// The structure stage (CONTRACTS §1.3, AI_HARNESS §3.8): transcript + template → the
// template's sections as blocks citing `#idx` tokens. Transcripts over 60,000 compact
// characters are summarised window by window first (map), then structured (reduce).

import { SourceToken, templateOutputSchema, TemplateOutput } from "@lectern/domain";
import { z } from "zod";
import { llmSchemaHash } from "../gemini-llm.ts";
import { sha256Hex } from "../hash.ts";
import type { LlmProvider, LlmRequest } from "../providers.ts";
import type { Routing } from "../routing.ts";
import { defineStage, type StageDefinition } from "../stage.ts";
import type { PdfContext } from "../pdf/context.ts";
import type { LoadedTemplate } from "../templates.ts";
import { formatCompactTranscript, type CompactSegment } from "./compact.ts";
import { hasPdfText, NOTES_SYSTEM, notesContext, pdfContextParts, repairSuffix } from "./prompt.ts";

export const STRUCTURE_STAGE_VERSION = 1;
/** A compact transcript longer than this is summarised in windows first. */
export const STRUCTURE_MAX_CHARS = 60_000;
export const STRUCTURE_WINDOW_CHARS = 20_000;

export interface StructureInput {
  template: LoadedTemplate;
  segments: CompactSegment[];
  language: string;
  /** Related lecture PDF pages (P3-04); without page text the prompt is the P1 one. */
  pdf?: PdfContext;
  /**
   * Segments the user marked as important while recording (D-P6-3, from markerSegments).
   * Absent, not empty, when there are none: the cache key of an unmarked recording stays as it was.
   */
  important?: ImportantSegment[];
}

/** A transcript segment (its compact `#idx`) the user marked, and the marker's label. */
export interface ImportantSegment {
  idx: number;
  label: string | null;
}

/** At most this many marked segments go into the prompt. */
export const MAX_IMPORTANT_SEGMENTS = 40;

/**
 * The segments the markers point at (D-P6-3). For each marker: the segment playing at that
 * moment (the last one starting at or before it), so before the first segment the first one;
 * a marker in a gap lands on the segment that ended before it (people press after they hear
 * it). The segment just before is added too. Deduplicated, in transcript order, at most 40.
 */
export function markerSegments(
  segments: readonly CompactSegment[],
  markers: readonly { at_ms: number; label: string | null }[]
): ImportantSegment[] {
  if (!segments.length || !markers.length) return [];
  const ordered = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.idx - b.idx);
  const chosen = new Map<number, string | null>();
  const add = (position: number, label: string | null) => {
    const idx = ordered[position]!.idx;
    if (!chosen.has(idx) || (chosen.get(idx) === null && label !== null)) chosen.set(idx, label);
  };
  for (const marker of markers) {
    let at = 0;
    for (let i = 0; i < ordered.length && ordered[i]!.start_ms <= marker.at_ms; i += 1) at = i;
    if (at > 0 && !chosen.has(ordered[at - 1]!.idx)) chosen.set(ordered[at - 1]!.idx, null);
    add(at, marker.label);
  }
  const positions = new Map(ordered.map((s, i) => [s.idx, i]));
  return [...chosen.entries()]
    .sort((a, b) => positions.get(a[0])! - positions.get(b[0])!)
    .slice(0, MAX_IMPORTANT_SEGMENTS)
    .map(([idx, label]) => ({ idx, label }));
}

/** The prompt lines that name the marked segments; empty without any. */
export function importantNote(important: readonly ImportantSegment[] | undefined): string {
  if (!important?.length) return "";
  const list = important.map((s) => (s.label ? `#${s.idx}(${s.label})` : `#${s.idx}`)).join(", ");
  return `\n\n사용자가 녹음 중에 "중요"라고 표시한 구간: ${list}\n이 구간의 내용은 빠뜨리지 말고 노트에 담는다. 표시가 없는 구간을 덜 중요하게 다루라는 뜻은 아니다.`;
}

export const PartialSummary = z.object({
  points: z.array(z.object({ text: z.string().min(1), sources: z.array(SourceToken).min(1) })),
});
export type PartialSummary = z.infer<typeof PartialSummary>;

const STRUCTURE_INSTRUCTION = "위 전사로 노트를 만든다. 아래 섹션만 JSON으로 답한다.";
const MAP_INSTRUCTION =
  "이 구간의 핵심 내용을 항목으로 요약한다. 항목마다 근거 출처(sources)를 `#번호` 또는 `#시작-#끝`으로 단다. 구간 요약만 쓴다.";
const REDUCE_NOTE = "\n출처 번호는 위 요약에 적힌 것만 쓴다.";
const PDF_PAGES_NOTE = "\n자료(PDF) 쪽을 근거로 쓸 때는 pdf_pages에 위 [PDF 번호]만 쓴다. 근거가 아닌 쪽은 쓰지 않는다.";

/** Splits on line boundaries into windows of at most `maxChars`; a longer line is its own window. */
export function splitTranscriptWindows(text: string, maxChars: number): string[] {
  if (!text) return [];
  const windows: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      windows.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) windows.push(current);
  return windows;
}

function buildStructureInstruction(input: StructureInput, repair: { issues: string } | null): string {
  const sections = input.template.def.sections
    .filter((s) => s.fill === "structure")
    .map(
      (s) =>
        `- ${s.key} ${s.title} (${s.required ? "필수" : "선택"}) 허용 블록: ${s.block_types.join(", ")} — ${s.instructions}`
    )
    .join("\n");
  const pdfNote = hasPdfText(input.pdf) ? PDF_PAGES_NOTE : "";
  return `${STRUCTURE_INSTRUCTION}\n\n${input.template.structurePrompt}\n\n출력 언어: ${input.language}\n\n섹션:\n${sections}${pdfNote}${importantNote(input.important)}${repairSuffix(repair)}`;
}

export function structureStage(llm: LlmProvider, routing: Routing): StageDefinition<StructureInput, TemplateOutput> {
  const route = routing.structure;
  return defineStage({
    name: "structure",
    version: STRUCTURE_STAGE_VERSION,
    output: TemplateOutput,
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 1 },
    key: (input) => {
      const def = input.template.def;
      return {
        inputs: [
          sha256Hex(formatCompactTranscript({ segments: input.segments }).text),
          ...(hasPdfText(input.pdf) ? [sha256Hex(input.pdf.text)] : []),
          // Only when there are marks, so an unmarked recording keeps its key (D-P6-3).
          ...(input.important?.length ? [sha256Hex(`important:${JSON.stringify(input.important)}`)] : []),
        ],
        prompt: sha256Hex(`${NOTES_SYSTEM}\u0000${STRUCTURE_INSTRUCTION}\u0000${MAP_INSTRUCTION}`),
        template: `${def.id}@${def.version}:${input.template.hash}`,
        provider: llm.id,
        model: route.model,
        params: {
          schema: llmSchemaHash(templateOutputSchema(def)),
          maxOutputTokens: route.maxOutputTokens,
          language: input.language,
          windowChars: STRUCTURE_WINDOW_CHARS,
          maxChars: STRUCTURE_MAX_CHARS,
        },
      };
    },
    async run(input, ctx) {
      const call = <T>(req: Omit<LlmRequest<T>, "system" | "model" | "maxOutputTokens" | "signal">) =>
        ctx.meter({ provider: llm.id, model: route.model }, () =>
          llm.generate<T>({
            ...req,
            system: NOTES_SYSTEM,
            model: route.model,
            maxOutputTokens: route.maxOutputTokens,
            signal: ctx.signal,
          })
        );
      const schema = templateOutputSchema(input.template.def);
      const compact = formatCompactTranscript({ segments: input.segments }).text;

      if (compact.length <= STRUCTURE_MAX_CHARS) {
        const result = await call({
          schema,
          context: [...notesContext(input.segments), ...pdfContextParts(input.pdf)],
          instruction: buildStructureInstruction(input, ctx.repair),
        });
        return result.value;
      }

      const lines: string[] = [];
      for (const window of splitTranscriptWindows(compact, STRUCTURE_WINDOW_CHARS)) {
        // A window keeps the marks that fall in it, so the summaries carry those segments'
        // numbers to the reduce, which names every mark again.
        const inWindow = new Set(window.split("\n").map((line) => Number(/^#(\d+) /.exec(line)?.[1] ?? NaN)));
        const marks = input.important?.filter((s) => inWindow.has(s.idx));
        const partial = await call({
          schema: PartialSummary,
          context: [{ type: "text", text: `전사(일부):\n${window}` }],
          instruction: `${MAP_INSTRUCTION}${importantNote(marks)}${repairSuffix(ctx.repair)}`,
        });
        for (const point of partial.value.points) lines.push(`- ${point.text} [${point.sources.join(" ")}]`);
      }
      const result = await call({
        schema,
        context: [
          { type: "text", text: `구간별 요약(전사 전체를 나눠 요약한 것):\n${lines.join("\n")}` },
          ...pdfContextParts(input.pdf),
        ],
        instruction: `${buildStructureInstruction(input, ctx.repair)}${REDUCE_NOTE}`,
      });
      return result.value;
    },
  });
}
