import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@lectern/db";
import { Harness, type HarnessOptions } from "../src/index.ts";

export interface TestEnv {
  dir: string;
  dbPath: string;
  blobDir: string;
  db: Database;
  harness(options?: Partial<HarnessOptions>): Harness;
  /** Inserts a `job` row (the runner reads its budget, the ledger charges it). */
  job(id: string, fields?: { budgetMicrousd?: number }): string;
  close(): void;
}

/** A migrated SQLite file and a blob root in a fresh temp dir. */
export function testEnv(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), "lectern-harness-test-"));
  const dbPath = join(dir, "harness.sqlite");
  const db = new Database(dbPath, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
  runMigrations(db, { backupDir: join(dir, "backups") });
  const blobDir = join(dir, "data", "blobs");
  return {
    dir,
    dbPath,
    blobDir,
    db,
    harness: (options = {}) => new Harness({ db, blobDir, sleep: async () => {}, ...options }),
    job(id, fields = {}) {
      db.query(
        `INSERT INTO job (id, owner_id, kind, state, run_after, budget_microusd, created_at)
         VALUES (?, 'owner-test', 'harness-test', 'running', 0, ?, 0)`
      ).run(id, fields.budgetMicrousd ?? null);
      return id;
    },
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function rows<T = any>(db: Database, sql: string, ...params: any[]): T[] {
  return db.query(sql).all(...params) as T[];
}
