// Gemini adapters for 물어보기 (docs/adr/0009-ask-rag.md, AI_HARNESS §12): a streaming
// chat model with function calling (`AskModel`) and the embedding model (`Embedder`),
// both over the REST API with fetch, like packages/core.
//
// - The key goes in the `x-goog-api-key` header, never the URL, so it cannot end up in a
//   log line. It is read when a call is made (readSecret), not when the adapter is built.
// - A function-calling turn is replayed in the next request exactly as received: Gemini
//   attaches thought signatures to the model's parts and answers MISSING_THOUGHT_SIGNATURE
//   without them. The adapter keeps the raw parts in the `done` event's `turn`.
// - Embedding responses carry no token counts, so embedding usage is estimated with the
//   same estimator the context budget uses; the ledger row is then an estimate.

import type { AskModel, AskModelEvent, AskModelRequest, Embedder, EmbeddingResult, ToolSpec } from "@lectern/ask";
import { estimateTokens } from "@lectern/ask";
import type { GeminiUsageMetadata } from "@lectern/core";
import { HarnessError } from "./errors.ts";
import {
  GEMINI_API_BASE,
  geminiHttpError as httpError,
  geminiKeyOrThrow as keyOrThrow,
  withDeadline,
  type GeminiAdapterOptions,
} from "./gemini-http.ts";
import { GEMINI_PROVIDER_ID, normalizeGeminiUsage } from "./gemini.ts";

/** Pinned model ids for ask (ADR-0009 §5, §8; ROADMAP D13). */
export const ASK_ANSWER_MODEL = "gemini-3.5-flash-lite";
export const ASK_EMBEDDING_MODEL = "gemini-embedding-2";
export const ASK_EMBEDDING_DIM = 768;

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiChunk {
  candidates?: Array<{ content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

// ---------------------------------------------------------------------------
// Function declarations
// ---------------------------------------------------------------------------

const SCHEMA_KEYS = new Set(["type", "description", "properties", "required", "enum", "items", "nullable"]);

/**
 * JSON Schema (as zod emits it) → the OpenAPI subset `functionDeclarations[].parameters`
 * takes: keeps type, description, properties, required, enum and items; drops `$schema`,
 * `additionalProperties`, `pattern`, `format` and the like.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function declarations(tools: readonly ToolSpec[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.parameters),
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Chat model
// ---------------------------------------------------------------------------

/** The streamGenerateContent request body for one ask round. */
export function askRequestBody(req: AskModelRequest): Record<string, unknown> {
  const contents: unknown[] = [{ role: "user", parts: [{ text: req.context }, { text: req.instruction }] }];
  for (const exchange of req.exchanges) {
    const modelParts: GeminiPart[] =
      (exchange.modelTurn as GeminiPart[] | undefined) ??
      exchange.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }));
    // Answer each call in order, echoing the id Gemini gave it (ids the adapter made up
    // for calls without one are not sent back).
    const callParts = modelParts.filter((p) => p.functionCall);
    contents.push({ role: "model", parts: modelParts });
    contents.push({
      role: "user",
      parts: exchange.results.map((r, i) => {
        const id = callParts[i]?.functionCall?.id;
        return { functionResponse: { ...(id ? { id } : {}), name: r.name, response: { result: r.output } } };
      }),
    });
  }
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    ...(req.tools.length ? { tools: declarations(req.tools), toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
    // Temperature stays at the model default: Gemini 3 guidance advises against lowering it.
    generationConfig: { maxOutputTokens: req.maxOutputTokens },
  };
}

function finishOf(reason: string | undefined, sawCall: boolean, blocked: boolean): Extract<AskModelEvent, { type: "done" }>["finish"] {
  if (blocked) return "refusal";
  if (sawCall) return "tool_calls";
  switch (reason) {
    case undefined:
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "refusal";
    default:
      return "error"; // MALFORMED_FUNCTION_CALL, MISSING_THOUGHT_SIGNATURE, OTHER, ...
  }
}

/** Server-sent `data:` payloads of a streamGenerateContent?alt=sse response. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
  const tail = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (tail) yield tail;
}

export class GeminiAskModel implements AskModel {
  readonly provider = GEMINI_PROVIDER_ID;

  constructor(
    readonly model: string,
    private opts: GeminiAdapterOptions,
  ) {}

  async *stream(req: AskModelRequest): AsyncIterable<AskModelEvent> {
    const key = keyOrThrow(this.opts);
    const doFetch = this.opts.fetch ?? fetch;
    const res = await doFetch(
      `${this.opts.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(askRequestBody(req)),
        signal: withDeadline(req.signal, this.opts.timeoutMs ?? 120_000),
      },
    );
    if (!res.ok || !res.body) throw await httpError(res);

    const turn: GeminiPart[] = [];
    let usage: GeminiUsageMetadata | undefined;
    let finishReason: string | undefined;
    let requestId: string | null = null;
    let sawCall = false;
    let blocked = false;
    let calls = 0;
    for await (const data of sseData(res.body)) {
      const chunk = JSON.parse(data) as GeminiChunk;
      if (chunk.promptFeedback?.blockReason) blocked = true;
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (chunk.responseId) requestId = chunk.responseId;
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        turn.push(part);
        if (part.functionCall) {
          sawCall = true;
          calls++;
          yield {
            type: "tool_call",
            id: part.functionCall.id ?? `call_${calls}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          };
        } else if (typeof part.text === "string" && part.text && !part.thought) {
          yield { type: "text", text: part.text };
        }
      }
    }
    yield {
      type: "done",
      usage: normalizeGeminiUsage(usage),
      finish: finishOf(finishReason, sawCall, blocked),
      requestId,
      turn,
    };
  }
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * gemini-embedding-2 takes no task type; the query/document role is a text prefix
 * (ai.google.dev/gemini-api/docs/embeddings). Chunk headings are already in the text.
 */
export function embeddingInput(text: string, purpose: "document" | "query"): string {
  return purpose === "query" ? `task: question answering | query: ${text}` : `title: none | text: ${text}`;
}

export class GeminiEmbedder implements Embedder {
  readonly provider = GEMINI_PROVIDER_ID;

  constructor(
    readonly model: string,
    readonly dim: number,
    private opts: GeminiAdapterOptions,
  ) {}

  async embed(texts: readonly string[], purpose: "document" | "query", signal?: AbortSignal): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], inputTokens: 0 };
    const key = keyOrThrow(this.opts);
    const inputs = texts.map((t) => embeddingInput(t, purpose));
    const res = await (this.opts.fetch ?? fetch)(
      `${this.opts.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          requests: inputs.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dim,
          })),
        }),
        signal: withDeadline(signal, this.opts.timeoutMs ?? 60_000),
      },
    );
    if (!res.ok) throw await httpError(res);
    const body = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
    const vectors = (body.embeddings ?? []).map((e) => Float32Array.from(e.values ?? []));
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== this.dim)) {
      throw new HarnessError("output_validation", `Gemini returned ${vectors.length} embeddings of the wrong size`);
    }
    return { vectors, inputTokens: inputs.reduce((n, t) => n + estimateTokens(t), 0) };
  }
}
