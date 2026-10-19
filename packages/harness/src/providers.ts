// Provider abstraction (AI_HARNESS §5). Implemented so far: the legacy Gemini distillation
// (gemini.ts), Gemini audio transcription (gemini-transcribe.ts) and the ask adapters
// (gemini-ask.ts). LLM text adapters arrive with their stages (§11 step 5). A provider is
// registered only on a paid tier whose inputs are not used for training (§5, data policy).

import type { TranscribeResult } from "@lectern/domain";
import type { RenderedChunk } from "@lectern/media";
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

export interface TranscribeOptions {
  /** BCP 47 hint (`ko`); the provider transcribes what it hears either way. */
  language?: string;
  speakersHint?: number;
  signal?: AbortSignal;
  /** Set on a repair attempt: why the previous answer was rejected (StageContext.repair). */
  repair?: { issues: string } | null;
}

export interface TranscriptionProvider {
  /** "gemini", "stt-x" */
  id: string;
  /** Pinned model id: part of the memo key, and what `ai_call.model` holds. */
  model: string;
  /** Longest chunk the provider takes; the pipeline plans chunks within it. */
  maxChunkSeconds: number;
  /**
   * Everything besides the audio and the options that decides the answer, for the memo key
   * (§4.4): the prompt file's content hash and the request parameters (schema hash, ...).
   */
  readonly fingerprint: { prompt: string; params: unknown };
  /**
   * Transcribes one chunk. Times in the result are chunk-relative cut-audio time
   * (domain TranscribeSegment). A billed answer that is unusable throws a HarnessError
   * carrying `billed`, so the ledger still records it.
   */
  transcribe(chunk: RenderedChunk, opts: TranscribeOptions): Promise<TranscribeResult & ProviderCallResult>;
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
