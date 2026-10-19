// Drizzle schema for every table added from v2 on. The v1 tables (users, sessions,
// lectures, ...) are still created by the frozen bootstrap in apps/server/src/db.ts and
// are not declared here, so drizzle-kit never generates DROP/ALTER statements for them;
// a change to a v1 table is a hand-written migration (`drizzle-kit generate --custom`).
//
// Times are integer milliseconds since the epoch: the queue compares them in SQL.
// Every table carries `workspace_id` (nullable until P2 creates workspaces and backfills
// it from `owner_id`), per docs/v2/ARCHITECTURE.md §5.1.

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** One unit of background work (a distillation, a compaction, later a harness pipeline). */
export const job = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    /** The recording/lecture the job works on, if any. */
    subjectId: text("subject_id"),
    state: text("state", { enum: ["queued", "running", "succeeded", "failed", "canceled"] })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(0),
    runAfter: integer("run_after").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    /** JSON input for the handler. Secrets never go here in clear (see sealed_secret). */
    payload: text("payload").notNull().default("{}"),
    /** AES-GCM sealed secret for this job only (e.g. a user-supplied model API key); cleared when the job ends. */
    sealedSecret: text("sealed_secret"),
    result: text("result"),
    error: text("error"),
    errorCode: text("error_code"),
    /** Unique among unfinished jobs: (kind, subject) dedupe is enforced in code. */
    idempotencyKey: text("idempotency_key"),
    budgetMicrousd: integer("budget_microusd"),
    spentMicrousd: integer("spent_microusd").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("idx_job_lease").on(t.state, t.runAfter, t.priority),
    index("idx_job_subject").on(t.subjectId, t.kind, t.state),
    index("idx_job_finished").on(t.finishedAt),
    uniqueIndex("idx_job_idempotency").on(t.idempotencyKey),
  ]
);

/** One execution of one pipeline stage (P1 harness). */
export const stageRun = sqliteTable(
  "stage_run",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    workspaceId: text("workspace_id"),
    stage: text("stage").notNull(),
    chunkIndex: integer("chunk_index"),
    state: text("state", { enum: ["running", "succeeded", "failed", "skipped"] }).notNull(),
    /** Memoization key: stage version, input hashes, prompt/template/model hashes. */
    stageKey: text("stage_key").notNull(),
    cacheHit: integer("cache_hit", { mode: "boolean" }).notNull().default(false),
    outputJson: text("output_json"),
    attempts: integer("attempts").notNull().default(1),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("idx_stage_run_job").on(t.jobId), index("idx_stage_run_key").on(t.stageKey, t.state)]
);

/** Content-addressed output of a stage, stored in the blob store. */
export const artifact = sqliteTable(
  "artifact",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    jobId: text("job_id"),
    stageRunId: text("stage_run_id"),
    kind: text("kind").notNull(),
    blobKey: text("blob_key").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_artifact_job").on(t.jobId), index("idx_artifact_sha").on(t.sha256)]
);

/** Ledger of every model/STT call: tokens, cost, latency. */
export const aiCall = sqliteTable(
  "ai_call",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    jobId: text("job_id"),
    stageRunId: text("stage_run_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    costMicrousd: integer("cost_microusd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    requestId: text("request_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_ai_call_job").on(t.jobId), index("idx_ai_call_created").on(t.createdAt)]
);

/**
 * Lecture/recording change events, written by whichever process made the change (API or
 * worker) and tailed by the API to feed SSE. Pruned after a day by maintenance.
 */
export const jobEvent = sqliteTable(
  "job_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id"),
    ownerId: text("owner_id").notNull(),
    subjectId: text("subject_id"),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    /** Process instance that wrote it, so that process does not deliver it twice. */
    origin: text("origin").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_job_event_created").on(t.createdAt)]
);

/** Small key/value store for process coordination (e.g. the release the API booted). */
export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
