import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingMigrations, runMigrations } from "../src/index.ts";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "lectern-db-test-"));
}

const CALENDAR_TABLES = ["calendar_feed", "calendar_event_link", "reminder", "oauth_state"];

/** The `when` drizzle recorded for a migration tag (its __drizzle_migrations.created_at). */
function journalWhen(tag: string): number {
  const journal = JSON.parse(readFileSync(join(import.meta.dir, "../migrations/meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return journal.entries.find((e) => e.tag === tag)!.when;
}

function freshDb(): Database {
  const sqlite = new Database(":memory:");
  runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
  return sqlite;
}

describe("@lectern/db migrations", () => {
  test("a fresh database gets every v2 table and nothing is pending afterwards", () => {
    const dir = tempDir();
    try {
      const sqlite = new Database(join(dir, "fresh.sqlite"));
      expect(pendingMigrations(sqlite).length).toBeGreaterThan(0);
      const res = runMigrations(sqlite, { backupDir: join(dir, "backups") });
      expect(res.applied).toEqual(["0000_job_queue", "0001_search_ask", "0002_search_fts", "0003_v2_entities", "0004_p1_pipeline", "0005_p3_pdf", "0006_p4_calendar"]);
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
        "pdf_page", "calendar_feed", "calendar_event_link", "reminder", "oauth_state",
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

  test("fresh db has pdf_page", () => {
    const sqlite = new Database(":memory:");
    const res = runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    expect(res.applied).toContain("0005_p3_pdf");
    const columns = sqlite.query(`PRAGMA table_info(pdf_page)`).all() as Array<{ name: string; notnull: number; pk: number }>;
    expect(columns.map((c) => c.name)).toEqual([
      "asset_id", "page_no", "workspace_id", "recording_id", "text", "char_count", "has_text_layer", "ocr_source",
    ]);
    expect(columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)).toEqual(["asset_id", "page_no"]);
    expect(columns.find((c) => c.name === "ocr_source")!.notnull).toBe(0);
    const indexes = (sqlite.query(`PRAGMA index_list(pdf_page)`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain("idx_pdf_page_recording");
    sqlite.close();
  });

  test("existing rows survive the p3_pdf migration", () => {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    // Roll the database back to just before p3_pdf, as a server that ran P2 would be
    // (later migrations go too).
    sqlite.query(`DELETE FROM __drizzle_migrations WHERE created_at >= ?`).run(journalWhen("0005_p3_pdf"));
    for (const t of ["pdf_page", ...CALENDAR_TABLES]) sqlite.query(`DROP TABLE ${t}`).run();
    sqlite
      .query(
        `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, bytes, mime, created_at)
         VALUES ('ast_1', 'wsp_1', 'rec_1', 'pdf', 0, 'file:x.pdf', 10, 'application/pdf', 0)`,
      )
      .run();
    expect(runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") }).applied).toEqual(["0005_p3_pdf", "0006_p4_calendar"]);
    expect(sqlite.query(`SELECT id, kind FROM asset`).all()).toEqual([{ id: "ast_1", kind: "pdf" }]);
    expect(sqlite.query(`SELECT COUNT(*) AS n FROM pdf_page`).get()).toEqual({ n: 0 });
    sqlite.close();
  });

  test("fresh db has the p4_calendar tables", () => {
    const sqlite = new Database(":memory:");
    const res = runMigrations(sqlite, { backupDir: join(tmpdir(), "unused") });
    expect(res.applied.at(-1)).toBe("0006_p4_calendar");
    const tables = (sqlite.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((r) => r.name);
    for (const t of CALENDAR_TABLES) expect(tables).toContain(t);
    const columns = (sqlite.query(`PRAGMA table_info(reminder)`).all() as Array<{ name: string; notnull: number }>);
    expect(columns.map((c) => c.name)).toEqual([
      "id", "workspace_id", "user_id", "target_type", "target_id", "send_at", "state", "sent_at", "created_at",
    ]);
    expect(columns.find((c) => c.name === "send_at")!.notnull).toBe(1);
    expect(columns.find((c) => c.name === "state")!.notnull).toBe(1);
    sqlite.close();
  });

  test("reminder is unique per user/target/time", () => {
    const sqlite = freshDb();
    const insert = (id: string) =>
      sqlite
        .query(
          `INSERT INTO reminder (id, workspace_id, user_id, target_type, target_id, send_at, state, created_at)
           VALUES (?, 'wsp_1', 'usr_1', 'event', 'evt_1', 1000, 'scheduled', 0)`,
        )
        .run(id);
    insert("rem_1");
    expect(() => insert("rem_2")).toThrow(/UNIQUE/);
    // Another time for the same target is a separate reminder.
    sqlite
      .query(
        `INSERT INTO reminder (id, workspace_id, user_id, target_type, target_id, send_at, state, created_at)
         VALUES ('rem_3', 'wsp_1', 'usr_1', 'event', 'evt_1', 2000, 'scheduled', 0)`,
      )
      .run();
    expect(sqlite.query(`SELECT COUNT(*) AS n FROM reminder`).get()).toEqual({ n: 2 });
    sqlite.close();
  });

  test("calendar_feed token_hash unique", () => {
    const sqlite = freshDb();
    const insert = (id: string, user: string) =>
      sqlite
        .query(`INSERT INTO calendar_feed (id, user_id, workspace_id, token_hash, created_at) VALUES (?, ?, 'wsp_1', 'hash_a', 0)`)
        .run(id, user);
    insert("cfd_1", "usr_1");
    expect(() => insert("cfd_2", "usr_2")).toThrow(/UNIQUE/);
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
