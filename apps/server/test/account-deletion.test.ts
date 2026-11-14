import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakeEmbedder, type AskModel, type AskModelEvent } from "@lectern/ask";
import { config, resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId, placeRecordingInWorkspace, projectLecture, uuidv7, verifyLegacy } from "@lectern/db";
import { AccountDeletionInfo, ApiError } from "@lectern/domain";
import { createPat } from "../src/access-tokens.ts";
import {
  ACCOUNT_DELETION_JOB_KIND,
  DELETION_GRACE_MS,
  deletionOf,
  enqueueDueDeletions,
  executeDeletion,
  requestDeletion,
  USER_TABLES,
} from "../src/account-deletion.ts";
import { createApiV2App } from "../src/api/v2/index.ts";
import { indexLecture } from "../src/ask/index-job.ts";
import { createAskService } from "../src/ask/service.ts";
import {
  completeLectureRecord,
  createPendingLecture,
  createSession,
  createUser,
  db,
  deleteUserAndData,
  generateId,
  getLectureById,
  getUserById,
  recordAuditLog,
  type UserRecord,
} from "../src/db.ts";
import { exportDir, runExportJob } from "../src/export/job.ts";
import { createOAuthState } from "../src/google/oauth.ts";
import { sealGoogleTokens } from "../src/google/tokens.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { createInvite } from "../src/invites.ts";
import { logger } from "../src/log.ts";
import { issueNativePair } from "../src/native-auth.ts";
import { linkIdentity } from "../src/oauth/login.ts";
import { embeddedWorker, JobWorker, type JobWorker as Worker } from "../src/queue.ts";
import { recordSessionMeta } from "../src/session-meta.ts";
import { refreshLedger, setQuota } from "../src/usage.ts";
import { createFakeGoogle } from "./fakes/google.ts";

// Account deletion (P5-09, D-P5-9): the request and its 7 days of grace, then the deletion
// itself, which must leave the user's id, personal workspace id and e-mail in no text column
// of any table. Google is faked; the model is scripted; nothing leaves the machine.

const google = createFakeGoogle();
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "correct_password_1";

class SilentModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  async *stream(): AsyncIterable<AskModelEvent> {
    yield { type: "text", text: "노트에 따르면 스택은 LIFO입니다." };
    yield { type: "done", usage: { inputTokens: 1_000, cachedTokens: 0, outputTokens: 50 }, finish: "stop", requestId: "r1" };
  }
}
const embedder = new FakeEmbedder(64);
const askService = createAskService({ model: new SilentModel(), embedder, monthlyLimitMicrousd: 1_000_000_000 });
const app = createApiV2App({ askService: () => askService });

// This file runs account_deletion itself: the shared embedded worker must not lease its jobs.
let paused: Worker | null = null;

beforeAll(async () => {
  google.install();
  Object.assign(process.env, { LECTERN_WORKER_MODE: "external", LECTERN_TEAMS: "1" });
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
beforeEach(() => resetAuthRateLimits());
afterAll(() => {
  db.query(`DELETE FROM job WHERE kind IN (?, 'export') AND state = 'queued'`).run(ACCOUNT_DELETION_JOB_KIND);
  google.restore();
  delete process.env.LECTERN_WORKER_MODE;
  delete process.env.LECTERN_TEAMS;
  resetConfigForTests();
  paused?.start();
});

const newUser = (name = "삭제테스트") =>
  createUser({ email: `${generateId("del")}@test.local`, displayName: `${name}-${generateId("n")}`, password: PASSWORD });

/** A web session: the cookie the browser sends. */
const sessionOf = (u: UserRecord) => createSession(u.id);

async function call(token: string, method: string, path: string, body?: unknown, viaHeader = false): Promise<Response> {
  const headers: Record<string, string> = viaHeader ? { "X-Lectern-Token": token } : { Cookie: `lectern_session=${encodeURIComponent(token)}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** `null` sends no password at all. */
const requestIt = (token: string, password: string | null = PASSWORD) => call(token, "POST", "/me/deletion", password === null ? {} : { password });

async function scheduled(u: UserRecord): Promise<AccountDeletionInfo> {
  const res = await requestIt(sessionOf(u));
  expect(res.status).toBe(200);
  return AccountDeletionInfo.parse(await res.json());
}

/** Moves the user's deletion date into the past. */
const makeDue = (u: UserRecord) => db.query(`UPDATE account_deletion SET execute_after = ? WHERE user_id = ?`).run(Date.now() - 1, u.id);

async function v1Login(email: string, password = PASSWORD): Promise<number> {
  const res = await handleRequest(
    new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })
  );
  await res.body?.cancel();
  return res.status;
}

/** A processed lecture with an audio file in the sandboxed lectures directory. */
function lecture(owner: UserRecord, title: string): { lectureId: string; recordingId: string; audioPath: string } {
  const id = generateId("lec");
  // Where v1 keeps uploaded audio (db.ts deletes lecture audio only there).
  mkdirSync(join(config().dataDir, "uploads"), { recursive: true });
  const audioPath = join(config().dataDir, "uploads", `${id}.m4a`);
  writeFileSync(audioPath, crypto.getRandomValues(new Uint8Array(2048)));
  createPendingLecture({
    id,
    ownerId: owner.id,
    title,
    course: "자료구조",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 2048,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "web",
  });
  completeLectureRecord(id, { title, courseName: "자료구조", markdown: `# ${title}\n\n스택은 나중에 넣은 것을 먼저 꺼낸다.\n`, excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 600 });
  return { lectureId: id, recordingId: lectureRecordingId(id), audioPath };
}

async function team(owner: UserRecord, name: string): Promise<string> {
  const res = await call(sessionOf(owner), "POST", "/workspaces", { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function join_(workspaceId: string, u: UserRecord, role: string) {
  const now = Date.now();
  db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, u.id, role, now, now);
}

/** Every (table, column) whose text contains one of the needles, with the count. */
function traces(needles: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const tables = db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const cols = (db.query(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; type: string }>).filter((c) => /TEXT|^$/i.test(c.type));
    for (const col of cols) {
      for (const needle of needles) {
        const n = (db.query(`SELECT COUNT(*) AS n FROM "${name}" WHERE instr("${col.name}", ?) > 0`).get(needle) as { n: number }).n;
        if (n) out[`${name}.${col.name}`] = (out[`${name}.${col.name}`] ?? 0) + n;
      }
    }
  }
  return out;
}

describe("requesting", () => {
  test("request needs the password", async () => {
    const u = newUser();
    const token = sessionOf(u);
    const wrong = await requestIt(token, "wrong_password_9");
    expect(wrong.status).toBe(403);
    expect(ApiError.parse(await wrong.json()).error.message).toBe("비밀번호가 올바르지 않습니다.");
    expect((await requestIt(token, null)).status).toBe(403);
    expect(deletionOf(u.id).state).toBe("none");

    const ok = await requestIt(token);
    expect(ok.status).toBe(200);
    const info = AccountDeletionInfo.parse(await ok.json());
    expect(info.state).toBe("scheduled");
    expect(Date.parse(info.execute_after!) - Date.parse(info.requested_at!)).toBe(DELETION_GRACE_MS);
    expect(AccountDeletionInfo.parse(await (await call(token, "GET", "/me/deletion")).json())).toEqual(info);
  });

  test("wrong passwords are limited per user", async () => {
    const u = newUser();
    const token = sessionOf(u);
    for (let i = 0; i < 5; i++) expect((await requestIt(token, "wrong_password_9")).status).toBe(403);
    const limited = await requestIt(token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  test("an account without a password needs a fresh sign-in", async () => {
    const u = newUser();
    linkIdentity(u.id, { provider: "google", subject: generateId("sub"), email: u.email });
    const old = sessionOf(u);
    db.query(`UPDATE sessions SET created_at = ? WHERE token = ?`).run(new Date(Date.now() - 11 * 60_000).toISOString(), old);
    const stale = await requestIt(old, null);
    expect(stale.status).toBe(403);
    expect(ApiError.parse(await stale.json()).error.message).toBe("보안을 위해 다시 로그인한 뒤 10분 안에 요청해 주세요.");
    expect((await requestIt(sessionOf(u), null)).status).toBe(200);
  });

  test("tokens cannot request deletion", async () => {
    const u = newUser();
    const { secret } = createPat({ userId: u.id, workspaceId: personalWorkspaceId(u.id), name: "ci", scopes: ["recordings:read", "recordings:write"], expiresAt: null });
    const native = issueNativePair({ userId: u.id, deviceName: "iPhone", platform: "ios" });
    for (const token of [secret, native.accessToken, u.api_token]) {
      const res = await call(token, "POST", "/me/deletion", { password: PASSWORD }, true);
      expect(res.status).toBe(403);
    }
    expect(deletionOf(u.id).state).toBe("none");
  });

  test("sole owner of a team with members", async () => {
    const owner = newUser();
    const ws = await team(owner, "알고리즘 스터디");
    join_(ws, newUser(), "member");
    const res = await requestIt(sessionOf(owner));
    expect(res.status).toBe(409);
    const body = ApiError.parse(await res.json());
    expect(body.error.message).toContain('"알고리즘 스터디" 워크스페이스의 유일한 owner입니다.');
    expect(body.error.details).toEqual({ workspaces: [ws] });
  });

  test("still usable during the grace period", async () => {
    const u = newUser();
    await scheduled(u);
    expect(await v1Login(u.email)).toBe(200);
    const token = sessionOf(u);
    expect((await call(token, "GET", "/recordings?workspace_id=" + personalWorkspaceId(u.id))).status).toBe(200);
    const upload = await call(token, "POST", "/uploads", {
      workspace_id: personalWorkspaceId(u.id),
      files: [{ kind: "audio", filename: "a.m4a", mime: "audio/mp4", bytes: 10, sha256: "a".repeat(64) }],
    });
    expect(upload.status).toBe(201);
  });

  test("cancel", async () => {
    const u = newUser();
    await scheduled(u);
    const token = sessionOf(u);
    const res = await call(token, "DELETE", "/me/deletion");
    expect(AccountDeletionInfo.parse(await res.json())).toEqual({ state: "none", requested_at: null, execute_after: null });
    expect(AccountDeletionInfo.parse(await (await call(token, "GET", "/me/deletion")).json()).state).toBe("none");
    enqueueDueDeletions(Date.now() + 8 * DAY); // other users' deletions in this file may be queued
    expect(db.query(`SELECT 1 FROM job WHERE kind = ? AND subject_id = ?`).get(ACCOUNT_DELETION_JOB_KIND, u.id)).toBeNull();
    db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(ACCOUNT_DELETION_JOB_KIND);
  });

  test("requesting twice keeps the date", async () => {
    const u = newUser();
    const first = requestDeletion(u.id, Date.now());
    const again = requestDeletion(u.id, Date.now() + DAY);
    expect(again).toEqual(first);
  });

  test("a new request after a cancel starts a fresh 7 days", async () => {
    const u = newUser();
    requestDeletion(u.id, Date.now() - 10 * DAY); // long past due
    await call(sessionOf(u), "DELETE", "/me/deletion");
    const info = await scheduled(u);
    expect(Date.parse(info.execute_after!)).toBeGreaterThan(Date.now() + DELETION_GRACE_MS - 60_000);
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).not.toBeNull();
  });
});

describe("executing", () => {
  test("not before the date", async () => {
    const u = newUser();
    await scheduled(u);
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).not.toBeNull();
    expect(enqueueDueDeletions()).toBe(0);
  });

  test("a job queued before a cancel finds nothing to do", async () => {
    const u = newUser();
    await scheduled(u);
    makeDue(u);
    expect(enqueueDueDeletions()).toBe(1);
    expect(enqueueDueDeletions()).toBe(0); // already queued
    db.query(`UPDATE account_deletion SET state = 'canceled' WHERE user_id = ?`).run(u.id); // canceled behind the queue's back
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).not.toBeNull();
    db.query(`DELETE FROM job WHERE kind = ? AND subject_id = ?`).run(ACCOUNT_DELETION_JOB_KIND, u.id);
  });

  test("a running job holds the deletion back", async () => {
    const u = newUser();
    await scheduled(u);
    makeDue(u);
    const jobId = `job_${generateId("run")}`;
    db.query(`INSERT INTO job (id, owner_id, kind, state, run_after, created_at) VALUES (?, ?, 'process', 'running', ?, ?)`).run(jobId, u.id, Date.now(), Date.now());
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).not.toBeNull();
    expect((db.query(`SELECT cancel_requested_at FROM job WHERE id = ?`).get(jobId) as { cancel_requested_at: number | null }).cancel_requested_at).not.toBeNull();
    db.query(`UPDATE job SET state = 'canceled' WHERE id = ?`).run(jobId);
    expect(await executeDeletion(u.id)).toBe("done");
  });

  test("idempotent, and login fails afterwards", async () => {
    const u = newUser();
    await scheduled(u);
    makeDue(u);
    expect(await executeDeletion(u.id)).toBe("done");
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).toBeNull();
    expect(await v1Login(u.email)).toBe(401);
  });

  test("team recordings", async () => {
    const owner = newUser("owner");
    const member = newUser("member");
    const ws = await team(owner, "팀");
    join_(ws, member, "member");
    const shared = lecture(member, "공유 강의");
    const secret = lecture(member, "비공개 강의");
    placeRecordingInWorkspace(db, shared.recordingId, ws, "workspace");
    placeRecordingInWorkspace(db, secret.recordingId, ws, "private");

    requestDeletion(member.id, Date.now() - DELETION_GRACE_MS - 1);
    expect(await executeDeletion(member.id)).toBe("done");

    const kept = db.query(`SELECT workspace_id, created_by, visibility FROM recording WHERE id = ?`).get(shared.recordingId);
    expect(kept).toEqual({ workspace_id: ws, created_by: owner.id, visibility: "workspace" });
    expect(getLectureById(shared.lectureId)?.owner_id).toBe(owner.id);
    expect(existsSync(shared.audioPath)).toBe(true);
    // A later projection pass leaves it where it is.
    projectLecture(db, shared.lectureId);
    expect(db.query(`SELECT workspace_id, created_by FROM recording WHERE id = ?`).get(shared.recordingId)).toEqual({ workspace_id: ws, created_by: owner.id });
    expect(verifyLegacy(db).ok).toBe(true);

    expect(db.query(`SELECT 1 FROM recording WHERE id = ?`).get(secret.recordingId)).toBeNull();
    expect(getLectureById(secret.lectureId)).toBeNull();
    expect(traces([member.id, member.email])).toEqual({});
  });

  test("solo team is removed", async () => {
    const u = newUser();
    const ws = await team(u, "혼자 쓰는 팀");
    const rec = lecture(u, "팀 강의");
    placeRecordingInWorkspace(db, rec.recordingId, ws, "workspace");
    // A former member's recording stays in the team after they left: it goes back to them.
    const former = newUser("former");
    const theirs = lecture(former, "나간 사람의 강의");
    placeRecordingInWorkspace(db, theirs.recordingId, ws, "workspace");

    requestDeletion(u.id, Date.now() - DELETION_GRACE_MS - 1);
    expect(await executeDeletion(u.id)).toBe("done");
    expect(db.query(`SELECT 1 FROM workspace WHERE id = ?`).get(ws)).toBeNull();
    expect(traces([ws, u.id, u.email])).toEqual({});
    expect(db.query(`SELECT 1 FROM recording WHERE id = ?`).get(rec.recordingId)).toBeNull();
    expect(db.query(`SELECT workspace_id, created_by FROM recording WHERE id = ?`).get(theirs.recordingId)).toEqual({
      workspace_id: personalWorkspaceId(former.id),
      created_by: former.id,
    });
  });

  test("the server owner cannot be deleted", async () => {
    const u = newUser();
    db.query(`UPDATE users SET role = 'owner' WHERE id = ?`).run(u.id);
    const res = await requestIt(sessionOf(u));
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.message).toContain("서버 owner 계정은 삭제할 수 없습니다.");
    requestDeletion(u.id, Date.now() - DELETION_GRACE_MS - 1);
    expect(await executeDeletion(u.id)).toBe("skipped");
    expect(getUserById(u.id)).not.toBeNull();
    db.query(`DELETE FROM account_deletion WHERE user_id = ?`).run(u.id);
    db.query(`UPDATE users SET role = 'member' WHERE id = ?`).run(u.id);
  });

  test("a run cut short inside a solo team is finished by the next run", async () => {
    const u = newUser();
    const ws = await team(u, "반쯤 지운 팀");
    const now = Date.now();
    // A recording without a lecture, and a folder: what the first run had not reached.
    db.query(
      `INSERT INTO recording (id, workspace_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
       VALUES (?, ?, '남은 녹음', ?, 'upload', 'ready', ?, 'workspace', ?, ?)`
    ).run(uuidv7(now), ws, now, u.id, now, now);
    db.query(`INSERT INTO folder (id, workspace_id, name, sort_key, created_at, updated_at) VALUES (?, ?, '남은 폴더', 'a', ?, ?)`).run(uuidv7(now), ws, now, now);
    db.query(`DELETE FROM workspace WHERE id = ?`).run(ws); // the first run stopped right after this
    requestDeletion(u.id, now - DELETION_GRACE_MS - 1);
    expect(await executeDeletion(u.id)).toBe("done");
    expect(traces([ws, u.id, u.email])).toEqual({});
  });

  test("a run cut short after the user row went is finished by the next run", async () => {
    const u = newUser();
    const personal = personalWorkspaceId(u.id);
    const now = Date.now();
    db.query(`INSERT INTO saved_view (id, workspace_id, user_id, name, query_json, sort_key, created_at, updated_at) VALUES (?, ?, ?, '보기', '{}', 'a', ?, ?)`).run(
      uuidv7(),
      personal,
      u.id,
      now,
      now
    );
    requestDeletion(u.id, now - DELETION_GRACE_MS - 1);
    deleteUserAndData(u.id); // the first run stopped right after this
    expect(await executeDeletion(u.id)).toBe("done");
    expect(db.query(`SELECT 1 FROM account_deletion WHERE user_id = ?`).get(u.id)).toBeNull();
    expect(traces([u.id, personal])).toEqual({});
  });

  test("Google token is revoked", async () => {
    const u = newUser();
    const refreshToken = `rt-${generateId("del")}`;
    google.refreshTokens.add(refreshToken);
    const integrationId = uuidv7();
    const now = Date.now();
    db.query(
      `INSERT INTO integration (id, workspace_id, user_id, provider, scopes_json, token_enc, calendar_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'google', '[]', ?, 'cal@group.calendar.google.com', 'active', ?, ?)`
    ).run(integrationId, personalWorkspaceId(u.id), u.id, sealGoogleTokens({ refresh_token: refreshToken }), now, now);
    requestDeletion(u.id, now - DELETION_GRACE_MS - 1);
    expect(await executeDeletion(u.id)).toBe("done");
    expect(google.revoked).toContain(refreshToken);
    expect(db.query(`SELECT 1 FROM integration WHERE id = ?`).get(integrationId)).toBeNull();
  });

  test("the queued job deletes the account and then its own row", async () => {
    const u = newUser();
    requestDeletion(u.id, Date.now() - DELETION_GRACE_MS - 1);
    expect(enqueueDueDeletions()).toBe(1);
    const jobId = (db.query(`SELECT id FROM job WHERE kind = ? AND subject_id = ?`).get(ACCOUNT_DELETION_JOB_KIND, u.id) as { id: string }).id;
    // Only this job may run: other queued jobs of this file wait.
    const others = db.query(`UPDATE job SET run_after = ? WHERE state = 'queued' AND id != ?`).run(Date.now() + DAY, jobId).changes;
    const worker = new JobWorker({ pollMs: 20 });
    worker.start();
    try {
      for (let i = 0; i < 250 && db.query(`SELECT 1 FROM job WHERE id = ?`).get(jobId); i++) await Bun.sleep(20);
    } finally {
      await worker.drain(10_000);
      if (others) db.query(`UPDATE job SET run_after = ? WHERE state = 'queued'`).run(Date.now());
    }
    expect(db.query(`SELECT 1 FROM job WHERE id = ?`).get(jobId)).toBeNull();
    expect(getUserById(u.id)).toBeNull();
    expect(traces([u.id, u.email])).toEqual({});
  });
});

describe("no trace is left", () => {
  test("every text column of every table, before and after", async () => {
    const u = newUser("전수검사");
    const personal = personalWorkspaceId(u.id);
    const token = sessionOf(u);
    recordSessionMeta(token, u.id, new Request("http://localhost/", { headers: { "user-agent": "Mozilla/5.0 (Macintosh)" } }));
    const now = Date.now();

    // Recordings, documents, transcript, events, action items, the ask index and a conversation.
    const first = lecture(u, "자료구조 3주차");
    lecture(u, "자료구조 4주차");
    await indexLecture(first.lectureId, { jobId: `job_${generateId("idx")}`, embedder });
    db.query(`INSERT INTO speaker (id, workspace_id, recording_id, label, created_at, updated_at) VALUES (?, ?, ?, 'S1', ?, ?)`).run(uuidv7(), personal, first.recordingId, now, now);
    db.query(`INSERT INTO transcript_segment (workspace_id, recording_id, idx, start_ms, end_ms, text) VALUES (?, ?, 0, 0, 1000, '스택')`).run(personal, first.recordingId);
    const eventId = uuidv7();
    db.query(
      `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, tz, raw_expression, resolution_json, confidence, evidence_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'quiz', '퀴즈', ?, 'Asia/Seoul', '다음 주', '{}', 0.9, '[]', 'synced', ?, ?)`
    ).run(eventId, personal, first.recordingId, now + DAY, now, now);
    db.query(`INSERT INTO action_item (id, workspace_id, recording_id, text, evidence_json, created_at, updated_at) VALUES (?, ?, ?, '복습', '[]', ?, ?)`).run(
      uuidv7(),
      personal,
      first.recordingId,
      now,
      now
    );
    const thread = await call(token, "POST", "/ask/threads", { workspace_id: personal, scope: { kind: "workspace" } });
    expect(thread.status).toBe(201);
    const threadId = ((await thread.json()) as { id: string }).id;
    const asked = await call(token, "POST", `/ask/threads/${threadId}/turns`, { question: "스택이 뭐야?" });
    expect(asked.status).toBe(200);
    await asked.text();

    // Sharing, tokens, sign-ins, calendar, exports, uploads, views, quota, ledger, audit.
    expect((await call(token, "POST", "/share-links", { target_type: "recording", target_id: first.recordingId, scope: { transcript: false, audio: false } })).status).toBe(201);
    createPat({ userId: u.id, workspaceId: personal, name: "ci", scopes: ["recordings:read"], expiresAt: null });
    issueNativePair({ userId: u.id, deviceName: "iPhone", platform: "ios" });
    linkIdentity(u.id, { provider: "apple", subject: generateId("sub"), email: u.email });
    createOAuthState({ userId: u.id, workspaceId: personal, purpose: "google_calendar", verifier: "v", redirectAfter: "/app" });
    const refreshToken = `rt-${generateId("all")}`;
    google.refreshTokens.add(refreshToken);
    const integrationId = uuidv7();
    db.query(
      `INSERT INTO integration (id, workspace_id, user_id, provider, scopes_json, token_enc, calendar_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'google', '[]', ?, 'cal@group.calendar.google.com', 'active', ?, ?)`
    ).run(integrationId, personal, u.id, sealGoogleTokens({ refresh_token: refreshToken }), now, now);
    db.query(`INSERT INTO calendar_event_link (event_candidate_id, integration_id, external_event_id, state, last_synced_at) VALUES (?, ?, 'ev1', 'synced', ?)`).run(
      eventId,
      integrationId,
      now
    );
    db.query(`INSERT INTO calendar_feed (id, user_id, workspace_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(uuidv7(), u.id, personal, generateId("h"), now);
    db.query(`INSERT INTO reminder (id, workspace_id, user_id, target_type, target_id, send_at, state, created_at) VALUES (?, ?, ?, 'event', ?, ?, 'scheduled', ?)`).run(
      uuidv7(),
      personal,
      u.id,
      eventId,
      now + DAY,
      now
    );
    db.query(`INSERT INTO saved_view (id, workspace_id, user_id, name, query_json, sort_key, created_at, updated_at) VALUES (?, ?, ?, '시험', '{}', 'a', ?, ?)`).run(
      uuidv7(),
      personal,
      u.id,
      now,
      now
    );
    const exported = await call(token, "POST", "/me/exports", { workspace_id: personal, include_audio: true });
    expect(exported.status).toBe(202);
    const exportId = ((await exported.json()) as { id: string }).id;
    await runExportJob(exportId);
    const exportFile = join(exportDir(), `${exportId}.zip`);
    expect(existsSync(exportFile)).toBe(true);
    expect(
      (
        await call(token, "POST", "/uploads", {
          workspace_id: personal,
          files: [{ kind: "audio", filename: "b.m4a", mime: "audio/mp4", bytes: 10, sha256: "b".repeat(64) }],
        })
      ).status
    ).toBe(201);
    setQuota(personal, { audio_ms_month: 36_000_000, ai_microusd_month: null, storage_bytes: null }, u.id);
    refreshLedger(personal);
    db.query(`INSERT INTO email_verifications (email, code, purpose, expires_at, created_at) VALUES (?, '123456', 'reset', ?, ?)`).run(
      u.email,
      new Date(now + 600_000).toISOString(),
      new Date(now).toISOString()
    );
    recordAuditLog({ actorId: u.id, actorEmail: u.email, action: "auth.login", detail: `${u.email} 로그인` });
    db.query(`INSERT INTO job (id, owner_id, workspace_id, kind, subject_id, state, run_after, created_at) VALUES (?, ?, ?, 'process', ?, 'succeeded', ?, ?)`).run(
      `job_${generateId("done")}`,
      u.id,
      personal,
      first.lectureId,
      now,
      now
    );

    // Teams: another user's team where u is an admin and invited someone; u's solo team.
    const other = newUser("other");
    const shared = await team(other, "같이 쓰는 팀");
    join_(shared, u, "admin");
    createInvite({ workspaceId: shared, email: "friend@example.com", role: "member", invitedBy: u.id });
    const solo = await team(u, "혼자 팀");
    // Rows that belong to others: they stay, without u's id.
    const theirs = lecture(other, "팀 강의");
    placeRecordingInWorkspace(db, theirs.recordingId, shared, "workspace");
    const editedVersion = (db.query(`SELECT id FROM document_version WHERE recording_id = ? ORDER BY version DESC LIMIT 1`).get(theirs.recordingId) as { id: string }).id;
    db.query(`UPDATE document_version SET author_id = ? WHERE id = ?`).run(u.id, editedVersion);
    setQuota(personalWorkspaceId(other.id), { audio_ms_month: null, ai_microusd_month: 1_000_000, storage_bytes: null }, u.id);

    const archive = getLectureById(first.lectureId)?.md_source_path ?? null;
    const needles = [u.id, personal, u.email, solo];
    const before = traces(needles);
    // The scan sees every kind of row seeded above (else a seed that wrote nothing would pass).
    for (const key of [
      "users.id",
      "users.email",
      "sessions.user_id",
      "auth_session_meta.user_id",
      "lectures.owner_id",
      "recording.workspace_id",
      "recording.created_by",
      "document.workspace_id",
      "document_version.workspace_id",
      "transcript_segment.workspace_id",
      "speaker.workspace_id",
      "event_candidate.workspace_id",
      "action_item.workspace_id",
      "asset.workspace_id",
      "search_chunk.workspace_id",
      "ask_thread.user_id",
      "ask_turn.user_id",
      "ai_call.workspace_id",
      "share_link.created_by",
      "access_token.user_id",
      "native_session.user_id",
      "oauth_identity.user_id",
      "oauth_identity.email",
      "oauth_state.user_id",
      "integration.user_id",
      "calendar_feed.user_id",
      "reminder.user_id",
      "saved_view.user_id",
      "data_export.user_id",
      "upload.user_id",
      "workspace_quota.workspace_id",
      "workspace_quota.updated_by",
      "usage_ledger.workspace_id",
      "email_verifications.email",
      "audit_logs.actor_id",
      "audit_logs.actor_email",
      "audit_logs.detail",
      "job.owner_id",
      "membership.user_id",
      "workspace.id",
      "workspace.personal_user_id",
      "workspace_invite.invited_by",
      "document_version.author_id",
    ]) {
      expect(before[key], key).toBeGreaterThan(0);
    }
    const covered = new Set(USER_TABLES.map((t) => t.table));
    expect(covered.has("push_device") && covered.has("recording_marker")).toBe(true);

    // A request through the API, then the date passes.
    resetAuthRateLimits();
    expect((await requestIt(sessionOf(u))).status).toBe(200);
    makeDue(u);

    const logged: unknown[][] = [];
    const spies = (["info", "warn", "error"] as const).map((level) =>
      spyOn(logger, level).mockImplementation(((...args: unknown[]) => void logged.push(args)) as never)
    );
    try {
      expect(await executeDeletion(u.id)).toBe("done");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(traces(needles)).toEqual({});
    // Files and the index are gone.
    expect(existsSync(first.audioPath)).toBe(false);
    if (archive) expect(existsSync(archive)).toBe(false);
    expect(existsSync(exportFile)).toBe(false);
    expect(db.query(`SELECT COUNT(*) AS n FROM search_chunk WHERE workspace_id = ?`).get(personal)).toEqual({ n: 0 });
    expect(google.revoked).toContain(refreshToken);
    // The other team and its owner are untouched; the synced event went back to accepted.
    expect(db.query(`SELECT 1 FROM workspace WHERE id = ?`).get(shared)).not.toBeNull();
    expect(getUserById(other.id)).not.toBeNull();
    expect(db.query(`SELECT author_id FROM document_version WHERE id = ?`).get(editedVersion)).toEqual({ author_id: null });
    expect(db.query(`SELECT updated_by, ai_microusd_month FROM workspace_quota WHERE workspace_id = ?`).get(personalWorkspaceId(other.id))).toEqual({
      updated_by: "deleted-user",
      ai_microusd_month: 1_000_000,
    });
    expect(db.query(`SELECT status FROM event_candidate WHERE id = ?`).get(eventId)).toBeNull(); // personal: deleted with the workspace
    // Logs carry neither the e-mail, the name nor the raw id.
    const text = JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v));
    for (const secret of [u.email, u.display_name, u.id]) expect(text.includes(secret), `${secret} in ${text}`).toBe(false);
  });
});
