import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { courseFolderId, personalWorkspaceId, verifyLegacy } from "@lectern/db";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  deleteUserAndData,
  generateId,
  getLectureById,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// The v1 contract the shipped clients depend on (macOS menu bar, Android, Windows tray, the
// iOS shortcut and app intent, the legacy web UI in ui.ts). The field lists come from the
// clients' decoders: macOS and Windows fail a whole list or note when one field they read
// is missing or has another type, so every key and its JSON type is pinned here. Since P2
// these routes are adapters over the v2 tables (ARCHITECTURE §5.3, §6); the last block
// checks that what they write lands there.

type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";
const typeOf = (v: unknown): JsonType => (v === null ? "null" : Array.isArray(v) ? "array" : (typeof v as JsonType));

/** `{ key: type }` for every key of `value`, so a test pins both the key set and the types. */
function shapeOf(value: Record<string, unknown>): Record<string, JsonType> {
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, typeOf(value[k])]));
}

function expectShape(value: Record<string, unknown>, expected: Record<string, JsonType | JsonType[]>) {
  expect(Object.keys(value).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, type] of Object.entries(expected)) {
    const allowed = Array.isArray(type) ? type : [type];
    expect(allowed, `${key}: ${typeOf(value[key])}`).toContain(typeOf(value[key]));
  }
}

/** toLectureSummaryDto: GET /api/lectures items, ingest responses, SSE payloads. */
const SUMMARY: Record<string, JsonType | JsonType[]> = {
  id: "string",
  share_token: "string",
  is_public: "boolean",
  title: "string",
  course: "string",
  date_label: "string",
  status: "string",
  stage: "string",
  stage_message: "string",
  progress: "number",
  excerpt: "string",
  duration_sec: "number",
  audio_size: "number",
  model_used: "string",
  has_audio: "boolean",
  created_at: "string",
  updated_at: "string",
};

/** The full lecture record: GET/PUT /api/lectures/{id}, visibility and audio deletion. */
const RECORD: Record<string, JsonType | JsonType[]> = {
  id: "string",
  owner_id: "string",
  share_token: "string",
  is_public: "boolean",
  title: "string",
  course: "string",
  date_label: "string",
  status: "string",
  stage: "string",
  stage_message: "string",
  progress: "number",
  markdown: "string",
  excerpt: "string",
  audio_path: ["string", "null"],
  audio_mime: ["string", "null"],
  audio_size: "number",
  audio_sha256: ["string", "null"],
  audio_original_size: "number",
  audio_compact_state: ["string", "null"],
  audio_compacted_at: ["string", "null"],
  duration_sec: "number",
  model_requested: "string",
  model_used: "string",
  source_client: "string",
  error_message: ["string", "null"],
  md_source_path: ["string", "null"],
  created_at: "string",
  updated_at: "string",
  has_audio: "boolean",
};

let seq = 0;
function makeUser(): UserRecord {
  return createUser({ email: `${generateId("v1c")}@example.com`, displayName: "계약 테스트", password: "correct_password_1" });
}

function seedLecture(owner: UserRecord, course = "정보보호개론"): string {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, "0123456789");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title: "대칭키 암호",
    course,
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 10,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "macos-native-menubar",
  });
  completeLectureRecord(id, {
    title: "대칭키 암호",
    courseName: course,
    markdown: "# 대칭키 암호\n\n## 🎯 핵심\n- [10:15] AES-GCM 인증 암호화",
    excerpt: "AES-GCM 인증 암호화",
    modelUsed: "gemini-3.8-flash",
    durationSec: 3600,
  });
  return id;
}

async function call(method: string, path: string, init: { user?: UserRecord; json?: unknown; headers?: Record<string, string>; body?: BodyInit } = {}) {
  const headers: Record<string, string> = { ...(init.user ? { "X-Lectern-Token": init.user.api_token } : {}), ...init.headers };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await handleRequest(new Request(`http://localhost${path}`, { method, headers, body }));
  const type = res.headers.get("content-type") || "";
  return { res, status: res.status, body: type.includes("application/json") ? ((await res.json()) as any) : await res.text() };
}

/** A multipart upload as the native clients build it (fields first, then `audio`). */
function multipart(fields: Record<string, string>, audio: { name: string; type: string; bytes: string }) {
  const boundary = `v1-contract-${++seq}`;
  let body = "";
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${audio.name}"\r\nContent-Type: ${audio.type}\r\n\r\n${audio.bytes}\r\n--${boundary}--\r\n`;
  return { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body };
}

let user: UserRecord;
let lectureId: string;

beforeAll(() => {
  user = makeUser();
  lectureId = seedLecture(user);
});

describe("v1 contract: reading", () => {
  test("GET /api/lectures: { lectures: Summary[], courses: string[] }", async () => {
    const { status, body } = await call("GET", "/api/lectures", { user });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["courses", "lectures"]);
    expect(body.courses).toEqual(["정보보호개론"]);
    expect(body.lectures).toHaveLength(1);
    expectShape(body.lectures[0], SUMMARY);
    expect(body.lectures[0]).toMatchObject({ id: lectureId, status: "done", has_audio: true, is_public: false, duration_sec: 3600 });

    const filtered = await call("GET", `/api/lectures?course=${encodeURIComponent("없는 과목")}`, { user });
    expect(filtered.body).toEqual({ lectures: [], courses: ["정보보호개론"] }); // courses is never filtered
    const searched = await call("GET", `/api/lectures?q=${encodeURIComponent("AES-GCM")}`, { user });
    expect(searched.body.lectures.map((l: any) => l.id)).toEqual([lectureId]);
  });

  test("GET /api/lectures/{id}: { lecture: Record, rendered: { html, toc } }", async () => {
    const { status, body } = await call("GET", `/api/lectures/${lectureId}`, { user });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["lecture", "rendered"]);
    expectShape(body.lecture, RECORD);
    expect(body.lecture.markdown).toContain("AES-GCM");
    expect(typeof body.rendered.html).toBe("string");
    expect(Array.isArray(body.rendered.toc)).toBe(true);
  });

  test("audio (Range, ?token= for players) and Markdown download", async () => {
    const audio = await handleRequest(new Request(`http://localhost/api/lectures/${lectureId}/audio?token=${user.api_token}`, { headers: { Range: "bytes=0-3" } }));
    expect(audio.status).toBe(206);
    expect(audio.headers.get("content-type")).toBe("audio/mp4");
    expect(await audio.text()).toBe("0123");
    const md = await call("GET", `/api/lectures/${lectureId}/markdown`, { user });
    expect(md.res.headers.get("content-type")).toStartWith("text/markdown");
    expect(md.body).toContain("AES-GCM");
  });

  test("errors are { error: string } with 401/403/404", async () => {
    const anonymous = await call("GET", "/api/lectures");
    expect(anonymous.status).toBe(401);
    expect(shapeOf(anonymous.body)).toEqual({ error: "string" });
    const stranger = makeUser();
    const forbidden = await call("GET", `/api/lectures/${lectureId}`, { user: stranger });
    expect(forbidden.status).toBe(403);
    expect(shapeOf(forbidden.body)).toEqual({ error: "string" });
    const missing = await call("GET", "/api/lectures/lec_missing", { user });
    expect(missing.status).toBe(404);
    expect(shapeOf(missing.body)).toEqual({ error: "string" });
  });
});

describe("v1 contract: writing", () => {
  test("PUT /api/lectures/{id} {title, course, markdown} answers { lecture: Record }", async () => {
    const id = seedLecture(user, "네트워크");
    const { status, body } = await call("PUT", `/api/lectures/${id}`, {
      user,
      json: { title: "TCP 혼잡 제어", course: "컴퓨터네트워크", markdown: "# TCP\n\n- 혼잡 윈도" },
    });
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["lecture"]);
    expectShape(body.lecture, RECORD);
    expect(body.lecture).toMatchObject({ title: "TCP 혼잡 제어", course: "컴퓨터네트워크", markdown: "# TCP\n\n- 혼잡 윈도" });
  });

  test("PATCH /api/lectures/{id}/visibility answers { ok, lecture: Record }", async () => {
    const { body } = await call("PATCH", `/api/lectures/${lectureId}/visibility`, { user, json: { is_public: true } });
    expect(Object.keys(body).sort()).toEqual(["lecture", "ok"]);
    expect(body.ok).toBe(true);
    expectShape(body.lecture, RECORD);
    expect(body.lecture.is_public).toBe(true);
    // The share page serves the notes with the token.
    const md = await handleRequest(new Request(`http://localhost/api/lectures/${lectureId}/markdown?share=${body.lecture.share_token}`));
    expect(md.status).toBe(200);
    await call("PATCH", `/api/lectures/${lectureId}/visibility`, { user, json: { is_public: false } });
  });

  test("POST /api/lectures/cleanup answers { ok, affectedCount, affectedIds, reclaimedBytes }", async () => {
    const { body } = await call("POST", "/api/lectures/cleanup", { user, json: { mode: "short_fragments" } });
    expect(shapeOf(body)).toEqual({ affectedCount: "number", affectedIds: "array", ok: "boolean", reclaimedBytes: "number" });
  });

  test("DELETE /api/lectures/{id}/audio and DELETE /api/lectures/{id}", async () => {
    const id = seedLecture(user, "삭제용");
    const audio = await call("DELETE", `/api/lectures/${id}/audio`, { user });
    expect(Object.keys(audio.body).sort()).toEqual(["lecture", "ok", "reclaimedBytes"]);
    expectShape(audio.body.lecture, RECORD);
    expect(audio.body.lecture.has_audio).toBe(false);
    const gone = await call("DELETE", `/api/lectures/${id}`, { user });
    expect(gone.body).toEqual({ ok: true, deletedId: id });
    expect((await call("GET", `/api/lectures/${id}`, { user })).status).toBe(404);
  });
});

describe("v1 contract: ingest", () => {
  test("macOS / Android / Windows: POST /api/ingest/shortcut?wait=false (multipart)", async () => {
    const form = multipart(
      { course: "운영체제", idempotency_key: "mac_contract_1" },
      { name: "lecture.m4a", type: "audio/mp4", bytes: "macos audio" }
    );
    const { status, body } = await call("POST", "/api/ingest/shortcut?wait=false", {
      user,
      headers: { ...form.headers, "X-Client": "macos-native-menubar", "X-Idempotency-Key": "mac_contract_1" },
      body: form.body,
    });
    expect(status).toBe(200);
    expectShape(body, { ok: "boolean", id: "string", status: "string", lecture: "object", url: "string", shareUrl: "string" });
    expect(body).toMatchObject({ ok: true, status: "processing" });
    expectShape(body.lecture, SUMMARY);
    expect(body.url).toEndWith(`/?lecture=${body.id}`);
    expect(body.shareUrl).toContain(`/s/${body.lecture.share_token}`);

    // The same idempotency key again: deduplicated, with the notes so far.
    const again = multipart({ course: "운영체제", idempotency_key: "mac_contract_1" }, { name: "lecture.m4a", type: "audio/mp4", bytes: "macos audio" });
    const dup = await call("POST", "/api/ingest/shortcut?wait=false", {
      user,
      headers: { ...again.headers, "X-Idempotency-Key": "mac_contract_1" },
      body: again.body,
    });
    expect(dup.body.deduplicated).toBe(true);
    expect(dup.body.id).toBe(body.id);
    expect(Object.keys(dup.body).sort()).toEqual(
      dup.body.retried
        ? ["deduplicated", "id", "lecture", "ok", "retried", "shareUrl", "status", "url"]
        : ["deduplicated", "id", "lecture", "markdown", "ok", "shareUrl", "status", "url"]
    );

    // Windows sends `source` in the form and no X-Client.
    const win = multipart({ course: "운영체제", source: "windows-native-tray", idempotency_key: "win_contract" }, { name: "a.wav", type: "audio/wav", bytes: "windows audio" });
    const winRes = await call("POST", "/api/ingest/shortcut?wait=false", { user, headers: { ...win.headers, "X-Idempotency-Key": "win_contract" }, body: win.body });
    expect(winRes.status).toBe(200);
    expect(getLectureById(winRes.body.id)!.source_client).toBe("windows-native-tray");
  });

  test("iOS shortcut: a raw body with X-Course", async () => {
    const res = await call("POST", "/api/ingest/shortcut?wait=false", {
      user,
      headers: { "Content-Type": "audio/mp4", "X-Course": encodeURIComponent("정보보호개론") },
      body: "ios raw audio",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "processing" });
    expect(getLectureById(res.body.id)!.course).toBe("정보보호개론");
  });

  test("web UI: POST /api/lectures/ingest answers { ok, lecture, url, shareUrl }", async () => {
    const form = multipart({ course: "웹 업로드", source: "web-upload", idempotency_key: "web_contract" }, { name: "r.webm", type: "audio/webm", bytes: "web audio" });
    const { status, body } = await call("POST", "/api/lectures/ingest", { user, headers: { ...form.headers, "X-Idempotency-Key": "web_contract" }, body: form.body });
    expect(status).toBe(200);
    expectShape(body, { ok: "boolean", lecture: "object", url: "string", shareUrl: "string" });
    expectShape(body.lecture, SUMMARY);
  });

  test("ingest without credentials is refused before anything is stored", async () => {
    const form = multipart({ course: "x" }, { name: "a.m4a", type: "audio/mp4", bytes: "x" });
    const res = await call("POST", "/api/ingest/shortcut?wait=false", { headers: form.headers, body: form.body });
    expect(res.status).toBe(401);
    expect(shapeOf(res.body)).toEqual({ error: "string" });
  });
});

describe("v1 adapter over the v2 tables", () => {
  test("v1 ingest and edits land in the v2 rows, and the lectures agree with them", async () => {
    const form = multipart({ course: "선형대수" }, { name: "x.m4a", type: "audio/mp4", bytes: "adapter audio" });
    const ingest = await call("POST", "/api/ingest/shortcut?wait=false", { user, headers: { ...form.headers, "X-Client": "android-compose" }, body: form.body });
    const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(ingest.body.id) as any;
    expect(recording).toMatchObject({
      workspace_id: personalWorkspaceId(user.id),
      folder_id: courseFolderId(user.id, "선형대수"),
      source_client: "android-compose",
      recorded_at_source: "upload",
    });

    await call("PUT", `/api/lectures/${ingest.body.id}`, { user, json: { title: "고윳값", course: "선형대수 심화", markdown: "# 고윳값" } });
    const moved = db
      .query(`SELECT r.title, f.name FROM recording r JOIN folder f ON f.id = r.folder_id WHERE r.id = ?`)
      .get(ingest.body.id) as any;
    expect(moved).toEqual({ title: "고윳값", name: "선형대수 심화" });
    const version = db
      .query(`SELECT v.created_by, v.author_id, v.rendered_md FROM document d JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.recording_id = ?`)
      .get(ingest.body.id) as any;
    expect(version).toEqual({ created_by: "user", author_id: user.id, rendered_md: "# 고윳값" });

    const report = verifyLegacy(db);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("clearing the notes from v1 keeps lectures and v2 rows in agreement", async () => {
    const id = seedLecture(user, "지울 노트");
    db.query(`UPDATE lectures SET md_source_path = ? WHERE id = ?`).run(`/archive/${id}_요약.md`, id);
    const cleared = await call("PUT", `/api/lectures/${id}`, { user, json: { title: "빈 노트", course: "지울 노트", markdown: "" } });
    expect(cleared.status).toBe(200);
    expect(verifyLegacy(db).mismatches).toEqual([]);
    expect(verifyLegacy(db).ok).toBe(true);
  });

  test("account deletion removes every lecture, even one whose v2 rows went missing", () => {
    const leaving = makeUser();
    const kept = seedLecture(leaving, "탈퇴");
    const orphaned = seedLecture(leaving, "탈퇴");
    db.query(`DELETE FROM recording WHERE id = ?`).run(orphaned); // a projection that never happened
    expect(deleteUserAndData(leaving.id)).toBe(true);
    expect(getLectureById(kept)).toBeNull();
    expect(getLectureById(orphaned)).toBeNull();
    expect(db.query(`SELECT COUNT(*) AS n FROM workspace WHERE id = ?`).get(personalWorkspaceId(leaving.id))).toEqual({ n: 0 });
  });
});
