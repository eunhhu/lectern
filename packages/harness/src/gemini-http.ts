// REST plumbing shared by the Gemini adapters (gemini-ask.ts, gemini-transcribe.ts).
//
// - The key goes in the `x-goog-api-key` header, never the URL, so it cannot end up in a
//   log line. It is read when a call is made, not when the adapter is built.
// - HTTP failures become HarnessErrors by status (classifyHttpStatus); a 429 body's
//   RetryInfo (`"retryDelay": "17s"`) becomes retryAfterMs.

import { classifyHttpStatus, HarnessError } from "./errors.ts";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiAdapterOptions {
  /** Returns the API key at call time (undefined: not configured). */
  apiKey: () => string | undefined;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Whole-call deadline. */
  timeoutMs?: number;
}

export function geminiKeyOrThrow(opts: GeminiAdapterOptions): string {
  const key = opts.apiKey();
  if (!key) throw new HarnessError("config", "GEMINI_API_KEY is not configured");
  return key;
}

export async function geminiHttpError(res: Response): Promise<HarnessError> {
  const body = await res.text().catch(() => "");
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  const kind = classifyHttpStatus(res.status);
  return new HarnessError(kind, `Gemini request failed (${res.status}): ${body.slice(0, 300)}`, {
    retryAfterMs: kind === "transient" && delay ? Math.ceil(Number(delay[1]) * 1000) : undefined,
  });
}

export function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
