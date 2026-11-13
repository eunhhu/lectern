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
      expect(res.applied).toEqual(["0000_job_queue", "0001_search_ask", "0002_search_fts", "0003_v2_entities", "0004_p1_pipeline"]);
      expect(res.backup).toBeNull(); // nothing to protect yet
      const tables = (sqlite.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]).map((r) => r.name);
      for (const t of ["job", "stage_run", "artifact", "ai_call", "job_event", "system_state"]) {
        expect(tables).toContain(t);
      }
      for (const t of ["search_chunk", "search_chunk_fts", "search_embedding", "search_index_state", "ask_thread", "ask_turn"]) {
        expect(tables).toContain(t);
      }
      for (const t of [
        "workspace", "membership", "folder", "tag", "recording", "recording_tag", "asset", "transcript_segment",
        "transcript_gap", "speaker", "document", "document_version", "question", "event_candidate", "action_item",
        "share_link", "integration", "usage_ledger", "saved_view", "upload", "upload_part", "lecture_sync_pending",
      ]) {
        expect(tables).toContain(t);
      }
      expect(pendingMigrations(sqlite)).toEqual([]);
      expect(runMigrations(sqlite, { backupDir: join(dir, "backups") }).applied).toEqual([]);
      sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fresh db has job.cancel_requested_at", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    const columns = sqlite.query(`PRAGMA table_info(job)`).all() as Array<{ name: string; notnull: number }>;
    const column = columns.find((c) => c.name === "cancel_requested_at");
    expect(column).toBeDefined();
    expect(column!.notnull).toBe(0);
    sqlite.close();
  });

  test("existing job rows survive", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    sqlite.query(`INSERT INTO job (id, owner_id, kind, run_after, created_at) VALUES ('job_1', 'usr_1', 'distill', 0, 0)`).run();
    expect(sqlite.query(`SELECT cancel_requested_at FROM job WHERE id = 'job_1'`).get()).toEqual({ cancel_requested_at: null });
    sqlite.close();
  });

  test("the search FTS table is contentless and supports deletes", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    sqlite.query(`INSERT INTO search_chunk_fts (rowid, body) VALUES (7, '운영 영모 모드 ecb')`).run();
    const hit = () => sqlite.query(`SELECT rowid FROM search_chunk_fts WHERE search_chunk_fts MATCH '"영모 모드"'`).all();
    expect(hit()).toEqual([{ rowid: 7 }]);
    expect(sqlite.query(`SELECT body FROM search_chunk_fts WHERE rowid = 7`).get()).toEqual({ body: null });
    sqlite.query(`DELETE FROM search_chunk_fts WHERE rowid = 7`).run();
    expect(hit()).toEqual([]);
    sqlite.close();
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
