// How a /search hit reads in the ⌘K palette. Legacy (v1) notes are Markdown, so their
// document snippets carry `#` headings, list marks and `[MM:SS]` time marks: the label
// drops those, and the time mark nearest before the match becomes the place to open.

import type { SearchHit } from "../api/types.ts";
import { parseClock } from "./legacy-markdown.ts";

const TIME_MARK = /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[~-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]/g;

/** One line of plain text: no Markdown marks, no time marks, whitespace collapsed. */
export function hitText(hit: SearchHit): string {
  return hit.snippet
    .map((p) => p.text)
    .join("")
    .replace(TIME_MARK, "")
    // Block marks at the start of a line (the snippet may start with "…").
    .replace(/(^…?|\n)\s*(?:#{1,6}|[-*+]|\d+\.|>)\s+/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
