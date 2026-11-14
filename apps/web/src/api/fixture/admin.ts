// The admin console's fixture (P5-12): five users, twelve jobs (states mixed; one failed
// process job with six stages and four model calls), and three usage ledger rows for this
// month. Like the server, every call answers 403 unless the signed-in user is an operator
// (system role owner or admin). Quotas are shared with the fixture's workspace usage, so a
// limit set here shows in 설정 › 사용량.

import type { AdminApi, AdminOverview, AdminUser } from "../admin.ts";
import { ApiClientError } from "../client.ts";
import type { AiCall, Job, JobDetail, Me, StageRun, UsageLedger, WorkspaceQuota } from "../types.ts";

export interface FixtureAdminDeps {
  me: () => Me;
  wait: <T>(fn: () => T) => Promise<T>;
  /** Workspace limits, shared with getWorkspaceUsage. */
  quotas: Map<string, WorkspaceQuota>;
  personalWs: string;
  teamWs: string | undefined;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hash = (n: number) => n.toString(16).padStart(64, "0");

export function createFixtureAdmin(deps: FixtureAdminDeps): AdminApi {
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const me = deps.me();

  let users: AdminUser[] = [
    { id: me.id, email: me.email, display_name: me.display_name, is_admin: true, role: "owner", status: "active", quota_mb: 2048, last_login_at: at(HOUR), created_at: at(120 * DAY), lecture_count: 14, error_count: 1, audio_bytes: 412_000_000, session_count: 2 },
    { id: "usr_fixture_jimin", email: "jimin@example.com", display_name: "한지민", is_admin: true, role: "admin", status: "active", quota_mb: 4096, last_login_at: at(3 * HOUR), created_at: at(90 * DAY), lecture_count: 22, error_count: 0, audio_bytes: 980_000_000, session_count: 1 },
    { id: "usr_fixture_sehun", email: "sehun@example.com", display_name: "오세훈", is_admin: false, role: "member", status: "active", quota_mb: 2048, last_login_at: at(2 * DAY), created_at: at(60 * DAY), lecture_count: 7, error_count: 2, audio_bytes: 205_000_000, session_count: 1 },
    { id: "usr_fixture_seoa", email: "seoa@example.com", display_name: "윤서아", is_admin: false, role: "member", status: "pending", quota_mb: 2048, last_login_at: null, created_at: at(2 * DAY), lecture_count: 0, error_count: 0, audio_bytes: 0, session_count: 0 },
    { id: "usr_fixture_dohyun", email: "dohyun@example.com", display_name: "최도현", is_admin: false, role: "viewer", status: "suspended", quota_mb: 1024, last_login_at: at(30 * DAY), created_at: at(75 * DAY), lecture_count: 3, error_count: 0, audio_bytes: 61_000_000, session_count: 0 },
  ];

  const team = deps.teamWs ?? deps.personalWs;
  const job = (id: string, kind: Job["kind"], state: Job["state"], ws: string | null, rec: string | null, createdAgo: number, tookMs: number, spent: number, error: string | null = null): Job =>
    ({
      id,
      workspace_id: ws,
      recording_id: rec,
      kind,
      state,
      priority: 0,
      run_after: at(createdAgo),
      attempts: state === "queued" ? 0 : 1,
      lease_owner: state === "running" ? "worker-1" : null,
      lease_until: state === "running" ? new Date(now + 60_000).toISOString() : null,
      budget_microusd: kind === "process" ? 500_000 : null,
      spent_microusd: spent,
      idempotency_key: rec ? `${kind}:${rec}` : null,
      error_code: error,
      created_at: at(createdAgo),
      updated_at: at(Math.max(0, createdAgo - tookMs)),
    }) as unknown as Job;

  const jobs: Job[] = [
    job("job_fx_01", "process", "failed", deps.personalWs, "rec_os07", 2 * HOUR, 7 * 60_000, 41_870, "verify_failed"),
    job("job_fx_02", "process", "succeeded", deps.personalWs, "rec_os08", 5 * HOUR, 6 * 60_000, 38_200),
    job("job_fx_03", "process", "succeeded", team, "rec_tw42", 26 * HOUR, 9 * 60_000, 52_340),
    job("job_fx_04", "process", "succeeded", deps.personalWs, "rec_ds04", 3 * DAY, 5 * 60_000, 29_910),
    job("job_fx_05", "process", "running", team, "rec_tw43", 4 * 60_000, 0, 12_050),
    job("job_fx_06", "process", "queued", deps.personalWs, "rec_test", 60_000, 0, 0),
    job("job_fx_07", "index", "succeeded", deps.personalWs, "rec_os08", 5 * HOUR - 6 * 60_000, 40_000, 820),
    job("job_fx_08", "export", "succeeded", team, null, 2 * DAY, 95_000, 0),
    job("job_fx_09", "calendar_sync", "failed", team, null, 8 * HOUR, 3_000, 0, "google_revoked"),
    job("job_fx_10", "maintenance", "succeeded", null, null, 22 * HOUR, 14_000, 0),
    job("job_fx_11", "regenerate", "canceled", team, "rec_tw42", 20 * HOUR, 30_000, 4_100),
    job("job_fx_12", "reminder", "queued", team, null, 10 * 60_000, 0, 0),
  ];

  // job_fx_01's timeline: transcribe (2 calls), structure (1), verify fails (1), publish never ran.
  const started = now - 2 * HOUR;
  const run = (n: number, stage: StageRun["stage"], state: StageRun["state"], startMs: number | null, tookMs: number, error: StageRun["error"] = null): StageRun =>
    ({
      id: `str_fx_${n}`,
      workspace_id: deps.personalWs,
      job_id: "job_fx_01",
      stage,
      chunk_index: null,
      state,
      input_hash: hash(n),
      output_artifact_ids: [],
      cache_hit: false,
      attempts: state === "pending" ? 0 : state === "failed" ? 3 : 1,
      started_at: startMs === null ? null : new Date(started + startMs).toISOString(),
      finished_at: startMs === null || state === "running" ? null : new Date(started + startMs + tookMs).toISOString(),
      error,
      created_at: new Date(started).toISOString(),
    }) as unknown as StageRun;
  const runs: StageRun[] = [
    run(1, "ingest", "succeeded", 0, 4_000),
    run(2, "normalize", "succeeded", 4_000, 11_000),
    run(3, "transcribe", "succeeded", 15_000, 182_000),
    run(4, "structure", "succeeded", 197_000, 64_000),
    run(5, "verify", "failed", 261_000, 158_000, { class: "output_validation", code: "verify_failed", message: "인용이 전사와 맞지 않는 문단이 남았습니다." }),
    run(6, "publish", "pending", null, 0),
  ];
  const call = (n: number, runId: string, inTok: number, outTok: number, audio: number, cost: number, latency: number, status: AiCall["status"]): AiCall =>
    ({
      id: `aic_fx_${n}`,
      workspace_id: deps.personalWs,
      stage_run_id: runId,
      recording_id: "rec_os07",
      provider: "gemini",
      model: "gemini-3.8-flash",
      model_version: "gemini-3.8-flash",
      input_tokens: inTok,
      cached_tokens: 0,
      output_tokens: outTok,
      audio_seconds: audio,
      cost_microusd: cost,
      latency_ms: latency,
      status,
      request_id: null,
      error_code: status === "ok" ? null : "verify_failed",
      created_at: new Date(started + 20_000 * n).toISOString(),
    }) as unknown as AiCall;
  const calls: AiCall[] = [
    call(1, "str_fx_3", 48_200, 6_100, 1_500, 14_320, 88_000, "ok"),
    call(2, "str_fx_3", 47_900, 5_800, 1_500, 13_990, 86_000, "ok"),
    call(3, "str_fx_4", 12_400, 3_900, 0, 8_460, 61_000, "ok"),
    call(4, "str_fx_5", 15_100, 1_200, 0, 5_100, 52_000, "error"),
  ];

  const period = () => new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 7);
  const ledger = (): UsageLedger[] => [
    { id: "ulg_fx_1", workspace_id: deps.personalWs, period: period(), audio_ms: 12_000_000, ai_cost_microusd: 1_234_567, storage_bytes: 1_288_490_189, updated_at: at(HOUR) },
    { id: "ulg_fx_2", workspace_id: team, period: period(), audio_ms: 66_600_000, ai_cost_microusd: 10_000_000, storage_bytes: 3_435_973_837, updated_at: at(HOUR) },
    { id: "ulg_fx_3", workspace_id: "ws_lab", period: period(), audio_ms: 3_400_000, ai_cost_microusd: 412_000, storage_bytes: 210_000_000, updated_at: at(HOUR) },
  ] as unknown as UsageLedger[];

  const operator = () => {
    const role = deps.me().system_role;
    if (role !== "owner" && role !== "admin") throw new ApiClientError(403, "forbidden", "관리자(Owner/Admin) 권한이 필요한 기능입니다.");
  };
  const overview = (): AdminOverview => ({
    metrics: {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === "active").length,
      pendingUsers: users.filter((u) => u.status === "pending").length,
      suspendedUsers: users.filter((u) => u.status === "suspended").length,
      totalLectures: users.reduce((n, u) => n + u.lecture_count, 0),
      publicLectures: 4,
      errorLectures: users.reduce((n, u) => n + u.error_count, 0),
      totalAudioBytes: users.reduce((n, u) => n + u.audio_bytes, 0),
    },
    users: structuredClone(users),
  });
  const user = (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u) throw new ApiClientError(404, "not_found", "대상 계정을 찾을 수 없습니다.");
    return u;
  };

  return {
    overview: () => deps.wait(() => (operator(), overview())),
    users: () => deps.wait(() => (operator(), overview().users)),
    // The old console's rules (apps/server/src/index.ts): owners are touched by owners only,
    // and nobody changes their own role or status.
    updateUser: (id, patch) =>
      deps.wait(() => {
        operator();
        const target = user(id);
        const mine = deps.me().system_role;
        if (target.role === "owner" && mine !== "owner") throw new ApiClientError(403, "forbidden", "Owner 계정은 다른 Owner만 수정할 수 있습니다.");
        if (patch.role === "owner" && mine !== "owner") throw new ApiClientError(403, "forbidden", "Owner 역할 부여는 Owner 계정만 수행할 수 있습니다.");
        if (target.id === deps.me().id && ((patch.status && patch.status !== "active") || (patch.role && patch.role !== target.role))) {
          throw new ApiClientError(400, "bad_request", "본인 계정의 역할을 변경하거나 정지시킬 수 없습니다.");
        }
        if (patch.role) {
          target.role = patch.role;
          target.is_admin = patch.role === "owner" || patch.role === "admin";
        }
        if (patch.status) target.status = patch.status;
      }),
    deleteUser: (id) =>
      deps.wait(() => {
        operator();
        const target = user(id);
        if (target.id === deps.me().id) throw new ApiClientError(400, "bad_request", "본인 계정은 삭제할 수 없습니다.");
        if (target.role === "owner") throw new ApiClientError(400, "bad_request", "Owner 계정은 삭제할 수 없습니다.");
        users = users.filter((u) => u !== target);
      }),
    jobs: (q) =>
      deps.wait(() => {
        operator();
        const matching = jobs.filter((j) => (!q.state || j.state === q.state) && (!q.kind || j.kind === q.kind));
        const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
        const start = q.cursor ? Number(q.cursor) : 0;
        const items = matching.slice(start, start + limit);
        return { items: structuredClone(items), next_cursor: start + limit < matching.length ? String(start + limit) : null };
      }),
    job: (id) =>
      deps.wait((): JobDetail => {
        operator();
        const found = jobs.find((j) => j.id === id);
        if (!found) throw new ApiClientError(404, "not_found", "작업을 찾을 수 없습니다.");
        if (id !== "job_fx_01") return { job: structuredClone(found), stage_runs: [], ai_calls: [] };
        return { job: structuredClone(found), stage_runs: structuredClone(runs), ai_calls: structuredClone(calls) };
      }),
    // Only failed harness jobs (process, regenerate) go back to the queue, like the server.
    retryJob: (id) =>
      deps.wait(() => {
        operator();
        const found = jobs.find((j) => j.id === id);
        if (!found) throw new ApiClientError(404, "not_found", "작업을 찾을 수 없습니다.");
        if (found.state !== "failed" || (found.kind !== "process" && found.kind !== "regenerate")) {
          throw new ApiClientError(409, "conflict", "다시 시도할 수 없는 작업입니다.");
        }
        Object.assign(found, { state: "queued", attempts: 0, error_code: null, updated_at: new Date().toISOString() });
      }),
    usage: (p) =>
      deps.wait(() => {
        operator();
        const rows = ledger().filter((r) => !p || r.period === p);
        return { items: rows, next_cursor: null };
      }),
    setQuota: (workspaceId, q) =>
      deps.wait(() => {
        operator();
        if (!ledger().some((r) => r.workspace_id === workspaceId)) throw new ApiClientError(404, "not_found", "워크스페이스를 찾을 수 없습니다.");
        const quota = { audio_ms_month: q.audio_ms_month, ai_microusd_month: q.ai_microusd_month, storage_bytes: q.storage_bytes };
        if (quota.audio_ms_month === null && quota.ai_microusd_month === null && quota.storage_bytes === null) deps.quotas.delete(workspaceId);
        else deps.quotas.set(workspaceId, quota);
        return structuredClone(quota);
      }),
  };
}
