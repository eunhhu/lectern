import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterEach, describe, expect, test } from "bun:test";
import { basename, resolve, sep } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { PART_SIZE } from "../../src/api/v2/uploads.ts";
import { DATA_DIR, getLectureById, type UserRecord } from "../../src/db.ts";
import { makeUser, tokenAuth, v2, type Res } from "./helpers.ts";

// P5-15 · Upload input (resumable uploads, /api/v2/uploads) and serving what was uploaded
// (/api/v2/assets/{id}/content): file types, names, part numbers and sizes, other people's
// sessions and files.

afterEach(() => {
  delete process.env.LECTERN_PDF;
  resetConfigForTests();
});

const audioFile = (filename: string, mime = "audio/mpeg", bytes = 1024) => ({ kind: "audio", filename, mime, bytes });

const createUpload = (user: UserRecord, files: unknown[], extra: Record<string, unknown> = {}) =>
  v2("POST", "/uploads", { headers: tokenAuth(user), body: { workspace_id: personalWorkspaceId(user.id), files, ...extra } });

const putPart = (user: UserRecord, uploadId: string, part: number | string, bytes: Uint8Array<ArrayBuffer>) =>
  v2("PUT", `/uploads/${uploadId}/parts/${part}`, { headers: { ...tokenAuth(user), "Content-Type": "application/octet-stream" }, raw: bytes });

const complete = (user: UserRecord, uploadId: string) => v2("POST", `/uploads/${uploadId}/complete`, { headers: tokenAuth(user) });

/** Uploads one audio file all the way; returns the completion answer. */
async function uploadAudio(user: UserRecord, filename: string, mime = "audio/mpeg"): Promise<Res> {
  const bytes = new TextEncoder().encode(`${filename} ${crypto.randomUUID()}`.padEnd(1024, "x"));
  const created = await createUpload(user, [audioFile(filename, mime, bytes.length)]);
  expect(created.status, filename).toBe(201);
  expect((await putPart(user, created.body.id, 1, bytes)).status).toBe(200);
  const done = await complete(user, created.body.id);
  expect(done.status, filename).toBe(200);
  return done;
}

/** The stored audio of an upload must be a plain file name inside the data directory. */
function expectSafeStoredPath(done: Res, forbidden: RegExp) {
  const path = getLectureById(done.body.recording.id)!.audio_path!;
  expect(resolve(path).startsWith(resolve(DATA_DIR) + sep), path).toBe(true);
  expect(basename(path)).toMatch(/^[A-Za-z0-9_.-]+$/);
  expect(basename(path)).not.toMatch(forbidden);
}

describe("security: uploads", () => {
  test("rejects a non-audio file", async () => {
    const user = makeUser();
    for (const file of [audioFile("x.html", "text/html"), audioFile("x.svg", "image/svg+xml"), { kind: "image", filename: "x.html", mime: "text/html", bytes: 10 }]) {
      const res = await createUpload(user, [file]);
      expect([400, 415], JSON.stringify(file)).toContain(res.status);
    }
  });

  test("rejects a mismatched extension", async () => {
    const user = makeUser();
    const res = await createUpload(user, [audioFile("x.exe")]);
    if (res.status === 400 || res.status === 415) return;
    // Accepted for its audio type: the stored name takes the type's extension, not the name's.
    expectSafeStoredPath(await uploadAudio(user, "x.exe"), /\.exe$/i);
  });

  test("path traversal in the file name", async () => {
    const user = makeUser();
    for (const name of ["../../etc/passwd", "..\\..\\x.mp3", "/abs/x.mp3", "a\u0000b.mp3", "../../../tmp/evil.mp3"]) {
      const created = await createUpload(user, [audioFile(name)]);
      if (created.status === 400 || created.status === 415) continue;
      expect(created.status, JSON.stringify(name)).toBe(201);
      expectSafeStoredPath(await uploadAudio(user, name), /passwd|\.\.|[\\/]/);
    }
  });

  test("part numbers out of range", async () => {
    const user = makeUser();
    const created = await createUpload(user, [audioFile("lecture.mp3")]);
    for (const part of ["0", "-1", "100000", "1.5", "abc"]) {
      const res = await putPart(user, created.body.id, part, new Uint8Array(1024));
      expect(res.status, part).toBe(400);
    }
  });

  test("oversized part", async () => {
    const user = makeUser();
    const created = await createUpload(user, [audioFile("lecture.mp3", "audio/mpeg", 1024)]);
    expect((await putPart(user, created.body.id, 1, new Uint8Array(4096))).status).toBe(413);
    // A file bigger than the server takes is refused before any part.
    expect((await createUpload(user, [audioFile("huge.mp3", "audio/mpeg", 5 * 1024 ** 4)])).status).toBe(413);
    expect(PART_SIZE).toBeGreaterThan(0);
  });

  test("someone else's upload session", async () => {
    const a = makeUser();
    const b = makeUser();
    const created = await createUpload(a, [audioFile("lecture.mp3", "audio/mpeg", 1024)]);
    const id = created.body.id;
    expect((await v2("GET", `/uploads/${id}`, { headers: tokenAuth(b) })).status).toBe(404);
    expect((await putPart(b, id, 1, new Uint8Array(1024))).status).toBe(404);
    expect((await complete(b, id)).status).toBe(404);
    expect((await v2("DELETE", `/uploads/${id}`, { headers: tokenAuth(b) })).status).toBe(404);
    // A's session is untouched.
    expect((await v2("GET", `/uploads/${id}`, { headers: tokenAuth(a) })).body.received_parts).toEqual([]);
  });

  test("asset content needs access", async () => {
    const a = makeUser();
    const b = makeUser();
    const done = await uploadAudio(a, "private.mp3");
    const detail = await v2("GET", `/recordings/${done.body.recording.id}`, { headers: tokenAuth(a) });
    const assetId = detail.body.assets[0].id;
    expect((await v2("GET", `/assets/${assetId}/content`, { headers: tokenAuth(a) })).status).toBe(200);
    const foreign = await v2("GET", `/assets/${assetId}/content`, { headers: tokenAuth(b) });
    expect(foreign.status).toBe(404);
    expect(foreign.text).not.toContain("private.mp3");
    expect((await v2("GET", `/assets/${assetId}/content`)).status).toBe(401);
  });

  test("served files are not executable in the browser", async () => {
    process.env.LECTERN_PDF = "1";
    resetConfigForTests();
    const user = makeUser();
    const done = await uploadAudio(user, "lecture.mp3");
    const recordingId = done.body.recording.id;
    // A PDF whose body is HTML after the magic bytes: still served as a PDF.
    const pdf = new TextEncoder().encode("%PDF-1.4\n<html><script>alert(1)</script></html>\n%%EOF\n");
    const added = await createUpload(user, [{ kind: "pdf", filename: "slides.pdf", mime: "application/pdf", bytes: pdf.length }], { recording_id: recordingId });
    expect(added.status).toBe(201);
    expect((await putPart(user, added.body.id, 1, pdf)).status).toBe(200);
    expect((await complete(user, added.body.id)).status).toBe(200);
    const assets = (await v2("GET", `/recordings/${recordingId}`, { headers: tokenAuth(user) })).body.assets as { id: string; kind: string }[];
    expect(assets.map((a) => a.kind).sort()).toEqual(["audio", "pdf"]);
    for (const asset of assets) {
      const res = await v2("GET", `/assets/${asset.id}/content`, { headers: tokenAuth(user) });
      expect(res.status, asset.kind).toBe(200);
      const type = (res.res.headers.get("Content-Type") ?? "").toLowerCase();
      expect(res.res.headers.get("X-Content-Type-Options"), asset.kind).toBe("nosniff");
      expect(type, asset.kind).not.toMatch(/html|xml|javascript|svg/);
      expect(type, asset.kind).toMatch(asset.kind === "pdf" ? /^application\/pdf/ : /^audio\//);
    }
  });
});
