// Provider abstraction (AI_HARNESS §5). Types only for now: the one implemented provider
// is the legacy Gemini distillation (gemini.ts). Transcription and LLM adapters arrive with
// their stages (§11 steps 3 and 5); a provider is registered only on a paid tier whose
// inputs are not used for training (§5, data policy).

import type { TranscribeResult } from "@lectern/domain";
import type { ZodType } from "zod";

/**
 * Normalized token usage of one call, the unit the cost ledger prices.
 * `inputTokens` excludes cache hits, which are counted in `cachedTokens` and priced at the
 * cache-read rate; `outputTokens` includes reasoning/thinking tokens.
 */
export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Audio length sent, for per-minute STT pricing and reporting. */
  audioSeconds?: number;
}

export const ZERO_USAGE: Usage = Object.freeze({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 });

/** What every provider call returns besides its value; StageContext.meter records it. */
export interface ProviderCallResult {
  usage: Usage;
  /** The model version the provider reports serving (e.g. Gemini `modelVersion`). */
  model?: string;
  requestId?: string | null;
  /** Provider-side latency when the adapter can measure it more precisely than the wrapper. */
  latencyMs?: number;
}

/**
 * One chunk of normalized audio, as packages/media's `chunk` step will produce it.
 * Assumed shape until that package lands; replace with its exported type then.
 */
export interface AudioChunk {
  index: number;
  path: string;
  mimeType: string;
  sha256: string;
  /** Position in cut-audio time (see speech_map, §3.2). */
  startMs: number;
  endMs: number;
}

export interface TranscriptionProvider {
  /** "gemini", "stt-x" */
  id: string;
  maxChunkSeconds: number;
  transcribe(
    chunk: AudioChunk,
    opts: { language?: string; speakersHint?: number; signal?: AbortSignal }
  ): Promise<TranscribeResult & ProviderCallResult>;
}

export type ContextPart =
  | { type: "text"; text: string }
  | { type: "pdf"; path: string; pages?: number[] };

export interface LlmRequest<T> {
  /** Structured output is enforced with this schema. */
  schema: ZodType<T>;
  /** Fixed (cacheable) prefix. */
  system: string;
  /** Transcript, PDF page text, or native PDF where supported. */
  context: ContextPart[];
  /** Per-stage instruction (variable, after the cached prefix). */
  instruction: string;
  model: string;
  /** Shares a cached prefix across stages of one recording. */
  cacheKey?: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  id: string;
  generate<T>(req: LlmRequest<T>): Promise<{ value: T; raw: unknown } & ProviderCallResult>;
}
