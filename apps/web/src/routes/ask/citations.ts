// How a 물어보기 citation reads and where it leads. Three kinds (packages/domain
// AskCitation): a transcript range, a document block (the v1 bridge sends these for
// lecture notes, with only a `[MM:SS]` time), and a PDF page. Unknown kinds render as a
// plain label (open union).

import type { AskCitation, AskScope, Folder, RecordingListItem } from "../../api/types.ts";
import { formatTimestamp } from "../../lib/format.ts";
import { folderPath } from "../library/folders.ts";

/** The number shown for `[c3]`: 3. */
export function citationNumber(c: Pick<AskCitation, "label">): string {
  return c.label.replace(/^c/, "");
}

/** Where in the note: "12:30", "운영 모드 · 12:03", "PDF 4쪽". */
export function citationWhere(c: AskCitation): string {
  switch (c.kind) {
    case "transcript":
      return formatTimestamp(c.start_ms);
    case "document":
      return [c.section_title, c.start_ms !== null ? formatTimestamp(c.start_ms) : null].filter(Boolean).join(" · ") || "문서";
    case "pdf_page":
      return `PDF ${c.page}쪽`;
    default:
      return "";
  }
}

/** Accessible name: starts with the visible number (WCAG 2.5.3). */
export function citationName(c: AskCitation): string {
  const where = citationWhere(c);
  const base = `출처 ${citationNumber(c)}, ${c.recording_title}${where ? ` ${where}` : ""}`;
  if (!c.available) return `${base} (지금은 볼 수 없음)`;
  return c.support === "weak" ? `${base}, 근거 약함` : base;
}

/** Original-audio ms the citation starts at, when it has one. */
export function citationStartMs(c: AskCitation): number | null {
  if (c.kind === "transcript") return c.start_ms;
  if (c.kind === "document") return c.start_ms;
  return null;
}

/** A transcript range the citation points at (directly, or through the block's first source). */
export function citationRange(c: AskCitation): { start_idx: number; end_idx: number } | null {
  if (c.kind === "transcript") return { start_idx: c.start_idx, end_idx: c.end_idx };
  if (c.kind === "document") {
    const source = c.sources.find((s) => s.kind === "transcript");
    if (source && source.kind === "transcript") return { start_idx: source.start_idx, end_idx: source.end_idx };
  }
  return null;
}

/** Display label of a thread's scope ("운영체제 7주차", "운영체제 폴더", "전체 노트"). */
export function scopeLabel(scope: AskScope, folders: Folder[], recordings: RecordingListItem[]): string {
  if (scope.kind === "recording") return recordings.find((r) => r.id === scope.recording_id)?.title ?? "노트";
  if (scope.kind === "folder") {
    const name = folderPath(folders, scope.folder_id) || folders.find((f) => f.id === scope.folder_id)?.name;
    return name ? `${name} 폴더` : "폴더";
  }
  if (scope.kind === "workspace") return "전체 노트";
  return "범위";
}

export function sameScope(a: AskScope, b: AskScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "recording" && b.kind === "recording") return a.recording_id === b.recording_id;
  if (a.kind === "folder" && b.kind === "folder") return a.folder_id === b.folder_id && a.include_subfolders === b.include_subfolders;
  return true;
}
