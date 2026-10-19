// Rehearses the P2 migration (lectures -> v2 rows, ARCHITECTURE §5.3) on a COPY of a
// database and proves it lossless with counts and checksums (ROADMAP P2 종료 기준).
//
//   bun apps/server/scripts/rehearse-v2-migration.ts /path/to/lectern-backup.sqlite
//
// The given file is only read: it is copied into a temporary directory (with its -wal
// file, if any) and everything runs on the copy, which is deleted afterwards. Output is
// counts, checksums and row ids only (no titles, notes or emails), so it can be pasted into
// a PR. Exit code 0 means lossless; 1 means a mismatch or a row the API could not serve.
//
// The deploy preflight runs the same checks on its copy of the live database (preflight.ts).

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { backfillLegacy, installLectureSyncTriggers, runMigrations, sha256Hex, verifyLegacy } from "@lectern/db";
import { checkV2Rows } from "../src/api/v2/row-check.ts";

/** sha256 over every row of a v1 table, to show the migration left it untouched. */
function tableChecksum(sqlite: Database, table: string): { rows: number; sha256: string } {
  const rows = sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all();
  return { rows: rows.length, sha256: sha256Hex(JSON.stringify(rows)) };
}

const V1_TABLES = ["users", "lectures", "sessions", "audit_logs", "deleted_sources"] as const;

export function rehearse(sourcePath: string) {
  const dir = mkdtempSync(join(tmpdir(), "lectern-rehearsal-"));
  const copy = join(dir, basename(sourcePath));
  try {
    copyFileSync(sourcePath, copy);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(sourcePath + suffix)) copyFileSync(sourcePath + suffix, copy + suffix);
    const sqlite = new Database(copy);
    sqlite.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
    const present = (t: string) => Boolean(sqlite.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t));
    if (!present("lectures") || !present("users")) throw new Error("not a Lectern database (no users/lectures tables)");

    const v1Before = Object.fromEntries(V1_TABLES.filter(present).map((t) => [t, tableChecksum(sqlite, t)]));
    const started = performance.now();
    const migrations = runMigrations(sqlite, { backupDir: join(dir, "backups") });
    installLectureSyncTriggers(sqlite);
    const backfill = backfillLegacy(sqlite);
    const migrateMs = Math.round(performance.now() - started);
    const second = backfillLegacy(sqlite); // every boot runs it again: must create nothing
    const verify = verifyLegacy(sqlite);
    const rows = checkV2Rows(sqlite);
    const v1After = Object.fromEntries(V1_TABLES.filter(present).map((t) => [t, tableChecksum(sqlite, t)]));
    const v1Unchanged = JSON.stringify(v1Before) === JSON.stringify(v1After);
    sqlite.close();

    const idempotent = second.recordings === 0 && second.workspaces === 0;
    return {
      ok: verify.ok && rows.ok && v1Unchanged && idempotent,
      migrations: migrations.applied,
      migrate_ms: migrateMs,
      backfill,
      idempotent,
      v1_unchanged: v1Unchanged,
      v1_tables: v1After,
      counts: verify.counts,
      checksums: verify.checksums,
      mismatch_count: verify.mismatch_count,
      mismatches: verify.mismatches,
      unowned_lectures: verify.unowned_lectures,
      rows,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const source = process.argv[2];
  if (!source || !existsSync(source)) {
    console.error("usage: bun apps/server/scripts/rehearse-v2-migration.ts <copy of lectern.sqlite>");
    process.exit(2);
  }
  const report = rehearse(source);
  console.log(JSON.stringify(report, null, 2));
  console.error(report.ok ? "rehearsal: lossless" : "rehearsal: FAILED (see mismatches / rows.failures)");
  process.exit(report.ok ? 0 : 1);
}
