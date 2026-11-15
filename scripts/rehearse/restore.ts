// Restore rehearsal (P7-02, CONTRACTS D-P7-3): restores one backup file into a throwaway work
// directory, checks the copy against the backup (counts, hashes, integrity), boots the server
// on the copy (migrations included) and checks that no table lost rows. It never writes to
// the backup and refuses a live data directory as its work directory. The summary carries
// counts and hashes only, never row contents. Runbook: docs/runbooks/backup-restore.md §7.
//
//   bun scripts/rehearse/restore.ts --backup <file> [--work <empty dir>] [--uploads <dir>] [--keep] [--out <file>]

import { Database } from "bun:sqlite";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { assertWorkDir, compareDigests, digestDatabase, integrity, REPO_ROOT, restoreEnv, type TableDigest } from "./lib.ts";

/**
 * Tables a boot may shrink without losing user data: sessions, the job queue and its events,
 * rate-limit windows. None shrank when copies with an expired session, a finished job months
 * old, a stale running job and an old job event were booted (2026-11-15: with
 * LECTERN_WORKER_MODE=external the boot runs no maintenance and no reclaim); the list stays
 * so a boot clean-up of these tables added later is noted, not a failure. Any other table
 * that shrinks fails the rehearsal.
 */
const BOOT_CLEANUP = (table: string) => ["sessions", "job", "job_event"].includes(table) || table.startsWith("rate_limit");

const HEALTH_TIMEOUT_MS = 90_000;
const STOP_GRACE_MS = 10_000;

const USAGE = "usage: bun scripts/rehearse/restore.ts --backup <file> [--work <empty dir>] [--uploads <dir>] [--keep] [--out <file>]";

interface Args {
  backup: string;
  work: string | null;
  uploads: string | null;
  keep: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { backup: "", work: null, uploads: null, keep: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === "--keep") {
      args.keep = true;
      continue;
    }
    if (!["--backup", "--work", "--uploads", "--out"].includes(flag)) usage(`unknown option: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag === "--backup") args.backup = value;
    else if (flag === "--work") args.work = value;
    else if (flag === "--uploads") args.uploads = value;
    else args.out = value;
  }
  if (!args.backup) usage("--backup is required");
  return args;
}

function usage(problem: string): never {
  process.stderr.write(`${problem}\n${USAGE}\n`);
  process.exit(2);
}

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

async function healthOf(baseUrl: string): Promise<{ status: number; database: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
    const body = (await res.json().catch(() => null)) as { checks?: { database?: string } } | null;
    return { status: res.status, database: String(body?.checks?.database ?? "unknown") };
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const backup = resolve(args.backup);
if (!existsSync(backup) || !statSync(backup).isFile()) {
  process.stderr.write(`rehearse: no backup file at ${backup}\n`);
  process.exit(2);
}

// The guard runs before anything is created or removed: a refused directory is never touched.
// A directory the caller gave that already existed (strictly empty, by the guard) keeps
// existing afterwards: only what this script put in it is removed (it may be a mount point).
const givenExisting = args.work !== null && existsSync(resolve(args.work));
let work: string;
try {
  work = assertWorkDir(args.work ?? mkdtempSync(join(tmpdir(), "lectern-restore-")), backup);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(2);
}

let child: ReturnType<typeof Bun.spawn> | null = null;
const alive = () => child !== null && child.exitCode === null && child.signalCode === null;

async function stopServer(): Promise<void> {
  if (!child || !alive()) return;
  child.kill("SIGTERM");
  const ended = await Promise.race([child.exited.then(() => true), Bun.sleep(STOP_GRACE_MS).then(() => false)]);
  if (!ended) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

function cleanUp(): void {
  if (args.keep) return;
  try {
    if (givenExisting) for (const name of readdirSync(work)) rmSync(join(work, name), { recursive: true, force: true });
    else rmSync(work, { recursive: true, force: true });
  } catch (err) {
    // Never changes the outcome: the summary is already out.
    process.stderr.write(`rehearse: could not remove the work directory ${work}: ${(err as Error).message}\n`);
  }
}

// Ctrl-C, a closed terminal or a supervisor's stop: the rehearsal server goes down with us.
process.on("exit", () => {
  if (alive()) child!.kill("SIGKILL");
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    void stopServer().finally(() => {
      cleanUp();
      process.exit(130);
    });
  });
}

const notes: string[] = [];
const backupStat = statSync(backup);

// 1. The backup, read without writing (immutable open: no lock, nothing created beside it).
const before = digestDatabase(backup);

// 2. The copy, and the same digest and an intact database.
const dataDir = join(work, "data");
for (const sub of ["data", "lectures", "home"]) mkdirSync(join(work, sub), { recursive: true });
const copy = join(dataDir, "lectern.sqlite");
copyFileSync(backup, copy);
const after = digestDatabase(copy);
const differences = compareDigests(before, after);
for (const line of differences.slice(0, 20)) notes.push(`copy: ${line}`);
const check = integrity(copy);

// 3. The server on the copy (migrations run at boot), then stopped.
const port = freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logPath = join(work, "server.log");
const logFd = openSync(logPath, "w");
const started = performance.now();
child = Bun.spawn(["bun", "--no-env-file", "apps/server/src/index.ts"], {
  cwd: REPO_ROOT,
  env: restoreEnv(work, port),
  stdin: "ignore",
  stdout: logFd,
  stderr: logFd,
});
closeSync(logFd);

const server: { started: boolean; health: string; migration_ms: number | null } = { started: false, health: "unreachable", migration_ms: null };
while (performance.now() - started < HEALTH_TIMEOUT_MS) {
  if (!alive()) {
    notes.push(`server exited during boot (code ${child.exitCode ?? child.signalCode}); rerun with --keep and read server.log in the work directory`);
    break;
  }
  const health = await healthOf(baseUrl);
  if (health) {
    server.started = true;
    server.health = health.database;
    server.migration_ms = Math.round(performance.now() - started);
    break;
  }
  await Bun.sleep(250);
}
if (!server.started && alive()) notes.push(`server did not answer /api/health within ${HEALTH_TIMEOUT_MS / 1000} s`);
await stopServer();

// 4. After migrations: no table may have lost rows, except the boot clean-up tables.
const shrunk: string[] = [];
let migrated: TableDigest[] = [];
if (server.started) {
  migrated = digestDatabase(copy, { wal: true });
  const byName = new Map(migrated.map((t) => [t.table, t]));
  for (const t of before) {
    const now = byName.get(t.table);
    const rows = now?.rows ?? 0;
    if (rows >= t.rows) continue;
    if (BOOT_CLEANUP(t.table)) notes.push(`boot clean-up: ${t.table} ${t.rows} → ${rows} rows`);
    else {
      shrunk.push(t.table);
      notes.push(`shrank after boot: ${t.table} ${t.rows} → ${now ? rows : "dropped"}`);
    }
  }
}

// 5. Optional: which referenced audio files exist in the uploads directory (names only, nothing read).
let audio: { referenced: number; present: number; missing: string[] } | undefined;
if (args.uploads) {
  const uploads = resolve(args.uploads);
  const db = new Database(copy, { readonly: true });
  try {
    const paths = db.query(`SELECT audio_path FROM lectures WHERE audio_path IS NOT NULL AND audio_path != ''`).all() as Array<{ audio_path: string }>;
    const missing = paths.map((p) => basename(p.audio_path)).filter((name) => !existsSync(join(uploads, name)));
    audio = { referenced: paths.length, present: paths.length - missing.length, missing: missing.slice(0, 20) };
  } finally {
    db.close();
  }
}

const rowsTotal = before.reduce((n, t) => n + t.rows, 0);
const summary = {
  backup: { file: basename(backup), bytes: backupStat.size, mtime: backupStat.mtime.toISOString() },
  tables: before.length,
  rows_total: rowsTotal,
  digest_equal: differences.length === 0,
  integrity: check.integrity,
  foreign_key_violations: check.foreignKeyViolations,
  server,
  shrunk_tables: shrunk,
  ...(audio ? { audio } : {}),
  ok:
    differences.length === 0 &&
    check.integrity === "ok" &&
    check.foreignKeyViolations === 0 &&
    server.started &&
    server.health === "ok" &&
    shrunk.length === 0,
  notes,
};

const json = JSON.stringify(summary, null, 2);
process.stdout.write(`${json}\n`);
if (args.out) writeFileSync(args.out, `${json}\n`);
if (args.keep) process.stderr.write(`rehearse: work directory kept at ${work}\n`);
cleanUp();
process.exit(summary.ok ? 0 : 1);
