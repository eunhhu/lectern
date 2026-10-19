// DocumentBody -> Markdown (`document_version.rendered_md`). Markdown is a rendering of the
// structured body, never the source (packages/domain blocks.ts); v1 clients and the
// lecture archive read it. Unknown block types render as nothing (open union).

import type { DocumentBlock, DocumentBody } from "@lectern/domain";

const GAP_LABEL: Record<string, string> = { break: "쉬는 시간", tail: "종료 후", missing_transcript: "전사 누락" };

/** `H:MM:SS` from one hour on, else `MM:SS` (the v1 note timestamp style). */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function block(b: DocumentBlock): string {
  const heading = "heading" in b && b.heading ? `### ${b.heading}\n\n` : "";
  switch (b.type) {
    case "paragraph":
      return `${heading}${b.text}`;
    case "list":
      return `${heading}${b.items.map((item, i) => `${b.style === "numbered" ? `${i + 1}.` : "-"} ${item.text}`).join("\n")}`;
    case "quote":
      return `${heading}${b.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}${b.speaker ? `\n> — ${b.speaker}` : ""}`;
    case "term":
      return `${heading}**${b.term}**: ${b.definition}`;
    case "formula":
      return `${heading}$$\n${b.expression}\n$$${b.explanation ? `\n\n${b.explanation}` : ""}`;
    case "callout":
      return `${heading}> **${b.tone}** ${b.text}`;
    case "gap":
      return `[${GAP_LABEL[b.kind] ?? b.kind}: ${formatClock(b.start_ms)}~${formatClock(b.end_ms)}]`;
    default:
      return "";
  }
}

export function renderDocumentMarkdown(title: string, body: DocumentBody): string {
  const parts = [`# ${title}`];
  for (const section of body.sections) {
    parts.push(`## ${section.title}`);
    for (const b of section.blocks) {
      const text = block(b);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/**
 * The body with `edited: true` on every block that differs from the same-id block of the
 * base version (or has no counterpart there). Unchanged blocks keep the base's flag.
 */
export function markEditedBlocks(body: DocumentBody, base: DocumentBody | null): DocumentBody {
  const before = new Map<string, DocumentBlock>();
  for (const section of base?.sections ?? []) for (const b of section.blocks) before.set(b.id, b);
  const strip = (b: DocumentBlock) => JSON.stringify({ ...b, edited: undefined });
  return {
    sections: body.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((b) => {
        const old = before.get(b.id);
        if (old && strip(old) === strip(b)) return old.type === "gap" ? b : ({ ...b, edited: "edited" in old ? old.edited : undefined } as DocumentBlock);
        return b.type === "gap" ? b : ({ ...b, edited: true } as DocumentBlock);
      }),
    })),
  };
}
