import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentBody } from "@lectern/domain";
import { lectureRecordingId, personalWorkspaceId } from "@lectern/db";
import type { NotesResult } from "@lectern/harness";
import { API_BASE_PATH } from "../src/api/v2/index.ts";
import {
  createPendingLecture,
  DATA_DIR,
  db,
  ensureBootstrapOwner,
  generateId,
  getLectureById,
  updateLectureMarkdown,
} from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { publishNotes } from "../src/notes-publish.ts";

function lecture() {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audio = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audio, "audio");
  const row = createPendingLecture({
    id: generateId("lec"),
    ownerId: ensureBootstrapOwner().id,
    title: "",
    course: "정보보호",
    audioPath: audio,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  return { lectureId: row.id, recordingId: lectureRecordingId(row.id), workspaceId: personalWorkspaceId(row.owner_id) };
}

const DAY = Date.parse("2026-10-27T00:00:00+09:00");

function event(title: string, startAt = DAY) {
  return {
    title,
    kind: "deadline" as const,
    start_at: startAt,
    end_at: startAt + 86_400_000,
    all_day: true,
    tz: "Asia/Seoul",
    raw_expression: "다음 주 화요일까지",
    resolution: { method: "parser" as const, rule: "next_week_weekday" },
    confidence: 0.9,
    evidence: { sources: [{ kind: "transcript" as const, start_idx: 2, end_idx: 2 }], quote: "다음 주 화요일까지" },
    flags: ["date_mismatch"],
  };
}

function item(text: string, dueAt: number | null = null) {
  return {
    text,
    owner_name: null,
    due_at: dueAt,
    due_raw: dueAt ? "금요일까지" : null,
    evidence: { sources: [{ kind: "transcript" as const, start_idx: 1, end_idx: 1 }], quote: null },
    flags: [],
  };
}

function result(over: Partial<NotesResult> = {}): NotesResult {
  return {
    classification: {
      domain: "lecture",
      language: "ko",
      title: "AI 제목",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    },
    template: { id: "lecture", version: 1 },
    body: {
      sections: [
        {
          key: "summary",
          title: "핵심 요약",
          blocks: [{ id: "b1", type: "paragraph", heading: null, text: "요약", sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }] }],
        },
      ],
    },
    markdown: "# AI 제목\n\n## 핵심 요약\n\n요약 [00:10]\n",
    events: [event("과제 제출"), event("중간고사", DAY + 7 * 86_400_000)],
    action_items: [item("보고서 작성")],
    report: { repaired: false, dropped_blocks: 0, items: [] },
    partial: false,
    ...over,
  } as NotesResult;
}

const count = (sql: string, ...params: any[]) => (db.query(sql).get(...params) as { n: number }).n;
const legacyDocs = (recordingId: string) =>
  count(`SELECT COUNT(*) AS n FROM document WHERE recording_id = ? AND template_id = 'legacy-markdown'`, recordingId);

async function api(path: string) {
  const owner = ensureBootstrapOwner();
  const res = await handleRequest(new Request(`http://localhost${path}`, { headers: { "X-Lectern-Token": owner.api_token } }));
  return { status: res.status, body: (await res.json()) as any };
}

describe("publishNotes", () => {
  test("publishes document version 1", () => {
    const { recordingId, workspaceId } = lecture();
    const out = publishNotes({ recordingId, workspaceId, result: result() });
    expect(out.version).toBe(1);
    const doc = db.query(`SELECT current_version, template_id FROM document WHERE id = ?`).get(out.documentId);
    expect(doc).toEqual({ current_version: 1, template_id: "lecture" });
    const versions = db.query(`SELECT body_json, created_by FROM document_version WHERE document_id = ?`).all(out.documentId) as Array<{
      body_json: string;
      created_by: string;
    }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.created_by).toBe("ai");
    expect(() => DocumentBody.parse(JSON.parse(versions[0]!.body_json))).not.toThrow();
  });

  test("lectures.markdown equals rendered_md and no legacy doc", async () => {
    const { lectureId, recordingId, workspaceId } = lecture();
    const r = result();
    publishNotes({ recordingId, workspaceId, result: r });
    const row = getLectureById(lectureId)!;
    expect(row.markdown).toBe(r.markdown);
    expect(row.status).toBe("done");
    expect(legacyDocs(recordingId)).toBe(0);
    const res = await api(`/api/lectures/${lectureId}`);
    expect(res.status).toBe(200);
    expect(res.body.lecture.markdown).toBe(r.markdown);
  });

  test("v1 edit afterwards creates legacy version", () => {
    const { lectureId, recordingId, workspaceId } = lecture();
    const out = publishNotes({ recordingId, workspaceId, result: result() });
    updateLectureMarkdown(lectureId, "AI 제목", "정보보호", "# 손글");
    expect(legacyDocs(recordingId)).toBe(1);
    expect((db.query(`SELECT user_edited FROM document WHERE id = ?`).get(out.documentId) as { user_edited: number }).user_edited).toBe(1);
  });

  test("events and action items pass domain schemas", async () => {
    const { recordingId, workspaceId } = lecture();
    publishNotes({ recordingId, workspaceId, result: result() });
    const events = await api(`${API_BASE_PATH}/recordings/${recordingId}/events`);
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(2);
    expect(events.body.items[0].flags).toEqual(["date_corrected"]);
    const items = await api(`${API_BASE_PATH}/recordings/${recordingId}/action-items`);
    expect(items.status).toBe(200);
    expect(items.body.items).toHaveLength(1);
  });

  test("atomic: failure leaves nothing", () => {
    const { lectureId, recordingId, workspaceId } = lecture();
    const before = getLectureById(lectureId)!.markdown;
    const cyclic: any = { sources: [] };
    cyclic.self = cyclic;
    const broken = result({ events: [{ ...event("과제"), evidence: cyclic }] as any });
    expect(() => publishNotes({ recordingId, workspaceId, result: broken })).toThrow();
    expect(count(`SELECT COUNT(*) AS n FROM document WHERE recording_id = ?`, recordingId)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM event_candidate WHERE recording_id = ?`, recordingId)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM action_item WHERE recording_id = ?`, recordingId)).toBe(0);
    expect(getLectureById(lectureId)!.markdown).toBe(before);
  });

  test("republish keeps accepted events and dedupes", () => {
    const { recordingId, workspaceId } = lecture();
    publishNotes({ recordingId, workspaceId, result: result() });
    db.query(`UPDATE event_candidate SET status = 'accepted' WHERE recording_id = ? AND title = '과제 제출'`).run(recordingId);
    const out = publishNotes({
      recordingId,
      workspaceId,
      result: result({ events: [event("과제 제출"), event("기말고사", DAY + 14 * 86_400_000)] as any }),
    });
    expect(out.version).toBe(2);
    const rows = db.query(`SELECT title, status FROM event_candidate WHERE recording_id = ? ORDER BY title`).all(recordingId);
    expect(rows).toEqual([
      { title: "과제 제출", status: "accepted" },
      { title: "기말고사", status: "suggested" },
    ]);
  });

  test("republish keeps edited and done action items", () => {
    const { recordingId, workspaceId } = lecture();
    publishNotes({
      recordingId,
      workspaceId,
      result: result({ action_items: [item("하나"), item("둘"), item("셋")] as any }),
    });
    db.query(`UPDATE action_item SET status = 'done' WHERE recording_id = ? AND text = '하나'`).run(recordingId);
    db.query(`UPDATE action_item SET updated_at = created_at + 1 WHERE recording_id = ? AND text = '둘'`).run(recordingId);
    publishNotes({ recordingId, workspaceId, result: result({ action_items: [item("넷")] as any }) });
    const texts = (db.query(`SELECT text FROM action_item WHERE recording_id = ? ORDER BY text`).all(recordingId) as Array<{
      text: string;
    }>).map((r) => r.text);
    expect(texts.sort()).toEqual(["넷", "둘", "하나"].sort());
  });

  test("keepTitle protects a user title", () => {
    const { recordingId, workspaceId } = lecture();
    db.query(`UPDATE recording SET title = '내가 정한 제목' WHERE id = ?`).run(recordingId);
    publishNotes({ recordingId, workspaceId, result: result(), keepTitle: true });
    expect((db.query(`SELECT title FROM recording WHERE id = ?`).get(recordingId) as { title: string }).title).toBe("내가 정한 제목");
  });

  test("title and domain follow classification", () => {
    const { lectureId, recordingId, workspaceId } = lecture();
    publishNotes({ recordingId, workspaceId, result: result() });
    const rec = db.query(`SELECT title, domain, template_id, language FROM recording WHERE id = ?`).get(recordingId);
    expect(rec).toEqual({ title: "AI 제목", domain: "lecture", template_id: "lecture", language: "ko" });
    expect(getLectureById(lectureId)!.title).toBe("AI 제목");
  });
});
