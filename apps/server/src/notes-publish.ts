// Publishes a notes pipeline result (CONTRACTS §1.9, D-P1-3, D-P1-5) in one transaction:
// a new structured document version, the suggested events and open action items, the
// recording's title/domain/template, and the v1 bridge (`lectures.markdown` = the
// document's rendered Markdown). Recording state, events and indexing are the caller's
// (process-job.ts). Like queue.ts, this module must not import index.ts.

import { extractExcerpt } from "@lectern/core";
import { documentVersionId, LEGACY_TEMPLATE_ID } from "@lectern/db";
import type { NotesResult } from "@lectern/harness";
import { transact, uuidv7 } from "./api/v2/store.ts";
import { db, syncPendingLectures } from "./db.ts";
import { logger } from "./log.ts";

export interface PublishNotesInput {
  recordingId: string;
  workspaceId: string;
  result: NotesResult;
  /** Keep the recording's current title (one the user chose) instead of the classified one. */
  keepTitle?: boolean;
}

export interface PublishNotesResult {
  documentId: string;
  version: number;
  events: number;
  actionItems: number;
  lectureId: string | null;
}

/** Verifier flags as the domain VerifyFlag enum stores them (CONTRACTS §1.6 → domain). */
const FLAG_MAP: Record<string, string | null> = {
  low_confidence: "low_confidence",
  needs_review: "needs_review",
  recorded_at_estimated: "recorded_at_estimated",
  date_mismatch: "date_corrected",
  weekday_mismatch: "needs_review",
};

function domainFlags(flags: readonly string[]): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    const mapped = FLAG_MAP[flag];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function norm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

function localDate(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
      new Date(ms)
    );
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const dueKey = (dueAt: number | null) => (dueAt === null ? "none" : new Date(dueAt).toISOString().slice(0, 10));

export function publishNotes(input: PublishNotesInput): PublishNotesResult {
  const { recordingId, workspaceId, result, keepTitle } = input;
  const published = transact(() => {
    const now = Date.now();
    const recording = db.query(`SELECT id, title, lecture_id FROM recording WHERE id = ?`).get(recordingId) as {
      id: string;
      title: string;
      lecture_id: string | null;
    } | null;
    if (!recording) throw new Error("recording not found");

    // Document: one structured document per recording, a new version per publish.
    const existing = db
      .query(
        `SELECT id, current_version FROM document WHERE recording_id = ? AND template_id != '${LEGACY_TEMPLATE_ID}'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(recordingId) as { id: string; current_version: number } | null;
    let documentId: string;
    let version: number;
    if (!existing) {
      documentId = uuidv7();
      version = 1;
      db.query(
        `INSERT INTO document (id, workspace_id, recording_id, template_id, template_version, current_version, user_edited,
           md_source_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`
      ).run(documentId, workspaceId, recordingId, result.template.id, result.template.version, now, now);
    } else {
      documentId = existing.id;
      version = existing.current_version + 1;
      db.query(`UPDATE document SET template_id = ?, template_version = ?, current_version = ?, updated_at = ? WHERE id = ?`).run(
        result.template.id,
        result.template.version,
        version,
        now,
        documentId
      );
    }
    db.query(
      `INSERT INTO document_version (id, workspace_id, document_id, recording_id, version, base_version, template_id,
         template_version, body_json, rendered_md, created_by, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'ai', NULL, ?)`
    ).run(
      documentVersionId(documentId, version),
      workspaceId,
      documentId,
      recordingId,
      version,
      result.template.id,
      result.template.version,
      JSON.stringify(result.body),
      result.markdown,
      now
    );

    // Events (D-P1-5): suggestions are replaced; what the user accepted, dismissed or
    // synced stays, and a new suggestion with the same title and day is not added again.
    db.query(`DELETE FROM event_candidate WHERE recording_id = ? AND status = 'suggested'`).run(recordingId);
    const keptEvents = db
      .query(`SELECT title, start_at, tz FROM event_candidate WHERE recording_id = ?`)
      .all(recordingId) as Array<{ title: string; start_at: number; tz: string }>;
    const eventKeys = new Set(keptEvents.map((e) => `${norm(e.title)}|${localDate(e.start_at, e.tz)}`));
    const insertEvent = db.query(
      `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
         resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?)`
    );
    let events = 0;
    for (const event of result.events) {
      const key = `${norm(event.title)}|${localDate(event.start_at, event.tz)}`;
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      insertEvent.run(
        uuidv7(),
        workspaceId,
        recordingId,
        event.kind,
        event.title,
        event.start_at,
        event.end_at,
        event.all_day ? 1 : 0,
        event.tz,
        event.raw_expression,
        JSON.stringify(event.resolution),
        event.confidence,
        JSON.stringify(event.evidence),
        JSON.stringify(domainFlags(event.flags)),
        now,
        now
      );
      events += 1;
    }

    // Action items (D-P1-5): open items nobody touched are replaced; done or edited ones stay.
    db.query(`DELETE FROM action_item WHERE recording_id = ? AND status = 'open' AND updated_at = created_at`).run(recordingId);
    const keptItems = db.query(`SELECT text, due_at FROM action_item WHERE recording_id = ?`).all(recordingId) as Array<{
      text: string;
      due_at: number | null;
    }>;
    const itemKeys = new Set(keptItems.map((a) => `${norm(a.text)}|${dueKey(a.due_at)}`));
    const insertItem = db.query(
      `INSERT INTO action_item (id, workspace_id, recording_id, text, owner_name, due_at, due_raw, status, evidence_json,
         flags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    );
    let actionItems = 0;
    for (const item of result.action_items) {
      const key = `${norm(item.text)}|${dueKey(item.due_at)}`;
      if (itemKeys.has(key)) continue;
      itemKeys.add(key);
      insertItem.run(
        uuidv7(),
        workspaceId,
        recordingId,
        item.text,
        item.owner_name,
        item.due_at,
        item.due_raw,
        JSON.stringify(item.evidence),
        JSON.stringify(domainFlags(item.flags)),
        now,
        now
      );
      actionItems += 1;
    }

    // Recording: classification and template. State is the caller's.
    const title = keepTitle ? recording.title : result.classification.title;
    db.query(`UPDATE recording SET domain = ?, template_id = ?, language = ?, title = ?, updated_at = ? WHERE id = ?`).run(
      result.classification.domain,
      result.template.id,
      result.classification.language,
      title,
      now,
      recordingId
    );

    // The v1 bridge (D-P1-3): the lecture shows the document's Markdown.
    if (recording.lecture_id) {
      db.query(
        `UPDATE lectures SET markdown = ?, excerpt = ?, title = ?, status = 'done', stage = 'done', stage_message = '완료',
           progress = 100, error_message = NULL, updated_at = ? WHERE id = ?`
      ).run(result.markdown, extractExcerpt(result.markdown), title, new Date(now).toISOString(), recording.lecture_id);
    }
    return { documentId, version, events, actionItems, lectureId: recording.lecture_id };
  });

  // Projects the lecture write: equal Markdown, so no legacy document (legacy.ts).
  try {
    syncPendingLectures();
  } catch (err) {
    logger.error("could not sync lecture after notes publish", { err });
  }
  return published;
}
