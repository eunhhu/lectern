// Gemini: error classification and usage normalization for the existing packages/core
// path, plus the one provider adapter implemented so far, which wraps
// distillLectureAudio() unchanged (AI_HARNESS §11 step 1).

import {
  distillLectureAudio,
  type DistillationResult,
  type DistillOptions,
  type GeminiUsageMetadata,
  type ProgressEvent,
} from "@lectern/core";
import { classifyHttpStatus, HarnessError } from "./errors.ts";
import type { ProviderCallResult, Usage } from "./providers.ts";

export const GEMINI_PROVIDER_ID = "gemini";

/**
 * Failure class of an error from the packages/core Gemini path. Configuration problems,
 * silent recordings, unreadable audio and 4xx answers fail the same way every time;
 * network errors, timeouts, 408, 429 and 5xx are worth another attempt. 429 bodies carry
 * RetryInfo (`"retryDelay": "17s"`), which becomes retryAfterMs.
 */
export function classifyGeminiError(err: unknown): HarnessError {
  if (err instanceof HarnessError) return err;
  const message = String((err as { message?: unknown })?.message ?? err ?? "");
  const make = (kind: HarnessError["kind"], retryAfterMs?: number) =>
    new HarnessError(kind, message, { cause: err, retryAfterMs });

  if (message.includes("GEMINI_API_KEY is not configured")) return make("config");
  if (
    message.includes("음성 신호가 감지되지 않았습니다") ||
    message.includes("Audio file not found") ||
    message.includes("ffmpeg transcoding failed") ||
    // Gemini rejected this file itself; uploading it again ends the same way.
    message.includes("did not reach ACTIVE state (state=FAILED)")
  ) {
    return make("input");
  }
  const status = message.match(/\((\d{3})\)/);
  if (status) {
    const kind = classifyHttpStatus(Number(status[1]));
    const delay = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    return make(kind, kind === "transient" && delay ? Math.ceil(Number(delay[1]) * 1000) : undefined);
  }
  return make("transient");
}

/** Gemini usageMetadata → ledger Usage. Cached tokens are part of promptTokenCount there. */
export function normalizeGeminiUsage(meta: GeminiUsageMetadata | undefined, audioSeconds?: number): Usage {
  const prompt = meta?.promptTokenCount ?? 0;
  const cached = Math.min(prompt, meta?.cachedContentTokenCount ?? 0);
  return {
    inputTokens: prompt - cached,
    cachedTokens: cached,
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    audioSeconds,
  };
}

export interface LegacyDistillRequest {
  audioPath: string;
  courseName: string;
  /** Pinned model id (already resolved against the allowlist). */
  model: string;
  /** A user-supplied key, or undefined for the server key. Never recorded anywhere. */
  apiKey?: string;
  onProgress?: (ev: ProgressEvent) => void;
}

/** The single-call "audio in, Markdown out" path that predates the staged pipeline. */
export interface LegacyDistillProvider {
  readonly id: string;
  distill(req: LegacyDistillRequest): Promise<{ result: DistillationResult } & ProviderCallResult>;
}

/**
 * The existing Gemini path behind the provider interface. `distill` is a parameter so a
 * test can substitute recorded responses; production uses distillLectureAudio.
 */
export function geminiLegacyDistillProvider(
  distill: (opts: DistillOptions) => Promise<DistillationResult> = distillLectureAudio
): LegacyDistillProvider {
  return {
    id: GEMINI_PROVIDER_ID,
    async distill(req) {
      let result: DistillationResult;
      try {
        result = await distill({
          audioPath: req.audioPath,
          courseName: req.courseName,
          model: req.model,
          apiKey: req.apiKey,
          onProgress: req.onProgress,
        });
      } catch (err) {
        throw classifyGeminiError(err);
      }
      return {
        result,
        usage: normalizeGeminiUsage(result.usage, result.durationSec),
        model: result.modelUsed,
        requestId: result.requestId ?? null,
        latencyMs: result.generateMs,
      };
    },
  };
}
