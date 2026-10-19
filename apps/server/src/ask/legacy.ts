// v1 bridge for 물어보기 (docs/v2/ARCHITECTURE.md §12.4): until the v2 tables exist (P2),
// a user's v1 lectures are their notes. A lecture is a recording, its Markdown is a
// legacy document, its course name is a folder, and every user has one personal
// workspace. The ids derived here are the ones the P2 migration must keep (ARCHITECTURE
// §5.3), so search rows and ask threads need no re-keying.
//
// This module only reads `lectures`; it never imports db.ts's write paths.

import { createHash } from "node:crypto";
import type { RecordingSources } from "@lectern/ask";
import type { FolderRow, RecordingAccessRow } from "@lectern/ask";
import { db } from "../db.ts";
import { personalWorkspaceId } from "./workspace.ts";

export { personalWorkspaceId };

const short = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

/** A stable folder id per (owner, course name). */
export function courseFolderId(ownerId: string, course: string): string {
  return `fld_${short(`${ownerId}\n${course}`)}`;
}

/** The legacy-markdown document of a lecture (one per lecture, version 1). */
export function lectureDocumentId(lectureId: string): string {
  return `doc_${lectureId}`.length <= 64 ? `doc_${lectureId}` : `doc_${short(lectureId)}`;
}

interface LectureRow {
  id: string;
  title: string;
  course: string;
  status: "processing" | "done" | "error";
  created_at: string;
}

function statusOf(status: LectureRow["status"]): string {
  return status === "done" ? "ready" : status === "processing" ? "processing" : "failed";
}

/** The caller's lectures as recordings (titles and status only, no Markdown). */
export function recordingRows(ownerId: string): RecordingAccessRow[] {
  const workspaceId = personalWorkspaceId(ownerId);
  const rows = db
    .query(`SELECT id, title, course, status, created_at FROM lectures WHERE owner_id = ?`)
    .all(ownerId) as LectureRow[];
  return rows.map((l) => ({
    id: l.id,
    workspace_id: workspaceId,
    folder_id: courseFolderId(ownerId, l.course),
    visibility: "private",
    created_by: ownerId,
    title: l.title,
    recorded_at: l.created_at,
    status: statusOf(l.status),
  }));
}

/** One folder per course name; v1 has no nesting. */
export function folderRows(ownerId: string): FolderRow[] {
  const workspaceId = personalWorkspaceId(ownerId);
  const courses = db.query(`SELECT DISTINCT course FROM lectures WHERE owner_id = ?`).all(ownerId) as Array<{ course: string }>;
  return courses.map(({ course }) => ({ id: courseFolderId(ownerId, course), workspace_id: workspaceId, parent_id: null }));
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
