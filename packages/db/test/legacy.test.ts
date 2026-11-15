import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillLegacy,
  courseFolderId,
  drainLectureSync,
  hasPendingLectureSync,
  installLectureSyncTriggers,
  lectureAudioAssetId,
  lectureDocumentId,
  lectureRecordingId,
  lectureShareLinkId,
  personalWorkspaceId,
  placeRecordingInWorkspace,
  projectLecture,
  runMigrations,
  sortKeyAfter,
  UNFILED_COURSE,
  uuidv7,
  verifyLegacy,
} from "../src/index.ts";

// The v1 tables as apps/server/src/db.ts creates them (the columns the migration reads).
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

function v1Database(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(V1_SCHEMA);
  return sqlite;
}

function migrate(sqlite: Database) {
  runMigrations(sqlite, { backupDir: join(tmpdir(), "lectern-db-legacy-unused") });
  installLectureSyncTriggers(sqlite);
}

function addUser(sqlite: Database, id: string) {
  sqlite
    .query(`INSERT INTO users (id, email, display_name, password_hash, api_token, created_at) VALUES (?, ?, ?, 'x', ?, ?)`)
    .run(id, `${id}@example.com`, `사용자 ${id}`, `tok_${id}`, "2026-09-01T00:00:00.000Z");
}

let lectureCount = 0;
function addLecture(sqlite: Database, fields: Record<string, unknown>) {
  lectureCount += 1;
  const row = {
    id: `lec_${lectureCount}`,
    owner_id: "usr_a",
    share_token: `share${lectureCount}`,
    is_public: 0,
    title: `강의 ${lectureCount}`,
    course: "정보보호개론",
    date_label: "2026-09-02 (수) 10:00",
    status: "done",
    markdown: `# 노트 ${lectureCount}\n\n- [10:15] 내용`,
    audio_path: `/data/uploads/a${lectureCount}.m4a`,
    audio_mime: "audio/mp4",
    audio_size: 1000 + lectureCount,
    duration_sec: 3600,
    source_client: "macos-native-menubar",
    error_message: null,
    md_source_path: null,
    created_at: `2026-09-02T01:00:${String(lectureCount).padStart(2, "0")}.000Z`,
    updated_at: "2026-09-03T00:00:00.000Z",
    ...fields,
  };
  const cols = Object.keys(row);
  sqlite.query(`INSERT INTO lectures (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(Object.values(row) as any[]));
  return row.id as string;
}

const one = (sqlite: Database, sql: string, ...args: any[]) => sqlite.query(sql).get(...args) as any;
const all = (sqlite: Database, sql: string, ...args: any[]) => sqlite.query(sql).all(...args) as any[];

describe("v2 ids", () => {
  test("match the ids the 물어보기 bridge already wrote (ARCHITECTURE §5.3)", () => {
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(personalWorkspaceId("usr_0199")).toBe("wsp_usr_0199");
    expect(courseFolderId("usr_a", "정보보호개론")).toBe(`fld_${sha("usr_a\n정보보호개론").slice(0, 32)}`);
    expect(lectureDocumentId("lec_1")).toBe("doc_lec_1");
    expect(lectureDocumentId("x".repeat(70))).toBe(`doc_${sha("x".repeat(70)).slice(0, 32)}`);
    expect(lectureRecordingId("lec_1")).toBe("lec_1");
    expect(lectureRecordingId("lec 1/2")).toMatch(/^rec_[0-9a-f]{32}$/);
  });

  test("uuidv7 is a time-ordered RFC 9562 version 7 id", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  test("sort keys append after any key, byte-wise", () => {
    const keys = ["m"];
    for (let i = 0; i < 200; i += 1) keys.push(sortKeyAfter(keys[keys.length - 1]!));
    const sorted = [...keys].sort((x, y) => (Buffer.from(x) < Buffer.from(y) ? -1 : 1));
    expect(sorted).toEqual(keys);
    expect(sortKeyAfter(null)).toBe("m");
  });
});

describe("lectures -> v2 migration", () => {
  test("backfill is lossless on a synthetic v1 database (counts and checksums)", () => {
    const sqlite = v1Database();
    addUser(sqlite, "usr_a");
    addUser(sqlite, "usr_b");
    addUser(sqlite, "usr_empty"); // no lectures: still gets a workspace
    const plain = addLecture(sqlite, {});
    addLecture(sqlite, { course: "정보보호개론", is_public: 1 });
    addLecture(sqlite, { owner_id: "usr_b", course: "정보보호개론" }); // same course, other owner
    addLecture(sqlite, { course: "운영체제/실습", audio_path: null, audio_mime: null, audio_size: 0 }); // slash, no audio
    addLecture(sqlite, { status: "processing", markdown: "", duration_sec: 0 });
    addLecture(sqlite, { status: "error", markdown: "", error_message: "Gemini 응답이 비었습니다." });
    addLecture(sqlite, { course: "", md_source_path: "/archive/기타/x_요약.md" }); // blank course -> unfiled
    addLecture(sqlite, { owner_id: "usr_gone" }); // owner deleted: kept in a memberless workspace
    addLecture(sqlite, { owner_id: "" }); // not adopted yet: left for the bootstrap owner
    migrate(sqlite);

    const before = all(sqlite, `SELECT * FROM lectures ORDER BY id`);
    const report = backfillLegacy(sqlite, Date.parse("2026-10-19T00:00:00Z"));
    expect(report).toEqual({ workspaces: 3, recordings: 8, skipped: 1 });
    expect(all(sqlite, `SELECT * FROM lectures ORDER BY id`)).toEqual(before); // v1 untouched

    const verify = verifyLegacy(sqlite);
    expect(verify.mismatches).toEqual([]);
    expect(verify.ok).toBe(true);
    expect(verify.checksums.v1).toBe(verify.checksums.v2);
    expect(verify.unowned_lectures).toBe(1);
    expect(verify.counts).toEqual({
      users: { v1: 3, v2: 3 },
      lectures: { v1: 8, v2: 8 },
      documents: { v1: 6, v2: 6 },
      audio: { v1: 7, v2: 7 },
      courses: { v1: 4, v2: 4 },
      public_links: { v1: 1, v2: 1 },
    });

    // The ids the ask bridge uses, and the shape of one migrated lecture.
    const rec = one(sqlite, `SELECT * FROM recording WHERE id = ?`, plain);
    expect(rec).toMatchObject({
      workspace_id: "wsp_usr_a",
      folder_id: courseFolderId("usr_a", "정보보호개론"),
      domain: "lecture",
      status: "ready",
      recorded_at_source: "upload",
      duration_ms: 3_600_000,
      created_by: "usr_a",
      visibility: "private",
      lecture_id: plain,
    });
    expect(one(sqlite, `SELECT * FROM document WHERE id = ?`, `doc_${plain}`)).toMatchObject({
      template_id: "legacy-markdown",
      current_version: 1,
      user_edited: 0,
    });
    expect(one(sqlite, `SELECT body_json, created_by FROM document_version WHERE document_id = ?`, `doc_${plain}`)).toEqual({
      body_json: null,
      created_by: "ai",
    });
    expect(one(sqlite, `SELECT kind, blob_key, sha256 FROM asset WHERE id = ?`, lectureAudioAssetId(plain))).toEqual({
      kind: "audio",
      blob_key: `lecture:${plain}`,
      sha256: null, // v1 audio_sha256 may be a client key: computed later from the file
    });
    expect(one(sqlite, `SELECT revoked_at IS NOT NULL AS revoked FROM share_link WHERE id = ?`, lectureShareLinkId(plain))).toEqual({ revoked: 1 });
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM folder WHERE name = '정보보호개론'`).n).toBe(3); // one per owner (usr_a, usr_b, usr_gone)
    expect(one(sqlite, `SELECT COUNT(*) AS n FROM membership WHERE workspace_id = 'wsp_usr_gone'`).n).toBe(0);

    // Idempotent: a second run (every boot) creates nothing.
    expect(backfillLegacy(sqlite)).toEqual({ workspaces: 0, recordings: 0, skipped: 1 });
    expect(verifyLegacy(sqlite).ok).toBe(true);
    sqlite.close();
  });

  test("writes that bypass the projection are caught by the triggers and drained", () => {
    const sqlite = v1Database();
    addUser(sqlite, "usr_a");
    const id = addLecture(sqlite, {});
    migrate(sqlite);
    backfillLegacy(sqlite);
    expect(hasPendingLectureSync(sqlite)).toBe(false);

    // e.g. storage.ts compaction swapping the file, a user edit, a re-share
    sqlite.query(`UPDATE lectures SET audio_path = '/data/uploads/c.m4a', audio_size = 10, audio_mime = 'audio/mp4' WHERE id = ?`).run(id);
    sqlite.query(`UPDATE asset SET sha256 = ? WHERE id = ?`).run("a".repeat(64), lectureAudioAssetId(id));
    sqlite.query(`UPDATE lectures SET title = '새 제목', course = '운영체제', markdown = '# 고침', is_public = 1, share_token = 'rotated' WHERE id = ?`).run(id);
    expect(hasPendingLectureSync(sqlite)).toBe(true);
    expect(verifyLegacy(sqlite).ok).toBe(false);

    expect(drainLectureSync(sqlite)).toBe(1);
    expect(hasPendingLectureSync(sqlite)).toBe(false);
    expect(verifyLegacy(sqlite).ok).toBe(true);
    expect(one(sqlite, `SELECT sha256 FROM asset WHERE id = ?`, lectureAudioAssetId(id)).sha256).toBeNull(); // new file, digest dropped
    expect(all(sqlite, `SELECT version, created_by FROM document_version WHERE document_id = ? ORDER BY version`, `doc_${id}`)).toEqual([
      { version: 1, created_by: "ai" },
      { version: 2, created_by: "ai" },
    ]);

    // A lecture handed to another account moves to that account's workspace.
    addUser(sqlite, "usr_new");
    sqlite.query(`UPDATE lectures SET owner_id = 'usr_new' WHERE id = ?`).run(id);
    drainLectureSync(sqlite);
    expect(one(sqlite, `SELECT workspace_id, created_by FROM recording WHERE id = ?`, id)).toEqual({ workspace_id: "wsp_usr_new", created_by: "usr_new" });
    expect(verifyLegacy(sqlite).ok).toBe(true);

    sqlite.query(`DELETE FROM lectures WHERE id = ?`).run(id);
    drainLectureSync(sqlite);
    for (const table of ["recording", "asset", "document", "document_version", "share_link"]) {
      expect(one(sqlite, `SELECT COUNT(*) AS n FROM ${table}`).n).toBe(0);
    }
    sqlite.close();
  });

  test("a user edit becomes a user version; the folder v2 chose survives while its name matches", () => {
    const sqlite = v1Database();
    addUser(sqlite, "usr_a");
    const id = addLecture(sqlite, { course: "자료구조" });
    migrate(sqlite);
    backfillLegacy(sqlite);

    // v2 nests the course folder under a new parent: v1 still sees the leaf name.
    const parent = uuidv7();
    sqlite.query(`INSERT INTO folder (id, workspace_id, parent_id, name, sort_key, created_at, updated_at) VALUES (?, 'wsp_usr_a', NULL, '2학기', 'a', 0, 0)`).run(parent);
    const courseFolder = courseFolderId("usr_a", "자료구조");
    sqlite.query(`UPDATE folder SET parent_id = ? WHERE id = ?`).run(parent, courseFolder);

    sqlite.query(`UPDATE lectures SET markdown = '# 사용자 수정' WHERE id = ?`).run(id);
    expect(projectLecture(sqlite, id, { author: "user", authorId: "usr_a" })).toBe("updated");
    expect(one(sqlite, `SELECT folder_id FROM recording WHERE id = ?`, id).folder_id).toBe(courseFolder);
    expect(one(sqlite, `SELECT created_by, author_id, base_version FROM document_version WHERE document_id = ? AND version = 2`, `doc_${id}`)).toEqual({
      created_by: "user",
      author_id: "usr_a",
      base_version: 1,
    });
    expect(one(sqlite, `SELECT user_edited FROM document WHERE id = ?`, `doc_${id}`).user_edited).toBe(1);

    // A v1 move to another course finds that folder by name, or creates it at the root.
    sqlite.query(`UPDATE lectures SET course = '2학기' WHERE id = ?`).run(id);
    projectLecture(sqlite, id);
    expect(one(sqlite, `SELECT folder_id FROM recording WHERE id = ?`, id).folder_id).toBe(parent);
    sqlite.query(`UPDATE lectures SET course = ? WHERE id = ?`).run(UNFILED_COURSE, id);
    projectLecture(sqlite, id);
    expect(one(sqlite, `SELECT folder_id FROM recording WHERE id = ?`, id).folder_id).toBeNull();
    expect(verifyLegacy(sqlite).ok).toBe(true);
    expect(projectLecture(sqlite, id)).toBe("unchanged");
    sqlite.close();
  });
});

describe("team uploads (P5-06)", () => {
  function teamSetup() {
    const sqlite = v1Database();
    addUser(sqlite, "usr_a");
    addUser(sqlite, "usr_b");
    migrate(sqlite);
    backfillLegacy(sqlite); // personal workspaces for both
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    sqlite
      .query(`INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at) VALUES ('wsp_team', '스터디', 'team', 'free', '{}', NULL, ?, ?)`)
      .run(now, now);
    for (const user of ["usr_a", "usr_b"]) {
      sqlite.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES ('wsp_team', ?, 'member', ?, ?)`).run(user, now, now);
    }
    sqlite
      .query(`INSERT INTO folder (id, workspace_id, parent_id, name, sort_key, created_at, updated_at) VALUES ('fld_team', 'wsp_team', NULL, '운영체제', 'm', ?, ?)`)
      .run(now, now);
    sqlite.query(`INSERT INTO tag (id, workspace_id, name, color, created_at, updated_at) VALUES ('tag_team', 'wsp_team', '시험', 'blue', ?, ?)`).run(now, now);
    return { sqlite, now };
  }

  test("a recording placed in a team workspace stays there through later projections", () => {
    const { sqlite, now } = teamSetup();
    const id = addLecture(sqlite, { course: "운영체제", status: "processing", markdown: "" });
    projectLecture(sqlite, id);
    const recordingId = lectureRecordingId(id);
    expect(one(sqlite, `SELECT workspace_id FROM recording WHERE id = ?`, recordingId).workspace_id).toBe(personalWorkspaceId("usr_a"));

    placeRecordingInWorkspace(sqlite, recordingId, "wsp_team");
    sqlite.query(`UPDATE recording SET folder_id = 'fld_team' WHERE id = ?`).run(recordingId);
    sqlite
      .query(`INSERT INTO recording_tag (workspace_id, recording_id, tag_id, source, confidence, created_at) VALUES ('wsp_team', ?, 'tag_team', 'user', NULL, ?)`)
      .run(recordingId, now);

    // The pipeline finishes: status, Markdown, title change on the lecture.
    sqlite.query(`UPDATE lectures SET status = 'done', markdown = '# 스케줄링', title = '운영체제 3주차' WHERE id = ?`).run(id);
    expect(drainLectureSync(sqlite)).toBe(1);
    const rec = one(sqlite, `SELECT workspace_id, folder_id, visibility, created_by, title, status FROM recording WHERE id = ?`, recordingId);
    expect(rec).toEqual({ workspace_id: "wsp_team", folder_id: "fld_team", visibility: "workspace", created_by: "usr_a", title: "운영체제 3주차", status: "ready" });
    expect(all(sqlite, `SELECT tag_id FROM recording_tag WHERE recording_id = ?`, recordingId)).toEqual([{ tag_id: "tag_team" }]);
    expect(one(sqlite, `SELECT workspace_id FROM document WHERE id = ?`, lectureDocumentId(id)).workspace_id).toBe("wsp_team");
    expect(one(sqlite, `SELECT workspace_id FROM asset WHERE id = ?`, lectureAudioAssetId(id)).workspace_id).toBe("wsp_team");

    // A course change from v1 finds (or makes) the folder in the team, not in the personal workspace.
    sqlite.query(`UPDATE lectures SET course = '자료구조' WHERE id = ?`).run(id);
    drainLectureSync(sqlite);
    const folder = one(sqlite, `SELECT f.workspace_id, f.name FROM recording r JOIN folder f ON f.id = r.folder_id WHERE r.id = ?`, recordingId);
    expect(folder).toEqual({ workspace_id: "wsp_team", name: "자료구조" });

    const report = verifyLegacy(sqlite);
    expect(report.mismatches).toEqual([]);
    expect(report.ok).toBe(true);
    expect(projectLecture(sqlite, id)).toBe("unchanged");
    sqlite.close();
  });

  test("a private team upload stays private; personal workspaces are refused", () => {
    const { sqlite } = teamSetup();
    const id = addLecture(sqlite, { course: UNFILED_COURSE });
    projectLecture(sqlite, id);
    const recordingId = lectureRecordingId(id);
    placeRecordingInWorkspace(sqlite, recordingId, "wsp_team", "private");
    expect(one(sqlite, `SELECT visibility FROM recording WHERE id = ?`, recordingId).visibility).toBe("private");
    expect(() => placeRecordingInWorkspace(sqlite, recordingId, personalWorkspaceId("usr_b"))).toThrow("not a team workspace");
    expect(one(sqlite, `SELECT workspace_id FROM recording WHERE id = ?`, recordingId).workspace_id).toBe("wsp_team");
    sqlite.close();
  });

  test("other recordings still follow their owner to the personal workspace", () => {
    const { sqlite } = teamSetup();
    const id = addLecture(sqlite, {});
    projectLecture(sqlite, id);
    sqlite.query(`UPDATE lectures SET owner_id = 'usr_b' WHERE id = ?`).run(id);
    drainLectureSync(sqlite);
    expect(one(sqlite, `SELECT workspace_id, created_by FROM recording WHERE id = ?`, lectureRecordingId(id))).toEqual({
      workspace_id: personalWorkspaceId("usr_b"),
      created_by: "usr_b",
    });
    sqlite.close();
  });
});
