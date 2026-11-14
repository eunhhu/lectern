import { existsSync } from "node:fs";
import { db, getLectureById, recordAuditLog, resetLectureForRetry } from "../../db.ts";
import { toLectureSummaryDto } from "../../dto.ts";
import { emitLectureEvent } from "../../events.ts";
import { isLectureBusy, wakeJobWorker } from "../../queue.ts";
import { quotaOf, setQuota, type Quota } from "../../usage.ts";
import { apiError, defineRouter, notFound, ok, pageBounds, pageFrom } from "./common.ts";
import { usageLedgerDto, type QueueJobRow, type UsageLedgerRow } from "./rows.ts";
import { toJob } from "./store.ts";

interface StageRunRow {
  id: string;
  job_id: string;
  workspace_id: string | null;
  stage: string;
  chunk_index: number | null;
  state: string;
  stage_key: string;
  cache_hit: number;
  output_json: string | null;
  attempts: number;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

interface AiCallRow {
  id: string;
  workspace_id: string | null;
  job_id: string | null;
  stage_run_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  cost_microusd: number;
  latency_ms: number;
  status: string;
  request_id: string | null;
  created_at: number;
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
const SHA_RE = /^[0-9a-f]{64}$/;

function stageRunDto(r: StageRunRow, workspaceId: string | null) {
  const output = r.output_json ? (JSON.parse(r.output_json) as { output?: string; artifacts?: string[] }) : {};
  let error: { class: string; code: string; message: string } | null = null;
  if (r.error) {
    try {
      const parsed = JSON.parse(r.error);
      error = { class: parsed.class ?? "transient", code: String(parsed.code ?? "error").slice(0, 64), message: String(parsed.message ?? "") };
    } catch {
      error = { class: "transient", code: "error", message: r.error };
    }
  }
  // stage_key is the §4.4 memo key; older rows hold a non-hex key, hashed for the DTO.
  const inputHash = SHA_RE.test(r.stage_key) ? r.stage_key : new Bun.CryptoHasher("sha256").update(r.stage_key).digest("hex");
  return {
    id: r.id,
    workspace_id: r.workspace_id ?? workspaceId,
    job_id: r.job_id,
    stage: r.stage,
    chunk_index: r.chunk_index,
    state: r.state,
    input_hash: inputHash,
    output_artifact_ids: [output.output, ...(output.artifacts ?? [])].filter((id): id is string => typeof id === "string"),
    cache_hit: Boolean(r.cache_hit),
    attempts: r.attempts,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    error,
    created_at: iso(r.started_at)!,
  };
}

function aiCallDto(a: AiCallRow, workspaceId: string | null, recordingId: string | null) {
  return {
    id: a.id,
    workspace_id: a.workspace_id ?? workspaceId,
    stage_run_id: a.stage_run_id,
    recording_id: recordingId,
    provider: a.provider,
    model: a.model,
    model_version: null,
    input_tokens: a.input_tokens,
    cached_tokens: a.cached_tokens,
    output_tokens: a.output_tokens,
    audio_seconds: a.audio_seconds,
    cost_microusd: a.cost_microusd,
    latency_ms: a.latency_ms,
    status: a.status,
    request_id: a.request_id,
    error_code: null,
    created_at: iso(a.created_at)!,
  };
}

/** Job kinds that run on the harness runner, so a retry under the same id resumes. */
const RETRYABLE_KINDS = new Set(["process", "regenerate"]);

// defineRouter answers 403 on every `admin`-tagged route unless the caller is an operator.
export const adminRouter = defineRouter({
  adminListJobs: (req) => {
    const q = req.query as { state?: string; kind?: string; workspace_id?: string };
    const bounds = pageBounds(req);
    if (bounds instanceof Response) return bounds;
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.state) (where.push(`state = ?`), params.push(q.state));
    if (q.kind) {
      // `process` is the v1 queue's `distill`.
      where.push(q.kind === "process" ? `kind IN ('process', 'distill')` : `kind = ?`);
      if (q.kind !== "process") params.push(q.kind);
    }
    if (q.workspace_id) {
      where.push(`(workspace_id = ? OR (workspace_id IS NULL AND 'wsp_' || owner_id = ?))`);
      params.push(q.workspace_id, q.workspace_id);
    }
    const rows = db
      .query(`SELECT * FROM job ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
      .all(...params, bounds.limit + 1, bounds.offset) as QueueJobRow[];
    const page = pageFrom(rows, bounds);
    return ok(req, { items: page.items.map(toJob), next_cursor: page.next_cursor });
  },
  adminGetJob: (req) => {
    const row = db.query(`SELECT * FROM job WHERE id = ?`).get(String(req.params.job_id)) as QueueJobRow | null;
    if (!row) return notFound(req, "작업");
    const job = toJob(row);
    const runs = db.query(`SELECT * FROM stage_run WHERE job_id = ? ORDER BY started_at, id`).all(row.id) as StageRunRow[];
    const calls = db
      .query(`SELECT * FROM ai_call WHERE job_id = ? AND stage_run_id IS NOT NULL ORDER BY created_at, id`)
      .all(row.id) as AiCallRow[];
    return ok(req, {
      job,
      stage_runs: runs.map((r) => stageRunDto(r, job.workspace_id)),
      // A call of a system job has no workspace and no AiCall shape: left out.
      ai_calls: calls.filter((a) => a.workspace_id ?? job.workspace_id).map((a) => aiCallDto(a, job.workspace_id, job.recording_id)),
    });
  },
  // Same job id, so the runner's memo skips the stages that finished: the job resumes at the
  // stage that failed. Only for the harness kinds whose stages are memoized.
  adminRetryJob: (req) => {
    const row = db.query(`SELECT * FROM job WHERE id = ?`).get(String(req.params.job_id)) as QueueJobRow | null;
    if (!row) return notFound(req, "작업");
    if (!RETRYABLE_KINDS.has(row.kind) || row.state !== "failed" || !row.subject_id) {
      return apiError(req.c, 409, "conflict", "다시 시도할 수 없는 작업입니다.");
    }
    const subject = row.subject_id;
    if (isLectureBusy(subject, row.kind)) return apiError(req.c, 409, "conflict", "같은 녹음의 작업이 이미 대기 중이거나 실행 중입니다.");
    if (row.kind === "process") {
      const lecture = getLectureById(subject);
      if (!lecture?.audio_path || !existsSync(lecture.audio_path)) {
        return apiError(req.c, 409, "conflict", "원본 오디오가 없어 다시 시도할 수 없습니다.");
      }
      const reset = resetLectureForRetry(subject);
      if (reset) {
        emitLectureEvent(reset.owner_id, {
          type: "progress",
          id: subject,
          stage: reset.stage,
          stage_message: reset.stage_message,
          progress: reset.progress,
          lecture: toLectureSummaryDto(reset),
        });
      }
    }
    const requeued = db
      .query(
        `UPDATE job SET state = 'queued', attempts = 0, error = NULL, error_code = NULL, result = NULL, finished_at = NULL,
           lease_owner = NULL, lease_until = NULL, cancel_requested_at = NULL, run_after = ?, idempotency_key = ?
         WHERE id = ? AND state = 'failed'`
      )
      .run(Date.now(), `${row.kind}:${subject}`, row.id).changes;
    if (!requeued) return apiError(req.c, 409, "conflict", "다시 시도할 수 없는 작업입니다.");
    wakeJobWorker();
    return ok(req, toJob(db.query(`SELECT * FROM job WHERE id = ?`).get(row.id) as QueueJobRow));
  },
  adminListUsage: (req) => {
    const { period } = req.query as { period?: string };
    const rows = db
      .query(`SELECT * FROM usage_ledger ${period ? "WHERE period = ?" : ""} ORDER BY period DESC, workspace_id`)
      .all(...(period ? [period] : [])) as UsageLedgerRow[];
    return ok(req, { items: rows.map(usageLedgerDto), next_cursor: null });
  },
  // Operators set a workspace's limits by hand (D-P5-7, D10). Three nulls remove the row:
  // the workspace is back to no limit.
  adminSetQuota: (req) => {
    const workspaceId = String(req.params.workspace_id);
    if (!db.query(`SELECT 1 FROM workspace WHERE id = ?`).get(workspaceId)) return notFound(req, "워크스페이스");
    const body = req.body as Quota;
    const quota: Quota = { audio_ms_month: body.audio_ms_month, ai_microusd_month: body.ai_microusd_month, storage_bytes: body.storage_bytes };
    const user = req.user!;
    setQuota(workspaceId, quota, user.id);
    recordAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: "workspace.quota.set",
      targetId: workspaceId,
      detail: JSON.stringify(quota),
    });
    return ok(req, quotaOf(workspaceId) ?? { audio_ms_month: null, ai_microusd_month: null, storage_bytes: null });
  },
});
