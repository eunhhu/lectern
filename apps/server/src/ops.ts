// Operational plumbing: periodic maintenance (expired rows, audit pruning, orphan/trash
// cleanup, retention, SQLite backups and WAL checkpoints), host/database gauges for the
// admin dashboard, request counters, and the CD deploy runner.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT, config } from "@lectern/config";
import { BlobStore, deleteArtifactsForJobs, sweepHarnessData, type HarnessSweepResult } from "@lectern/harness";
import type { MaintenanceResultDto } from "./admin-api.ts";
import { pruneLectureEvents } from "./events.ts";
import { pruneFinishedJobs } from "./queue.ts";
import { DATA_DIR, HARNESS_BLOB_DIR, db, getSystemSettings } from "./db.ts";
import { ensurePrivateDir, makePrivate } from "./fsperm.ts";
import { logger } from "./log.ts";
import {
  applyRetentionPolicies,
  moveToTrash,
  purgeStaleTempFiles,
  purgeTrash,
  scanOrphanUploads,
  type RetentionOutcome,
} from "./storage.ts";

export const BOOT_AT = new Date();
export const MAINTENANCE_INTERVAL_MIN = config().maintenanceIntervalMin;
const BACKUP_KEEP = config().backupKeep;
const BACKUP_INTERVAL_HOURS = config().backupIntervalHours;
export const BACKUP_DIR = resolve(DATA_DIR, "backups");
const DB_PATH = resolve(DATA_DIR, "lectern.sqlite");
const BACKUP_NAME_RE = /^lectern-\d{8}-\d{6}\.sqlite$/;
/** Pre-migrate snapshots (packages/db) and operator snapshots (docs/runbooks/backup-restore.md). */
const SNAPSHOT_NAME_RE = /^(?:pre-migrate|manual)-.+\.sqlite$/;
/**
 * The privacy policy promises that deleted data leaves every backup copy within 7 days.
 * Scheduled backups meet it through rotation (BACKUP_KEEP, one a day); the snapshots
 * above sit outside that rotation, so they are deleted by age instead.
 */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600_000;

/** The checkout this server runs from (its HEAD is the reported gitSha). */
const RUNNING_REPO_DIR = config().repoDir ?? REPO_ROOT;

// The checkout the CD webhook hard-resets to origin/main. It is never inferred from the
// running code, so a deploy call against a developer's server cannot reset their working
// tree: set LECTERN_REPO_DIR. Until the production unit sets it, the legacy host path is
// used when it exists (remove once deploy/systemd/lectern.env is installed on the host).
const LEGACY_DEPLOY_DIR = "/home/eunhhu/work/lectern";
export const DEPLOY_REPO_DIR: string | null =
  config().repoDir ?? (existsSync(LEGACY_DEPLOY_DIR) ? LEGACY_DEPLOY_DIR : null);

// MARK: - Request counters

const requestCounters = { total: 0, errors5xx: 0 };

export function recordRequestOutcome(status: number): void {
  requestCounters.total++;
  if (status >= 500) requestCounters.errors5xx++;
}

export function requestStats(): { total: number; errors5xx: number } {
  return { ...requestCounters };
}

/** Query parameters that carry credentials are never written to logs. */
export function redactUrlForLog(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const key of ["token", "share", "key"]) {
    if (params.has(key)) params.set(key, "redacted");
  }
  const qs = params.toString();
  return qs ? `${url.pathname}?${qs}` : url.pathname;
}

// MARK: - Gauges

export function diskStats(): {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
  low: boolean;
} | null {
  try {
    const st = statfsSync(DATA_DIR);
    const totalBytes = st.blocks * st.bsize;
    const freeBytes = st.bavail * st.bsize;
    if (!totalBytes) return null;
    return {
      path: DATA_DIR,
      totalBytes,
      freeBytes,
      usedPct: Math.round((1 - freeBytes / totalBytes) * 1000) / 10,
      low: freeBytes < 2 * 1024 ** 3 || freeBytes / totalBytes < 0.1,
    };
  } catch {
    return null;
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function count(sql: string): number {
  return (db.query(sql).get() as { n: number }).n;
}

export function databaseStats() {
  return {
    sizeBytes: sizeOf(DB_PATH),
    walBytes: sizeOf(`${DB_PATH}-wal`),
    users: count(`SELECT COUNT(*) AS n FROM users`),
    lectures: count(`SELECT COUNT(*) AS n FROM lectures`),
    sessions: count(`SELECT COUNT(*) AS n FROM sessions`),
    auditLogs: count(`SELECT COUNT(*) AS n FROM audit_logs`),
  };
}

/** Cheap liveness probe for /api/health: the database answers a trivial query. */
export function databaseIsHealthy(): boolean {
  try {
    db.query(`SELECT 1`).get();
    return true;
  } catch {
    return false;
  }
}

// MARK: - Backups

function listBackups(): Array<{ file: string; path: string; sizeBytes: number; mtimeMs: number }> {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((file) => BACKUP_NAME_RE.test(file))
    .map((file) => {
      const path = join(BACKUP_DIR, file);
      const st = statSync(path);
      return { file, path, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

export function backupStats() {
  const backups = listBackups();
  const latest = backups[0];
  return {
    keep: BACKUP_KEEP,
    count: backups.length,
    totalBytes: backups.reduce((s, b) => s + b.sizeBytes, 0),
    latest: latest
      ? { file: latest.file, sizeBytes: latest.sizeBytes, createdAt: new Date(latest.mtimeMs).toISOString() }
      : null,
  };
}

function backupStamp(d: Date): string {
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

/**
 * Writes a consistent, compacted snapshot with VACUUM INTO (safe while the server keeps
 * serving: readers continue, writers wait for the copy) and keeps the newest BACKUP_KEEP.
 */
export function backupDatabase(now = new Date()): { file: string; sizeBytes: number } {
  ensurePrivateDir(BACKUP_DIR);
  const file = `lectern-${backupStamp(now)}.sqlite`;
  const target = join(BACKUP_DIR, file);
  if (!existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    makePrivate(target);
  }
  for (const old of listBackups().slice(BACKUP_KEEP)) {
    try {
      unlinkSync(old.path);
    } catch {
      // ignore
    }
  }
  return { file, sizeBytes: sizeOf(target) };
}

/** Deletes pre-migrate and manual snapshots older than SNAPSHOT_MAX_AGE_MS (by mtime). */
export function pruneOldSnapshots(now = Date.now()): { count: number; bytes: number } {
  if (!existsSync(BACKUP_DIR)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const file of readdirSync(BACKUP_DIR)) {
    if (!SNAPSHOT_NAME_RE.test(file)) continue;
    const path = join(BACKUP_DIR, file);
    const st = lstatSync(path);
    if (!st.isFile() || now - st.mtimeMs < SNAPSHOT_MAX_AGE_MS) continue;
    unlinkSync(path);
    count++;
    bytes += st.size;
  }
  return { count, bytes };
}

function backupIsDue(now: number): boolean {
  const latest = listBackups()[0];
  return !latest || now - latest.mtimeMs >= BACKUP_INTERVAL_HOURS * 3600_000 - 60_000;
}

// MARK: - Maintenance

let maintenanceRunning: Promise<MaintenanceResultDto> | null = null;
let lastMaintenance: MaintenanceResultDto | null = null;

export function maintenanceStatus() {
  return {
    intervalMin: MAINTENANCE_INTERVAL_MIN,
    running: maintenanceRunning !== null,
    lastRunAt: lastMaintenance?.finishedAt ?? null,
    lastResult: lastMaintenance,
  };
}

export interface MaintenanceOptions {
  /** Take a backup even if the last one is recent. */
  forceBackup?: boolean;
  /** Lectures with a queued/running job are left alone by retention. */
  isBusy: (lectureId: string) => boolean;
  /** Lets the server push SSE updates for lectures retention touched. */
  onRetention?: (outcome: RetentionOutcome) => void;
  now?: number;
}

/** Runs every maintenance step once; concurrent callers share the same run. */
export function runMaintenance(options: MaintenanceOptions): Promise<MaintenanceResultDto> {
  if (!maintenanceRunning) {
    maintenanceRunning = Promise.resolve()
      .then(() => doMaintenance(options))
      .then((result) => {
        lastMaintenance = result;
        return result;
      })
      .finally(() => {
        maintenanceRunning = null;
      });
  }
  return maintenanceRunning;
}

function doMaintenance(options: MaintenanceOptions): MaintenanceResultDto {
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const errors: string[] = [];
  const step = <T>(name: string, fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (err: any) {
      errors.push(`${name}: ${err?.message || String(err)}`);
      return fallback;
    }
  };
  const settings = getSystemSettings();

  const expiredSessions = step("sessions", 0, () =>
    db.query(`DELETE FROM sessions WHERE expires_at < ?`).run(nowIso).changes
  );
  const expiredCodes = step("verification codes", 0, () =>
    db.query(`DELETE FROM email_verifications WHERE expires_at < ?`).run(nowIso).changes
  );
  const prunedAuditLogs = step("audit logs", 0, () => {
    if (!settings.audit_retention_days) return 0;
    const cutoff = new Date(now - settings.audit_retention_days * 86400_000).toISOString();
    return db.query(`DELETE FROM audit_logs WHERE created_at < ?`).run(cutoff).changes;
  });

  const orphanFiles = step("orphans", { count: 0, bytes: 0 }, () => {
    const orphans = scanOrphanUploads(now);
    const moved = moveToTrash(orphans);
    return { count: moved, bytes: orphans.reduce((s, f) => s + f.bytes, 0) };
  });
  step("trash", null, () => purgeTrash(now));
  const tempFiles = step("temp files", { count: 0, bytes: 0 }, () => purgeStaleTempFiles(now));
  // SSE events are only useful to a client that reconnects soon; finished job rows feed
  // the admin "recent jobs" list and the 24h stats.
  const prunedJobEvents = step("job events", 0, () => pruneLectureEvents(24 * 3600_000, now));
  const prunedJobs = step("finished jobs", 0, () => pruneFinishedJobs(30 * 24 * 3600_000, now));
  // After the job prune: stage runs of pruned jobs, orphaned artifacts and blobs, stale tmp files.
  const harnessCleanup = step<HarnessSweepResult | null>("harness data", null, () => {
    const blobs = new BlobStore(HARNESS_BLOB_DIR);
    const swept = sweepHarnessData(db, blobs, { now });
    // A stage that committed after its lecture was deleted (deleteLectureById already ran)
    // leaves artifacts under a job that still exists, which the sweep does not see as
    // orphaned: they go here instead of 30 days later with the job. Job subjects are
    // lecture ids; follow the subject table here if that changes.
    const gone = (
      db
        .query(
          `SELECT id FROM job
           WHERE subject_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM lectures WHERE lectures.id = job.subject_id)
             AND EXISTS (SELECT 1 FROM artifact WHERE artifact.job_id = job.id)`
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
    const late = gone.length ? deleteArtifactsForJobs(db, blobs, gone) : { artifacts: 0, blobs: 0 };
    return { ...swept, artifacts: swept.artifacts + late.artifacts, blobs: swept.blobs + late.blobs };
  });

  const retentionOutcome = step<RetentionOutcome | null>("retention", null, () =>
    applyRetentionPolicies(settings, { dryRun: false, isBusy: options.isBusy, now })
  );
  if (retentionOutcome && options.onRetention) {
    step("retention events", null, () => options.onRetention!(retentionOutcome));
  }

  const backup = step<{ file: string; sizeBytes: number } | null>("backup", null, () =>
    options.forceBackup || backupIsDue(now) ? backupDatabase(new Date(now)) : null
  );
  const prunedSnapshots = step("old snapshots", { count: 0, bytes: 0 }, () => pruneOldSnapshots(now));
  const walCheckpointed = step("wal checkpoint", false, () => {
    db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
    db.exec(`PRAGMA optimize`);
    return true;
  });

  if (errors.length) logger.error("maintenance finished with errors", { errors });
  return {
    startedAt: nowIso,
    finishedAt: new Date().toISOString(),
    expiredSessions,
    expiredCodes,
    prunedAuditLogs,
    prunedJobEvents,
    prunedJobs,
    harnessCleanup: harnessCleanup ?? undefined,
    orphanFiles,
    tempFiles,
    retention: {
      count: retentionOutcome?.audioRemoved.length ?? 0,
      bytes: retentionOutcome?.retention.bytes ?? 0,
    },
    failedRetention: {
      count: retentionOutcome?.deleted.length ?? 0,
      bytes: retentionOutcome?.failedRetention.bytes ?? 0,
    },
    backup,
    prunedSnapshots,
    walCheckpointed,
    errors,
  };
}

// MARK: - Deploy

export function resolveGitSha(): string {
  try {
    const res = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: DEPLOY_REPO_DIR || RUNNING_REPO_DIR,
      stdout: "pipe",
      stderr: "ignore",
    });
    return new TextDecoder().decode(res.stdout).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export interface StepResult {
  ok: boolean;
  code: number;
  output: string;
}

async function runStep(
  cwd: string,
  cmd: string[],
  timeoutMs: number,
  env?: Record<string, string | undefined>
): Promise<StepResult> {
  const proc = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { ok: code === 0, code, output: `${stdout}\n${stderr}`.trim().slice(-600) };
}

let deployInProgress = false;
let lastDeploy: { ok: boolean; sha: string; error: string | null; at: string } | null = null;

export function deployStatus() {
  return { inProgress: deployInProgress, lastResult: lastDeploy };
}

const SHA_RE = /^[0-9a-f]{40}$/;
// Files whose change means `bun install` has to run again.
const DEPENDENCY_FILES = [
  "bun.lock",
  "package.json",
  "apps/server/package.json",
  "packages/core/package.json",
];

export type DeployOutcome =
  | {
      ok: true;
      sha: string;
      previousSha: string;
      /** False when nothing changed (already live, or a newer release is live). */
      restart: boolean;
      note: "deployed" | "already-deployed" | "superseded";
      steps: string[];
    }
  | {
      ok: false;
      busy?: boolean;
      error: string;
      sha: string;
      /** The checkout was moved and then put back after a failed install or preflight. */
      rolledBack?: boolean;
      steps: string[];
    };

/**
 * Release a checkout to `targetSha` (or origin/main when none is given), safely:
 * - only commits on origin/main are accepted, and the checkout never moves backwards
 *   (an older SHA than the one running is reported as superseded, not deployed);
 * - `bun install --frozen-lockfile` runs only when dependency files changed;
 * - before the caller restarts the server, `preflight` boots the new code against a
 *   throwaway data directory; if that or the install fails, the checkout is reset to the
 *   previous commit (and its dependencies) so the running server's code stays intact.
 * Subprocesses are async, so the server keeps answering requests meanwhile.
 */
export async function releaseCheckout(options: {
  repoDir: string;
  targetSha?: string | null;
  preflight: (repoDir: string) => Promise<StepResult>;
}): Promise<DeployOutcome> {
  const { repoDir } = options;
  const steps: string[] = [];
  const git = async (args: string[], timeoutMs = 60_000) => {
    const res = await runStep(repoDir, ["git", ...args], timeoutMs);
    steps.push(`git ${args.join(" ")} → ${res.code}`);
    return res;
  };
  const headSha = async () => (await git(["rev-parse", "HEAD"])).output.trim();
  const fail = (error: string, sha: string, rolledBack?: boolean): DeployOutcome => ({
    ok: false,
    error,
    sha,
    rolledBack,
    steps,
  });

  if (options.targetSha && !SHA_RE.test(options.targetSha)) {
    return fail("배포할 커밋 SHA 형식이 올바르지 않습니다.", "");
  }
  const previousSha = await headSha();
  const fetched = await git(["fetch", "--quiet", "origin", "main"], 120_000);
  if (!fetched.ok) return fail(`git fetch failed: ${fetched.output}`, previousSha);
  const sha = options.targetSha || (await git(["rev-parse", "origin/main"])).output.trim();
  if (!SHA_RE.test(sha)) return fail("origin/main 커밋을 확인할 수 없습니다.", previousSha);

  const onMain = await git(["merge-base", "--is-ancestor", sha, "origin/main"]);
  if (onMain.code !== 0) {
    return fail("origin/main에 없는 커밋은 배포하지 않습니다.", previousSha);
  }
  if (sha === previousSha) {
    return { ok: true, sha, previousSha, restart: false, note: "already-deployed", steps };
  }
  const alreadyIncluded = await git(["merge-base", "--is-ancestor", sha, previousSha]);
  if (alreadyIncluded.code === 0) {
    return { ok: true, sha: previousSha, previousSha, restart: false, note: "superseded", steps };
  }

  const depsDiff = await git(["diff", "--quiet", previousSha, sha, "--", ...DEPENDENCY_FILES]);
  const depsChanged = depsDiff.code !== 0;
  const install = async () => {
    const res = await runStep(repoDir, ["bun", "install", "--frozen-lockfile"], 300_000);
    steps.push(`bun install --frozen-lockfile → ${res.code}`);
    return res;
  };
  const rollBack = async (reason: string): Promise<DeployOutcome> => {
    const reset = await git(["reset", "--hard", previousSha]);
    const reinstall = depsChanged && reset.ok ? await install() : null;
    const restored = reset.ok && (!reinstall || reinstall.ok);
    return fail(
      `${reason}${restored ? " — 이전 버전으로 되돌렸습니다." : " — 이전 버전 복구에도 실패했습니다. 수동 확인이 필요합니다."}`,
      previousSha,
      restored
    );
  };

  const reset = await git(["reset", "--hard", sha]);
  if (!reset.ok) return rollBack(`git reset failed: ${reset.output}`);
  if (depsChanged) {
    const installed = await install();
    if (!installed.ok) return rollBack(`bun install failed: ${installed.output}`);
  } else {
    steps.push("bun install skipped (dependencies unchanged)");
  }
  const checked = await options.preflight(repoDir);
  steps.push(`preflight → ${checked.code}`);
  if (!checked.ok) return rollBack(`preflight failed: ${checked.output}`);

  return { ok: true, sha, previousSha, restart: true, note: "deployed", steps };
}

/** Boots the checked-out server code in a subprocess against throwaway directories. */
async function runPreflight(repoDir: string): Promise<StepResult> {
  const sandbox = mkdtempSync(join(tmpdir(), "lectern-preflight-"));
  try {
    for (const dir of ["data", "lectures", "home"]) mkdirSync(join(sandbox, dir));
    // The new release boots against a consistent copy of the live database, so its
    // migrations are rehearsed on real data before the real one is touched.
    const copy = join(sandbox, "data", "lectern.sqlite");
    db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    return await runStep(
      repoDir,
      ["bun", "run", "apps/server/src/preflight.ts"],
      120_000,
      {
        ...process.env,
        LECTERN_PREFLIGHT: "1",
        LECTERN_DATA_DIR: join(sandbox, "data"),
        LECTERN_LECTURES_DIR: join(sandbox, "lectures"),
        HOME: join(sandbox, "home"),
        LECTERN_RESEND_CREDENTIALS_FILE: join(sandbox, "none.json"),
        LECTERN_LOG_REQUESTS: "0",
        GEMINI_API_KEY: "",
        RESEND_API_KEY: "",
        LECTERN_DEPLOY_TOKEN: "",
      }
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** The CD webhook's deploy: one at a time, against DEPLOY_REPO_DIR. */
export async function pullLatestRelease(targetSha?: string | null): Promise<DeployOutcome> {
  if (!DEPLOY_REPO_DIR) {
    return {
      ok: false,
      error: "배포 대상 체크아웃(LECTERN_REPO_DIR)이 설정되지 않았습니다.",
      sha: resolveGitSha(),
      steps: [],
    };
  }
  if (deployInProgress) {
    return { ok: false, busy: true, error: "다른 배포가 진행 중입니다.", sha: resolveGitSha(), steps: [] };
  }
  deployInProgress = true;
  try {
    const outcome = await releaseCheckout({
      repoDir: DEPLOY_REPO_DIR,
      targetSha,
      preflight: runPreflight,
    });
    lastDeploy = {
      ok: outcome.ok,
      sha: outcome.sha,
      error: outcome.ok ? null : outcome.error,
      at: new Date().toISOString(),
    };
    return outcome;
  } finally {
    deployInProgress = false;
  }
}
