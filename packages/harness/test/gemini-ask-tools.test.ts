// The Gemini ask adapter's tool round trip (P3-07, D-P3-6) against scriptedGeminiFetch:
// function-call turns are replayed byte for byte with their thought signatures, each call
// is answered with its own id in order, tools are declared only when offered, and the fake
// refuses non-Gemini URLs and requests past its script. No network.

import { describe, expect, test } from "bun:test";
import { type AskModelEvent, type AskModelRequest, askTools, type ToolExchange } from "@lectern/ask";
import { functionCallPart, GeminiAskModel, scriptedGeminiFetch, type ScriptedGeminiStep, type SeenGeminiRequest, textPart } from "../src/index.ts";

const request = (over: Partial<AskModelRequest> = {}): AskModelRequest => ({
  system: "규칙",
  context: "노트 조각:\n\n[c1] QA 일정은 회의에서 정했다",
  instruction: "질문: QA 일정은?",
  exchanges: [],
  tools: askTools(false),
  maxOutputTokens: 700,
  ...over,
});

async function collect(stream: AsyncIterable<AskModelEvent>): Promise<AskModelEvent[]> {
  const out: AskModelEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function model(steps: ScriptedGeminiStep[], seen: SeenGeminiRequest[] = []) {
  return new GeminiAskModel("gemini-3.5-flash-lite", { apiKey: () => "test-key", fetch: scriptedGeminiFetch(steps, seen) });
}

const doneOf = (events: AskModelEvent[]) => events.find((e): e is Extract<AskModelEvent, { type: "done" }> => e.type === "done")!;
const callsOf = (events: AskModelEvent[]) =>
  events.filter((e): e is Extract<AskModelEvent, { type: "tool_call" }> => e.type === "tool_call").map(({ id, name, args }) => ({ id, name, args }));

/** The exchange the runner would build from one round's events. */
function exchangeOf(events: AskModelEvent[], outputs: string[]): ToolExchange {
  const calls = callsOf(events);
  return { calls, results: calls.map((c, i) => ({ id: c.id, name: c.name, output: outputs[i]! })), modelTurn: doneOf(events).turn };
}

describe("Gemini ask tool round trip", () => {
  test("signature survives two rounds", async () => {
    const seen: SeenGeminiRequest[] = [];
    const first = functionCallPart("search_notes", { query: "QA" }, { id: "fc1", thoughtSignature: "c2lnMQ==" });
    const second = functionCallPart("read_more", { label: "c1", direction: "after" }, { id: "fc2", thoughtSignature: "c2lnMg==" });
    const m = model([{ parts: [first] }, { parts: [second] }, { parts: [textPart("QA는 일주일 당겼습니다 [c2].")] }], seen);

    const round1 = await collect(m.stream(request()));
    const ex1 = exchangeOf(round1, ["[c2] QA를 일주일 당기기로 했다"]);
    const round2 = await collect(m.stream(request({ exchanges: [ex1] })));
    const ex2 = exchangeOf(round2, ["[c3] 출시일은 11월 3일"]);
    const round3 = await collect(m.stream(request({ exchanges: [ex1, ex2] })));
    expect(doneOf(round3).finish).toBe("stop");

    const contents = seen[2]!.body.contents;
    expect(contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(contents[1].parts).toEqual([first]);
    expect(contents[2].parts).toEqual([{ functionResponse: { id: "fc1", name: "search_notes", response: { result: "[c2] QA를 일주일 당기기로 했다" } } }]);
    expect(contents[3].parts).toEqual([second]);
    expect(contents[4].parts).toEqual([{ functionResponse: { id: "fc2", name: "read_more", response: { result: "[c3] 출시일은 11월 3일" } } }]);
    expect(contents[1].parts[0].thoughtSignature).toBe("c2lnMQ==");
    expect(contents[3].parts[0].thoughtSignature).toBe("c2lnMg==");
  });

  test("parallel calls", async () => {
    const seen: SeenGeminiRequest[] = [];
    const m = model(
      [
        { parts: [functionCallPart("search_notes", { query: "QA" }, { id: "a" }), functionCallPart("search_notes", { query: "출시" }, { id: "b" })] },
        { parts: [textPart("끝")] },
      ],
      seen,
    );
    const round1 = await collect(m.stream(request()));
    expect(callsOf(round1).map((c) => c.id)).toEqual(["a", "b"]);
    expect(doneOf(round1).finish).toBe("tool_calls");
    await collect(m.stream(request({ exchanges: [exchangeOf(round1, ["결과 없음", "[c2] 출시일"])] })));
    const answers = seen[1]!.body.contents[2].parts.map((p: any) => p.functionResponse);
    expect(answers.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
    expect(answers.map((r: any) => r.response.result)).toEqual(["결과 없음", "[c2] 출시일"]);
  });

  test("call without signature", async () => {
    const seen: SeenGeminiRequest[] = [];
    const m = model([{ parts: [functionCallPart("search_notes", { query: "QA" }, { id: "fc1" })] }, { parts: [textPart("끝")] }], seen);
    const round1 = await collect(m.stream(request()));
    const round2 = await collect(m.stream(request({ exchanges: [exchangeOf(round1, ["결과 없음"])] })));
    expect(doneOf(round2).finish).toBe("stop");
    const replayed = seen[1]!.body.contents[1].parts[0];
    expect(replayed.functionCall).toEqual({ id: "fc1", name: "search_notes", args: { query: "QA" } });
    expect("thoughtSignature" in replayed).toBe(false);
  });

  test("no tools no tools field", async () => {
    const seen: SeenGeminiRequest[] = [];
    await collect(model([{ parts: [textPart("답")] }], seen).stream(request({ tools: [] })));
    expect("tools" in seen[0]!.body).toBe(false);
    expect("toolConfig" in seen[0]!.body).toBe(false);
  });

  test("tools declared", async () => {
    const seen: SeenGeminiRequest[] = [];
    await collect(model([{ parts: [textPart("답")] }], seen).stream(request()));
    expect(seen[0]!.body.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(["search_notes", "read_more"]);
    expect(seen[0]!.body.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
  });

  test("outbound allowlist", async () => {
    const seen: SeenGeminiRequest[] = [];
    const fake = scriptedGeminiFetch([{ parts: [textPart("답")] }], seen);
    await expect(fake("https://example.com/x", { method: "POST", body: "{}" })).rejects.toThrow("unexpected outbound request");
    expect(seen).toEqual([]);
  });

  test("extra request fails", async () => {
    const m = model([{ parts: [textPart("답")] }]);
    await collect(m.stream(request()));
    await expect(collect(m.stream(request()))).rejects.toThrow("unexpected extra Gemini request");
  });

  test("header key only", async () => {
    const seen: SeenGeminiRequest[] = [];
    await collect(model([{ parts: [textPart("답")] }], seen).stream(request()));
    expect(seen[0]!.headers["x-goog-api-key"]).toBe("test-key");
    expect(seen[0]!.url).not.toContain("test-key");
    expect(seen[0]!.url.endsWith("/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse")).toBe(true);
  });

  test("a step function sees the parsed body and may answer with its own response", async () => {
    const seen: SeenGeminiRequest[] = [];
    const m = model([(body, i) => (body.contents.length === 1 && i === 0 ? new Response("overloaded", { status: 503 }) : { parts: [] })], seen);
    await expect(collect(m.stream(request()))).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
});
