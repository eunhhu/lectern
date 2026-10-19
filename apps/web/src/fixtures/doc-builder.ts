// Helpers for writing fixture documents as packages/domain DocumentBody values. Sources
// cite transcript anchors by key, so every chip points at a segment range that exists.

import type {
  AssetId,
  BlockId,
  DocumentBlock,
  DocumentBody,
  DocumentSection,
  GapKind,
  SourceRef,
} from "../api/types.ts";
import { formatTimestamp } from "../lib/format.ts";

type AnchorMap = Record<string, { start_idx: number; end_idx: number }>;
type Tone = "exam" | "assignment" | "important" | "note";

export class DocBuilder {
  #n = 0;

  constructor(
    private readonly documentId: string,
    private readonly anchors: AnchorMap,
    private readonly pdfAssetId: AssetId | null = null,
  ) {}

  #id(): BlockId {
    this.#n += 1;
    return `${this.documentId}_b${this.#n}` as BlockId;
  }

  /** Transcript sources for anchor keys. Unknown keys are a fixture bug, so they throw. */
  t(...keys: string[]): SourceRef[] {
    return keys.map((key) => {
      const range = this.anchors[key];
      if (!range) throw new Error(`fixture anchor not found: ${key}`);
      return { kind: "transcript", ...range };
    });
  }

  /** A PDF page source (1-based). */
  page(page: number): SourceRef {
    if (!this.pdfAssetId) throw new Error("fixture document has no PDF");
    return { kind: "pdf_page", asset_id: this.pdfAssetId, page };
  }

  paragraph(text: string, sources: SourceRef[], heading: string | null = null): DocumentBlock {
    return { id: this.#id(), type: "paragraph", heading, text, sources };
  }

  list(items: [text: string, sources: SourceRef[]][], style: "bullet" | "numbered" = "bullet", heading: string | null = null): DocumentBlock {
    return {
      id: this.#id(),
      type: "list",
      heading,
      style,
      items: items.map(([text, sources]) => ({ text, sources })),
      sources: [],
    };
  }

  term(term: string, definition: string, sources: SourceRef[], heading: string | null = null): DocumentBlock {
    return { id: this.#id(), type: "term", heading, term, definition, sources };
  }

  callout(tone: Tone, text: string, sources: SourceRef[], heading: string | null = null): DocumentBlock {
    return { id: this.#id(), type: "callout", heading, tone, text, sources };
  }

  quote(text: string, speaker: string | null, sources: SourceRef[], heading: string | null = null): DocumentBlock {
    return { id: this.#id(), type: "quote", heading, text, speaker, sources };
  }

  formula(expression: string, explanation: string | null, sources: SourceRef[], heading: string | null = null): DocumentBlock {
    return { id: this.#id(), type: "formula", heading, expression, explanation, sources };
  }

  gap(kind: GapKind, start_ms: number, end_ms: number): DocumentBlock {
    return { id: this.#id(), type: "gap", heading: null, kind, start_ms, end_ms, sources: [] };
  }
}

export function section(key: string, title: string, blocks: DocumentBlock[]): DocumentSection {
  return { key, title, blocks };
}

const CALLOUT_LABEL: Record<Tone, string> = { exam: "시험", assignment: "과제", important: "중요", note: "참고" };
const GAP_LABEL: Record<string, string> = { break: "쉬는 시간", tail: "녹음 끝", missing_transcript: "전사 없음" };

/** `document_version.rendered_md` for fixtures (the server renders it from the body in production). */
export function renderMarkdown(title: string, body: DocumentBody): string {
  const out: string[] = [`# ${title}`];
  for (const s of body.sections) {
    out.push("", `## ${s.title}`);
    for (const b of s.blocks) {
      if ("heading" in b && b.heading) out.push("", `### ${b.heading}`);
      out.push("");
      switch (b.type) {
        case "paragraph":
          out.push(b.text);
          break;
        case "list":
          b.items.forEach((item, i) => out.push(`${b.style === "numbered" ? `${i + 1}.` : "-"} ${item.text}`));
          break;
        case "quote":
          out.push(`> ${b.text}`);
          break;
        case "term":
          out.push(`**${b.term}**: ${b.definition}`);
          break;
        case "formula":
          out.push(`$$${b.expression}$$`, ...(b.explanation ? ["", b.explanation] : []));
          break;
        case "callout":
          out.push(`> **${CALLOUT_LABEL[b.tone]}** ${b.text}`);
          break;
        case "gap":
          out.push(`_${GAP_LABEL[b.kind] ?? "구간 없음"} (${formatTimestamp(b.start_ms)}–${formatTimestamp(b.end_ms)})_`);
          break;
      }
    }
  }
  return out.join("\n") + "\n";
}
