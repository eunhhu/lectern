// Stage runner (AI_HARNESS §4). A job handler runs its stages one call at a time:
//
//   const run = harness.job({ jobId, scope });
//   const audio = await run.run(normalizeStage, { path });
//   const text = await run.run(transcribeStage, { chunk }, { chunkIndex: 3 });
//
// Every call is recorded in `stage_run`. Calling the same stages again after a crash
// resumes the job: stages that already succeeded return their stored output, and the stage
// that was interrupted runs again on its own row.
//
// Write order (§4.3), which is what makes resuming safe:
//   1. the output is validated, written to a tmp blob, hashed and renamed into place;
//   2. `artifact` rows are inserted, and
//   3. `stage_run` turns `succeeded` with its output linked, in the same transaction
//      (the state transition is always last).
// A crash before 3 leaves the run `running`, so it runs again; orphaned blobs are harmless
// because blobs are content-addressed and the rerun writes the same key. Publishing to
// user-visible tables is the caller's step, after `run()` returns, in one transaction.
//
// The runner does not write `job_event`: those rows feed SSE, whose event types the clients
// know. Callers map StageEvents (onEvent) to the events they already emit.

import type { Database } from "bun:sqlite";
import type { ZodType } from "zod";
import { BlobStore } from "./blobs.ts";
import { classifyError, HarnessError } from "./errors.ts";
import { canonicalJson } from "./hash.ts";
import { DEFAULT_PRICING, recordAiCall, type PricingTable } from "./ledger.ts";
import { ZERO_USAGE, type ProviderCallResult } from "./providers.ts";
import {
  DEFAULT_RETRY,
  stageKey,
  type ArtifactRef,
  type RetryPolicy,
  type StageContext,
  type StageDefinition,
} from "./stage.ts";

/** Structurally compatible with apps/server/src/log.ts `logger`. */
export interface HarnessLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface HarnessOptions {
  db: Database;
  /** Blob store root (production: DATA_DIR/blobs). Ignored when `blobs` is given. */
  blobDir?: string;
  blobs?: BlobStore;
  logger?: HarnessLogger;
  pricing?: PricingTable;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type StageEvent =
  | { type: "started"; stage: string; stageRunId: string; attempt: number }
  | { type: "cache_hit"; stage: string; stageRunId: string; fromJob: string }
  | {
      type: "retry";
      stage: string;
      stageRunId: string;
      /** The attempt about to start (2, 3, ...) and the transient-attempt limit. */
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      error: HarnessError;
    }
  | { type: "succeeded"; stage: string; stageRunId: string; attempts: number }
  | { type: "failed"; stage: string; stageRunId: string; error: HarnessError };

export interface JobRunContext {
  jobId: string;
  /** Tenant boundary for memo hits: the workspace id, or `owner:<id>` until workspaces exist. */
  scope: string;
  workspaceId?: string | null;
  signal?: AbortSignal;
  onEvent?: (event: StageEvent) => void;
}

export interface StageResult<O> {
  value: O;
  stageRunId: string;
  /** Served from another job's success (the returned run has cache_hit=1). */
  cacheHit: boolean;
  /** This job's own earlier success was returned (a resumed job). */
  resumed: boolean;
  /** The artifact holding `value` as canonical JSON. */
  output: ArtifactRef;
}

/** `stage_run.output_json`: references only, never the output itself (that is a blob). */
interface StoredOutput {
  output: string;
  artifacts: string[];
}

interface ArtifactRow {
  id: string;
  kind: string;
  blob_key: string;
  sha256: string;
  bytes: number;
}

const noopLogger: HarnessLogger = { info() {}, warn() {}, error() {} };

export class Harness {
  readonly db: Database;
  readonly blobs: BlobStore;
  readonly logger: HarnessLogger;
  readonly pricing: PricingTable;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HarnessOptions) {
    if (!options.blobs && !options.blobDir) throw new Error("Harness needs blobDir or blobs");
    this.db = options.db;
    this.blobs = options.blobs ?? new BlobStore(options.blobDir!);
    this.logger = options.logger ?? noopLogger;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  }

  job(context: JobRunContext): JobRun {
    return new JobRun(this, context);
  }

  /**
   * Deletes a job's artifact rows, then every blob no other artifact still references.
   * For outputs that must not outlive the job (the legacy distillation's notes already live
   * in `lectures`), and the hook for deleting a recording's derived data.
   */
  deleteArtifactsForJob(jobId: string): { artifacts: number; blobs: number } {
    const shas = (
      this.db.query(`SELECT DISTINCT sha256 FROM artifact WHERE job_id = ?`).all(jobId) as Array<{ sha256: string }>
    ).map((r) => r.sha256);
    const artifacts = this.db.query(`DELETE FROM artifact WHERE job_id = ?`).run(jobId).changes;
    let blobs = 0;
    for (const sha of shas) {
      if (this.db.query(`SELECT 1 FROM artifact WHERE sha256 = ? LIMIT 1`).get(sha)) continue;
      if (this.blobs.delete(sha)) blobs++;
    }
    return { artifacts, blobs };
  }
}

export class JobRun {
  constructor(
    private readonly harness: Harness,
    readonly context: JobRunContext
  ) {}

  async run<I, O>(
    stage: StageDefinition<I, O>,
    input: I,
    options: { chunkIndex?: number } = {}
  ): Promise<StageResult<O>> {
    const classify = stage.classify ?? classifyError;
    this.throwIfCanceled();
    let parts;
    try {
      parts = await stage.key(input);
    } catch (err) {
      throw classify(err);
    }
    const key = stageKey(stage, this.context.scope, parts);
    const chunkIndex = options.chunkIndex ?? null;

    const reused = this.reuse(stage, key, chunkIndex);
    if (reused) return reused;

    this.throwIfOverBudget();
    const policy: RetryPolicy = { ...DEFAULT_RETRY, ...stage.retry };
    const stageRunId = this.openRun(stage, key, chunkIndex);
    const started = this.harness.now();
    let transientFailures = 0;
    let repairs = 0;
    let repair: { issues: string } | null = null;

    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        if (this.context.signal?.aborted) {
          const error = canceledError(this.context.signal);
          this.fail(stage.name, stageRunId, error);
          throw error;
        }
        this.harness.db.query(`UPDATE stage_run SET attempts = attempts + 1 WHERE id = ?`).run(stageRunId);
      }
      this.emit({ type: "started", stage: stage.name, stageRunId, attempt });
      const ctx = new Context(this.harness, this.context, stageRunId, attempt, repair, classify);
      let error: HarnessError;
      try {
        const raw = await stage.run(input, ctx);
        const parsed = stage.output.safeParse(raw);
        if (parsed.success) {
          const result = await this.commit(stage, stageRunId, parsed.data, ctx.pending);
          const attempts = this.attemptsOf(stageRunId);
          this.emit({ type: "succeeded", stage: stage.name, stageRunId, attempts });
          this.harness.logger.info("stage succeeded", {
            job_id: this.context.jobId,
            stage: stage.name,
            stage_run_id: stageRunId,
            attempts,
            ms: this.harness.now() - started,
          });
          return result;
        }
        error = new HarnessError("output", `${stage.name} output failed validation: ${parsed.error.message}`, {
          cause: parsed.error,
        });
      } catch (err) {
        error = classify(err);
      }

      let delayMs: number | null = null;
      if (error.kind === "transient" && ++transientFailures < policy.maxAttempts) {
        delayMs = Math.min(policy.maxDelayMs, Math.max(policy.backoffMs(attempt + 1), error.retryAfterMs ?? 0));
      } else if (error.kind === "output" && repairs < policy.repairs) {
        repairs++;
        repair = { issues: error.message };
        delayMs = 0;
      }
      if (delayMs === null || this.context.signal?.aborted) {
        if (this.context.signal?.aborted) error = canceledError(this.context.signal);
        this.fail(stage.name, stageRunId, error);
        throw error;
      }
      this.harness.db.query(`UPDATE stage_run SET error = ? WHERE id = ?`).run(error.message, stageRunId);
      this.emit({
        type: "retry",
        stage: stage.name,
        stageRunId,
        attempt: attempt + 1,
        maxAttempts: policy.maxAttempts,
        delayMs,
        error,
      });
      if (delayMs > 0) await this.harness.sleep(delayMs);
    }
  }

  // MARK: - Memo

  /** A stored success for this key, recorded for this job (cache_hit=1 when it came from another). */
  private reuse<I, O>(stage: StageDefinition<I, O>, key: string, chunkIndex: number | null): StageResult<O> | null {
    const { db } = this.harness;
    const jobId = this.context.jobId;
    const candidates = db
      .query(
        `SELECT id, job_id, output_json FROM stage_run
         WHERE stage_key = ? AND state = 'succeeded' ${stage.memo === "job" ? "AND job_id = ?" : ""}
         ORDER BY CASE WHEN job_id = ? THEN 0 ELSE 1 END, finished_at DESC
         LIMIT 5`
      )
      .all(...(stage.memo === "job" ? [key, jobId, jobId] : [key, jobId])) as Array<{
      id: string;
      job_id: string;
      output_json: string | null;
    }>;

    for (const candidate of candidates) {
      const loaded = this.load(stage.output, candidate.output_json);
      if (!loaded) continue;
      if (candidate.job_id === jobId) {
        this.emit({ type: "cache_hit", stage: stage.name, stageRunId: candidate.id, fromJob: jobId });
        return { value: loaded.value, stageRunId: candidate.id, cacheHit: false, resumed: true, output: loaded.output };
      }
      // Another job's success: record a cache-hit run with this job's own artifact rows
      // (same blobs), so the job's timeline and its artifact cleanup stay self-contained.
      const now = this.harness.now();
      const stageRunId = `sr_${Bun.randomUUIDv7()}`;
      const copies = loaded.artifacts.map((a) => ({ ...a, newId: `art_${Bun.randomUUIDv7()}` }));
      const outputId = copies.find((a) => a.id === loaded.output.id)!.newId;
      const stored: StoredOutput = { output: outputId, artifacts: copies.map((a) => a.newId) };
      db.transaction(() => {
        for (const a of copies) {
          this.insertArtifact(a.newId, stageRunId, a.kind, a.blob_key, a.sha256, a.bytes, now);
        }
        db.query(
          `INSERT INTO stage_run (id, job_id, workspace_id, stage, chunk_index, state, stage_key, cache_hit,
             output_json, attempts, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, 'succeeded', ?, 1, ?, 0, ?, ?)`
        ).run(
          stageRunId,
          jobId,
          this.context.workspaceId ?? null,
          stage.name,
          chunkIndex,
          key,
          JSON.stringify(stored),
          now,
          now
        );
      })();
      this.emit({ type: "cache_hit", stage: stage.name, stageRunId, fromJob: candidate.job_id });
      this.harness.logger.info("stage cache hit", {
        job_id: jobId,
        stage: stage.name,
        stage_run_id: stageRunId,
        from_stage_run_id: candidate.id,
      });
      return {
        value: loaded.value,
        stageRunId,
        cacheHit: true,
        resumed: false,
        output: { ...loaded.output, id: outputId },
      };
    }
    return null;
  }

  /** Reads a stored output back, or null when its artifacts or blobs are gone or it no longer validates. */
  private load<O>(
    schema: ZodType<O>,
    outputJson: string | null
  ): { value: O; output: ArtifactRef; artifacts: ArtifactRow[] } | null {
    if (!outputJson) return null;
    let stored: StoredOutput;
    try {
      stored = JSON.parse(outputJson);
    } catch {
      return null;
    }
    if (!stored?.output || !Array.isArray(stored.artifacts)) return null;
    const { db, blobs } = this.harness;
    const artifacts: ArtifactRow[] = [];
    for (const id of stored.artifacts) {
      const row = db.query(`SELECT id, kind, blob_key, sha256, bytes FROM artifact WHERE id = ?`).get(id) as
        | ArtifactRow
        | null;
      if (!row || !blobs.has(row.sha256)) return null;
      artifacts.push(row);
    }
    const out = artifacts.find((a) => a.id === stored.output);
    if (!out) return null;
    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(blobs.readText(out.sha256)));
    } catch {
      return null;
    }
    if (!parsed.success) return null; // schema changed without a version bump: run again
    return {
      value: parsed.data,
      output: { id: out.id, kind: out.kind, sha256: out.sha256, blobKey: out.blob_key, bytes: out.bytes },
      artifacts,
    };
  }

  // MARK: - Recording

  /** The run row for this attempt: an interrupted or failed run of this job is resumed in place. */
  private openRun<I, O>(stage: StageDefinition<I, O>, key: string, chunkIndex: number | null): string {
    const { db } = this.harness;
    const now = this.harness.now();
    const leftover = db
      .query(
        `SELECT id, state FROM stage_run
         WHERE job_id = ? AND stage_key = ? AND chunk_index IS ? AND state IN ('running', 'failed')
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(this.context.jobId, key, chunkIndex) as { id: string; state: string } | null;
    if (leftover) {
      db.query(
        `UPDATE stage_run SET state = 'running', attempts = attempts + 1, error = NULL,
           started_at = ?, finished_at = NULL
         WHERE id = ?`
      ).run(now, leftover.id);
      this.harness.logger.info("stage resumed", {
        job_id: this.context.jobId,
        stage: stage.name,
        stage_run_id: leftover.id,
        was: leftover.state,
      });
      return leftover.id;
    }
    const id = `sr_${Bun.randomUUIDv7()}`;
    db.query(
      `INSERT INTO stage_run (id, job_id, workspace_id, stage, chunk_index, state, stage_key, cache_hit,
         attempts, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, 0, 1, ?)`
    ).run(id, this.context.jobId, this.context.workspaceId ?? null, stage.name, chunkIndex, key, now);
    return id;
  }

  private async commit<I, O>(
    stage: StageDefinition<I, O>,
    stageRunId: string,
    value: O,
    pending: ArtifactRef[]
  ): Promise<StageResult<O>> {
    const blob = await this.harness.blobs.putBytes(canonicalJson(value));
    const output: ArtifactRef = { id: `art_${Bun.randomUUIDv7()}`, kind: stage.name, ...blob };
    const artifacts = [...pending, output];
    const now = this.harness.now();
    const { db } = this.harness;
    db.transaction(() => {
      for (const a of artifacts) this.insertArtifact(a.id, stageRunId, a.kind, a.blobKey, a.sha256, a.bytes, now);
      const stored: StoredOutput = { output: output.id, artifacts: artifacts.map((a) => a.id) };
      db.query(
        `UPDATE stage_run SET state = 'succeeded', output_json = ?, error = NULL, finished_at = ? WHERE id = ?`
      ).run(JSON.stringify(stored), now, stageRunId);
    })();
    return { value, stageRunId, cacheHit: false, resumed: false, output };
  }

  private insertArtifact(
    id: string,
    stageRunId: string,
    kind: string,
    blobKey: string,
    sha256: string,
    bytes: number,
    now: number
  ): void {
    this.harness.db
      .query(
        `INSERT INTO artifact (id, workspace_id, job_id, stage_run_id, kind, blob_key, sha256, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, this.context.workspaceId ?? null, this.context.jobId, stageRunId, kind, blobKey, sha256, bytes, now);
  }

  private fail(stage: string, stageRunId: string, error: HarnessError): void {
    this.harness.db
      .query(`UPDATE stage_run SET state = 'failed', error = ?, finished_at = ? WHERE id = ?`)
      .run(error.message, this.harness.now(), stageRunId);
    this.emit({ type: "failed", stage, stageRunId, error });
    this.harness.logger.warn("stage failed", {
      job_id: this.context.jobId,
      stage,
      stage_run_id: stageRunId,
      kind: error.kind,
      error: error.message,
    });
  }

  private attemptsOf(stageRunId: string): number {
    return (this.harness.db.query(`SELECT attempts FROM stage_run WHERE id = ?`).get(stageRunId) as { attempts: number })
      .attempts;
  }

  // MARK: - Guards

  private throwIfCanceled(): void {
    if (this.context.signal?.aborted) throw canceledError(this.context.signal);
  }

  /** §4.5 "budget": no new paid stage once the job has spent its budget (memo hits still pass). */
  private throwIfOverBudget(): void {
    const row = this.harness.db
      .query(`SELECT budget_microusd, spent_microusd FROM job WHERE id = ?`)
      .get(this.context.jobId) as { budget_microusd: number | null; spent_microusd: number } | null;
    if (row && row.budget_microusd !== null && row.spent_microusd >= row.budget_microusd) {
      throw new HarnessError("budget", "작업 예산을 모두 사용해 남은 처리 단계를 중단했습니다.");
    }
  }

  private emit(event: StageEvent): void {
    try {
      this.context.onEvent?.(event);
    } catch (err) {
      this.harness.logger.error("stage event listener failed", { job_id: this.context.jobId, err });
    }
  }
}

function canceledError(signal: AbortSignal): HarnessError {
  const reason = signal.reason;
  return reason instanceof HarnessError
    ? reason
    : new HarnessError("canceled", reason instanceof Error ? reason.message : "작업이 취소되었습니다.", {
        cause: reason,
      });
}

class Context implements StageContext {
  readonly pending: ArtifactRef[] = [];

  constructor(
    private readonly harness: Harness,
    private readonly job: JobRunContext,
    readonly stageRunId: string,
    readonly attempt: number,
    readonly repair: { issues: string } | null,
    private readonly classify: (err: unknown) => HarnessError
  ) {}

  get jobId(): string {
    return this.job.jobId;
  }

  get signal(): AbortSignal | undefined {
    return this.job.signal;
  }

  get blobs(): BlobStore {
    return this.harness.blobs;
  }

  async putArtifact(kind: string, data: string | Uint8Array): Promise<ArtifactRef> {
    const ref = { id: `art_${Bun.randomUUIDv7()}`, kind, ...(await this.harness.blobs.putBytes(data)) };
    this.pending.push(ref);
    return ref;
  }

  async putArtifactFile(kind: string, path: string): Promise<ArtifactRef> {
    const ref = { id: `art_${Bun.randomUUIDv7()}`, kind, ...(await this.harness.blobs.putFile(path)) };
    this.pending.push(ref);
    return ref;
  }

  async meter<T extends ProviderCallResult>(
    meta: { provider: string; model: string },
    call: () => Promise<T>
  ): Promise<T> {
    const started = this.harness.now();
    let result: T;
    try {
      result = await call();
    } catch (err) {
      const error = this.classify(err);
      // Transient failures are the provider's (network, 429, 5xx): they feed the error-rate
      // and circuit-breaker metrics. Input/config errors are ours and mostly never left
      // the process (missing key, silent audio), so they are not calls.
      if (error.kind === "transient") {
        this.record(meta, { usage: ZERO_USAGE }, this.harness.now() - started, "error");
      }
      throw error;
    }
    this.record(meta, result, result.latencyMs ?? this.harness.now() - started, "ok");
    return result;
  }

  private record(
    meta: { provider: string; model: string },
    result: ProviderCallResult,
    latencyMs: number,
    status: "ok" | "error"
  ): void {
    // The call already happened (and was paid for): a ledger failure must not fail the stage.
    try {
      recordAiCall(
        this.harness.db,
        {
          jobId: this.job.jobId,
          stageRunId: this.stageRunId,
          workspaceId: this.job.workspaceId,
          provider: meta.provider,
          model: meta.model,
          modelVersion: result.model,
          usage: result.usage,
          latencyMs,
          status,
          requestId: result.requestId,
        },
        {
          pricing: this.harness.pricing,
          now: this.harness.now(),
          onUnpriced: (provider, model) =>
            this.harness.logger.warn("model has no price in pricing.json; ai_call recorded at cost 0", {
              job_id: this.job.jobId,
              provider,
              model,
            }),
        }
      );
    } catch (err) {
      this.harness.logger.error("could not record ai_call", { job_id: this.job.jobId, err });
    }
  }
}
