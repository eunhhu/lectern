import { z } from "zod";
import { GapKind } from "./enums.ts";
import { BlockId, Milliseconds, SourceRef } from "./primitives.ts";
import { named } from "./registry.ts";

// Document blocks exist in two forms built from the same field list:
//
// - TemplateBlock: what the `structure` stage asks the model for. Sources are
//   segment tokens (`#12`, `#40-#44`) and context page numbers (AI_HARNESS §3.8).
// - DocumentBlock: what `document_version.body` stores after `verify`. Sources
//   are verified SourceRefs, and every block has an id.
//
// Block `type` is an open union: new types may be added, and clients render
// unknown types as nothing (or as their `heading`).

/** Segment reference token in model output: `#12` or the inclusive range `#40-#44`. */
export const SourceToken = z
  .string()
  .regex(/^#\d+(?:-#\d+)?$/)
  .describe("Transcript segment id `#12` or inclusive range `#40-#44` from the compact transcript.");

export const SpeakerLabel = z.string().regex(/^S\d+$/).describe("Speaker label such as `S1`.");

const Heading = z.string().min(1).nullable().describe("Optional sub-heading, e.g. the topic name.");
const Text = z.string().min(1);

export const TEMPLATE_BLOCK_TYPES = ["paragraph", "list", "quote", "term", "formula", "callout"] as const;
/** Block types a template section can ask the model for (harness only, not in openapi.json). */
export const TemplateBlockType = z.enum(TEMPLATE_BLOCK_TYPES);
export type TemplateBlockType = z.infer<typeof TemplateBlockType>;

export const ListStyle = z.enum(["bullet", "numbered"]);
export const CalloutTone = z.enum(["exam", "assignment", "important", "note"]);

function blockShapes<H extends z.ZodRawShape, P extends z.ZodRawShape>(head: H, provenance: P) {
  const listItem = z.object({ text: Text, ...provenance });
  return {
    listItem,
    paragraph: z.object({ ...head, type: z.literal("paragraph"), heading: Heading, text: Text, ...provenance }),
    list: z.object({
      ...head,
      type: z.literal("list"),
      heading: Heading,
      style: ListStyle,
      items: z.array(listItem).min(1),
      ...provenance,
    }),
    quote: z.object({
      ...head,
      type: z.literal("quote"),
      heading: Heading,
      text: Text,
      speaker: SpeakerLabel.nullable(),
      ...provenance,
    }),
    term: z.object({ ...head, type: z.literal("term"), heading: Heading, term: Text, definition: Text, ...provenance }),
    formula: z.object({
      ...head,
      type: z.literal("formula"),
      heading: Heading,
      expression: Text.describe("LaTeX source."),
      explanation: z.string().min(1).nullable(),
      ...provenance,
    }),
    callout: z.object({
      ...head,
      type: z.literal("callout"),
      heading: Heading,
      tone: CalloutTone,
      text: Text,
      ...provenance,
    }),
  };
}

// ---------------------------------------------------------------------------
// Model output form
// ---------------------------------------------------------------------------

const modelBlocks = blockShapes(
  {},
  {
    sources: z.array(SourceToken).describe("Segment tokens backing this block or item."),
    pdf_pages: z
      .array(z.int().min(1))
      .describe("1-based page numbers as labelled in the PDF context; the harness maps them to asset + page."),
  },
);

export const TemplateBlocks = {
  paragraph: modelBlocks.paragraph,
  list: modelBlocks.list,
  quote: modelBlocks.quote,
  term: modelBlocks.term,
  formula: modelBlocks.formula,
  callout: modelBlocks.callout,
} as const satisfies Record<TemplateBlockType, z.ZodObject>;

export const TemplateBlock = z.discriminatedUnion("type", [
  modelBlocks.paragraph,
  modelBlocks.list,
  modelBlocks.quote,
  modelBlocks.term,
  modelBlocks.formula,
  modelBlocks.callout,
]);
export type TemplateBlock = z.infer<typeof TemplateBlock>;

// ---------------------------------------------------------------------------
// Persisted form
// ---------------------------------------------------------------------------

const storedBlocks = blockShapes({ id: BlockId }, { sources: z.array(SourceRef) });

export const ListItem = named("ListItem", storedBlocks.listItem);
export const ParagraphBlock = named("ParagraphBlock", storedBlocks.paragraph);
export const ListBlock = named("ListBlock", storedBlocks.list);
export const QuoteBlock = named("QuoteBlock", storedBlocks.quote);
export const TermBlock = named("TermBlock", storedBlocks.term);
export const FormulaBlock = named("FormulaBlock", storedBlocks.formula);
export const CalloutBlock = named("CalloutBlock", storedBlocks.callout);

/** A stretch of original audio that has no transcript (cut break, tail, failed chunk). */
export const TranscriptGap = named(
  "TranscriptGap",
  z
    .object({ kind: GapKind, start_ms: Milliseconds, end_ms: Milliseconds })
    .refine((gap) => gap.end_ms >= gap.start_ms, { message: "end_ms must be >= start_ms", path: ["end_ms"] }),
  "Original-audio time range with no transcript.",
);
export type TranscriptGap = z.infer<typeof TranscriptGap>;

/** Written by code, never by the model: marks a break, tail or missing chunk in the document. */
export const GapBlock = named(
  "GapBlock",
  z
    .object({
      id: BlockId,
      type: z.literal("gap"),
      heading: Heading,
      kind: GapKind,
      start_ms: Milliseconds,
      end_ms: Milliseconds,
      sources: z.array(SourceRef),
    })
    .refine((gap) => gap.end_ms >= gap.start_ms, { message: "end_ms must be >= start_ms", path: ["end_ms"] }),
);

export const DocumentBlock = named(
  "DocumentBlock",
  z.discriminatedUnion("type", [ParagraphBlock, ListBlock, QuoteBlock, TermBlock, FormulaBlock, CalloutBlock, GapBlock]),
  "A verified document block. Open union on `type`: render unknown types as nothing.",
);
export type DocumentBlock = z.infer<typeof DocumentBlock>;

export const DocumentSection = named(
  "DocumentSection",
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).describe("Section key from the template, e.g. `summary`."),
    title: z.string().min(1).describe("Display title; templates set it, users may rename it later."),
    blocks: z.array(DocumentBlock),
  }),
);
export type DocumentSection = z.infer<typeof DocumentSection>;

export const DocumentBody = named(
  "DocumentBody",
  z.object({ sections: z.array(DocumentSection) }),
  "Structured document. Markdown/HTML are rendered from this, never the other way round.",
);
export type DocumentBody = z.infer<typeof DocumentBody>;
