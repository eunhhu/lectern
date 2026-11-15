// How a /search hit reads in the ⌘K palette and on the search screen (D-P3-5). Legacy
// (v1) notes are Markdown, so their document snippets carry `#` headings, list marks and
// `[MM:SS]` time marks: the text drops those, and the time mark nearest before the match
// becomes the place to open. A PDF page hit opens its page instead.

import type { SearchHit } from "../api/types.ts";
import { parseClock } from "./legacy-markdown.ts";

type SnippetPart = SearchHit["snippet"][number];

const TIME_MARK = /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[~-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]/g;
// Block marks at the start of a line (a snippet may start with "…").
const LINE_START_MARK = /(^…?|\n)\s*(?:#{1,6}|[-*+]|\d+\.|>)\s+/g;
const LINE_MARK = /(\n)\s*(?:#{1,6}|[-*+]|\d+\.|>)\s+/g;

/** The cleanups of one piece of snippet text; `atLineStart` when it begins a line. */
function cleanText(text: string, atLineStart: boolean): string {
  return text
    .replace(TIME_MARK, "")
    .replace(atLineStart ? LINE_START_MARK : LINE_MARK, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ");
}

/** One line of plain text: no Markdown marks, no time marks, whitespace collapsed. */
export function hitText(hit: SearchHit): string {
  return cleanText(hit.snippet.map((p) => p.text).join(""), true).trim();
}

/**
 * The snippet runs cleaned like hitText, run by run so the highlights stay: empty runs
 * dropped, the ends trimmed.
 */
export function cleanSnippet(parts: SnippetPart[]): SnippetPart[] {
  let previous = "";
  const out = parts
    .map((p, i) => {
      const text = cleanText(p.text, i === 0 || previous.endsWith("\n"));
      previous = p.text;
      return { text, highlight: p.highlight };
    })
    .filter((p) => p.text !== "");
  while (out.length && out[0]!.text.trimStart() === "") out.shift();
  while (out.length && out.at(-1)!.text.trimEnd() === "") out.pop();
  if (out.length) {
    out[0] = { ...out[0]!, text: out[0]!.text.trimStart() };
    out[out.length - 1] = { ...out.at(-1)!, text: out.at(-1)!.text.trimEnd() };
  }
  return out;
}

/** The PDF page a hit opens, for `pdf_page` hits only. */
export function hitPdfTarget(hit: SearchHit): { assetId: string; page: number } | undefined {
  return hit.kind === "pdf_page" ? { assetId: hit.asset_id, page: hit.page } : undefined;
}

export type HitGroupKey = "recording" | "transcript" | "document" | "pdf_page";

export const HIT_GROUP_LABEL: Record<HitGroupKey, string> = { recording: "녹음", transcript: "전사", document: "문서", pdf_page: "PDF" };

const GROUP_ORDER: HitGroupKey[] = ["recording", "transcript", "document", "pdf_page"];

/** Hits by kind in a fixed order (recording, transcript, document, PDF); empty groups and unknown kinds left out. */
export function groupHits(hits: SearchHit[]): Array<{ key: HitGroupKey; label: string; hits: SearchHit[] }> {
  return GROUP_ORDER.map((key) => ({ key, label: HIT_GROUP_LABEL[key], hits: hits.filter((h) => h.kind === key) })).filter((g) => g.hits.length > 0);
}

/** Original-audio ms to open the recording at: the transcript time, or a legacy note's mark before the match. */
export function hitTime(hit: SearchHit): number | undefined {
  if (hit.kind === "transcript") return hit.start_ms;
  if (hit.kind !== "document") return undefined;
  let before = "";
  for (const part of hit.snippet) {
    if (part.highlight) break;
    before += part.text;
  }
  // Only a mark on the same line as the match belongs to it.
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const marks = [...line.matchAll(TIME_MARK)];
  const last = marks.at(-1);
  return last ? parseClock(last[1]!) : undefined;
}
