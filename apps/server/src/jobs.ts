// In-process job queue for the slow, CPU/network-heavy work: Gemini distillation and
// audio compaction. Each kind has its own concurrency limit so a burst of uploads cannot
// start dozens of ffmpeg processes and Gemini uploads at once, and a lecture never has two
// jobs of the same kind in flight. State lives in memory: on restart, distillations are
// re-queued from the database (status = 'processing') and compaction candidates are
// re-derived from lecture rows, so nothing durable depends on this module.

import { config } from "@lectern/config";

export type JobKind = "distill" | "compact";

export interface JobOutcome {
  ok: boolean;
  error?: string | null;
  savedBytes?: number;
}

export interface JobInfo {
  id: string;
  kind: JobKind;
  lectureId: string;
  state: "queued" | "running";
  enqueuedAt: string;
  startedAt: string | null;
}

export interface FinishedJob {
  id: string;
  kind: JobKind;
  lectureId: string;
  ok: boolean;
  error: string | null;
  savedBytes: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface JobEntry extends JobInfo {
  run: () => Promise<JobOutcome>;
  done: Promise<JobOutcome>;
  settle: (outcome: JobOutcome) => void;
}

export const JOB_CONCURRENCY: Record<JobKind, number> = {
  distill: config().maxConcurrentJobs,
  compact: config().maxConcurrentCompact,
};

const RECENT_LIMIT = 200;

const queued: Record<JobKind, JobEntry[]> = { distill: [], compact: [] };
const running: Record<JobKind, Set<JobEntry>> = { distill: new Set(), compact: new Set() };
const recent: FinishedJob[] = [];
let accepting = true;
let jobSeq = 0;
const idleWaiters = new Set<() => void>();

function findJob(kind: JobKind, lectureId: string): JobEntry | undefined {
  for (const job of running[kind]) {
    if (job.lectureId === lectureId) return job;
  }
  return queued[kind].find((job) => job.lectureId === lectureId);
}

/**
 * Queues `run` for a lecture. If a job of the same kind is already queued or running for
 * that lecture, nothing new is queued and the existing job's completion is returned.
 */
export function enqueueJob(
  kind: JobKind,
  lectureId: string,
  run: () => Promise<JobOutcome>
): { job: JobInfo; done: Promise<JobOutcome>; deduplicated: boolean; position: number } {
  const existing = findJob(kind, lectureId);
  if (existing) {
    return {
      job: toInfo(existing),
      done: existing.done,
      deduplicated: true,
      position: queued[kind].indexOf(existing) + 1,
    };
  }
  if (!accepting) {
    const outcome: JobOutcome = { ok: false, error: "서버가 재시작 중입니다." };
    return {
      job: {
        id: `job_rejected_${++jobSeq}`,
        kind,
        lectureId,
        state: "queued",
        enqueuedAt: new Date().toISOString(),
        startedAt: null,
      },
      done: Promise.resolve(outcome),
      deduplicated: false,
      position: 0,
    };
  }

  let settle!: (outcome: JobOutcome) => void;
  const done = new Promise<JobOutcome>((resolve) => {
    settle = resolve;
  });
  const entry: JobEntry = {
    id: `job_${Date.now().toString(36)}_${++jobSeq}`,
    kind,
    lectureId,
    state: "queued",
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    run,
    done,
    settle,
  };
  queued[kind].push(entry);
  pump(kind);
  return {
    job: toInfo(entry),
    done,
    deduplicated: false,
    position: queued[kind].indexOf(entry) + 1,
  };
}

function pump(kind: JobKind): void {
  while (accepting && running[kind].size < JOB_CONCURRENCY[kind] && queued[kind].length > 0) {
    const job = queued[kind].shift()!;
    job.state = "running";
    job.startedAt = new Date().toISOString();
    running[kind].add(job);
    void execute(job);
  }
}

async function execute(job: JobEntry): Promise<void> {
  const startedMs = Date.now();
  let outcome: JobOutcome;
  try {
    outcome = await job.run();
  } catch (err: any) {
    outcome = { ok: false, error: err?.message || String(err) };
  }
  running[job.kind].delete(job);
  recent.unshift({
    id: job.id,
    kind: job.kind,
    lectureId: job.lectureId,
    ok: outcome.ok,
    error: outcome.ok ? null : outcome.error || null,
    savedBytes: outcome.savedBytes || 0,
    startedAt: job.startedAt || new Date(startedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
  job.settle(outcome);
  pump(job.kind);
  if (isIdle()) {
    for (const wake of idleWaiters) wake();
    idleWaiters.clear();
  }
}

function toInfo(job: JobEntry): JobInfo {
  return {
    id: job.id,
    kind: job.kind,
    lectureId: job.lectureId,
    state: job.state,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
  };
}

/** "queued" / "running" if any job (of any kind) is pending for the lecture. */
export function getLectureJobState(lectureId: string): "queued" | "running" | null {
  let state: "queued" | "running" | null = null;
  for (const kind of ["distill", "compact"] as const) {
    const job = findJob(kind, lectureId);
    if (job?.state === "running") return "running";
    if (job) state = "queued";
  }
  return state;
}

/** The lecture's in-flight job (a running one wins over a queued one), if any. */
export function getLectureJob(
  lectureId: string
): { kind: JobKind; state: "queued" | "running" } | null {
  let queuedJob: { kind: JobKind; state: "queued" } | null = null;
  for (const kind of ["distill", "compact"] as const) {
    const job = findJob(kind, lectureId);
    if (job?.state === "running") return { kind, state: "running" };
    if (job && !queuedJob) queuedJob = { kind, state: "queued" };
  }
  return queuedJob;
}

export function isLectureBusy(lectureId: string, kind?: JobKind): boolean {
  if (kind) return Boolean(findJob(kind, lectureId));
  return getLectureJobState(lectureId) !== null;
}

/** 1-based position in the queue of that kind, or 0 when running / not queued. */
export function queuePosition(kind: JobKind, lectureId: string): number {
  return queued[kind].findIndex((job) => job.lectureId === lectureId) + 1;
}

export function snapshotJobs(): {
  concurrency: Record<JobKind, number>;
  running: JobInfo[];
  queued: JobInfo[];
  recent: FinishedJob[];
  last24h: { completed: number; failed: number; avgDurationMs: number };
} {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const window = recent.filter((j) => Date.parse(j.finishedAt) >= cutoff);
  const completed = window.filter((j) => j.ok);
  const avgDurationMs = completed.length
    ? Math.round(completed.reduce((s, j) => s + j.durationMs, 0) / completed.length)
    : 0;
  return {
    concurrency: { ...JOB_CONCURRENCY },
    running: [...running.distill, ...running.compact].map(toInfo),
    queued: [...queued.distill, ...queued.compact].map(toInfo),
    recent: recent.slice(0, 50),
    last24h: { completed: completed.length, failed: window.length - completed.length, avgDurationMs },
  };
}

export function countJobs(kind: JobKind): { queued: number; running: number } {
  return { queued: queued[kind].length, running: running[kind].size };
}

function isIdle(): boolean {
  return running.distill.size === 0 && running.compact.size === 0;
}

/**
 * Stops starting new jobs (queued ones stay queued and are dropped with the process;
 * distillations are re-queued from the database on the next boot) and waits up to
 * `timeoutMs` for running jobs to finish. Resolves true when everything finished.
 */
export async function drainJobs(timeoutMs: number): Promise<boolean> {
  accepting = false;
  if (isIdle()) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      idleWaiters.delete(wake);
      resolve(false);
    }, timeoutMs);
    const wake = () => {
      clearTimeout(timer);
      resolve(true);
    };
    idleWaiters.add(wake);
  });
}
