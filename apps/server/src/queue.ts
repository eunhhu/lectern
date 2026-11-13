// Durable job queue on the `job` table (packages/db). Producers (the API) enqueue rows; a
// worker (embedded in the API process, or apps/worker) leases and runs them. Everything
// survives restarts: a job whose worker dies is reclaimed when its lease expires.
//
// Semantics
// - Dedupe: an unfinished job holds idempotency_key = "<kind>:<subject>", enforced by a
//   unique index, so "one distillation per lecture" holds across processes. The key is
//   cleared in the same statement that finishes the job.
// - Retries live in two places: a handler retries transient failures itself (e.g. the
//   distill handler's 3 attempts). `job.attempts` counts only *interruptions* (worker
//   crash, SIGKILL, drain timeout); after max_attempts interruptions the job fails with
//   error_code 'lease_lost' and the handler's onLost hook cleans up.
// - Concurrency is per kind, per worker process (registerJobHandler).
// - This module must not import index.ts: apps/worker imports it.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config } from "@lectern/config";
import { db } from "./db.ts";
import { logger } from "./log.ts";
import { openSecret, sealSecret } from "./secrets.ts";

export interface JobOutcome {
  ok: boolean;
  error?: string | null;
  /** Compaction: bytes saved. */
  savedBytes?: number;
  result?: Record<string, unknown>;
  /** The job stopped because a user canceled it (job.cancel_requested_at): state `canceled`. */
  canceled?: boolean;
  /**
   * Runs once the job's row is finished and its dedupe key released. For follow-up jobs on
   * the same subject: one enqueued from inside the handler can be leased by this worker
   * right away and would still see this job as busy.
   */
  followUp?: () => void;
}

export interface LeasedJob {
  id: string;
  kind: string;
  subjectId: string | null;
  ownerId: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** The sealed secret enqueued with the job, or undefined. Throws if it cannot be opened. */
  secret(): string | undefined;
}

interface HandlerEntry {
  run: (job: LeasedJob) => Promise<JobOutcome>;
  concurrency: number;
  /** Called when the job is given up after repeated interruptions. */
  onLost?: (job: { id: string; subjectId: string | null; ownerId: string }) => void;
  /** Called when a queued job is canceled before any worker ran it. */
  onCanceled?: (job: { id: string; subjectId: string | null; ownerId: string }) => void;
}

const handlers = new Map<string, HandlerEntry>();

export function registerJobHandler(
  kind: string,
  run: HandlerEntry["run"],
  options: { concurrency: number; onLost?: HandlerEntry["onLost"]; onCanceled?: HandlerEntry["onCanceled"] }
): void {
  handlers.set(kind, {
    run,
    concurrency: Math.max(1, options.concurrency),
    onLost: options.onLost,
    onCanceled: options.onCanceled,
  });
}

export const JOB_CANCELED_MESSAGE = "사용자가 작업을 취소했습니다.";

/**
 * Ends queued jobs whose cancel was requested (job.cancel_requested_at): `canceled`, the
 * dedupe key released, and the kind's onCanceled hook run for each. `jobId` limits it to
 * one job. A running job stops itself at its next stage (its handler watches the column).
 */
export function cancelQueuedJobs(jobId?: string): number {
  const params: Array<string | number> = [Date.now(), JOB_CANCELED_MESSAGE];
  if (jobId) params.push(jobId);
  const rows = db
    .query(
      `UPDATE job SET state = 'canceled', finished_at = ?, idempotency_key = NULL, lease_owner = NULL, lease_until = NULL, error = ?
       WHERE state = 'queued' AND cancel_requested_at IS NOT NULL ${jobId ? "AND id = ?" : ""}
       RETURNING id, kind, subject_id, owner_id`
    )
    .all(...params) as Array<Pick<JobRow, "id" | "kind" | "subject_id" | "owner_id">>;
  for (const row of rows) {
    try {
      handlers.get(row.kind)?.onCanceled?.({ id: row.id, subjectId: row.subject_id, ownerId: row.owner_id });
    } catch (err) {
      logger.error("job cancel hook failed", { job_id: row.id, kind: row.kind, err });
    }
  }
  return rows.length;
}

export function jobConcurrency(): Record<string, number> {
  return Object.fromEntries([...handlers].map(([k, h]) => [k, h.concurrency]));
}

interface JobRow {
  id: string;
  owner_id: string;
  kind: string;
  subject_id: string | null;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  priority: number;
  run_after: number;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_until: number | null;
  payload: string;
  sealed_secret: string | null;
  result: string | null;
  error: string | null;
  error_code: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const LOST_MESSAGE = "작업 실행 중 처리 프로세스가 여러 번 중단되어 작업을 멈췄습니다. 다시 시도해주세요.";

// MARK: - Producer side

export function enqueueJob(input: {
  kind: string;
  ownerId: string;
  subjectId: string | null;
  payload?: Record<string, unknown>;
  /** Sealed at rest; available to the handler via job.secret(). */
  secret?: string;
  priority?: number;
  maxAttempts?: number;
  /** Spending cap the harness enforces between stages (job.budget_microusd); none by default. */
  budgetMicrousd?: number;
}): { jobId: string; deduplicated: boolean; position: number } {
  const key = input.subjectId ? `${input.kind}:${input.subjectId}` : null;
  const id = `job_${randomUUID()}`;
  const now = Date.now();
  const res = db
    .query(
      `INSERT INTO job (id, owner_id, kind, subject_id, state, priority, run_after, attempts,
         max_attempts, payload, sealed_secret, idempotency_key, budget_microusd, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .run(
      id,
      input.ownerId,
      input.kind,
      input.subjectId,
      input.priority ?? 0,
      now,
      input.maxAttempts ?? 3,
      JSON.stringify(input.payload ?? {}),
      input.secret ? sealSecret(input.secret) : null,
      key,
      input.budgetMicrousd ?? null,
      now
    );
  if (res.changes === 0) {
    const existing = db.query(`SELECT id FROM job WHERE idempotency_key = ?`).get(key) as { id: string };
    return { jobId: existing.id, deduplicated: true, position: queuePosition(existing.id) };
  }
  const position = queuePosition(id);
  wakeLocalWorker();
  return { jobId: id, deduplicated: false, position };
}

/**
 * 0 when the job is running or will start as soon as a worker looks (a slot is free),
 * otherwise its 1-based place among the jobs of its kind that have to wait.
 */
export function queuePosition(jobId: string): number {
  const job = db.query(`SELECT kind, state, created_at FROM job WHERE id = ?`).get(jobId) as
    | Pick<JobRow, "kind" | "state" | "created_at">
    | null;
  if (!job || job.state !== "queued") return 0;
  const counts = db
    .query(
      `SELECT
         SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN state = 'queued' AND created_at < ? THEN 1 ELSE 0 END) AS ahead
       FROM job WHERE kind = ?`
    )
    .get(job.created_at, job.kind) as { running: number | null; ahead: number | null };
  const free = Math.max(0, (handlers.get(job.kind)?.concurrency ?? 1) - (counts.running ?? 0));
  const ahead = counts.ahead ?? 0;
  return ahead < free ? 0 : ahead - free + 1;
}

/** The lecture's unfinished job, preferring a running one. */
export function getLectureJob(
  subjectId: string
): { id: string; kind: string; state: "queued" | "running" } | null {
  return (
    (db
      .query(
        `SELECT id, kind, state FROM job WHERE subject_id = ? AND state IN ('queued', 'running')
         ORDER BY CASE state WHEN 'running' THEN 0 ELSE 1 END LIMIT 1`
      )
      .get(subjectId) as { id: string; kind: string; state: "queued" | "running" } | null) ?? null
  );
}

export function getLectureJobState(subjectId: string): "queued" | "running" | null {
  return getLectureJob(subjectId)?.state ?? null;
}

export function isLectureBusy(subjectId: string, kind?: string): boolean {
  if (!kind) return getLectureJob(subjectId) !== null;
  return Boolean(db.query(`SELECT 1 FROM job WHERE idempotency_key = ?`).get(`${kind}:${subjectId}`));
}

/** Resolves when the job reaches a terminal state (or after `timeoutMs`). */
export async function waitForJob(
  jobId: string,
  timeoutMs = 60 * 60_000
): Promise<{ state: JobRow["state"]; error: string | null; result: Record<string, unknown> | null }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db.query(`SELECT state, error, result FROM job WHERE id = ?`).get(jobId) as
      | Pick<JobRow, "state" | "error" | "result">
      | null;
    if (!row) return { state: "failed", error: "작업을 찾을 수 없습니다.", result: null };
    if (row.state !== "queued" && row.state !== "running") {
      return { state: row.state, error: row.error, result: row.result ? JSON.parse(row.result) : null };
    }
    if (Date.now() > deadline) return { state: row.state, error: "timeout", result: null };
    await Bun.sleep(200);
  }
}

// MARK: - Introspection (admin)

export interface JobInfo {
  id: string;
  kind: string;
  lectureId: string;
  state: "queued" | "running";
  enqueuedAt: string;
  startedAt: string | null;
}

export interface FinishedJob {
  id: string;
  kind: string;
  lectureId: string;
  ok: boolean;
  error: string | null;
  savedBytes: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

export function snapshotJobs(): {
  concurrency: Record<string, number>;
  running: JobInfo[];
  queued: JobInfo[];
  recent: FinishedJob[];
  last24h: { completed: number; failed: number; avgDurationMs: number };
} {
  const active = db
    .query(`SELECT * FROM job WHERE state IN ('queued', 'running') ORDER BY created_at`)
    .all() as JobRow[];
  const toInfo = (j: JobRow): JobInfo => ({
    id: j.id,
    kind: j.kind,
    lectureId: j.subject_id ?? "",
    state: j.state as "queued" | "running",
    enqueuedAt: iso(j.created_at)!,
    startedAt: iso(j.started_at),
  });
  const recent = (
    db
      .query(
        `SELECT * FROM job WHERE state IN ('succeeded', 'failed', 'canceled')
         ORDER BY finished_at DESC LIMIT 50`
      )
      .all() as JobRow[]
  ).map((j): FinishedJob => {
    const result = j.result ? (JSON.parse(j.result) as { savedBytes?: number }) : {};
    const started = j.started_at ?? j.created_at;
    const finished = j.finished_at ?? started;
    return {
      id: j.id,
      kind: j.kind,
      lectureId: j.subject_id ?? "",
      ok: j.state === "succeeded",
      error: j.state === "succeeded" ? null : j.error,
      savedBytes: result.savedBytes ?? 0,
      startedAt: iso(started)!,
      finishedAt: iso(finished)!,
      durationMs: Math.max(0, finished - started),
    };
  });
  const stats = db
    .query(
      `SELECT
         SUM(CASE WHEN state = 'succeeded' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
         AVG(CASE WHEN state = 'succeeded' THEN finished_at - COALESCE(started_at, created_at) END) AS avg_ms
       FROM job WHERE finished_at >= ?`
    )
    .get(Date.now() - 24 * 3600_000) as { completed: number | null; failed: number | null; avg_ms: number | null };
  return {
    concurrency: jobConcurrency(),
    running: active.filter((j) => j.state === "running").map(toInfo),
    queued: active.filter((j) => j.state === "queued").map(toInfo),
    recent,
    last24h: {
      completed: stats.completed ?? 0,
      failed: stats.failed ?? 0,
      avgDurationMs: Math.round(stats.avg_ms ?? 0),
    },
  };
}

export function countJobs(kind: string): { queued: number; running: number } {
  const row = db
    .query(
      `SELECT SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued,
              SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running
       FROM job WHERE kind = ?`
    )
    .get(kind) as { queued: number | null; running: number | null };
  return { queued: row.queued ?? 0, running: row.running ?? 0 };
}

/** Deletes finished jobs older than `maxAgeMs` (maintenance). */
export function pruneFinishedJobs(maxAgeMs: number, now = Date.now()): number {
  return db
    .query(`DELETE FROM job WHERE state IN ('succeeded', 'failed', 'canceled') AND finished_at < ?`)
    .run(now - maxAgeMs).changes;
}

// MARK: - Worker side

/**
 * Puts running jobs whose lease expired back in the queue (counting the interruption),
 * then gives up on jobs interrupted max_attempts times.
 */
export function reclaimExpiredLeases(now = Date.now()): { requeued: number; failed: number } {
  const requeued = db
    .query(
      `UPDATE job SET state = 'queued', lease_owner = NULL, lease_until = NULL,
         attempts = attempts + 1, run_after = ?
       WHERE state = 'running' AND lease_until < ?`
    )
    .run(now, now).changes;
  const lost = db
    .query(`SELECT id, kind, subject_id, owner_id FROM job WHERE state = 'queued' AND attempts >= max_attempts`)
    .all() as Array<Pick<JobRow, "id" | "kind" | "subject_id" | "owner_id">>;
  for (const job of lost) {
    const changed = db
      .query(
        `UPDATE job SET state = 'failed', error = ?, error_code = 'lease_lost', finished_at = ?,
           idempotency_key = NULL, sealed_secret = NULL
         WHERE id = ? AND state = 'queued'`
      )
      .run(LOST_MESSAGE, now, job.id).changes;
    if (changed) {
      try {
        handlers.get(job.kind)?.onLost?.({ id: job.id, subjectId: job.subject_id, ownerId: job.owner_id });
      } catch (err) {
        logger.error("onLost hook failed", { job_id: job.id, kind: job.kind, err });
      }
    }
  }
  return { requeued, failed: lost.length };
}

export class JobWorker {
  readonly id: string;
  private readonly leaseTtlMs: number;
  private readonly pollMs: number;
  private readonly running = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wakeQueued = false;
  private stopped = false;
  private idleWaiters = new Set<() => void>();

  constructor(options: { id?: string; leaseTtlMs?: number; pollMs?: number } = {}) {
    this.id = options.id ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.leaseTtlMs = options.leaseTtlMs ?? config().jobLeaseTtlMs;
    this.pollMs = options.pollMs ?? config().jobPollMs;
  }

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  /** Look for work now instead of at the next poll. */
  wake(): void {
    if (this.stopped || this.wakeQueued) return;
    this.wakeQueued = true;
    queueMicrotask(() => {
      this.wakeQueued = false;
      this.tick();
    });
  }

  get activeCount(): number {
    let n = 0;
    for (const set of this.running.values()) n += set.size;
    return n;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delayMs);
    this.timer.unref?.();
  }

  private tick(): void {
    if (this.stopped) return;
    try {
      reclaimExpiredLeases();
      cancelQueuedJobs();
      for (const [kind, entry] of handlers) {
        const active = this.running.get(kind) ?? new Set<string>();
        this.running.set(kind, active);
        while (active.size < entry.concurrency) {
          const row = this.lease(kind);
          if (!row) break;
          active.add(row.id);
          void this.execute(row, entry, active);
        }
      }
    } catch (err) {
      logger.error("job worker tick failed", { err });
    }
    this.schedule(this.pollMs);
  }

  private lease(kind: string): JobRow | null {
    const now = Date.now();
    return (
      (db
        .query(
          `UPDATE job SET state = 'running', lease_owner = ?, lease_until = ?,
             started_at = COALESCE(started_at, ?)
           WHERE id = (
             SELECT id FROM job
             WHERE state = 'queued' AND run_after <= ? AND kind = ? AND cancel_requested_at IS NULL
             ORDER BY priority DESC, created_at
             LIMIT 1
           )
           AND state = 'queued'
           RETURNING *`
        )
        .get(this.id, now + this.leaseTtlMs, now, now, kind) as JobRow | null) ?? null
    );
  }

  private async execute(row: JobRow, entry: HandlerEntry, active: Set<string>): Promise<void> {
    const heartbeat = setInterval(() => {
      try {
        db.query(`UPDATE job SET lease_until = ? WHERE id = ? AND lease_owner = ?`).run(
          Date.now() + this.leaseTtlMs,
          row.id,
          this.id
        );
      } catch (err) {
        logger.error("job heartbeat failed", { job_id: row.id, err });
      }
    }, Math.max(250, Math.floor(this.leaseTtlMs / 3)));
    heartbeat.unref?.();

    const job: LeasedJob = {
      id: row.id,
      kind: row.kind,
      subjectId: row.subject_id,
      ownerId: row.owner_id,
      payload: JSON.parse(row.payload || "{}"),
      attempts: row.attempts,
      secret: () => {
        if (!row.sealed_secret) return undefined;
        const plain = openSecret(row.sealed_secret);
        if (plain === null) {
          throw new Error("작업에 함께 보낸 API 키를 복호화할 수 없습니다. 키를 다시 입력해 재시도해주세요.");
        }
        return plain;
      },
    };

    let outcome: JobOutcome;
    try {
      outcome = await entry.run(job);
    } catch (err: any) {
      outcome = { ok: false, error: err?.message || String(err) };
    } finally {
      clearInterval(heartbeat);
    }

    try {
      const result: Record<string, unknown> = { ...(outcome.result ?? {}) };
      if (outcome.savedBytes !== undefined) result.savedBytes = outcome.savedBytes;
      db.query(
        `UPDATE job SET state = ?, result = ?, error = ?, finished_at = ?, lease_owner = NULL,
           lease_until = NULL, idempotency_key = NULL, sealed_secret = NULL
         WHERE id = ? AND lease_owner = ?`
      ).run(
        outcome.canceled ? "canceled" : outcome.ok ? "succeeded" : "failed",
        JSON.stringify(result),
        outcome.canceled ? outcome.error ?? JOB_CANCELED_MESSAGE : outcome.ok ? null : outcome.error ?? null,
        Date.now(),
        row.id,
        this.id
      );
    } catch (err) {
      logger.error("could not record job outcome", { job_id: row.id, err });
    }
    try {
      outcome.followUp?.();
    } catch (err) {
      logger.error("job follow-up failed", { job_id: row.id, kind: row.kind, err });
    }
    active.delete(row.id);
    if (this.activeCount === 0) {
      for (const wake of this.idleWaiters) wake();
      this.idleWaiters.clear();
    }
    this.wake();
  }

  /**
   * Stops taking new jobs and waits up to `timeoutMs` for running ones. Jobs still running
   * after that are handed back to the queue immediately (counted as an interruption), so
   * the next worker picks them up without waiting for the lease to expire.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const drained =
      this.activeCount === 0 ||
      (await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          this.idleWaiters.delete(done);
          resolve(false);
        }, timeoutMs);
        const done = () => {
          clearTimeout(t);
          resolve(true);
        };
        this.idleWaiters.add(done);
      }));
    if (!drained) {
      db.query(
        `UPDATE job SET state = 'queued', lease_owner = NULL, lease_until = NULL,
           attempts = attempts + 1, run_after = ?
         WHERE lease_owner = ? AND state = 'running'`
      ).run(Date.now(), this.id);
    }
    return drained;
  }
}

// MARK: - Embedded worker (default until lectern-worker.service is installed)

let embedded: JobWorker | null = null;

/**
 * Starts the in-process worker when LECTERN_WORKER_MODE=embedded (never in the CD
 * preflight). Called lazily on the first enqueue and at API boot; returns it, or null.
 */
export function ensureEmbeddedWorker(): JobWorker | null {
  if (embedded) return embedded;
  if (config().workerMode !== "embedded" || process.env.LECTERN_PREFLIGHT === "1") return null;
  embedded = new JobWorker();
  embedded.start();
  return embedded;
}

export function embeddedWorker(): JobWorker | null {
  return embedded;
}

function wakeLocalWorker(): void {
  ensureEmbeddedWorker()?.wake();
}

/** Has the in-process worker look for work now (a job was requeued outside enqueueJob). */
export function wakeJobWorker(): void {
  wakeLocalWorker();
}
