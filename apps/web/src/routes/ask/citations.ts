// How a 물어보기 citation reads and where it leads. Three kinds (packages/domain
// AskCitation): a transcript range, a document block (the v1 bridge sends these for
// lecture notes, with only a `[MM:SS]` time), and a PDF page. Unknown kinds render as a
// plain label (open union).

import type { AskCitation, AskScope, Folder, RecordingListItem } from "../../api/types.ts";
import { formatTimestamp } from "../../lib/format.ts";
import { folderPath } from "../library/folders.ts";

/**
 * Numbers shown for the markers of one answer: 1, 2, 3 … in order of first use in the
 * text. Labels are the server's passage labels (`[c2]` may be the only one cited), so
 * they are not shown as they are. Citations the text never uses come last.
 */
export function citationNumbers(text: string, citations: readonly Pick<AskCitation, "label">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, label] of text.matchAll(/\[(c\d{1,3})\]/g)) if (!out.has(label!)) out.set(label!, out.size + 1);
  for (const c of citations) if (!out.has(c.label)) out.set(c.label, out.size + 1);
  return out;
}

/** The citations in the order of their numbers. */
export function orderedCitations<T extends Pick<AskCitation, "label">>(citations: readonly T[], numbers: Map<string, number>): T[] {
  return [...citations].sort((a, b) => (numbers.get(a.label) ?? 0) - (numbers.get(b.label) ?? 0));
}

/** The passage text without the `[MM:SS]` marks of legacy notes. */
export function citationSnippet(c: AskCitation): string {
  return c.snippet.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g, "").trim();
}

/** Where in the note: "12:30", "운영 모드 · 12:03", "PDF 4쪽". */
export function citationWhere(c: AskCitation): string {
  switch (c.kind) {
    case "transcript":
      return formatTimestamp(c.start_ms);
    case "document": {
      // Legacy notes report the note's own title as the section: not worth repeating.
      const section = c.section_title && c.section_title !== c.recording_title ? c.section_title : null;
      return [section, c.start_ms !== null ? formatTimestamp(c.start_ms) : null].filter(Boolean).join(" · ") || "문서";
    }
    case "pdf_page":
      return `PDF ${c.page}쪽`;
    default:
      return "";
  }
}

/** Accessible name: starts with the visible number (WCAG 2.5.3). */
export function citationName(c: AskCitation, n: number): string {
  const where = citationWhere(c);
  const base = `출처 ${n}, ${c.recording_title}${where ? ` ${where}` : ""}`;
  if (!c.available) return `${base} (지금은 볼 수 없음)`;
  return c.support === "weak" ? `${base}, 근거 약함` : base;
}

/** Name of an entry in the source list under an answer ("출처 1: …"), distinct from the inline mark. */
export function sourceName(c: AskCitation, n: number): string {
  const where = citationWhere(c);
  const base = `출처 ${n}: ${c.recording_title}${where ? ` ${where}` : ""}`;
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
