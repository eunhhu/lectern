// Gemini text generation with structured output (LlmProvider), used by the notes stages
// (classify → structure → extract → repair). The request follows the transcription adapter:
// key in the header, pinned model, responseSchema derived from the request's zod schema,
// and every answer validated again with that zod schema.

import { resolveGeminiModel, type GeminiUsageMetadata } from "@lectern/core";
import { z, type ZodType } from "zod";
import { HarnessError } from "./errors.ts";
import {
  GEMINI_API_BASE,
  geminiHttpError,
  geminiKeyOrThrow,
  withDeadline,
  type GeminiAdapterOptions,
} from "./gemini-http.ts";
import { GEMINI_PROVIDER_ID, normalizeGeminiUsage } from "./gemini.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { LlmProvider, LlmRequest, ProviderCallResult } from "./providers.ts";

export interface GeminiLlmOptions extends GeminiAdapterOptions {
  thinkingLevel?: "low" | "medium" | "high";
}

type JsonSchema = Record<string, unknown>;


function upperType(type: string): string {
  return type.toUpperCase();
}

// Only the keys Gemini's responseSchema understands are copied; everything else
// ($schema, additionalProperties, pattern, format, min/max, default, …) is left out.
function convert(node: unknown, defs: Record<string, unknown>, depth: number): JsonSchema {
  if (depth > 64) throw new Error("responseSchema is nested too deeply (recursive schema?)");
  if (!node || typeof node !== "object") return {};
  let source = node as JsonSchema;
  if (typeof source.$ref === "string") {
    const name = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(source.$ref)?.[1];
    const target = name === undefined ? undefined : defs[name];
    if (!target) throw new Error(`responseSchema: unresolved $ref ${source.$ref}`);
    source = { ...(target as JsonSchema), ...source, $ref: undefined };
  }

  const variants = (source.anyOf ?? source.oneOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((v) => (v as JsonSchema)?.type !== "null");
    const hasNull = nonNull.length !== variants.length;
    if (nonNull.length === 1) {
      const inner = convert(nonNull[0], defs, depth + 1);
      if (hasNull) inner.nullable = true;
      if (typeof source.description === "string" && inner.description === undefined) inner.description = source.description;
      return inner;
    }
    const out: JsonSchema = { anyOf: nonNull.map((v) => convert(v, defs, depth + 1)) };
    if (hasNull) out.nullable = true;
    if (typeof source.description === "string") out.description = source.description;
    return out;
  }

  const out: JsonSchema = {};
  if (Array.isArray(source.type)) {
    const types = (source.type as string[]).filter((t) => t !== "null");
    if (types.length !== source.type.length) out.nullable = true;
    if (types[0]) out.type = upperType(types[0]);
  } else if (typeof source.type === "string") {
    out.type = upperType(source.type);
  }
  if ("const" in source) {
    out.enum = [source.const];
    if (out.type === undefined) out.type = typeof source.const === "number" ? "NUMBER" : "STRING";
  }
  if (Array.isArray(source.enum)) out.enum = [...(source.enum as unknown[])];
  if (typeof source.description === "string") out.description = source.description;
  if (source.properties && typeof source.properties === "object") {
    const properties: JsonSchema = {};
    const ordering: string[] = [];
    for (const [key, value] of Object.entries(source.properties as JsonSchema)) {
      properties[key] = convert(value, defs, depth + 1);
      ordering.push(key);
    }
    out.properties = properties;
    out.propertyOrdering = ordering;
  }
  if (Array.isArray(source.required)) out.required = [...(source.required as string[])];
  if (source.items !== undefined) out.items = convert(source.items, defs, depth + 1);
  if (typeof source.minItems === "number") out.minItems = source.minItems;
  if (typeof source.maxItems === "number") out.maxItems = source.maxItems;
  return out;
}

/**
 * The zod schema as a Gemini responseSchema (the OpenAPI subset generateContent takes).
 * Unlike toGeminiSchema (gemini-ask.ts) it keeps unions (`anyOf`), literals (`enum`) and
 * nullability, which structured note output needs. Answers are re-validated with zod.
 */
export function geminiResponseSchema(schema: ZodType): unknown {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" }) as JsonSchema;
  const defs = { ...((json.$defs as Record<string, unknown>) ?? {}), ...((json.definitions as Record<string, unknown>) ?? {}) };
  return convert(json, defs, 0);
}

export function llmSchemaHash(schema: ZodType): string {
  return sha256Hex(canonicalJson(geminiResponseSchema(schema)));
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

export class GeminiLlmProvider implements LlmProvider {
  readonly id = GEMINI_PROVIDER_ID;
  private readonly thinkingLevel: "low" | "medium" | "high";

  constructor(private readonly opts: GeminiLlmOptions) {
    this.thinkingLevel = opts.thinkingLevel ?? "low";
  }

  requestBody<T>(req: LlmRequest<T>): Record<string, unknown> {
    const parts: Array<{ text: string }> = [];
    for (const part of req.context) {
      if (part.type === "pdf") {
        throw new HarnessError("config", "PDF context is not supported yet", { code: "pdf_unsupported" });
      }
      parts.push({ text: part.text });
    }
    parts.push({ text: req.instruction });
    // req.cacheKey is not used yet: explicit context caching comes with the cost work (AI_HARNESS §6).
    return {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema(req.schema),
        thinkingConfig: { thinkingLevel: this.thinkingLevel },
        maxOutputTokens: req.maxOutputTokens,
      },
    };
  }

  async generate<T>(req: LlmRequest<T>): Promise<{ value: T; raw: unknown } & ProviderCallResult> {
    const model = req.model;
    if (resolveGeminiModel(model) !== model) {
      throw new HarnessError("config", `model ${model} is not in the Gemini allowlist`, { code: "model_not_allowed" });
    }
    const key = geminiKeyOrThrow(this.opts);
    const body = this.requestBody(req);
    const started = Date.now();
    const res = await (this.opts.fetch ?? fetch)(
      `${this.opts.baseUrl ?? GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: withDeadline(req.signal, this.opts.timeoutMs ?? 300_000),
      }
    );
    if (!res.ok) throw await geminiHttpError(res);
    const data = (await res.json()) as GeminiResponse;
    const billed: ProviderCallResult = {
      usage: normalizeGeminiUsage(data.usageMetadata),
      model: data.modelVersion ?? model,
      requestId: data.responseId ?? null,
      latencyMs: Date.now() - started,
    };
    const reject = (code: string, message: string) =>
      new HarnessError("output_validation", `Gemini generation: ${message}`, { code, billed });

    if (data.promptFeedback?.blockReason) throw reject("blocked", `request blocked (${data.promptFeedback.blockReason})`);
    const candidate = data.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish === "MAX_TOKENS") throw reject("truncated", "output hit maxOutputTokens");
    if (finish && finish !== "STOP") throw reject("finish_reason", `finished with ${finish}`);
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    if (!text) throw reject("empty_response", "empty response");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw reject("malformed_json", "response is not JSON");
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw reject("schema", `response does not match the schema: ${parsed.error.message.slice(0, 200)}`);
    return { value: parsed.data, raw: json, ...billed };
  }
}
