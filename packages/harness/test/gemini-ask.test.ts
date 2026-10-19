import { describe, expect, test } from "bun:test";
import { type AskModelEvent, type AskModelRequest, askTools } from "@lectern/ask";
import {
  askRequestBody,
  embeddingInput,
  GeminiAskModel,
  GeminiEmbedder,
  HarnessError,
  sseData,
  toGeminiSchema,
} from "../src/index.ts";

// Response bodies follow the documented REST shapes (ai.google.dev/api/generate-content,
// /gemini-api/docs/embeddings). No request leaves the process.

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

const sse = (...chunks: unknown[]) => () =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const request = (over: Partial<AskModelRequest> = {}): AskModelRequest => ({
  system: "규칙",
  context: "노트 조각:\n\n[c1] ECB는 위험",
  instruction: "질문: ECB가 왜 위험해?",
  exchanges: [],
  tools: [],
  maxOutputTokens: 700,
  ...over,
});

async function collect(stream: AsyncIterable<AskModelEvent>): Promise<AskModelEvent[]> {
  const out: AskModelEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const key = () => "test-key";

describe("GeminiAskModel", () => {
  test("streams text, skips thought parts, and normalizes usage", async () => {
    const seen: Captured[] = [];
    const model = new GeminiAskModel("gemini-3.5-flash-lite", {
      apiKey: key,
      fetch: fakeFetch(
        [
          sse(
            { candidates: [{ content: { role: "model", parts: [{ text: "생각 중", thought: true }, { text: "패턴이 드러나서 " }] } }], responseId: "resp_1" },
            {
              candidates: [{ content: { role: "model", parts: [{ text: "위험합니다 [c1]." }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 4000, cachedContentTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 30 },
              modelVersion: "gemini-3.5-flash-lite",
            },
          ),
        ],
        seen,
      ),
    });
    const events = await collect(model.stream(request()));
    expect(events.filter((e) => e.type === "text").map((e) => e.type === "text" && e.text)).toEqual(["패턴이 드러나서 ", "위험합니다 [c1]."]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      finish: "stop",
      requestId: "resp_1",
      usage: { inputTokens: 3000, cachedTokens: 1000, outputTokens: 230 },
    });
    expect(seen[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    expect(seen[0]!.url).not.toContain("key=");
    expect(seen[0]!.headers["x-goog-api-key"]).toBe("test-key");
    expect(seen[0]!.body).toEqual({
      systemInstruction: { parts: [{ text: "규칙" }] },
      contents: [{ role: "user", parts: [{ text: "노트 조각:\n\n[c1] ECB는 위험" }, { text: "질문: ECB가 왜 위험해?" }] }],
      generationConfig: { maxOutputTokens: 700 },
    });
  });

  test("a function call is reported and its turn replayed with the thought signature", async () => {
    const seen: Captured[] = [];
    const callPart = { functionCall: { id: "fc_7", name: "search_notes", args: { query: "QA 일정" } }, thoughtSignature: "c2lnbmF0dXJl" };
    const model = new GeminiAskModel("gemini-3.5-flash-lite", {
      apiKey: key,
      fetch: fakeFetch(
        [
          sse({
            candidates: [{ content: { role: "model", parts: [callPart] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 20 },
          }),
        ],
        seen,
      ),
    });
    const tools = askTools(false);
    const events = await collect(model.stream(request({ tools })));
    expect(events[0]).toEqual({ type: "tool_call", id: "fc_7", name: "search_notes", args: { query: "QA 일정" } });
    const done = events.at(-1) as Extract<AskModelEvent, { type: "done" }>;
    expect(done.finish).toBe("tool_calls");
    expect(seen[0]!.body.tools[0].functionDeclarations.map((d: any) => d.name)).toEqual(["search_notes", "read_more"]);
    expect(seen[0]!.body.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });

    const next = askRequestBody(
      request({
        tools,
        exchanges: [
          {
            calls: [{ id: "fc_7", name: "search_notes", args: { query: "QA 일정" } }],
            results: [{ id: "fc_7", name: "search_notes", output: "[c2] QA를 일주일 당긴다" }],
            modelTurn: done.turn,
          },
        ],
      }),
    );
    expect((next.contents as any[])[1]).toEqual({ role: "model", parts: [callPart] });
    expect((next.contents as any[])[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { id: "fc_7", name: "search_notes", response: { result: "[c2] QA를 일주일 당긴다" } } }],
    });
  });

  test("HTTP errors carry their failure class; a missing key is a config error", async () => {
    const make = (res: () => Response) =>
      new GeminiAskModel("gemini-3.5-flash-lite", { apiKey: key, fetch: fakeFetch([res], []) });
    const quota = make(() => new Response('{"error":{"details":[{"retryDelay":"17s"}]}}', { status: 429 }));
    const err = await collect(quota.stream(request())).catch((e) => e);
    expect(err).toBeInstanceOf(HarnessError);
    expect(err).toMatchObject({ kind: "transient", retryAfterMs: 17_000 });
    const bad = make(() => new Response("bad", { status: 400 }));
    expect(await collect(bad.stream(request())).catch((e) => e.kind)).toBe("input");
    const noKey = new GeminiAskModel("gemini-3.5-flash-lite", { apiKey: () => undefined, fetch: fakeFetch([], []) });
    expect(await collect(noKey.stream(request())).catch((e) => e.kind)).toBe("config");
  });

  test("blocked prompts and odd finish reasons are not reported as normal answers", async () => {
    const run = async (chunk: unknown) =>
      (await collect(new GeminiAskModel("m", { apiKey: key, fetch: fakeFetch([sse(chunk)], []) }).stream(request()))).at(-1);
    expect(await run({ promptFeedback: { blockReason: "SAFETY" } })).toMatchObject({ finish: "refusal" });
    expect(await run({ candidates: [{ content: { parts: [{ text: "…" }] }, finishReason: "MAX_TOKENS" }] })).toMatchObject({ finish: "length" });
    expect(await run({ candidates: [{ finishReason: "MISSING_THOUGHT_SIGNATURE" }] })).toMatchObject({ finish: "error" });
  });
});

describe("SSE parsing", () => {
  test("handles CRLF framing and events split across network chunks", async () => {
    const text = 'data: {"a":1}\r\n\r\ndata: {"b":\ndata: 2}\n\n';
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const piece of [text.slice(0, 7), text.slice(7, 20), text.slice(20)]) c.enqueue(encoder.encode(piece));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const d of sseData(body)) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":\n2}']);
  });
});

describe("tool schemas", () => {
  test("only the OpenAPI subset Gemini accepts is kept", () => {
    const params = askTools(true).find((t) => t.name === "list_items")!.parameters;
    expect(params).toHaveProperty("$schema");
    const clean = toGeminiSchema(params) as any;
    expect(clean).not.toHaveProperty("$schema");
    expect(clean).not.toHaveProperty("additionalProperties");
    expect(clean.properties.kind.enum).toEqual(["events", "action_items"]);
    expect(clean.properties.from).not.toHaveProperty("format");
    expect(clean.properties.from).not.toHaveProperty("pattern");
  });
});

describe("GeminiEmbedder", () => {
  test("sends one batch with role prefixes and 768 dimensions", async () => {
    const seen: Captured[] = [];
    const vec = (x: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? x : 0));
    const embedder = new GeminiEmbedder("gemini-embedding-2", 768, {
      apiKey: key,
      fetch: fakeFetch([() => Response.json({ embeddings: [{ values: vec(1) }, { values: vec(0.5) }] })], seen),
    });
    const res = await embedder.embed(["시험 범위는 운영 모드까지", "CBC"], "document");
    expect(res.vectors.map((v) => v[0])).toEqual([1, 0.5]);
    expect(res.inputTokens).toBeGreaterThan(0);
    expect(seen[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents");
    expect(seen[0]!.body.requests[0]).toEqual({
      model: "models/gemini-embedding-2",
      content: { parts: [{ text: "title: none | text: 시험 범위는 운영 모드까지" }] },
      outputDimensionality: 768,
    });
    expect(embeddingInput("ECB?", "query")).toBe("task: question answering | query: ECB?");
  });

  test("a wrong number or size of vectors is an output error", async () => {
    const embedder = new GeminiEmbedder("gemini-embedding-2", 768, {
      apiKey: key,
      fetch: fakeFetch([() => Response.json({ embeddings: [{ values: [1, 2, 3] }] })], []),
    });
    expect(await embedder.embed(["a"], "query").catch((e) => e.kind)).toBe("output_validation");
    expect(await embedder.embed([], "query")).toEqual({ vectors: [], inputTokens: 0 });
  });
});
