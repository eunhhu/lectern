import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { MAX_PDF_BYTES } from "../src/api/v2/uploads.ts";
import { createUser, DATA_DIR, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// Lecture PDF uploads (P3-01, D-P3-2): with LECTERN_PDF=1 a PDF is checked for its type,
// its size (50 MiB) and its first bytes (%PDF-); with the flag off nothing changes. A PDF
// asset is served inline and never sniffed.

interface Res {
  status: number;
  body: any;
  res: Response;
}

async function api(
  method: string,
  path: string,
  user: UserRecord,
  init: { body?: unknown; headers?: Record<string, string>; raw?: Uint8Array } = {},
): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token, ...init.headers };
  let body: BodyInit | undefined = init.raw ? new Blob([init.raw as Uint8Array<ArrayBuffer>]) : undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, res };
}

const setPdf = (on: boolean) => {
  process.env.LECTERN_PDF = on ? "1" : "0";
  resetConfigForTests();
};

const audioBytes = () => new Uint8Array(randomBytes(1000));
const pdfBytes = (n = 100) => new TextEncoder().encode(`%PDF-1.4\n${"x".repeat(n)}`);
const text = (s: string) => new TextEncoder().encode(s);

interface FileSpec {
  kind: "audio" | "pdf";
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

const spec = (f: FileSpec) => ({ kind: f.kind, filename: f.filename, mime: f.mime, bytes: f.bytes.length });

/** Creates a session, sends every file as one part each, and completes it. */
async function upload(user: UserRecord, files: FileSpec[], extra: { recording_id?: string } = {}) {
  const created = await api("POST", "/uploads", user, {
    body: {
      workspace_id: personalWorkspaceId(user.id),
      ...(extra.recording_id ? { recording_id: extra.recording_id } : { recording: { title: generateId("pdf") } }),
      files: files.map(spec),
    },
  });
  expect(created.status).toBe(201);
  for (const [i, f] of files.entries()) {
    const part = created.body.files[i].first_part;
    const put = await api("PUT", `/uploads/${created.body.id}/parts/${part}`, user, {
      raw: f.bytes,
      headers: { "Content-Type": "application/octet-stream" },
    });
    expect(put.status).toBe(200);
  }
  const complete = await api("POST", `/uploads/${created.body.id}/complete`, user);
  return { id: created.body.id as string, complete };
}

const recordingAssets = async (user: UserRecord, recordingId: string) =>
  (await api("GET", `/recordings/${recordingId}`, user)).body.assets as Array<{ id: string; kind: string; mime: string; bytes: number }>;

let alice: UserRecord;
let bob: UserRecord;

beforeAll(() => {
  alice = createUser({ email: `${generateId("alice")}@example.com`, displayName: "alice", password: "correct_password_1" });
  bob = createUser({ email: `${generateId("bob")}@example.com`, displayName: "bob", password: "correct_password_1" });
});

afterEach(() => setPdf(false));

afterAll(() => {
  delete process.env.LECTERN_PDF;
  resetConfigForTests();
});

describe("PDF uploads with LECTERN_PDF=1", () => {
  let recordingId = "";
  let pdfAssetId = "";
  let audioAssetId = "";

  test("audio plus pdf in one recording", async () => {
    setPdf(true);
    const pdf = pdfBytes();
    const { complete } = await upload(alice, [
      { kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: audioBytes() },
      { kind: "pdf", filename: "slides.pdf", mime: "application/pdf", bytes: pdf },
    ]);
    expect(complete.status).toBe(200);
    recordingId = complete.body.recording.id;
    const assets = await recordingAssets(alice, recordingId);
    const pdfs = assets.filter((a) => a.kind === "pdf");
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]).toMatchObject({ mime: "application/pdf", bytes: pdf.length });
    pdfAssetId = pdfs[0]!.id;
    audioAssetId = assets.find((a) => a.kind.startsWith("audio"))!.id;
  });

  test("pdf only without recording is 400", async () => {
    setPdf(true);
    const res = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: personalWorkspaceId(alice.id),
        recording: { title: "PDF만" },
        files: [{ kind: "pdf", filename: "slides.pdf", mime: "application/pdf", bytes: 120 }],
      },
    });
    // The request schema already refuses a new recording without audio (domain
    // CreateUploadRequest), before the handler's own check.
    expect(res.status).toBe(400);
    expect(["validation_failed", "bad_request"]).toContain(res.body.error.code);
    expect(JSON.stringify(res.body.error)).toMatch(/audio|오디오/);
  });

  test("pdf attached to an existing recording", async () => {
    setPdf(true);
    const { complete } = await upload(alice, [{ kind: "pdf", filename: "more.pdf", mime: "application/pdf", bytes: pdfBytes(40) }], {
      recording_id: recordingId,
    });
    expect(complete.status).toBe(200);
    expect((await recordingAssets(alice, recordingId)).filter((a) => a.kind === "pdf")).toHaveLength(2);
  });

  test("oversize pdf is 413", async () => {
    setPdf(true);
    const res = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: personalWorkspaceId(alice.id),
        recording_id: recordingId,
        files: [{ kind: "pdf", filename: "big.pdf", mime: "application/pdf", bytes: MAX_PDF_BYTES + 1 }],
      },
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  test("exactly 50 MiB is accepted at create", async () => {
    setPdf(true);
    const res = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: personalWorkspaceId(alice.id),
        recording_id: recordingId,
        files: [{ kind: "pdf", filename: "edge.pdf", mime: "application/pdf", bytes: 50 * 1024 * 1024 }],
      },
    });
    expect(res.status).toBe(201);
  });

  test("wrong mime is 415", async () => {
    setPdf(true);
    const res = await api("POST", "/uploads", alice, {
      body: {
        workspace_id: personalWorkspaceId(alice.id),
        recording_id: recordingId,
        files: [{ kind: "pdf", filename: "a.pdf", mime: "text/plain", bytes: 20 }],
      },
    });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_media_type");
  });

  test("bad magic bytes is 400", async () => {
    setPdf(true);
    const uploads = join(DATA_DIR, "uploads");
    const before = new Set(readdirSync(uploads));
    const { id, complete } = await upload(alice, [{ kind: "pdf", filename: "fake.pdf", mime: "application/pdf", bytes: text("HELLO, not a PDF") }], {
      recording_id: recordingId,
    });
    expect(complete.status).toBe(400);
    expect(complete.body.error.code).toBe("bad_request");
    expect(complete.body.error.message).toContain("fake.pdf");
    expect(readdirSync(uploads).filter((f) => !before.has(f))).toEqual([]);
    expect((await api("GET", `/uploads/${id}`, alice)).body.status).toBe("open");
  });

  test("pdf content headers", async () => {
    setPdf(true);
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/assets/${pdfAssetId}/content`, { headers: { "X-Lectern-Token": alice.api_token } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer())).startsWith("%PDF-")).toBe(true);
  });

  test("audio content unchanged", async () => {
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/assets/${audioAssetId}/content`, { headers: { "X-Lectern-Token": alice.api_token } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition") ?? "").not.toContain("inline");
  });

  test("pdf of another user is 404", async () => {
    const res = await api("GET", `/assets/${pdfAssetId}/content`, bob);
    expect(res.status).toBe(404);
  });
});

describe("PDF uploads with LECTERN_PDF=0", () => {
  test("flag off keeps today's behaviour", async () => {
    setPdf(false);
    const { complete } = await upload(alice, [
      { kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: audioBytes() },
      { kind: "pdf", filename: "notes.pdf", mime: "text/plain", bytes: text("HELLO") },
    ]);
    expect(complete.status).toBe(200);
    const assets = await recordingAssets(alice, complete.body.recording.id);
    expect(assets.filter((a) => a.kind === "pdf")).toHaveLength(1);
  });
});
