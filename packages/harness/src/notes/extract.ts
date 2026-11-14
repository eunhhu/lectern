// The extract stage (CONTRACTS §1.3, §1.5; AI_HARNESS §3.8): events, action items,
// decisions and glossary entries in one model call, asking only for the fields the
// template enables. It shares the system text and transcript part with structure.

import {
  ExtractField,
  extractResultSchema,
  ExtractResult,
  type TemplateDefinition,
} from "@lectern/domain";
import { z, type ZodType } from "zod";
import { llmSchemaHash } from "../gemini-llm.ts";
import { canonicalJson, sha256Hex } from "../hash.ts";
import type { LlmProvider } from "../providers.ts";
import type { Routing } from "../routing.ts";
import { defineStage, type StageDefinition } from "../stage.ts";
import type { PdfContext } from "../pdf/context.ts";
import type { LoadedTemplate } from "../templates.ts";
import { formatCompactTranscript, type CompactSegment } from "./compact.ts";
import { hasPdfText, NOTES_SYSTEM, notesContext, pdfContextParts, repairSuffix } from "./prompt.ts";

export const EXTRACT_STAGE_VERSION = 1;

export interface ExtractInput {
  template: LoadedTemplate;
  segments: CompactSegment[];
  language: string;
  recordedAtMs: number;
  tz: string;
  /** Related lecture PDF pages (P3-04); without page text the prompt is the P1 one. */
  pdf?: PdfContext;
}

const EXTRACT_INSTRUCTION = "위 전사에서 아래 항목만 JSON으로 추출한다. 전사에 실제로 나온 것만 쓴다.";

const PDF_EVIDENCE_NOTE = "\n자료(PDF) 쪽은 참고만 한다. 근거(evidence)는 전사의 #번호로만 단다.";

const FIELD_HELP: Record<Exclude<ExtractField, "questions">, string> = {
  events:
    "마감·시험·회의·발표 등 날짜가 있는 일정. kind는 deadline, exam, meeting, task, other 중 하나. raw_expression은 말한 날짜 표현 그대로, model_resolution은 녹음 시각 기준 네 해석(date, time, end_time, all_day).",
  action_items: "누군가 해야 할 일. owner_name은 이름이 나올 때만, due_raw는 기한 표현 그대로(없으면 null).",
  decisions: "회의에서 확정된 결정. text와 evidence.",
  glossary: "설명된 용어. term, definition, evidence.",
};

/** Strict: a field the template switched off is an error, not silently stripped. */
export function extractSchemaFor(def: TemplateDefinition): ZodType<Partial<ExtractResult>> {
  const base = extractResultSchema(def) as unknown as z.ZodObject;
  return z.strictObject(base.shape) as unknown as ZodType<Partial<ExtractResult>>;
}

/** The fields this template asks for, in ExtractField order. Questions are never asked (D-P1-7). */
export function enabledExtractFields(def: TemplateDefinition): ExtractField[] {
  return ExtractField.options.filter((field) => def.extract[field] === true);
}

/** "2026-10-19 (월) 14:00 Asia/Seoul" */
export function formatRecordedAt(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year").replace(/\D/g, "");
  const month = get("month").replace(/\D/g, "").padStart(2, "0");
  const day = get("day").replace(/\D/g, "").padStart(2, "0");
  const hour = get("hour").replace(/\D/g, "").padStart(2, "0");
  const minute = get("minute").replace(/\D/g, "").padStart(2, "0");
  return `${year}-${month}-${day} (${get("weekday")}) ${hour}:${minute} ${tz}`;
}

function buildInstruction(input: ExtractInput, fields: ExtractField[], repair: { issues: string } | null): string {
  const help = fields
    .filter((f): f is Exclude<ExtractField, "questions"> => f !== "questions")
    .map((f) => `\n- ${f}: ${FIELD_HELP[f]}`)
    .join("");
  return (
    `${EXTRACT_INSTRUCTION}\n\n${input.template.extractPrompt}\n\n` +
    `녹음 시각: ${formatRecordedAt(input.recordedAtMs, input.tz)}\n출력 언어: ${input.language}\n추출 항목:${help}` +
    (hasPdfText(input.pdf) ? PDF_EVIDENCE_NOTE : "") +
    repairSuffix(repair)
  );
}

export function extractStage(
  llm: LlmProvider,
  routing: Routing
): StageDefinition<ExtractInput, Partial<ExtractResult>> {
  const route = routing.extract;
  return defineStage({
    name: "extract",
    version: EXTRACT_STAGE_VERSION,
    output: ExtractResult.partial() as unknown as ZodType<Partial<ExtractResult>>,
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 1 },
    key: (input) => {
      const def = input.template.def;
      const fields = enabledExtractFields(def);
      return {
        inputs: [
          sha256Hex(formatCompactTranscript({ segments: input.segments }).text),
          ...(hasPdfText(input.pdf) ? [sha256Hex(input.pdf.text)] : []),
        ],
        prompt: sha256Hex(`${NOTES_SYSTEM}\u0000${EXTRACT_INSTRUCTION}\u0000${canonicalJson(FIELD_HELP)}`),
        template: `${def.id}@${def.version}:${input.template.hash}`,
        provider: llm.id,
        model: route.model,
        params: {
          schema: fields.length ? llmSchemaHash(extractSchemaFor(def)) : null,
          maxOutputTokens: route.maxOutputTokens,
          language: input.language,
          recordedAt: formatRecordedAt(input.recordedAtMs, input.tz),
        },
      };
    },
    async run(input, ctx) {
      const def = input.template.def;
      const fields = enabledExtractFields(def);
      if (fields.length === 0) return {};
      const result = await ctx.meter({ provider: llm.id, model: route.model }, () =>
        llm.generate({
          schema: extractSchemaFor(def),
          system: NOTES_SYSTEM,
          context: [...notesContext(input.segments), ...pdfContextParts(input.pdf)],
          instruction: buildInstruction(input, fields, ctx.repair),
          model: route.model,
          maxOutputTokens: route.maxOutputTokens,
          signal: ctx.signal,
        })
      );
      return result.value;
    },
  });
}
