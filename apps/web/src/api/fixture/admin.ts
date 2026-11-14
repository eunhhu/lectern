// The admin console's fixture (P5-12, P5-16): five users, 55 v1 lectures spread over them
// (done, processing and failed; compacted, archived, audio deleted; four public), twelve v2
// jobs (states mixed; one failed process job with six stages and four model calls), and
// three usage ledger rows for this month. A user's lecture, error and public counts and
// audio bytes are added up from the lectures, as the server does. Like the server, every
// call answers 403 unless the signed-in user is an operator (system role owner or admin),
// and the old console's rules hold (see apps/server/src/index.ts and db.ts). Quotas are
// shared with the fixture's workspace usage, so a limit set here shows in 설정 › 사용량.

import type { AdminApi, AdminLecture, AdminLectureDetail, AdminOverview, AdminUser } from "../admin.ts";
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
const MB = 1_000_000;
const hash = (n: number) => n.toString(16).padStart(64, "0");
const BUSY = "이미 분석 또는 압축 작업이 진행 중인 강의입니다.";
const COMPACT_MS = 3_000;

type Lecture = AdminLectureDetail;
type UserRow = Omit<AdminUser, "lecture_count" | "error_count" | "public_count" | "audio_bytes">;

const COURSES = ["운영체제", "자료구조", "미시경제학", "정보보호", "데이터베이스", "선형대수", "알고리즘"];
const CLIENTS = ["web", "ios-shortcut", "macos", "android"];

export function createFixtureAdmin(deps: FixtureAdminDeps): AdminApi {
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const me = deps.me();

  const perms = { can_ingest: true, can_share: true, can_use_server_key: true };
  let users: UserRow[] = [
    { id: me.id, email: me.email, display_name: me.display_name, is_admin: true, role: "owner", status: "active", ...perms, memo: "", quota_mb: 2048, last_login_at: at(HOUR), created_at: at(120 * DAY), session_count: 2 },
    { id: "usr_fixture_jimin", email: "jimin@example.com", display_name: "한지민", is_admin: true, role: "admin", status: "active", ...perms, memo: "연구실 조교", quota_mb: 4096, last_login_at: at(3 * HOUR), created_at: at(90 * DAY), session_count: 1 },
    { id: "usr_fixture_sehun", email: "sehun@example.com", display_name: "오세훈", is_admin: false, role: "member", status: "active", ...perms, can_share: false, memo: "", quota_mb: 2048, last_login_at: at(2 * DAY), created_at: at(60 * DAY), session_count: 1 },
    { id: "usr_fixture_seoa", email: "seoa@example.com", display_name: "윤서아", is_admin: false, role: "member", status: "pending", ...perms, memo: "신입생", quota_mb: 2048, last_login_at: null, created_at: at(2 * DAY), session_count: 0 },
    { id: "usr_fixture_dohyun", email: "dohyun@example.com", display_name: "최도현", is_admin: false, role: "viewer", status: "suspended", can_ingest: false, can_share: false, can_use_server_key: false, memo: "", quota_mb: 1024, last_login_at: at(30 * DAY), created_at: at(75 * DAY), session_count: 0 },
  ];

  // 55 lectures, newest first: 14 mine (one failed), 31 한지민's, 7 오세훈's (two failed), 3
  // 최도현's. Two are being processed (one running, one queued), one is archived outside the
  // uploads folder, one has its audio deleted, one could not be compacted further.
  const owners: [string, number, number[]][] = [
    [me.id, 14, [5]],
    ["usr_fixture_jimin", 31, []],
    ["usr_fixture_sehun", 7, [1, 4]],
    ["usr_fixture_dohyun", 3, []],
  ];
  const totals: Record<string, number> = { [me.id]: 412 * MB, usr_fixture_jimin: 980 * MB, usr_fixture_sehun: 205 * MB, usr_fixture_dohyun: 61 * MB };
  let lectures: Lecture[] = [];
  let n = 0;
  for (const [ownerId, howMany, failed] of owners) {
    const owner = users.find((u) => u.id === ownerId)!;
    const share = Math.floor(totals[ownerId]! / howMany);
    for (let i = 0; i < howMany; i++) {
      n++;
      const course = COURSES[n % COURSES.length]!;
      const status: Lecture["status"] = failed.includes(i) ? "error" : n === 3 || n === 20 ? "processing" : "done";
      const size = i === howMany - 1 ? totals[ownerId]! - share * (howMany - 1) : share;
      const compacted = status === "done" && n % 4 === 0;
      const audioGone = n === 30;
      lectures.push({
        id: `lec_fx_${String(n).padStart(2, "0")}`,
        title: `${course} ${(n % 14) + 1}주차`,
        course,
        date_label: `2026년 ${(n % 12) + 1}월 강의`,
        status,
        stage: status === "done" ? "done" : status === "error" ? "error" : "analyzing",
        stage_message: status === "processing" ? "노트를 정리하는 중" : "",
        progress: status === "done" ? 100 : status === "processing" ? (n === 3 ? 40 : 0) : 0,
        excerpt: status === "done" ? `${course} 수업의 핵심 개념과 시험 범위를 정리했다.` : "",
        duration_sec: 1_800 + ((n * 577) % 5_400),
        audio_size: audioGone ? 0 : size,
        model_used: status === "done" ? "gemini-3.8-flash" : "",
        has_audio: !audioGone,
        is_public: [2, 9, 16, 33].includes(n),
        // 23 and 55 share no factor: the owners' lectures interleave in time.
        created_at: at((((n * 23) % 55) + 1) * 9 * HOUR),
        updated_at: at((((n * 23) % 55) + 1) * 9 * HOUR - 40 * 60_000),
        owner_id: ownerId,
        owner_email: owner.email,
        owner_name: owner.display_name,
        audio_ext: audioGone ? "" : compacted ? ".m4a" : n % 3 === 0 ? ".mp3" : ".webm",
        compacted,
        audio_original_size: compacted ? Math.round(size * 2.6) : audioGone ? 0 : size,
        error_message: status === "error" ? "Gemini 응답이 비어 있습니다. 잠시 뒤 다시 시도하세요." : null,
        source_client: CLIENTS[n % CLIENTS.length]!,
        job_state: n === 3 ? "running" : n === 20 ? "queued" : null,
        job_kind: n === 3 || n === 20 ? "distill" : null,
        model_requested: "gemini-3.8-flash",
        audio_mime: audioGone ? null : compacted ? "audio/mp4" : n % 3 === 0 ? "audio/mpeg" : "audio/webm",
        audio_compact_state: compacted ? "compacted" : n === 7 ? "skipped" : null,
        audio_compacted_at: compacted ? at((((n * 23) % 55) + 1) * 9 * HOUR - 2 * HOUR) : null,
        markdown_chars: status === "done" ? 3_000 + ((n * 811) % 9_000) : 0,
        archived: n === 11,
        audio_in_uploads: n !== 11,
      });
    }
  }
  lectures.sort((a, b) => b.created_at.localeCompare(a.created_at));

  /** A user row as the server sends it: counts and bytes added up from the lectures. */
  const crm = (u: UserRow): AdminUser => {
    const own = lectures.filter((l) => l.owner_id === u.id);
    return {
      ...u,
      lecture_count: own.length,
      error_count: own.filter((l) => l.status === "error").length,
      public_count: own.filter((l) => l.is_public).length,
      audio_bytes: own.reduce((sum, l) => sum + l.audio_size, 0),
    };
  };

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
  const settings = { default_user_role: "member" as const, default_can_use_server_key: true, default_quota_mb: 2048 };
  const overview = (): AdminOverview => {
    const rows = users.map(crm);
    return {
      metrics: {
        totalUsers: rows.length,
        activeUsers: rows.filter((u) => u.status === "active").length,
        pendingUsers: rows.filter((u) => u.status === "pending").length,
        suspendedUsers: rows.filter((u) => u.status === "suspended").length,
        totalLectures: rows.reduce((sum, u) => sum + u.lecture_count, 0),
        publicLectures: rows.reduce((sum, u) => sum + u.public_count, 0),
        errorLectures: rows.reduce((sum, u) => sum + u.error_count, 0),
        totalAudioBytes: rows.reduce((sum, u) => sum + u.audio_bytes, 0),
      },
      settings: { ...settings },
      users: rows,
    };
  };
  const user = (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u) throw new ApiClientError(404, "not_found", "대상 계정을 찾을 수 없습니다.");
    return u;
  };
  const lecture = (id: string) => {
    const l = lectures.find((x) => x.id === id);
    if (!l) throw new ApiClientError(404, "not_found", "Lecture not found");
    return l;
  };
  /** The list row: the detail without the detail-only fields. */
  const row = (l: Lecture): AdminLecture => {
    const { model_requested: _m, audio_mime: _a, audio_compact_state: _c, audio_compacted_at: _t, markdown_chars: _k, archived: _r, audio_in_uploads: _u, ...rest } = l;
    return structuredClone(rest);
  };
  const compactable = (l: Lecture) => l.status === "done" && l.has_audio && !l.compacted && l.audio_compact_state !== "skipped" && l.audio_in_uploads && !l.job_state;
  // A compaction queued here finishes COMPACT_MS later (read on the next list or detail
  // read), so the screens' refresh while a job is on has something to show.
  const compacting = new Map<string, number>();
  const settle = () => {
    const now = Date.now();
    for (const [id, since] of compacting) {
      if (now - since < COMPACT_MS) continue;
      compacting.delete(id);
      const l = lectures.find((x) => x.id === id);
      if (!l) continue;
      const done = new Date(now).toISOString();
      Object.assign(l, {
        audio_original_size: l.audio_size,
        audio_size: Math.round(l.audio_size * 0.4),
        compacted: true,
        audio_compact_state: "compacted",
        audio_compacted_at: done,
        job_state: null,
        job_kind: null,
        updated_at: done,
      });
    }
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
        const wasActive = target.status === "active";
        if (patch.status) target.status = patch.status;
        if (patch.displayName?.trim()) target.display_name = patch.displayName.trim();
        if (typeof patch.canIngest === "boolean") target.can_ingest = patch.canIngest;
        if (typeof patch.canShare === "boolean") target.can_share = patch.canShare;
        if (typeof patch.canUseServerKey === "boolean") target.can_use_server_key = patch.canUseServerKey;
        if (typeof patch.quotaMb === "number" && patch.quotaMb >= 0) target.quota_mb = Math.round(patch.quotaMb);
        if (typeof patch.memo === "string") target.memo = patch.memo.trim();
        // A short password is ignored by the server (the console refuses it before sending).
        if (patch.revokeSessions || target.status === "suspended" || (wasActive && target.status !== "active")) target.session_count = 0;
        for (const l of lectures) if (l.owner_id === target.id) Object.assign(l, { owner_email: target.email, owner_name: target.display_name });
      }),
    createUser: (body) =>
      deps.wait(() => {
        operator();
        const email = body.email.trim().toLowerCase();
        if (!email || email.length < 3) throw new ApiClientError(400, "bad_request", "아이디 또는 이메일을 입력해주세요.");
        if (body.password.length < 6) throw new ApiClientError(400, "bad_request", "초기 비밀번호는 6자 이상이어야 합니다.");
        if (body.role === "owner" && deps.me().system_role !== "owner") throw new ApiClientError(403, "forbidden", "Owner 역할 부여는 Owner 계정만 수행할 수 있습니다.");
        if (users.some((u) => u.email === email)) throw new ApiClientError(400, "bad_request", "이미 등록된 이메일(아이디)입니다.");
        const id = `usr_fixture_new_${users.length + 1}`;
        users.push({
          id,
          email,
          display_name: body.displayName.trim() || email.split("@")[0]!,
          is_admin: body.role === "owner" || body.role === "admin",
          role: body.role,
          status: body.status,
          can_ingest: body.canIngest,
          can_share: body.canShare,
          can_use_server_key: body.canUseServerKey,
          memo: body.memo.trim(),
          quota_mb: body.quotaMb,
          last_login_at: null,
          created_at: new Date().toISOString(),
          session_count: 0,
        });
        return id;
      }),
    deleteUser: (id) =>
      deps.wait(() => {
        operator();
        const target = user(id);
        if (target.id === deps.me().id) throw new ApiClientError(400, "bad_request", "본인 계정은 삭제할 수 없습니다.");
        if (target.role === "owner") throw new ApiClientError(400, "bad_request", "Owner 계정은 삭제할 수 없습니다.");
        users = users.filter((u) => u !== target);
        lectures = lectures.filter((l) => l.owner_id !== target.id);
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
    // GET /api/admin/lectures: q matches title, course, owner e-mail or the id; counts ignore
    // the status filter (one per status tab).
    lectures: (q) =>
      deps.wait(() => {
        operator();
        settle();
        const term = (q.q ?? "").trim().toLowerCase();
        const base = lectures.filter(
          (l) => (!q.owner || l.owner_id === q.owner) && (!term || l.id === term || [l.title, l.course, l.owner_email].some((t) => t.toLowerCase().includes(term))),
        );
        const matching = base.filter((l) => !q.status || l.status === q.status);
        const limit = Math.min(200, Math.max(1, q.limit ?? 50));
        const offset = Math.max(0, q.offset ?? 0);
        const by = (st: Lecture["status"]) => base.filter((l) => l.status === st).length;
        return {
          total: matching.length,
          counts: { all: base.length, processing: by("processing"), error: by("error"), done: by("done") },
          limit,
          offset,
          lectures: matching.slice(offset, offset + limit).map(row),
        };
      }),
    lecture: (id) => deps.wait(() => (operator(), settle(), structuredClone(lecture(id)))),
    retryLecture: (id) =>
      deps.wait(() => {
        operator();
        const l = lecture(id);
        if (l.job_state) throw new ApiClientError(409, "conflict", BUSY);
        if (!l.has_audio) throw new ApiClientError(400, "bad_request", "서버에 보존된 원본 오디오 파일이 없어 재분석할 수 없습니다.");
        Object.assign(l, { status: "processing", stage: "preparing", stage_message: "", progress: 0, error_message: null, job_state: "queued", job_kind: "distill", updated_at: new Date().toISOString() });
      }),
    compactLectures: (ids) =>
      deps.wait(() => {
        operator();
        const picked = lectures.filter((l) => ids.includes(l.id) && compactable(l));
        for (const l of picked) {
          Object.assign(l, { job_state: "queued", job_kind: "compact" });
          compacting.set(l.id, Date.now());
        }
        return { queued: picked.length, estimatedSavedBytes: picked.reduce((sum, l) => sum + Math.round(l.audio_size * 0.6), 0) };
      }),
    deleteLectureAudio: (id) =>
      deps.wait(() => {
        operator();
        const l = lecture(id);
        const reclaimedBytes = l.has_audio ? l.audio_size : 0;
        Object.assign(l, { has_audio: false, audio_size: 0, audio_ext: "", audio_mime: null, updated_at: new Date().toISOString() });
        return { reclaimedBytes };
      }),
    deleteLecture: (id) =>
      deps.wait(() => {
        operator();
        lecture(id);
        lectures = lectures.filter((l) => l.id !== id);
      }),
  };
}
