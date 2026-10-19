import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeLectureRecord, createPendingLecture, createUser, db, generateId } from "../src/db.ts";
import { rehearse } from "../scripts/rehearse-v2-migration.ts";

// The migration rehearsal (ROADMAP P2 종료 기준: 운영 백업 사본으로 리허설, 건수와 체크섬).
// No production data is used here: the "backup" is this sandbox's database taken back to
// its pre-P2 state (v1 tables with every column, the P0 queue/ask tables, no v2 entity
// tables), plus lectures shaped like the awkward rows production may hold.

const V2_TABLES = [
  "workspace", "membership", "folder", "tag", "recording", "recording_tag", "asset", "transcript_segment",
  "transcript_gap", "speaker", "document", "document_version", "question", "event_candidate", "action_item",
  "share_link", "integration", "usage_ledger", "saved_view", "upload", "upload_part", "lecture_sync_pending",
];

function preP2Copy(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "lectern-pre-p2-"));
  const path = join(dir, "lectern-backup.sqlite");
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  const copy = new Database(path);
  for (const trigger of ["insert", "update", "delete"]) copy.exec(`DROP TRIGGER IF EXISTS lectures_v2_sync_${trigger}`);
  for (const table of V2_TABLES) copy.exec(`DROP TABLE IF EXISTS ${table}`);
  const journal = JSON.parse(readFileSync(join(import.meta.dir, "../../../packages/db/migrations/meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const p2 = journal.entries.find((e) => e.tag === "0003_v2_entities")!;
  copy.query(`DELETE FROM __drizzle_migrations WHERE created_at >= ?`).run(p2.when);
  copy.close();
  return { dir, path };
}

function insertRawLecture(path: string, fields: Record<string, unknown>) {
  const copy = new Database(path);
  const row = {
    id: generateId("lec"),
    share_token: generateId("shr").slice(0, 20),
    title: "원시 행",
    course: "기타",
    date_label: "2026-03-02 (월) 09:00",
    created_at: "2026-03-02T00:00:00.000Z",
    updated_at: "2026-03-02T00:00:00.000Z",
    ...fields,
  };
  const cols = Object.keys(row);
  copy.query(`INSERT INTO lectures (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(Object.values(row) as any[]));
  copy.close();
}

describe("v2 migration rehearsal", () => {
  test("a pre-P2 database migrates losslessly, idempotently, leaving v1 tables untouched", () => {
    const owner = createUser({ email: `${generateId("rh")}@example.com`, displayName: "리허설", password: "correct_password_1" });
    for (const [i, course] of ["정보보호개론", "운영체제/실습", "  공백 과목  "].entries()) {
      const id = generateId("lec");
      createPendingLecture({ id, ownerId: owner.id, title: `강의 ${i}`, course, audioPath: `/nonexistent/${i}.m4a`, audioMime: "audio/mp4", audioSize: 100 + i, modelRequested: "gemini-3.8-flash", sourceClient: "web" });
      if (i !== 1) completeLectureRecord(id, { title: `강의 ${i}`, courseName: course, markdown: `# 강의 ${i}\n\n본문`, excerpt: "본문", modelUsed: "gemini-3.8-flash", durationSec: 600 });
    }
    const { dir, path } = preP2Copy();
    try {
      insertRawLecture(path, { owner_id: owner.id, course: "", is_public: 1, markdown: "# 빈 과목" }); // blank course, public
      insertRawLecture(path, { owner_id: "usr_deleted_account", markdown: "# 주인 없는 계정" }); // owner gone
      insertRawLecture(path, { owner_id: "", markdown: "# 아직 입양 전" }); // adopted at boot, not here
      insertRawLecture(path, { owner_id: owner.id, created_at: "2026-03-02 09:00:00", status: "error", error_message: "실패" }); // odd timestamp

      const report = rehearse(path);
      expect(report.mismatches).toEqual([]);
      expect(report.rows.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.migrations).toEqual(["0003_v2_entities"]);
      expect(report.idempotent).toBe(true);
      expect(report.v1_unchanged).toBe(true);
      expect(report.checksums.v1).toBe(report.checksums.v2);
      expect(report.unowned_lectures).toBe(1);
      for (const check of Object.values(report.counts)) expect(check.v1).toBe(check.v2);
      expect(report.counts.lectures.v1).toBeGreaterThanOrEqual(6);
      expect(report.rows.pending_digests).toBe(report.counts.audio.v2); // computed lazily from the files
      // The report carries counts and ids, never titles or notes.
      expect(JSON.stringify(report)).not.toContain("강의 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a row the API could not serve fails the rehearsal", () => {
    const { dir, path } = preP2Copy();
    try {
      const owner = createUser({ email: `${generateId("rh")}@example.com`, displayName: "긴 제목", password: "correct_password_1" });
      insertRawLecture(path, { owner_id: owner.id, title: "가".repeat(250), markdown: "# 긴 제목" });
      const report = rehearse(path);
      expect(report.ok).toBe(false);
      expect(report.rows.failures).toContainEqual(expect.objectContaining({ table: "recording", path: "title" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
