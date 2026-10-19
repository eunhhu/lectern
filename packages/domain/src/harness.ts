import { z } from "zod";
import { SourceToken, SpeakerLabel, TemplateBlock, TemplateBlocks, TemplateBlockType } from "./blocks.ts";
import { EventKind, QuestionDifficulty, QuestionKind, RecordingDomain } from "./enums.ts";
import { Confidence, LanguageTag, LocalDate, LocalTime, Milliseconds, Slug, TemplateId } from "./primitives.ts";

// Model-facing output schemas for the harness stages (AI_HARNESS §3.4, §3.8, §7).
// They describe what a provider must return, before `verify`. They are not part
// of the HTTP contract, so none of them is published to openapi.json.

// ---------------------------------------------------------------------------
// transcribe (§3.4)
// ---------------------------------------------------------------------------

/**
 * One segment as a transcription provider returns it. Times are relative to
 * the start of the chunk, in cut-audio time. `merge` maps them to original
 * audio exactly once (§3.2); only TranscriptSegment (entities.ts) is in
 * original time.
 */
export const TranscribeSegment = z
  .object({
    start_ms: Milliseconds.describe("Chunk-relative, cut-audio time."),
    end_ms: Milliseconds.describe("Chunk-relative, cut-audio time."),
    speaker: SpeakerLabel.describe("Chunk-local label; `speakers` unifies labels across chunks."),
    text: z.string(),
    confidence: Confidence.optional(),
  })
  .refine((seg) => seg.end_ms >= seg.start_ms, { message: "end_ms must be >= start_ms", path: ["end_ms"] });
export type TranscribeSegment = z.infer<typeof TranscribeSegment>;

export const TranscribeResult = z.object({
  segments: z.array(TranscribeSegment),
  language: LanguageTag.optional().describe("Detected language, when the provider reports one."),
});
export type TranscribeResult = z.infer<typeof TranscribeResult>;

// ---------------------------------------------------------------------------
// Templates (§7)
// ---------------------------------------------------------------------------

/** What fills a template section: the `structure` model call, or code rendering an extract field. */
export const SectionFill = z.enum(["structure", "events", "action_items", "questions", "decisions", "glossary"]);
export type SectionFill = z.infer<typeof SectionFill>;

export const ExtractField = z.enum(["events", "action_items", "questions", "decisions", "glossary"]);
export type ExtractField = z.infer<typeof ExtractField>;

export const TemplateSection = z.object({
  key: Slug,
  title: z.string().min(1).describe("Display title of the section (Korean UI by default)."),
  fill: SectionFill,
  instructions: z.string().describe("Prompt hint for `structure` sections; empty for extract-filled ones."),
  block_types: z.array(TemplateBlockType).min(1).describe("Block types allowed (structure) or emitted (extract)."),
  required: z.boolean(),
});
export type TemplateSection = z.infer<typeof TemplateSection>;

/** `template.json` of a template directory (`packages/harness/templates/<id>/`). */
export const TemplateDefinition = z
  .object({
    id: TemplateId,
    version: z.int().min(1),
    name: z.string().min(1),
    domains: z.array(RecordingDomain).min(1).describe("Domains that use this template by default."),
    sections: z.array(TemplateSection).min(1),
    extract: z.record(ExtractField, z.boolean()).describe("Which extract fields the `extract` stage asks for."),
    question_kinds: z.array(QuestionKind),
  })
  .superRefine((def, ctx) => {
    const keys = new Set<string>();
    def.sections.forEach((section, i) => {
      if (keys.has(section.key)) {
        ctx.addIssue({ code: "custom", message: `duplicate section key ${section.key}`, path: ["sections", i, "key"] });
      }
      keys.add(section.key);
      if (section.fill !== "structure" && !def.extract[section.fill]) {
        ctx.addIssue({
          code: "custom",
          message: `section ${section.key} is filled from ${section.fill}, which extract does not enable`,
          path: ["sections", i, "fill"],
        });
      }
    });
    if (def.extract.questions && def.question_kinds.length === 0) {
      ctx.addIssue({ code: "custom", message: "questions are enabled but no question_kinds", path: ["question_kinds"] });
    }
  });
export type TemplateDefinition = z.infer<typeof TemplateDefinition>;

// ---------------------------------------------------------------------------
// structure (§3.8): the template document
// ---------------------------------------------------------------------------

export const TemplateOutputSection = z.object({
  key: Slug,
  blocks: z.array(TemplateBlock),
});

/** Any template's `structure` output. Use templateOutputSchema() for one template. */
export const TemplateOutput = z.object({ sections: z.array(TemplateOutputSection) });
export type TemplateOutput = z.infer<typeof TemplateOutput>;

type AnyObject = z.ZodObject;
const asTuple = <T>(items: T[]) => items as [T, ...T[]];

/**
 * The `structure` output schema for one template: only its structure-filled
 * section keys, only the block types each section allows, required sections
 * present, no section twice. Usable both as the provider's response schema
 * and for verification.
 */
export function templateOutputSchema(def: TemplateDefinition): z.ZodType<TemplateOutput> {
  const sections = def.sections.filter((section) => section.fill === "structure");
  if (sections.length === 0) throw new Error(`template ${def.id} has no structure sections`);
  const sectionSchemas = sections.map((section) => {
    const blocks: AnyObject[] = section.block_types.map((type) => TemplateBlocks[type]);
    const block = blocks.length === 1 ? blocks[0]! : z.discriminatedUnion("type", asTuple(blocks));
    return z.object({ key: z.literal(section.key), blocks: z.array(block) });
  });
  const section = sectionSchemas.length === 1 ? sectionSchemas[0]! : z.discriminatedUnion("key", asTuple(sectionSchemas));
  return z
    .object({ sections: z.array(section) })
    .superRefine((output, ctx) => {
      const seen = new Set<string>();
      output.sections.forEach((s, i) => {
        if (seen.has(s.key)) ctx.addIssue({ code: "custom", message: `duplicate section ${s.key}`, path: ["sections", i] });
        seen.add(s.key);
      });
      for (const required of sections.filter((s) => s.required)) {
        if (!seen.has(required.key)) {
          ctx.addIssue({ code: "custom", message: `missing required section ${required.key}`, path: ["sections"] });
        }
      }
    }) as unknown as z.ZodType<TemplateOutput>;
}

// ---------------------------------------------------------------------------
// extract (§3.8): one call, one schema
// ---------------------------------------------------------------------------

export const ExtractedEvent = z.object({
  title: z.string().min(1),
  kind: EventKind,
  raw_expression: z.string().min(1).describe("The date phrase verbatim; code resolves it (§3.9.1)."),
  model_resolution: z.object({
    date: LocalDate.describe("The model's reading, in the user's zone."),
    time: LocalTime.nullable(),
    end_time: LocalTime.nullable(),
    all_day: z.boolean(),
  }),
  evidence: z.array(SourceToken).min(1),
  quote: z.string().min(1),
  confidence: Confidence,
});
export type ExtractedEvent = z.infer<typeof ExtractedEvent>;

export const ExtractedActionItem = z.object({
  text: z.string().min(1),
  owner_name: z.string().min(1).nullable(),
  due_raw: z.string().min(1).nullable(),
  evidence: z.array(SourceToken).min(1),
  quote: z.string().min(1).nullable(),
});
export type ExtractedActionItem = z.infer<typeof ExtractedActionItem>;

export const ExtractedQuestion = z.object({
  kind: QuestionKind,
  prompt: z.string().min(1),
  answer: z.string().min(1),
  sources: z.object({
    segments: z.array(SourceToken),
    pdf_pages: z.array(z.int().min(1)),
  }),
  difficulty: QuestionDifficulty,
});
export type ExtractedQuestion = z.infer<typeof ExtractedQuestion>;

export const ExtractedDecision = z.object({
  text: z.string().min(1),
  evidence: z.array(SourceToken).min(1),
});
export type ExtractedDecision = z.infer<typeof ExtractedDecision>;

export const ExtractedGlossaryEntry = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  evidence: z.array(SourceToken).min(1),
});
export type ExtractedGlossaryEntry = z.infer<typeof ExtractedGlossaryEntry>;

/** Every extract field. Templates switch fields off; see extractResultSchema(). */
export const ExtractResult = z.object({
  events: z.array(ExtractedEvent),
  action_items: z.array(ExtractedActionItem),
  questions: z.array(ExtractedQuestion),
  decisions: z.array(ExtractedDecision),
  glossary: z.array(ExtractedGlossaryEntry),
});
export type ExtractResult = z.infer<typeof ExtractResult>;

/** The extract schema for one template: only the fields it enables, and only its question kinds. */
export function extractResultSchema(def: TemplateDefinition): z.ZodType<Partial<ExtractResult>> {
  const shape: Partial<Record<ExtractField, z.ZodType>> = {};
  for (const field of ExtractField.options) {
    if (!def.extract[field]) continue;
    shape[field] =
      field === "questions"
        ? z.array(ExtractedQuestion.extend({ kind: z.enum(asTuple(def.question_kinds)) }))
        : ExtractResult.shape[field];
  }
  return z.object(shape) as unknown as z.ZodType<Partial<ExtractResult>>;
}
