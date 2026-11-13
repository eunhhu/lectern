import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lectureRecordingId, lectureShareLinkId, sha256Hex, uuidv7 } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  generateId,
  getLectureById,
  syncPendingLectures,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { PasswordLimiter } from "../src/share-page.ts";

// Share links (D-P2-3): creating, changing and revoking them over /api/v2, and the public
// page /s/:token they open (scope, expiry, password, attempt limit, escaping), including
// migrated v1 links.

interface Res {
  status: number;
  body: any;
  res: Response;
}

async function api(method: string, path: string, user: UserRecord, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, res };
}

async function v1(method: string, path: string, user: UserRecord, body?: unknown): Promise<Res> {
  const res = await handleRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "X-Lectern-Token": user.api_token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return { status: res.status, body: await res.json().catch(() => null), res };
}

const page = (path: string, init: RequestInit = {}) => handleRequest(new Request(`http://localhost${path}`, init));

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

/** A finished v1 lecture with an audio file under uploads; returns its recording id too. */
function seedLecture(owner: UserRecord, title = "운영체제 3주차", markdown = `# ${title}\n\n## 핵심\n- [01:30] 공유 문서 본문 FCFS`): { id: string; recordingId: string } {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, `audio of ${id}`);
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "운영체제",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: `audio of ${id}`.length,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  completeLectureRecord(id, { title, courseName: "운영체제", markdown, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 300 });
  syncPendingLectures();
  return { id, recordingId: lectureRecordingId(id) };
}

function seedTranscript(recordingId: string, texts: string[]) {
  const rec = db.query(`SELECT workspace_id FROM recording WHERE id = ?`).get(recordingId) as { workspace_id: string };
  texts.forEach((text, idx) =>
    db
      .query(
        `INSERT INTO transcript_segment (workspace_id, recording_id, idx, start_ms, end_ms, speaker_id, text, confidence, source_chunk, lang)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'ko')`
      )
      .run(rec.workspace_id, recordingId, idx, idx * 5000, idx * 5000 + 4000, text)
  );
}

async function createLink(user: UserRecord, recordingId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; token: string; res: Res }> {
  const res = await api("POST", "/share-links", user, { target_type: "recording", target_id: recordingId, scope: { transcript: false, audio: false }, ...extra });
  const token = res.status === 201 ? String(res.body.url).split("/s/")[1]! : "";
  return { id: res.body?.link?.id, token, res };
}

const form = (password: string, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  body: new URLSearchParams({ password }).toString(),
});

describe("share links over /api/v2", () => {
  test("create: 201 with a one-time URL, only the hash stored", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    const { token, res } = await createLink(alice, recordingId);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);
    expect(res.body.link).toMatchObject({ target_type: "recording", target_id: recordingId, has_password: false, revoked_at: null });
    expect(res.body.link).not.toHaveProperty("token_hash");
    expect(res.body.link).not.toHaveProperty("password_hash");
    expect(JSON.stringify(db.query(`SELECT * FROM share_link`).all())).not.toContain(token);
    expect((db.query(`SELECT token_hash FROM share_link WHERE id = ?`).get(res.body.link.id) as { token_hash: string }).token_hash).toBe(sha256Hex(token));
  });

  test("an expiry in the past is refused", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    const { res } = await createLink(alice, recordingId, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    expect(res.status).toBe(400);
  });

  test("permissions: workspace viewer 403, outsider 404, sharing restricted 403", async () => {
    const alice = makeUser("alice");
    const viewer = makeUser("viewer");
    const outsider = makeUser("outsider");
    const { recordingId } = seedLecture(alice);
    const workspace = (db.query(`SELECT workspace_id FROM recording WHERE id = ?`).get(recordingId) as { workspace_id: string }).workspace_id;
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'viewer', ?, ?)`).run(workspace, viewer.id, now, now);
    expect((await api("PATCH", `/recordings/${recordingId}`, alice, { visibility: "workspace" })).status).toBe(200);

    expect((await createLink(viewer, recordingId)).res.status).toBe(403);
    expect((await createLink(outsider, recordingId)).res.status).toBe(404);

    db.query(`UPDATE users SET can_share = 0 WHERE id = ?`).run(alice.id);
    const restricted = await createLink(alice, recordingId);
    expect(restricted.res.status).toBe(403);
    expect(restricted.res.body.error.message).toBe("외부 공유 링크 공개 권한이 제한된 계정입니다.");
  });

  test("revoke: 204, then the page is gone", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    const { id, token } = await createLink(alice, recordingId);
    expect((await page(`/s/${token}`)).status).toBe(200);
    expect((await api("DELETE", `/share-links/${id}`, alice)).status).toBe(204);
    expect((await api("DELETE", `/share-links/${id}`, alice)).status).toBe(204);
    expect((await page(`/s/${token}`)).status).toBe(404);
    expect((await api("PATCH", `/share-links/${id}`, alice, { password: null })).status).toBe(404);
  });
});

describe("the public page /s/:token", () => {
  test("opens with the title and the document", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice, "공유 테스트 강의");
    const { token } = await createLink(alice, recordingId);
    const res = await page(`/s/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain("<h1>공유 테스트 강의</h1>");
    expect(html).toContain("공유 문서 본문 FCFS");
    expect(html).toContain('class="ts-chip" data-sec="90"');
  });

  test("out of scope: no transcript and no audio in the markup", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    seedTranscript(recordingId, ["범위 밖 전사 문장 하나", "범위 밖 전사 문장 둘"]);
    const { token } = await createLink(alice, recordingId);
    const html = await (await page(`/s/${token}`)).text();
    expect(html).not.toContain("범위 밖 전사 문장");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("/audio");
    expect((await page(`/s/${token}/audio`)).status).toBe(404);
  });

  test("in scope: transcript and audio", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    seedTranscript(recordingId, ["범위 안 전사 문장"]);
    const { token } = await createLink(alice, recordingId, { scope: { transcript: true, audio: true } });
    const html = await (await page(`/s/${token}`)).text();
    expect(html).toContain("범위 안 전사 문장");
    expect(html).toContain('<section class="transcript" aria-label="전사">');
    expect(html).toContain("<audio");
    const audio = await page(`/s/${token}/audio`, { headers: { Range: "bytes=0-3" } });
    expect([200, 206]).toContain(audio.status);
    expect(audio.headers.get("cache-control")).toBe("private, no-store");
    const markdown = await page(`/s/${token}/markdown`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-disposition")).toContain("filename*=UTF-8''");
  });

  test("an expired link is 410", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    const token = `expired-${generateId("tok")}`;
    const workspace = (db.query(`SELECT workspace_id FROM recording WHERE id = ?`).get(recordingId) as { workspace_id: string }).workspace_id;
    db.query(
      `INSERT INTO share_link (id, workspace_id, target_type, target_id, token_hash, scope_json, expires_at, password_hash, created_by, created_at, revoked_at)
       VALUES (?, ?, 'recording', ?, ?, '{"transcript":false,"audio":false}', ?, NULL, ?, ?, NULL)`
    ).run(uuidv7(), workspace, recordingId, sha256Hex(token), Date.now() - 1000, alice.id, Date.now() - 60_000);
    const res = await page(`/s/${token}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toBe("만료된 공유 링크입니다.");
  });

  test("password: form, wrong, right, cookie, and a changed password", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice, "비밀번호 강의");
    const { id, token } = await createLink(alice, recordingId, { password: "correct-horse-1" });

    const locked = await page(`/s/${token}`);
    expect(locked.status).toBe(200);
    const lockedHtml = await locked.text();
    expect(lockedHtml).toContain('name="password"');
    expect(lockedHtml).not.toContain("공유 문서 본문");
    expect((await page(`/s/${token}/markdown`)).status).toBe(404);

    const wrong = await page(`/s/${token}`, form("wrong-password"));
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toContain("비밀번호가 올바르지 않습니다.");
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await page(`/s/${token}`, form("correct-horse-1"));
    expect(right.status).toBe(303);
    expect(right.headers.get("location")).toBe(`/s/${token}`);
    const cookie = right.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Path=/s/${token}`);
    const pair = cookie.split(";")[0]!;
    const open = await (await page(`/s/${token}`, { headers: { Cookie: pair } })).text();
    expect(open).toContain("공유 문서 본문");

    expect((await api("PATCH", `/share-links/${id}`, alice, { password: "another-horse-2" })).body.has_password).toBe(true);
    const again = await (await page(`/s/${token}`, { headers: { Cookie: pair } })).text();
    expect(again).toContain('name="password"');
  });

  test("the eleventh attempt in a minute is 429", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice);
    const { token } = await createLink(alice, recordingId, { password: "correct-horse-1" });
    for (let i = 0; i < 10; i++) expect((await page(`/s/${token}`, form(`wrong-${i}`))).status).toBe(403);
    const limited = await page(`/s/${token}`, form("correct-horse-1"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  test("PasswordLimiter: ten a minute", () => {
    const limiter = new PasswordLimiter(10, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(limiter.allow("k", t0 + i)).toBe(true);
    expect(limiter.allow("k", t0 + 100)).toBe(false);
    expect(limiter.allow("other", t0 + 100)).toBe(true);
    expect(limiter.allow("k", t0 + 60_010)).toBe(true);
  });

  test("hostile titles and Markdown are escaped; no inline script, style or other origin", async () => {
    const alice = makeUser("alice");
    const { recordingId } = seedLecture(alice, `<script>alert(1)</script>"onmouseover=`, "# x\n\n<img src=x onerror=alert(1)>\n");
    const { token } = await createLink(alice, recordingId);
    const html = await (await page(`/s/${token}`)).text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toContain("style=");
    expect(html).not.toContain("https://");
  });

  test("migrated v1 links open the new page and close with the lecture", async () => {
    const alice = makeUser("alice");
    const { id } = seedLecture(alice, "v1 공유 강의");
    const shareToken = getLectureById(id)!.share_token;
    expect((await v1("PATCH", `/api/lectures/${id}/visibility`, alice, { is_public: true })).status).toBe(200);
    const open = await page(`/s/${shareToken}`);
    expect(open.status).toBe(200);
    expect(await open.text()).toContain("/share-assets/share.css");

    expect((await v1("PATCH", `/api/lectures/${id}/visibility`, alice, { is_public: false })).status).toBe(200);
    const closed = await page(`/s/${shareToken}`);
    expect(closed.status).toBe(403);
    expect(await closed.text()).toContain("비공개로 설정된 강의 노트입니다.");
  });

  test("revoking a migrated v1 link makes the lecture private, and it stays revoked", async () => {
    const alice = makeUser("alice");
    const { id } = seedLecture(alice, "v1 회수 강의");
    expect((await v1("PATCH", `/api/lectures/${id}/visibility`, alice, { is_public: true })).status).toBe(200);
    syncPendingLectures();
    const linkId = lectureShareLinkId(id);
    expect((await api("DELETE", `/share-links/${linkId}`, alice)).status).toBe(204);
    expect(getLectureById(id)!.is_public).toBe(0);
    syncPendingLectures();
    expect((db.query(`SELECT revoked_at FROM share_link WHERE id = ?`).get(linkId) as { revoked_at: number | null }).revoked_at).not.toBeNull();
    expect((await page(`/s/${getLectureById(id)!.share_token}`)).status).toBe(403);
  });

  test("an unknown token keeps the v1 sentence", async () => {
    const res = await page("/s/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("공유된 강의 노트를 찾을 수 없습니다.");
  });

  test("static assets", async () => {
    const js = await page("/share-assets/share.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toStartWith("text/javascript");
    const css = await page("/share-assets/share.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toStartWith("text/css");
  });
});
