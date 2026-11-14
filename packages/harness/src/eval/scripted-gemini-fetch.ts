// A scripted stand-in for `fetch` at the Gemini HTTP boundary (P3-07). Tests hand it to
// the real adapters (GeminiAskModel and friends) so request bodies, thought-signature
// replay and SSE parsing run through production code. Each request plays the next step
// as one streamGenerateContent SSE chunk; anything that is not a Gemini URL throws, so a
// test can never reach the network.

import { GEMINI_API_BASE } from "../gemini-http.ts";

export interface ScriptedGeminiTurn {
  /** Response parts: text and functionCall parts, `thoughtSignature` allowed. */
  parts: Array<Record<string, unknown>>;
  usage?: { promptTokenCount: number; candidatesTokenCount: number; cachedContentTokenCount?: number };
  /** Default "STOP". */
  finishReason?: string;
  responseId?: string;
}

/** A fixed turn, or a function of the parsed request body that may answer with its own Response. */
export type ScriptedGeminiStep = ScriptedGeminiTurn | ((body: any, index: number) => ScriptedGeminiTurn | Response);

export interface SeenGeminiRequest {
  url: string;
  /** Lowercase header names. */
  headers: Record<string, string>;
  body: any;
}

const DEFAULT_USAGE = { promptTokenCount: 1000, candidatesTokenCount: 50 };

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * A `fetch` that answers the n-th Gemini request with `steps[n]` and records every
 * request in `seen`. Throws for a non-Gemini URL and for a request past the last step.
 */
export function scriptedGeminiFetch(steps: ScriptedGeminiStep[], seen: SeenGeminiRequest[] = []): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    if (!url.startsWith(GEMINI_API_BASE)) throw new Error(`unexpected outbound request: ${url}`);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    const at = index++;
    const step = steps[at];
    if (!step) throw new Error("unexpected extra Gemini request");
    const turn = typeof step === "function" ? step(body, at) : step;
    if (turn instanceof Response) return turn;
    const chunk = {
      candidates: [{ content: { role: "model", parts: turn.parts }, finishReason: turn.finishReason ?? "STOP" }],
      usageMetadata: turn.usage ?? DEFAULT_USAGE,
      ...(turn.responseId ? { responseId: turn.responseId } : {}),
    };
    return new Response(`data: ${JSON.stringify(chunk)}\r\n\r\n`, { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

export const textPart = (text: string): Record<string, unknown> => ({ text });

export const functionCallPart = (
  name: string,
  args: unknown,
  opts: { id?: string; thoughtSignature?: string } = {},
): Record<string, unknown> => ({
  functionCall: { ...(opts.id ? { id: opts.id } : {}), name, args },
  ...(opts.thoughtSignature ? { thoughtSignature: opts.thoughtSignature } : {}),
});
