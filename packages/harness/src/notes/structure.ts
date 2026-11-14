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
  return `${STRUCTURE_INSTRUCTION}\n\n${input.template.structurePrompt}\n\n출력 언어: ${input.language}\n\n섹션:\n${sections}${pdfNote}${repairSuffix(repair)}`;
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
        const partial = await call({
          schema: PartialSummary,
          context: [{ type: "text", text: `전사(일부):\n${window}` }],
          instruction: `${MAP_INSTRUCTION}${repairSuffix(ctx.repair)}`,
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
