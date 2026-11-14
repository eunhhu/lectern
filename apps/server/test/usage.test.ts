import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { FakeEmbedder, type AskModel, type AskModelEvent } from "@lectern/ask";
import { personalWorkspaceId, uuidv7 } from "@lectern/db";
import { ApiError, WorkspaceQuota, WorkspaceUsage } from "@lectern/domain";
import { createApiV2App } from "../src/api/v2/index.ts";
import { createAskService, type AskService } from "../src/ask/service.ts";
import { completeLectureRecord, createPendingLecture, createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { measureUsage, periodBounds, periodOf, quotaProblem, refreshAllLedgers, refreshLedger, setQuota } from "../src/usage.ts";

// Workspace usage and quotas (P5-07, D-P5-7): usage counted from recording, ai_call and asset
// rows; limits an operator sets; uploads and Ask refused with 409 quota_exceeded over them.
// The model is scripted and never called over the network.

const MIN = 60_000;

class SilentModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  async *stream(): AsyncIterable<AskModelEvent> {
    yield { type: "text", text: "[[모름]] 노트에 없습니다." };
    yield { type: "done", usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 5 }, finish: "stop", requestId: "r1" };
  }
}

const svc: AskService = createAskService({ model: new SilentModel(), embedder: new FakeEmbedder(64), monthlyLimitMicrousd: 1_000_000_000 });
const app = createApiV2App({ askService: () => svc });

function user(role: "member" | "admin" = "member"): UserRecord {
  return createUser({ email: `${generateId("usage")}@test.local`, displayName: "usage", password: "correct_password_1", role });
}

async function call(u: UserRecord, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "X-Lectern-Token": u.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function addRecording(workspaceId: string, durationMs: number | null, createdAt = Date.now()): string {
  const id = uuidv7(createdAt);
  db.query(
    `INSERT INTO recording (id, workspace_id, title, recorded_at, recorded_at_source, duration_ms, status, created_by, created_at, updated_at)
     VALUES (?, ?, '테스트', ?, 'upload', ?, 'ready', 'usr_test', ?, ?)`
  ).run(id, workspaceId, createdAt, durationMs, createdAt, createdAt);
  return id;
}

function addAiCall(workspaceId: string, costMicrousd: number, createdAt = Date.now()) {
  db.query(
    `INSERT INTO ai_call (id, workspace_id, provider, model, cost_microusd, status, created_at)
     VALUES (?, ?, 'gemini', 'gemini-3.5-flash-lite', ?, 'ok', ?)`
  ).run(uuidv7(createdAt), workspaceId, costMicrousd, createdAt);
}

function addAsset(workspaceId: string, bytes: number) {
  const now = Date.now();
  db.query(
    `INSERT INTO asset (id, workspace_id, recording_id, kind, blob_key, bytes, mime, created_at)
     VALUES (?, ?, ?, 'audio', 'file:/nonexistent', ?, 'audio/mp4', ?)`
  ).run(uuidv7(now), workspaceId, uuidv7(now), bytes, now);
}

const uploadBody = (workspaceId: string, bytes = 1_000) => ({
  workspace_id: workspaceId,
  files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes, sha256: "a".repeat(64) }],
});

const quota = (q: Partial<WorkspaceQuota>): WorkspaceQuota => ({ audio_ms_month: null, ai_microusd_month: null, storage_bytes: null, ...q });

async function newThread(u: UserRecord): Promise<string> {
  const res = await call(u, "POST", "/ask/threads", { workspace_id: personalWorkspaceId(u.id), scope: { kind: "workspace" } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function ask(u: UserRecord): Promise<Response> {
  const res = await call(u, "POST", `/ask/threads/${await newThread(u)}/turns`, { question: "시험 범위가 어디까지야?" });
  if (res.status === 200) await res.text();
  return res;
}

async function quotaError(res: Response) {
  expect(res.status).toBe(409);
  const { error } = ApiError.parse(await res.json());
  expect(error.code).toBe("quota_exceeded");
  return error as { code: string; message: string; details: { limit: string; used: number; max: number } };
}

/** The month before the current one, and a time inside it. */
function lastMonth(): { period: string; at: number } {
  const at = periodBounds(periodOf()).from - 24 * 60 * MIN;
  return { period: periodOf(at), at };
}

describe("periods", () => {
  test("period is the Seoul month", () => {
    expect(periodOf(Date.UTC(2026, 9, 31, 15, 30))).toBe("2026-11");
    expect(periodOf(Date.UTC(2026, 9, 31, 14, 59))).toBe("2026-10");
    const { from, to } = periodBounds("2026-11");
    expect(from).toBe(Date.UTC(2026, 9, 31, 15, 0));
    expect(to).toBe(Date.UTC(2026, 10, 30, 15, 0));
    expect(periodBounds("2026-12").to).toBe(Date.UTC(2026, 11, 31, 15, 0));
  });
});

describe("measuring", () => {
  test("measures from source rows", () => {
    const ws = personalWorkspaceId(user().id);
    const other = personalWorkspaceId(user().id);
    addRecording(ws, 10 * MIN);
    addRecording(ws, 20 * MIN);
    addRecording(ws, null); // not processed yet: 0
    addRecording(ws, 30 * MIN, lastMonth().at);
    addRecording(other, 99 * MIN);
    addAiCall(ws, 1_200);
    addAiCall(ws, 3_400);
    addAiCall(ws, 5_600);
    addAiCall(ws, 7_000, lastMonth().at);
    addAiCall(other, 9_999);
    addAsset(ws, 1_000);
    addAsset(ws, 2_500);
    addAsset(other, 4_000);

    const usage = measureUsage(ws);
    expect(usage).toEqual({ period: periodOf(), audio_ms: 1_800_000, ai_cost_microusd: 10_200, storage_bytes: 3_500 });
    // Storage is the current total in any month; audio and AI are per month.
    expect(measureUsage(ws, lastMonth().period)).toEqual({ period: lastMonth().period, audio_ms: 30 * MIN, ai_cost_microusd: 7_000, storage_bytes: 3_500 });
  });

  test("a v1 distillation call counts toward its owner's personal workspace", () => {
    const owner = user();
    const ws = personalWorkspaceId(owner.id);
    const now = Date.now();
    const job = (workspaceId: string | null, ownerId: string) => {
      const id = uuidv7(now);
      db.query(`INSERT INTO job (id, workspace_id, owner_id, kind, state, run_after, created_at) VALUES (?, ?, ?, 'distill', 'succeeded', ?, ?)`).run(
        id,
        workspaceId,
        ownerId,
        now,
        now
      );
      return id;
    };
    const call = (jobId: string | null, cost: number) =>
      db
        .query(`INSERT INTO ai_call (id, workspace_id, job_id, provider, model, cost_microusd, status, created_at) VALUES (?, NULL, ?, 'gemini', 'm', ?, 'ok', ?)`)
        .run(uuidv7(now), jobId, cost, now);
    call(job(null, owner.id), 700); // v1 job: no workspace anywhere, the owner's
    call(job(ws, "usr_someone_else"), 20); // the job names the workspace
    call(job(null, user().id), 5_000); // another user's v1 job
    call(null, 9_000); // a detached call (its job was pruned): nobody's
    expect(measureUsage(ws).ai_cost_microusd).toBe(720);
  });

  test("a processed lecture fills duration and storage", () => {
    const owner = user();
    const id = generateId("lec");
    createPendingLecture({
      id,
      ownerId: owner.id,
      title: "자료구조 3주차",
      course: "자료구조",
      audioPath: "/nonexistent.m4a",
      audioMime: "audio/mp4",
      audioSize: 12_345,
      modelRequested: "gemini-3.8-flash",
      sourceClient: "web",
    });
    completeLectureRecord(id, { title: "자료구조 3주차", courseName: "자료구조", markdown: "# 노트", excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 3600 });
    const usage = measureUsage(personalWorkspaceId(owner.id));
    expect(usage.audio_ms).toBe(3_600_000);
    expect(usage.storage_bytes).toBe(12_345);
  });

  test("ledger refresh", () => {
    const ws = personalWorkspaceId(user().id);
    addRecording(ws, 5 * MIN);
    addAiCall(ws, 42);
    const period = periodOf();
    const count = () => (db.query(`SELECT COUNT(*) AS n FROM usage_ledger WHERE period = ?`).get(period) as { n: number }).n;
    const workspaces = (db.query(`SELECT COUNT(DISTINCT workspace_id) AS n FROM recording`).get() as { n: number }).n;

    expect(refreshAllLedgers()).toBe(workspaces);
    const rows = count();
    expect(rows).toBeGreaterThanOrEqual(workspaces);
    expect(refreshAllLedgers()).toBe(workspaces);
    expect(count()).toBe(rows);
    const row = db.query(`SELECT * FROM usage_ledger WHERE workspace_id = ? AND period = ?`).get(ws, period) as Record<string, number>;
    expect(row).toMatchObject({ audio_ms: 5 * MIN, ai_cost_microusd: 42, storage_bytes: 0 });

    addAiCall(ws, 8);
    refreshLedger(ws);
    expect((db.query(`SELECT ai_cost_microusd AS n FROM usage_ledger WHERE workspace_id = ? AND period = ?`).get(ws, period) as { n: number }).n).toBe(50);
    expect((db.query(`SELECT COUNT(*) AS n FROM usage_ledger WHERE workspace_id = ?`).get(ws) as { n: number }).n).toBe(1);
  });
});

describe("enforcement", () => {
  test("no quota row: unlimited", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    addRecording(ws, 600 * MIN);
    addAiCall(ws, 50_000_000);
    addAsset(ws, 5_000_000_000);
    expect(quotaProblem(ws, { bytes: 1_000_000_000 })).toBeNull();
    expect((await call(u, "POST", "/uploads", uploadBody(ws))).status).toBe(201);
  });

  test("audio quota blocks uploads", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    setQuota(ws, quota({ audio_ms_month: 600_000 }), "usr_operator");
    addRecording(ws, 9 * MIN);
    expect((await call(u, "POST", "/uploads", uploadBody(ws))).status).toBe(201);

    addRecording(ws, 1 * MIN);
    const error = await quotaError(await call(u, "POST", "/uploads", uploadBody(ws)));
    expect(error.message.startsWith("이번 달 녹음 시간 한도를 모두 사용했습니다.")).toBe(true);
    expect(error.details).toEqual({ limit: "audio_ms_month", used: 600_000, max: 600_000 });
  });

  test("storage quota counts the new file", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    setQuota(ws, quota({ storage_bytes: 100 }), "usr_operator");
    addAsset(ws, 60);
    const error = await quotaError(await call(u, "POST", "/uploads", uploadBody(ws, 50)));
    expect(error.message.startsWith("저장 공간 한도를 넘습니다.")).toBe(true);
    expect(error.details.limit).toBe("storage_bytes");
    expect((await call(u, "POST", "/uploads", uploadBody(ws, 40))).status).toBe(201);
  });

  test("ai quota blocks ask and uploads", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    setQuota(ws, quota({ ai_microusd_month: 1_000 }), "usr_operator");
    expect((await ask(u)).status).toBe(200);

    addAiCall(ws, 1_000);
    const asked = await quotaError(await ask(u));
    expect(asked.message.startsWith("이번 달 AI 처리 한도를 모두 사용했습니다.")).toBe(true);
    expect(asked.details.limit).toBe("ai_microusd_month");
    expect((await quotaError(await call(u, "POST", "/uploads", uploadBody(ws)))).details.limit).toBe("ai_microusd_month");
  });

  test("audio quota does not block ask", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    setQuota(ws, quota({ audio_ms_month: 60_000, storage_bytes: 10 }), "usr_operator");
    addRecording(ws, 5 * MIN);
    addAsset(ws, 100);
    expect(quotaProblem(ws)?.details.limit).toBe("audio_ms_month");
    expect((await ask(u)).status).toBe(200);
  });

  test("new month resets", () => {
    const ws = personalWorkspaceId(user().id);
    setQuota(ws, quota({ audio_ms_month: 60_000, ai_microusd_month: 1_000 }), "usr_operator");
    const { at } = lastMonth();
    addRecording(ws, 30 * MIN, at);
    addAiCall(ws, 5_000, at);
    expect(quotaProblem(ws, {}, at)?.details.limit).toBe("audio_ms_month");
    expect(quotaProblem(ws)).toBeNull();
  });
});

describe("routes", () => {
  test("getWorkspaceUsage", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    addRecording(ws, 3 * MIN);
    const res = await call(u, "GET", `/workspaces/${ws}/usage`);
    expect(res.status).toBe(200);
    const usage = WorkspaceUsage.parse(await res.json());
    expect(usage).toEqual({ period: periodOf(), audio_ms: 3 * MIN, ai_cost_microusd: 0, storage_bytes: 0, quota: null });
    // The ledger was brought up to date on the way.
    expect(db.query(`SELECT audio_ms FROM usage_ledger WHERE workspace_id = ? AND period = ?`).get(ws, periodOf())).toEqual({ audio_ms: 3 * MIN });

    setQuota(ws, quota({ storage_bytes: 1_000 }), "usr_operator");
    const limited = WorkspaceUsage.parse(await (await call(u, "GET", `/workspaces/${ws}/usage`)).json());
    expect(limited.quota).toEqual(quota({ storage_bytes: 1_000 }));

    expect((await call(user(), "GET", `/workspaces/${ws}/usage`)).status).toBe(403);
  });

  test("only the operator sets quotas", async () => {
    const u = user();
    const ws = personalWorkspaceId(u.id);
    const res = await call(u, "PUT", `/admin/workspaces/${ws}/quota`, quota({ audio_ms_month: 1 }));
    expect(res.status).toBe(403);
    expect(db.query(`SELECT 1 FROM workspace_quota WHERE workspace_id = ?`).get(ws)).toBeNull();
    expect((await call(user("admin"), "PUT", `/admin/workspaces/wsp_${generateId("none")}/quota`, quota({ audio_ms_month: 1 }))).status).toBe(404);
  });

  test("set then clear", async () => {
    const operator = user("admin");
    const ws = personalWorkspaceId(user().id);
    const limits = quota({ audio_ms_month: 36_000_000, ai_microusd_month: 5_000_000 });
    const set = await call(operator, "PUT", `/admin/workspaces/${ws}/quota`, limits);
    expect(set.status).toBe(200);
    expect(WorkspaceQuota.parse(await set.json())).toEqual(limits);
    expect(db.query(`SELECT audio_ms_month, ai_microusd_month, storage_bytes, updated_by FROM workspace_quota WHERE workspace_id = ?`).get(ws)).toEqual({
      ...limits,
      updated_by: operator.id,
    });
    const audit = db.query(`SELECT actor_id, target_id FROM audit_logs WHERE action = 'workspace.quota.set' AND target_id = ?`).all(ws);
    expect(audit).toEqual([{ actor_id: operator.id, target_id: ws }]);

    const cleared = await call(operator, "PUT", `/admin/workspaces/${ws}/quota`, quota({}));
    expect(cleared.status).toBe(200);
    expect(WorkspaceQuota.parse(await cleared.json())).toEqual(quota({}));
    expect(db.query(`SELECT 1 FROM workspace_quota WHERE workspace_id = ?`).get(ws)).toBeNull();
  });
});
