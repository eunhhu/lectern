import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { HarnessError } from "../src/errors.ts";
import { GeminiLlmProvider, geminiResponseSchema, llmSchemaHash } from "../src/gemini-llm.ts";
import type { LlmRequest } from "../src/providers.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeFetch(responses: Array<() => Response>, seen: Captured[]): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return responses[i++]!();
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const answer = (text: string, extra: Record<string, unknown> = {}) =>
  json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    modelVersion: "gemini-3.8-flash",
    responseId: "resp-1",
    ...extra,
  });

const schema = z.object({ a: z.string() });
const request = (over: Partial<LlmRequest<{ a: string }>> = {}): LlmRequest<{ a: string }> => ({
  schema,
  system: "시스템 규칙",
  context: [{ type: "text", text: "#0 [00:00] S1: 본문" }],
  instruction: "지시",
  model: "gemini-3.8-flash",
  maxOutputTokens: 4096,
  ...over,
});

function provider(responses: Array<() => Response>, seen: Captured[], apiKey: () => string | undefined = () => "test-key") {
  return new GeminiLlmProvider({ apiKey, fetch: fakeFetch(responses, seen) });
}

async function failure(promise: Promise<unknown>): Promise<HarnessError> {
  const err = await promise.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(HarnessError);
  return err as HarnessError;
}

describe("GeminiLlmProvider", () => {
  test("request has header key, schema, model", async () => {
    const seen: Captured[] = [];
    await provider([answer('{"a":"x"}')], seen).generate(request());
    const call = seen[0]!;
    expect(call.headers["x-goog-api-key"]).toBe("test-key");
    expect(call.url).not.toContain("test-key");
    expect(call.url.endsWith("/models/gemini-3.8-flash:generateContent")).toBe(true);
    const config = call.body.generationConfig;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema.type).toBe("OBJECT");
    expect(config.thinkingConfig.thinkingLevel).toBe("low");
    expect(config.maxOutputTokens).toBe(4096);
    expect(config.temperature).toBeUndefined();
    expect(call.body.systemInstruction.parts[0].text).toBe("시스템 규칙");
    expect(call.body.contents[0].parts.at(-1).text).toBe("지시");
    expect(call.body.contents[0].parts[0].text).toBe("#0 [00:00] S1: 본문");
  });

  test("converts nullable and const", () => {
    const out = geminiResponseSchema(z.object({ k: z.literal("x"), n: z.string().nullable() })) as any;
    expect(out.properties.k.enum).toEqual(["x"]);
    expect(out.properties.n.nullable).toBe(true);
    expect(out.properties.n.type).toBe("STRING");
    expect(out.propertyOrdering).toEqual(["k", "n"]);
    expect(out.additionalProperties).toBeUndefined();
    expect(out.$schema).toBeUndefined();
  });

  test("converts a nullable object", () => {
    const out = geminiResponseSchema(z.object({ o: z.object({ v: z.int() }).nullable() })) as any;
    expect(out.properties.o.type).toBe("OBJECT");
    expect(out.properties.o.nullable).toBe(true);
    expect(out.properties.o.properties.v.type).toBe("INTEGER");
    expect(out.properties.o.properties.v.minimum).toBeUndefined();
  });

  test("converts a discriminated union to anyOf", () => {
    const out = geminiResponseSchema(
      z.discriminatedUnion("t", [z.object({ t: z.literal("a"), v: z.string() }), z.object({ t: z.literal("b") })])
    ) as any;
    expect(out.anyOf).toHaveLength(2);
    expect(out.anyOf[0].properties.t.enum).toEqual(["a"]);
  });

  test("schema hash is stable", () => {
    expect(llmSchemaHash(schema)).toBe(llmSchemaHash(z.object({ a: z.string() })));
    expect(llmSchemaHash(schema)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("returns value and usage", async () => {
    const result = await provider([answer('{"a":"x"}')], []).generate(request());
    expect(result.value).toEqual({ a: "x" });
    expect(result.usage).toEqual({ inputTokens: 100, cachedTokens: 0, outputTokens: 20 });
    expect(result.requestId).toBe("resp-1");
    expect(result.model).toBe("gemini-3.8-flash");
  });

  test("skips thought parts", async () => {
    const res = json({
      candidates: [
        { content: { parts: [{ thought: true, text: "생각" }, { text: '{"a":"y"}' }] }, finishReason: "STOP" },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    expect((await provider([res], []).generate(request())).value).toEqual({ a: "y" });
  });

  test("empty response", async () => {
    const res = json({
      candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 },
    });
    const err = await failure(provider([res], []).generate(request()));
    expect(err.kind).toBe("output_validation");
    expect(err.code).toBe("empty_response");
    expect(err.billed?.usage.inputTokens).toBe(100);
  });

  test("MAX_TOKENS", async () => {
    const res = json({
      candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 4096 },
    });
    const err = await failure(provider([res], []).generate(request()));
    expect(err.code).toBe("truncated");
    expect(err.billed).toBeDefined();
  });

  test("blocked", async () => {
    const res = json({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 100 } });
    const err = await failure(provider([res], []).generate(request()));
    expect(err.code).toBe("blocked");
  });

  test("not JSON", async () => {
    const err = await failure(provider([answer("abc")], []).generate(request()));
    expect(err.code).toBe("malformed_json");
  });

  test("schema mismatch", async () => {
    const err = await failure(provider([answer('{"b":1}')], []).generate(request()));
    expect(err.kind).toBe("output_validation");
    expect(err.code).toBe("schema");
  });

  test("429 and 503 are transient", async () => {
    const limited = () =>
      new Response(JSON.stringify({ error: { details: [{ retryDelay: "2s" }] } }).replace('"retryDelay":"2s"', '"retryDelay": "2s"'), {
        status: 429,
      });
    const err429 = await failure(provider([limited], []).generate(request()));
    expect(err429.kind).toBe("transient");
    expect(err429.retryAfterMs).toBe(2000);
    const err503 = await failure(provider([() => new Response("unavailable", { status: 503 })], []).generate(request()));
    expect(err503.kind).toBe("transient");
  });

  test("400 is input, 401 is config", async () => {
    const err400 = await failure(provider([() => new Response("bad", { status: 400 })], []).generate(request()));
    expect(err400.kind).toBe("input");
    const err401 = await failure(provider([() => new Response("no", { status: 401 })], []).generate(request()));
    expect(err401.kind).toBe("config");
  });

  test("no key", async () => {
    const seen: Captured[] = [];
    const err = await failure(provider([answer('{"a":"x"}')], seen, () => undefined).generate(request()));
    expect(err.kind).toBe("config");
    expect(seen).toHaveLength(0);
  });

  test("model outside allowlist", async () => {
    const seen: Captured[] = [];
    const err = await failure(provider([answer('{"a":"x"}')], seen).generate(request({ model: "gemini-9-pro" })));
    expect(err.kind).toBe("config");
    expect(err.code).toBe("model_not_allowed");
    expect(seen).toHaveLength(0);
  });

  test("pdf context refused", async () => {
    const seen: Captured[] = [];
    const err = await failure(
      provider([answer('{"a":"x"}')], seen).generate(request({ context: [{ type: "pdf", path: "x" }] }))
    );
    expect(err.kind).toBe("config");
    expect(err.code).toBe("pdf_unsupported");
    expect(seen).toHaveLength(0);
  });
});
