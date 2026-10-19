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
import { db } from "../db.ts";
import { personalWorkspaceId } from "./workspace.ts";

export { personalWorkspaceId };

// The id rules are shared with the P2 migration (@lectern/db ids.ts).
import { courseFolderId, lectureDocumentId } from "@lectern/db";
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

/** What the index stage reads for a lecture: its Markdown as a legacy document. */
export function lectureSources(lecture: IndexableLecture): RecordingSources {
  return {
    workspaceId: personalWorkspaceId(lecture.owner_id),
    recordingId: lecture.id,
    document: { kind: "markdown", documentId: lectureDocumentId(lecture.id), version: 1, markdown: lecture.markdown },
  };
}

export function isIndexable(lecture: IndexableLecture): boolean {
  return lecture.status === "done" && lecture.markdown.trim() !== "";
}
