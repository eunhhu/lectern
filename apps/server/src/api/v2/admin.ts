import { db } from "../../db.ts";
import { defineRouter, notFound, notImplemented, ok, pageBounds, pageFrom } from "./common.ts";
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
  adminRetryJob: notImplemented,
  adminListUsage: (req) => {
    const { period } = req.query as { period?: string };
    const rows = db
      .query(`SELECT * FROM usage_ledger ${period ? "WHERE period = ?" : ""} ORDER BY period DESC, workspace_id`)
      .all(...(period ? [period] : [])) as UsageLedgerRow[];
    return ok(req, { items: rows.map(usageLedgerDto), next_cursor: null });
  },
});
