// v1 bridge for 물어보기 (docs/v2/ARCHITECTURE.md §12.4): until the v2 tables exist (P2),
// a user's v1 lectures are their notes. A lecture is a recording, its Markdown is a
// legacy document, its course name is a folder, and every user has one personal
// workspace. The ids derived here are the ones the P2 migration must keep (ARCHITECTURE
// §5.3), so search rows and ask threads need no re-keying.
//
// This module only reads (`lectures` for the index, the v2 recording and folder rows for
// scopes); it never imports db.ts's write paths.

import type { RecordingSources } from "@lectern/ask";
import type { FolderRow, RecordingAccessRow } from "@lectern/ask";
import { DocumentBody } from "@lectern/domain";
import { db } from "../db.ts";
import { personalWorkspaceId } from "./workspace.ts";

export { personalWorkspaceId };

// The id rules are shared with the P2 migration (@lectern/db ids.ts).
import { courseFolderId, LEGACY_TEMPLATE_ID, lectureDocumentId, lectureRecordingId } from "@lectern/db";
export { courseFolderId, lectureDocumentId };

interface RecordingRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  visibility: string;
  created_by: string;
  title: string;
  recorded_at: number;
  status: string;
}

/**
 * The workspace's recordings for the scope check (titles and status only, no notes). Since
 * P2 these are the v2 rows the lectures were migrated to (packages/db legacy.ts), so v2
 * folders, moves and renames apply.
 */
export function recordingRows(workspaceId: string): RecordingAccessRow[] {
  const rows = db
    .query(`SELECT id, workspace_id, folder_id, visibility, created_by, title, recorded_at, status FROM recording WHERE workspace_id = ?`)
    .all(workspaceId) as RecordingRow[];
  return rows.map((r) => ({ ...r, recorded_at: new Date(r.recorded_at).toISOString() }));
}

/** The workspace's folders (nested since P2). */
export function folderRows(workspaceId: string): FolderRow[] {
  return db.query(`SELECT id, workspace_id, parent_id FROM folder WHERE workspace_id = ?`).all(workspaceId) as FolderRow[];
}

export interface IndexableLecture {
  id: string;
  owner_id: string;
  status: string;
  markdown: string;
  updated_at: string;
}

/** The published transcript of a lecture's recording (transcript-publish.ts), if any. */
function transcriptOf(lectureId: string): RecordingSources["transcript"] | null {
  const recordingId = lectureRecordingId(lectureId);
  const segments = db
    .query(`SELECT idx, start_ms, end_ms, speaker_id, text FROM transcript_segment WHERE recording_id = ? ORDER BY idx`)
    .all(recordingId) as Array<{ idx: number; start_ms: number; end_ms: number; speaker_id: string | null; text: string }>;
  if (segments.length === 0) return null;
  const speakerRows = db
    .query(`SELECT id, label, display_name FROM speaker WHERE recording_id = ?`)
    .all(recordingId) as Array<{ id: string; label: string; display_name: string | null }>;
  const speakers = new Map(speakerRows.map((row) => [row.id, row.display_name || row.label] as const));
  return { segments, speakers };
}

/**
 * The recording's structured document (notes pipeline, notes-publish.ts) when the lecture
 * still shows it: a v1 edit makes `lectures.markdown` differ, and then the edit is what
 * the user reads (the v1 bridge, CONTRACTS D-P1-3).
 */
function structuredDocumentOf(lectureId: string, markdown: string): RecordingSources["document"] | null {
  const row = db
    .query(
      `SELECT d.id, d.current_version, v.body_json, v.rendered_md FROM document d
       JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version
       WHERE d.recording_id = ? AND d.template_id != ?
       ORDER BY d.created_at DESC, d.id DESC LIMIT 1`
    )
    .get(lectureRecordingId(lectureId), LEGACY_TEMPLATE_ID) as {
    id: string;
    current_version: number;
    body_json: string;
    rendered_md: string;
  } | null;
  if (!row || row.rendered_md !== markdown) return null;
  return { kind: "blocks", documentId: row.id, version: row.current_version, body: DocumentBody.parse(JSON.parse(row.body_json)) };
}

/**
 * What the index stage reads for a lecture: its structured document as blocks, or else its
 * Markdown as a legacy document, plus its transcript once published.
 */
export function lectureSources(lecture: IndexableLecture): RecordingSources {
  const sources: RecordingSources = { workspaceId: personalWorkspaceId(lecture.owner_id), recordingId: lecture.id };
  const transcript = transcriptOf(lecture.id);
  if (transcript) sources.transcript = transcript;
  if (lecture.markdown.trim() !== "") {
    sources.document = structuredDocumentOf(lecture.id, lecture.markdown) ?? {
      kind: "markdown",
      documentId: lectureDocumentId(lecture.id),
      version: 1,
      markdown: lecture.markdown,
    };
  }
  return sources;
}

export function isIndexable(lecture: IndexableLecture): boolean {
  if (lecture.status === "done" && lecture.markdown.trim() !== "") return true;
  return db.query(`SELECT 1 FROM transcript_segment WHERE recording_id = ? LIMIT 1`).get(lectureRecordingId(lecture.id)) !== null;
}
