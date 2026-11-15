// The v1 bridge (CONTRACTS D-P1-3): once a recording has a structured document, a lecture
// whose Markdown equals the document's rendered Markdown needs no legacy document; a v1
// edit becomes a legacy version and marks the structured document user-edited.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  documentVersionId,
  installLectureSyncTriggers,
  lectureAudioAssetId,
  lectureRecordingId,
  personalWorkspaceId,
  projectLecture,
  runMigrations,
  verifyLegacy,
} from "../src/index.ts";

const V1_SCHEMA = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
    api_token TEXT UNIQUE NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE lectures (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT '', share_token TEXT UNIQUE NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, course TEXT NOT NULL, date_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'done', stage TEXT NOT NULL DEFAULT 'done', stage_message TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 100, markdown TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
    audio_path TEXT, audio_mime TEXT, audio_size INTEGER NOT NULL DEFAULT 0, duration_sec INTEGER NOT NULL DEFAULT 0,
    model_requested TEXT NOT NULL DEFAULT 'gemini-3.8-flash', model_used TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    source_client TEXT NOT NULL DEFAULT 'web', error_message TEXT, md_source_path TEXT UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, audio_sha256 TEXT
  );
`;

const LECTURE = "lec_bridge";

function setup(): { sqlite: Database; recordingId: string } {
  const sqlite = new Database(":memory:");
  sqlite.exec(V1_SCHEMA);
  runMigrations(sqlite, { backupDir: join(tmpdir(), "lectern-db-bridge-unused") });
  installLectureSyncTriggers(sqlite);
  sqlite
    .query(`INSERT INTO users (id, email, display_name, password_hash, api_token, created_at) VALUES (?, ?, ?, 'x', ?, ?)`)
    .run("usr_a", "usr_a@example.com", "사용자", "tok_usr_a", "2026-09-01T00:00:00.000Z");
  sqlite
    .query(
      `INSERT INTO lectures (id, owner_id, share_token, title, course, date_label, status, markdown, audio_path, audio_mime,
         audio_size, duration_sec, created_at, updated_at)
       VALUES (?, 'usr_a', 'share_bridge', '강의', '정보보호', '2026-09-02', 'processing', '', ?, 'audio/mp4', 100, 18, ?, ?)`
    )
    .run(LECTURE, "/data/uploads/bridge.m4a", "2026-09-02T01:00:00.000Z", "2026-09-02T01:00:00.000Z");
  projectLecture(sqlite, LECTURE);
  return { sqlite, recordingId: lectureRecordingId(LECTURE) };
}

/** A structured (template `lecture`) document at version 1 with this Markdown. */
function addStructured(sqlite: Database, recordingId: string, markdown: string): string {
  const id = "doc_structured_bridge";
  const ws = personalWorkspaceId("usr_a");
  sqlite
    .query(
      `INSERT INTO document (id, workspace_id, recording_id, template_id, template_version, current_version, user_edited,
         md_source_path, created_at, updated_at) VALUES (?, ?, ?, 'lecture', 1, 1, 0, NULL, 1, 1)`
    )
    .run(id, ws, recordingId);
  sqlite
    .query(
      `INSERT INTO document_version (id, workspace_id, document_id, recording_id, version, base_version, template_id,
         template_version, body_json, rendered_md, created_by, author_id, created_at)
       VALUES (?, ?, ?, ?, 1, NULL, 'lecture', 1, '{"sections":[]}', ?, 'ai', NULL, 1)`
    )
    .run(documentVersionId(id, 1), ws, id, recordingId, markdown);
  return id;
}

const setMarkdown = (sqlite: Database, markdown: string) =>
  sqlite
    .query(`UPDATE lectures SET markdown = ?, status = 'done', updated_at = ? WHERE id = ?`)
    .run(markdown, new Date().toISOString(), LECTURE);

const legacyDocs = (sqlite: Database) =>
  sqlite.query(`SELECT id FROM document WHERE template_id = 'legacy-markdown'`).all() as Array<{ id: string }>;

describe("v1 bridge in projectLecture", () => {
  test("bridge: equal markdown makes no legacy document", () => {
    const { sqlite, recordingId } = setup();
    addStructured(sqlite, recordingId, "# A");
    setMarkdown(sqlite, "# A");
    expect(["updated", "unchanged"]).toContain(projectLecture(sqlite, LECTURE));
    expect(legacyDocs(sqlite)).toHaveLength(0);
    const report = verifyLegacy(sqlite);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("bridge: different markdown creates a legacy version and marks user_edited", () => {
    const { sqlite, recordingId } = setup();
    const structured = addStructured(sqlite, recordingId, "# A");
    setMarkdown(sqlite, "# A");
    projectLecture(sqlite, LECTURE);
    setMarkdown(sqlite, "# B");
    projectLecture(sqlite, LECTURE, { author: "user", authorId: "usr_a" });
    const legacy = legacyDocs(sqlite);
    expect(legacy).toHaveLength(1);
    const version = sqlite
      .query(`SELECT version, rendered_md, created_by FROM document_version WHERE document_id = ?`)
      .all(legacy[0]!.id) as Array<{ version: number; rendered_md: string; created_by: string }>;
    expect(version).toEqual([{ version: 1, rendered_md: "# B", created_by: "user" }]);
    expect((sqlite.query(`SELECT user_edited FROM document WHERE id = ?`).get(structured) as { user_edited: number }).user_edited).toBe(1);
    expect(sqlite.query(`SELECT COUNT(*) AS n FROM document_version WHERE document_id = ?`).get(structured)).toEqual({ n: 1 });

    // bridge: second projection is unchanged
    expect(projectLecture(sqlite, LECTURE)).toBe("unchanged");
    // verifyLegacy accepts the user-edited lecture
    expect(verifyLegacy(sqlite).ok).toBe(true);
  });

  test("bridge: partial status survives projection", () => {
    const { sqlite, recordingId } = setup();
    addStructured(sqlite, recordingId, "# A");
    setMarkdown(sqlite, "# A");
    projectLecture(sqlite, LECTURE);
    sqlite
      .query(`UPDATE recording SET status = 'partial', failure_code = 'extract_failed', failure_message = '일부만 만들었습니다.' WHERE id = ?`)
      .run(recordingId);
    sqlite.query(`UPDATE lectures SET title = '새 제목', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), LECTURE);
    projectLecture(sqlite, LECTURE);
    const rec = sqlite.query(`SELECT status, title, failure_code, failure_message FROM recording WHERE id = ?`).get(recordingId);
    expect(rec).toEqual({ status: "partial", title: "새 제목", failure_code: "extract_failed", failure_message: "일부만 만들었습니다." });
    expect(verifyLegacy(sqlite).ok).toBe(true);
  });

  test("multi-part audio keeps part duration", () => {
    const { sqlite, recordingId } = setup();
    const first = lectureAudioAssetId(LECTURE);
    sqlite.query(`UPDATE asset SET duration_ms = 10000 WHERE id = ?`).run(first);
    sqlite
      .query(
        `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms,
           page_count, meta_json, created_at) VALUES ('ast_part2', ?, ?, 'audio', 1, 'file:part2', NULL, 50, 'audio/mp4', 8000, NULL, '{}', 1)`
      )
      .run(personalWorkspaceId("usr_a"), recordingId);
    sqlite.query(`UPDATE lectures SET audio_size = 150, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), LECTURE);
    projectLecture(sqlite, LECTURE);
    expect((sqlite.query(`SELECT duration_ms FROM asset WHERE id = ?`).get(first) as { duration_ms: number }).duration_ms).toBe(10000);
    expect((sqlite.query(`SELECT duration_ms FROM recording WHERE id = ?`).get(recordingId) as { duration_ms: number }).duration_ms).toBe(18000);
  });

  test("no structured document: projection is unchanged from before", () => {
    const { sqlite } = setup();
    setMarkdown(sqlite, "# 노트");
    projectLecture(sqlite, LECTURE);
    expect(legacyDocs(sqlite)).toHaveLength(1);
    expect(verifyLegacy(sqlite).ok).toBe(true);
  });
});
