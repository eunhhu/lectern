// Deterministic Markdown for a structured document (CONTRACTS §1.3, D-P1-3). The output
// becomes `document.rendered_md` and, through the v1 bridge, `lectures.markdown`. Same
// input, same characters: no clock, no randomness.

import type { DocumentBlock, DocumentBody, SourceRef } from "@lectern/domain";
import { formatGapMarker } from "@lectern/media";
import { compactClock } from "./compact.ts";

export interface RenderContext {
  /** Document title (the recording title); null/empty: no `# ` line. */
  title: string | null;
  /** idx → original-audio start, for the `[MM:SS]` source marker. */
  segments: readonly { idx: number; start_ms: number }[];
}

const CALLOUT_LABELS: Record<string, string> = {
  exam: "시험",
  assignment: "과제",
  important: "중요",
  note: "참고",
};

/** Backslash-escapes Markdown syntax in user text; line-start markers are neutralised too. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\*_`[\]<>$]/g, (c) => `\\${c}`)
    .replace(/^(#{1,6})(\s)/gm, "\\$1$2")
    .replace(/^([-+])(\s)/gm, "\\$1$2")
    .replace(/^(\d+)\.(\s)/gm, "$1\\.$2");
}

function oneLine(text: string): string {
  return escapeMarkdown(text.replace(/\s*\n\s*/g, " ").trim());
}

function lines(text: string): string[] {
  return text.split("\n").map((line) => escapeMarkdown(line));
}

function renderBlock(block: DocumentBlock, marker: (sources: readonly SourceRef[]) => string): string | null {
  const withHeading = (body: string) =>
    "heading" in block && block.heading !== null && block.heading !== undefined
      ? `### ${oneLine(block.heading)}\n\n${body}`
      : body;

  switch (block.type) {
    case "paragraph":
      return withHeading(`${lines(block.text).join("\n")}${marker(block.sources)}`);
    case "list":
      return withHeading(
        block.items
          .map((item, i) => `${block.style === "numbered" ? `${i + 1}.` : "-"} ${oneLine(item.text)}${marker(item.sources)}`)
          .join("\n")
      );
    case "quote": {
      const quoted = lines(block.text).map((line) => `> ${line}`);
      quoted[quoted.length - 1] += `${block.speaker ? ` — ${block.speaker}` : ""}${marker(block.sources)}`;
      return withHeading(quoted.join("\n"));
    }
    case "term":
      return withHeading(`**${oneLine(block.term)}**: ${oneLine(block.definition)}${marker(block.sources)}`);
    case "formula":
      return withHeading(
        `$${block.expression}$${block.explanation ? ` — ${oneLine(block.explanation)}` : ""}${marker(block.sources)}`
      );
    case "callout": {
      const [first = "", ...rest] = lines(block.text);
      const out = [`> **[${CALLOUT_LABELS[block.tone] ?? block.tone}]** ${first}`, ...rest.map((line) => `> ${line}`)];
      out[out.length - 1] += marker(block.sources);
      return withHeading(out.join("\n"));
    }
    case "gap":
      return formatGapMarker({ kind: block.kind, start_ms: block.start_ms, end_ms: block.end_ms });
    default:
      return null;
  }
}

export function renderDocumentMarkdown(body: DocumentBody, ctx: RenderContext): string {
  const starts = new Map(ctx.segments.map((s) => [s.idx, s.start_ms] as const));
  const marker = (sources: readonly SourceRef[]): string => {
    const first = sources[0];
    if (!first) return "";
    if (first.kind === "transcript") {
      const start = starts.get(first.start_idx);
      return start === undefined ? "" : ` [${compactClock(start)}]`;
    }
    if (first.kind === "pdf_page") return ` [p.${first.page}]`;
    return "";
  };

  const pieces: string[] = [];
  const title = ctx.title?.trim();
  if (title) pieces.push(`# ${oneLine(title)}`);
  for (const section of body.sections) {
    const blocks = section.blocks
      .map((block) => renderBlock(block, marker))
      .filter((text): text is string => text !== null && text !== "");
    if (blocks.length === 0) continue;
    pieces.push(`## ${oneLine(section.title)}`, ...blocks);
  }
  return pieces.length ? `${pieces.join("\n\n")}\n` : "";
}
