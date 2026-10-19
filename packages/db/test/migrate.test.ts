import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingMigrations, runMigrations } from "../src/index.ts";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "lectern-db-test-"));
}

describe("@lectern/db migrations", () => {
  test("a fresh database gets every v2 table and nothing is pending afterwards", () => {
    const dir = tempDir();
    try {
      const sqlite = new Database(join(dir, "fresh.sqlite"));
      expect(pendingMigrations(sqlite).length).toBeGreaterThan(0);
      const res = runMigrations(sqlite, { backupDir: join(dir, "backups") });
      expect(res.applied).toContain("0000_job_queue");
      expect(res.backup).toBeNull(); // nothing to protect yet
      const tables = (sqlite.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]).map((r) => r.name);
      for (const t of ["job", "stage_run", "artifact", "ai_call", "job_event", "system_state"]) {
        expect(tables).toContain(t);
      }
      expect(pendingMigrations(sqlite)).toEqual([]);
      expect(runMigrations(sqlite, { backupDir: join(dir, "backups") }).applied).toEqual([]);
      sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an existing database with data is snapshotted before it is migrated", () => {
    const dir = tempDir();
    try {
      const sqlite = new Database(join(dir, "legacy.sqlite"));
      sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','a@b.c');`);
      const res = runMigrations(sqlite, { backupDir: join(dir, "backups"), now: new Date("2026-10-19T01:02:03Z") });
      expect(res.backup).toBe(join(dir, "backups", "pre-migrate-20261019-010203.sqlite"));
      expect(readdirSync(join(dir, "backups"))).toEqual(["pre-migrate-20261019-010203.sqlite"]);
      expect(statSync(join(dir, "backups")).mode & 0o777).toBe(0o700);
      expect(statSync(res.backup!).mode & 0o777).toBe(0o600);
      const snap = new Database(res.backup!);
      expect((snap.query(`SELECT COUNT(*) AS n FROM users`).get() as any).n).toBe(1);
      expect(snap.query(`SELECT 1 FROM sqlite_master WHERE name='job'`).get()).toBeNull(); // pre-migration state
      snap.close();
      sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
