// Pieces of the restore rehearsal (P7-02, CONTRACTS D-P7-3): the work-directory guard, table
// digests (counts and hashes, never row contents), their comparison, and the integrity
// check. Same refusal rules as scripts/load/lib/guard.ts (D-0-10), written again here: the
// two scripts do not depend on each other.

import { constants, Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");

/** Secrets the rehearsal server must never see, even if a value slipped in: passed as "". */
export const BLANKED_SECRETS = [
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "LECTERN_DEPLOY_TOKEN",
  "LECTERN_OWNER_PASSWORD",
  "LECTERN_OWNER_API_TOKEN",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "APPLE_SIGNIN_CLIENT_ID",
  "APPLE_SIGNIN_TEAM_ID",
  "APPLE_SIGNIN_KEY_ID",
  "APPLE_SIGNIN_PRIVATE_KEY_FILE",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY_FILE",
];

function refuse(reason: string): never {
  throw new Error(`rehearse: refused — ${reason}`);
}

/** The real path of `path`: symlinks resolved on its deepest existing ancestor, the rest appended. */
function realPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Throws `rehearse: refused — <reason>` unless `workDir` is a safe place to restore into:
 * not the repository's `data/`, not overlapping LECTERN_DATA_DIR or LECTERN_LECTURES_DIR, not
 * the data directory the backup came from (`<X>/backups/<file>` → `<X>`), no lectern.sqlite
 * there or above, strictly empty if it exists, and not `/`, the home directory or the repository.
 * Creates it and returns its absolute path.
 */
export function assertWorkDir(workDir: string, backupFile: string, env: Record<string, string | undefined> = process.env): string {
  const target = realPath(workDir);
  const repo = realPath(REPO_ROOT);
  if (target === sep || target === realPath(homedir()) || target === repo) {
    refuse(`${target} is the filesystem root, the home directory or the repository`);
  }
  if (within(target, realPath(join(repo, "data"))) || within(target, join(repo, "data"))) {
    refuse(`${target} is the repository's data directory`);
  }
  for (const name of ["LECTERN_DATA_DIR", "LECTERN_LECTURES_DIR"] as const) {
    const value = env[name];
    if (!value) continue;
    const configured = realPath(value);
    if (within(target, configured) || within(configured, target)) refuse(`${target} overlaps ${name} (${configured})`);
  }
  const backupDir = dirname(realPath(backupFile));
  if (basename(backupDir) === "backups") {
    const source = dirname(backupDir);
    if (within(target, source) || within(source, target)) refuse(`${target} overlaps the data directory the backup came from (${source})`);
  }
  for (let at = target; ; at = dirname(at)) {
    if (existsSync(join(at, "lectern.sqlite"))) refuse(`${at} holds lectern.sqlite`);
    if (dirname(at) === at) break;
  }
  // Strictly empty, hidden entries and lost+found included: restore.ts removes what is in it
  // afterwards, so everything there must be its own.
  if (existsSync(target) && readdirSync(target).length > 0) refuse(`${target} is not empty`);
  mkdirSync(target, { recursive: true });
  return target;
}

export interface TableDigest {
  table: string;
  rows: number;
  /** Hex sha256 over the rows in rowid order; "-" for FTS5 virtual and shadow tables. */
  sha256: string;
}

/** SQLite URI special characters in a path. */
function uriPath(path: string): string {
  return resolve(path).replaceAll("%", "%25").replaceAll("?", "%3f").replaceAll("#", "%23");
}

/**
 * Opens `path` without writing anything: by default immutable (no lock, no -wal/-shm created
 * beside a backup); with `wal`, a plain read-only open that also reads a -wal left by a
 * server that was killed (the restored copy in the work directory).
 *
 * The immutable open is a URI, so SQLITE_OPEN_URI is passed explicitly: Bun's own SQLite on
 * Linux is built without URI filenames on by default (macOS's system SQLite has them).
 * Numeric flags leave no room for `safeIntegers`, so the row queries turn it on (`exactQuery`).
 */
function openReadOnly(path: string, options: { wal?: boolean } = {}): Database {
  if (!existsSync(path)) throw new Error(`rehearse: no database at ${path}`);
  if (options.wal) return new Database(path, constants.SQLITE_OPEN_READONLY);
  return new Database(`file:${uriPath(path)}?immutable=1`, constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI);
}

/** A statement that reads integers as bigint (2^53 and above stay exact). */
function exactQuery(db: Database, sql: string) {
  // Statement.safeIntegers exists at runtime (Bun 1.4) but is missing from bun-types.
  type Statement = ReturnType<Database["query"]>;
  return (db.query(sql) as Statement & { safeIntegers(on: boolean): Statement }).safeIntegers(true);
}

const FTS5_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return value;
}

/**
 * Row count and a hash of every row for each table (name order). Rows are streamed one at a
 * time, never collected. FTS5 virtual tables and their shadow tables get counts only.
 */
export function digestDatabase(path: string, options: { wal?: boolean } = {}): TableDigest[] {
  const db = openReadOnly(path, options);
  try {
    const tables = db
      .query(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`)
      .all() as Array<{ name: string; sql: string | null }>;
    const virtual = tables.filter((t) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql ?? "")).map((t) => t.name);
    const countOnly = new Set([...virtual, ...virtual.flatMap((v) => FTS5_SHADOW_SUFFIXES.map((s) => v + s))]);
    return tables.map(({ name }) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const rows = Number((db.query(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n);
      if (countOnly.has(name)) return { table: name, rows, sha256: "-" };
      let query;
      try {
        query = exactQuery(db, `SELECT * FROM ${quoted} ORDER BY rowid`);
      } catch {
        query = exactQuery(db, `SELECT * FROM ${quoted} ORDER BY 1`); // WITHOUT ROWID
      }
      const hash = createHash("sha256");
      for (const row of query.iterate() as Iterable<Record<string, unknown>>) {
        hash.update(JSON.stringify(Object.values(row).map(serialize)));
        hash.update("\n");
      }
      return { table: name, rows, sha256: hash.digest("hex") };
    });
  } finally {
    db.close();
  }
}

/** Differences between two digests, one line each (`table recording: rows 12 != 11`); [] when equal. */
export function compareDigests(a: TableDigest[], b: TableDigest[]): string[] {
  const out: string[] = [];
  const right = new Map(b.map((t) => [t.table, t]));
  for (const t of a) {
    const other = right.get(t.table);
    if (!other) out.push(`table ${t.table}: missing`);
    else if (t.rows !== other.rows) out.push(`table ${t.table}: rows ${t.rows} != ${other.rows}`);
    else if (t.sha256 !== other.sha256) out.push(`table ${t.table}: checksum differs`);
  }
  const left = new Set(a.map((t) => t.table));
  for (const t of b) if (!left.has(t.table)) out.push(`table ${t.table}: extra`);
  return out;
}

/** `PRAGMA integrity_check`'s first row and the number of `PRAGMA foreign_key_check` rows. */
export function integrity(path: string): { integrity: string; foreignKeyViolations: number } {
  const db = openReadOnly(path);
  try {
    const first = db.query(`PRAGMA integrity_check`).values()[0];
    return {
      integrity: String(first?.[0] ?? "no result"),
      foreignKeyViolations: db.query(`PRAGMA foreign_key_check`).all().length,
    };
  } finally {
    db.close();
  }
}

/**
 * The rehearsal server's whole environment: nothing inherited but PATH, the secrets blanked,
 * no jobs (LECTERN_WORKER_MODE=external) and LECTERN_PREFLIGHT=1, the mode the deploy
 * preflight uses on its copy of the live database (interrupted lectures are not queued
 * again). No owner variables: the copy's own accounts are used.
 */
export function restoreEnv(work: string, port: number): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LECTERN_DATA_DIR: join(work, "data"),
    LECTERN_LECTURES_DIR: join(work, "lectures"),
    HOME: join(work, "home"),
    LECTERN_RESEND_CREDENTIALS_FILE: join(work, "no-credentials.json"),
    PORT: String(port),
    LECTERN_BASE_URL: `http://127.0.0.1:${port}`,
    LECTERN_WORKER_MODE: "external",
    LECTERN_PREFLIGHT: "1",
    LECTERN_LOG_REQUESTS: "0",
  };
  for (const key of BLANKED_SECRETS) env[key] = "";
  return env;
}
