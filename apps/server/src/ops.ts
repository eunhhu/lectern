// Operational plumbing: periodic maintenance (expired rows, audit pruning, orphan/trash
// cleanup, retention, SQLite backups and WAL checkpoints), host/database gauges for the
// admin dashboard, request counters, and the CD deploy runner.

import { existsSync, mkdirSync, readdirSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MaintenanceResultDto } from "./admin-api.ts";
import { DATA_DIR, db, getSystemSettings } from "./db.ts";
import {
  applyRetentionPolicies,
  moveToTrash,
  purgeStaleTempFiles,
  purgeTrash,
  scanOrphanUploads,
  type RetentionOutcome,
} from "./storage.ts";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(process.env[name] ?? fallback));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const BOOT_AT = new Date();
export const MAINTENANCE_INTERVAL_MIN = envInt("LECTERN_MAINTENANCE_INTERVAL_MIN", 60, 5, 24 * 60);
const BACKUP_KEEP = envInt("LECTERN_BACKUP_KEEP", 7, 1, 365);
const BACKUP_INTERVAL_HOURS = envInt("LECTERN_BACKUP_INTERVAL_HOURS", 24, 1, 24 * 30);
export const BACKUP_DIR = resolve(DATA_DIR, "backups");
const DB_PATH = resolve(DATA_DIR, "lectern.sqlite");
const BACKUP_NAME_RE = /^lectern-\d{8}-\d{6}\.sqlite$/;

/** The checkout this server runs from (its HEAD is the reported gitSha). */
const RUNNING_REPO_DIR = resolve(process.env.LECTERN_REPO_DIR || join(import.meta.dir, "../../.."));

// The checkout the CD webhook hard-resets to origin/main. It is never inferred from the
// running code, so a deploy call against a developer's server cannot reset their working
// tree: set LECTERN_REPO_DIR, or the legacy production path is used when it exists.
const LEGACY_DEPLOY_DIR = "/home/eunhhu/work/lectern";
export const DEPLOY_REPO_DIR: string | null = process.env.LECTERN_REPO_DIR
  ? resolve(process.env.LECTERN_REPO_DIR)
  : existsSync(LEGACY_DEPLOY_DIR)
  ? LEGACY_DEPLOY_DIR
  : null;

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
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `lectern-${backupStamp(now)}.sqlite`;
  const target = join(BACKUP_DIR, file);
  if (!existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
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

  const retentionOutcome = step<RetentionOutcome | null>("retention", null, () =>
    applyRetentionPolicies(settings, { dryRun: false, isBusy: options.isBusy, now })
  );
  if (retentionOutcome && options.onRetention) {
    step("retention events", null, () => options.onRetention!(retentionOutcome));
  }

  const backup = step<{ file: string; sizeBytes: number } | null>("backup", null, () =>
    options.forceBackup || backupIsDue(now) ? backupDatabase(new Date(now)) : null
  );
  const walCheckpointed = step("wal checkpoint", false, () => {
    db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
    db.exec(`PRAGMA optimize`);
    return true;
  });

  if (errors.length) console.error("Maintenance finished with errors:", errors);
  return {
    startedAt: nowIso,
    finishedAt: new Date().toISOString(),
    expiredSessions,
    expiredCodes,
    prunedAuditLogs,
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

async function runStep(
  cwd: string,
  cmd: string[],
  timeoutMs: number
): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { ok: code === 0, output: `${stdout}\n${stderr}`.trim().slice(-600) };
}

let deployInProgress = false;
let lastDeploy: { ok: boolean; sha: string; error: string | null; at: string } | null = null;

export function deployStatus() {
  return { inProgress: deployInProgress, lastResult: lastDeploy };
}

/**
 * Updates the checkout to origin/main and installs exactly the locked dependencies. Runs
 * the subprocesses asynchronously so requests keep being served meanwhile; a second
 * request while one is running is refused instead of racing it.
 */
export async function pullLatestRelease(): Promise<
  { ok: true; sha: string; previousSha: string } | { ok: false; busy?: boolean; error: string; sha: string }
> {
  if (!DEPLOY_REPO_DIR) {
    return {
      ok: false,
      error: "배포 대상 체크아웃(LECTERN_REPO_DIR)이 설정되지 않았습니다.",
      sha: resolveGitSha(),
    };
  }
  if (deployInProgress) {
    return { ok: false, busy: true, error: "다른 배포가 진행 중입니다.", sha: resolveGitSha() };
  }
  const repoDir = DEPLOY_REPO_DIR;
  deployInProgress = true;
  const previousSha = resolveGitSha();
  try {
    const steps: Array<[string, string[], number]> = [
      ["git fetch", ["git", "fetch", "origin", "main"], 120_000],
      ["git reset", ["git", "reset", "--hard", "origin/main"], 60_000],
      ["bun install", ["bun", "install", "--frozen-lockfile"], 300_000],
    ];
    for (const [name, cmd, timeoutMs] of steps) {
      const res = await runStep(repoDir, cmd, timeoutMs);
      if (!res.ok) {
        const error = `${name} failed: ${res.output}`;
        lastDeploy = { ok: false, sha: resolveGitSha(), error, at: new Date().toISOString() };
        return { ok: false, error, sha: lastDeploy.sha };
      }
    }
    const sha = resolveGitSha();
    lastDeploy = { ok: true, sha, error: null, at: new Date().toISOString() };
    return { ok: true, sha, previousSha };
  } finally {
    deployInProgress = false;
  }
}
