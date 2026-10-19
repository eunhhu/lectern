// Chunking: turns a recording's published transcript, document and PDF text into the
// passages the index stores and the model reads (docs/adr/0009-ask-rag.md, "색인 단위").
//
// Every chunk keeps enough provenance to become a citation without another lookup:
// transcript windows keep their segment range, original-audio times and per-segment
// character spans; document chunks keep the block id and the block's own SourceRefs;
// PDF chunks keep the asset and page. Chunking is deterministic: the same input gives
// the same chunks and the same ids, so re-indexing unchanged text is free.

import { createHash } from "node:crypto";
import type { DocumentBody, SourceRef } from "@lectern/domain";
import { estimateTokens } from "./text.ts";

/** Bump when the same input would now produce different chunks (part of the index stage key). */
export const CHUNKER_VERSION = 1;

export type ChunkKind = "transcript" | "document" | "pdf_page";

export const CHUNK_RULES = {
  /** Close a transcript window at the next good boundary once it reaches this size. */
  targetTokens: 350,
  /** Never let a window grow past this. */
  maxTokens: 600,
  /** A trailing window smaller than this is merged into the previous one. */
  minTokens: 120,
  /** A pause this long between segments is a good boundary. */
  pauseMs: 2_000,
  /** A jump this long (a cut break) always ends a window. */
  breakMs: 60_000,
} as const;

export interface SegmentInput {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_id?: string | null;
  text: string;
}

/** [idx, start_ms, end_ms, char_start, char_end] of one segment inside a window's text. */
export type SegmentSpan = [number, number, number, number, number];

export interface ChunkDraft {
  id: string;
  workspaceId: string;
  recordingId: string;
  kind: ChunkKind;
  locator: string;
  ordinal: number;
  heading: string | null;
  text: string;
  contentSha256: string;
  tokens: number;
  startIdx: number | null;
  endIdx: number | null;
  startMs: number | null;
  endMs: number | null;
  spans: SegmentSpan[] | null;
  documentId: string | null;
  documentVersion: number | null;
  blockId: string | null;
  sources: SourceRef[] | null;
  assetId: string | null;
  page: number | null;
}

export interface RecordingSources {
  workspaceId: string;
  recordingId: string;
  transcript?: {
    segments: readonly SegmentInput[];
    /** speaker_id → label or display name shown in the passage (`S1`, `김교수`). */
    speakers?: ReadonlyMap<string, string>;
  };
  document?:
    | { kind: "blocks"; documentId: string; version: number; body: DocumentBody }
    | { kind: "markdown"; documentId: string; version: number; markdown: string };
  pdfs?: ReadonlyArray<{ assetId: string; pages: ReadonlyArray<{ page: number; text: string }> }>;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type Draft = Omit<ChunkDraft, "id" | "workspaceId" | "recordingId" | "ordinal" | "contentSha256" | "tokens">;

const EMPTY: Omit<Draft, "kind" | "locator" | "heading" | "text"> = {
  startIdx: null,
  endIdx: null,
  startMs: null,
  endMs: null,
  spans: null,
  documentId: null,
  documentVersion: null,
  blockId: null,
  sources: null,
  assetId: null,
  page: null,
};

/** The text the index and the embedding see: heading first, so section names are searchable. */
export function embeddingText(chunk: Pick<ChunkDraft, "heading" | "text">): string {
  return chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text;
}

/** All chunks of a recording in reading order: document, transcript, PDF. */
export function chunkRecording(input: RecordingSources): ChunkDraft[] {
  const drafts: Draft[] = [];
  if (input.document?.kind === "blocks") drafts.push(...chunkDocumentBlocks(input.document));
  if (input.document?.kind === "markdown") drafts.push(...chunkLegacyMarkdown(input.document));
  if (input.transcript) drafts.push(...chunkTranscript(input.transcript.segments, input.transcript.speakers));
  for (const pdf of input.pdfs ?? []) drafts.push(...chunkPdf(pdf));
  // A document block points at transcript segments by index; give it their start time.
  const segmentStart = new Map((input.transcript?.segments ?? []).map((s) => [s.idx, s.start_ms]));
  for (const d of drafts) {
    if (d.kind !== "document" || d.startMs !== null) continue;
    const ref = d.sources?.find((s) => s.kind === "transcript");
    if (ref?.kind === "transcript") d.startMs = segmentStart.get(ref.start_idx) ?? null;
  }
  return drafts.map((d, ordinal) => {
    const contentSha256 = sha256Hex(embeddingText(d));
    const id = `chk_${sha256Hex([input.workspaceId, input.recordingId, d.kind, d.locator, contentSha256].join("\n")).slice(0, 32)}`;
    return {
      ...d,
      id,
      workspaceId: input.workspaceId,
      recordingId: input.recordingId,
      ordinal,
      contentSha256,
      tokens: estimateTokens(embeddingText(d)),
    };
  });
}

// ---------------------------------------------------------------------------
// Transcript windows
// ---------------------------------------------------------------------------

/**
 * Groups consecutive segments into windows of about `targetTokens`, closing at a speaker
 * change or a pause, never splitting a segment, and always closing at a long time jump
 * (a cut break). Lines are speaker turns: `S1: …`.
 */
export function chunkTranscript(
  segments: readonly SegmentInput[],
  speakers: ReadonlyMap<string, string> = new Map(),
  rules: typeof CHUNK_RULES = CHUNK_RULES,
): Draft[] {
  const sorted = [...segments].filter((s) => s.text.trim() !== "").sort((a, b) => a.idx - b.idx);
  const windows: SegmentInput[][] = [];
  let current: SegmentInput[] = [];
  let tokens = 0;
  for (const seg of sorted) {
    const prev = current.at(-1);
    const segTokens = estimateTokens(seg.text);
    if (prev) {
      const gap = seg.start_ms - prev.end_ms;
      const goodBoundary = (seg.speaker_id ?? null) !== (prev.speaker_id ?? null) || gap >= rules.pauseMs;
      const close =
        gap >= rules.breakMs ||
        tokens >= rules.maxTokens ||
        (tokens >= rules.targetTokens && goodBoundary) ||
        (tokens + segTokens > rules.maxTokens && tokens >= rules.minTokens);
      if (close) {
        windows.push(current);
        current = [];
        tokens = 0;
      }
    }
    current.push(seg);
    tokens += segTokens;
  }
  if (current.length) {
    const last = windows.at(-1);
    const tail = current;
    const tailTokens = tokens;
    const joinable =
      last &&
      tailTokens < rules.minTokens &&
      tail[0]!.start_ms - last.at(-1)!.end_ms < rules.breakMs &&
      last.reduce((n, s) => n + estimateTokens(s.text), 0) + tailTokens <= rules.maxTokens * 1.25;
    if (joinable) last.push(...tail);
    else windows.push(tail);
  }
  return windows.map((w) => transcriptWindow(w, speakers));
}

function transcriptWindow(window: SegmentInput[], speakers: ReadonlyMap<string, string>): Draft {
  let text = "";
  const spans: SegmentSpan[] = [];
  let lastSpeaker: string | null | undefined;
  for (const seg of window) {
    const speaker = seg.speaker_id ?? null;
    if (speaker !== lastSpeaker || text === "") {
      if (text) text += "\n";
      const name = speaker ? (speakers.get(speaker) ?? null) : null;
      if (name) text += `${name}: `;
    } else {
      text += " ";
    }
    lastSpeaker = speaker;
    const body = seg.text.trim();
    spans.push([seg.idx, seg.start_ms, seg.end_ms, text.length, text.length + body.length]);
    text += body;
  }
  const first = window[0]!;
  const last = window.at(-1)!;
  return {
    ...EMPTY,
    kind: "transcript",
    locator: `t:${first.idx}-${last.idx}`,
    heading: null,
    text,
    startIdx: first.idx,
    endIdx: last.idx,
    startMs: first.start_ms,
    endMs: Math.max(...window.map((s) => s.end_ms)),
    spans,
  };
}

// ---------------------------------------------------------------------------
// Document blocks
// ---------------------------------------------------------------------------

const CALLOUT_LABEL: Record<string, string> = { exam: "시험", assignment: "과제", important: "중요", note: "참고" };

type Block = DocumentBody["sections"][number]["blocks"][number];

/** Plain text of a block, or null for blocks that carry no text (gap, unknown types). */
export function blockText(block: Block): string | null {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item, i) => (block.style === "numbered" ? `${i + 1}. ${item.text}` : `- ${item.text}`)).join("\n");
    case "quote":
      return block.speaker ? `"${block.text}" (${block.speaker})` : `"${block.text}"`;
    case "term":
      return `${block.term}: ${block.definition}`;
    case "formula":
      return block.explanation ? `${block.expression}\n${block.explanation}` : block.expression;
    case "callout":
      return `[${CALLOUT_LABEL[block.tone] ?? block.tone}] ${block.text}`;
    default:
      return null; // gap blocks and types this code does not know
  }
}

function blockSources(block: Block): SourceRef[] {
  const sources = [...block.sources];
  if (block.type === "list") for (const item of block.items) sources.push(...item.sources);
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = JSON.stringify(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One chunk per text block; an oversized block is split on line or sentence boundaries. */
export function chunkDocumentBlocks(doc: { documentId: string; version: number; body: DocumentBody }): Draft[] {
  const out: Draft[] = [];
  for (const section of doc.body.sections) {
    for (const block of section.blocks) {
      const text = blockText(block);
      if (!text?.trim()) continue;
      const heading = block.heading ? `${section.title} › ${block.heading}` : section.title;
      const parts = splitText(text, CHUNK_RULES.maxTokens);
      parts.forEach((part, i) => {
        out.push({
          ...EMPTY,
          kind: "document",
          locator: parts.length > 1 ? `d:${block.id}:${i}` : `d:${block.id}`,
          heading,
          text: part,
          documentId: doc.documentId,
          documentVersion: doc.version,
          blockId: block.id,
          sources: blockSources(block),
          startMs: null,
        });
      });
    }
  }
  return out;
}

/** Splits text into pieces of at most `maxTokens`, on lines first, then sentences. */
export function splitText(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const units = text.split(/\n+/).flatMap((line) => (estimateTokens(line) <= maxTokens ? [line] : line.split(/(?<=[.!?。])\s+/)));
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    const joined = current ? `${current}\n${unit}` : unit;
    if (current && estimateTokens(joined) > maxTokens) {
      out.push(current);
      current = unit;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Legacy Markdown documents (v1 lectures migrated as `legacy-markdown`)
// ---------------------------------------------------------------------------

const TIMESTAMP = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/;

/** `[MM:SS]` or `[H:MM:SS]` → ms, as v1 notes write them. */
export function parseTimestampMs(text: string): number | null {
  const m = TIMESTAMP.exec(text);
  if (!m) return null;
  const [h, mm, ss] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  return ((h * 60 + mm) * 60 + ss) * 1000;
}

/**
 * Splits a v1 Markdown note under its headings into chunks of about `targetTokens`.
 * There are no block ids; the first `[MM:SS]` in a chunk gives it an approximate time.
 */
export function chunkLegacyMarkdown(doc: { documentId: string; version: number; markdown: string }): Draft[] {
  const out: Draft[] = [];
  const path: string[] = [];
  let paragraphs: string[] = [];
  const flush = () => {
    const text = paragraphs.join("\n").trim();
    paragraphs = [];
    if (!text) return;
    for (const part of splitText(text, CHUNK_RULES.maxTokens)) {
      out.push({
        ...EMPTY,
        kind: "document",
        locator: `m:${out.length}`,
        heading: path.filter(Boolean).join(" › ") || null,
        text: part,
        documentId: doc.documentId,
        documentVersion: doc.version,
        startMs: parseTimestampMs(part),
        sources: [],
      });
    }
  };
  for (const line of doc.markdown.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      path.length = level - 1;
      path[level - 1] = heading[2]!.trim();
      continue;
    }
    paragraphs.push(line);
    if (estimateTokens(paragraphs.join("\n")) >= CHUNK_RULES.targetTokens && line.trim() === "") flush();
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// PDF pages
// ---------------------------------------------------------------------------

export function chunkPdf(pdf: { assetId: string; pages: ReadonlyArray<{ page: number; text: string }> }): Draft[] {
  const out: Draft[] = [];
  for (const { page, text } of pdf.pages) {
    if (!text.trim()) continue;
    const parts = splitText(text.trim(), CHUNK_RULES.maxTokens);
    parts.forEach((part, i) => {
      out.push({
        ...EMPTY,
        kind: "pdf_page",
        locator: `p:${pdf.assetId}:${page}${parts.length > 1 ? `:${i}` : ""}`,
        heading: `PDF ${page}쪽`,
        text: part,
        assetId: pdf.assetId,
        page,
      });
    });
  }
  return out;
}
