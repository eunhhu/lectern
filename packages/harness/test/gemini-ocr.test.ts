// The Gemini OCR adapter (P3-05, D-P3-3) against a fake fetch: request shape (key in the
// header, inline PDF, JSON schema), result filtering and usage, rejected answers, HTTP
// classes, the inline size limit and the pinned-model rule. No network.

import { describe, expect, test } from "bun:test";
import { HarnessError } from "../src/errors.ts";
import { GeminiOcrProvider, OCR_MAX_PDF_BYTES } from "../src/gemini-ocr.ts";

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

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const answer = (pages: unknown, extra: Record<string, unknown> = {}) =>
  json({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ pages }) }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 100 },
    modelVersion: "gemini-3.8-flash",
    responseId: "resp-ocr",
    ...extra,
  });

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

function provider(responses: Array<() => Response>, seen: Captured[]) {
  return new GeminiOcrProvider("gemini-3.8-flash", { apiKey: () => "test-key", fetch: fakeFetch(responses, seen) });
}

async function failure(promise: Promise<unknown>): Promise<HarnessError> {
  const err = await promise.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(HarnessError);
  return err as HarnessError;
}

describe("GeminiOcrProvider", () => {
  test("request shape", async () => {
    const seen: Captured[] = [];
    await provider([answer([{ page_no: 2, text: "가" }, { page_no: 3, text: "나" }])], seen).ocr({ pdf: PDF, pages: [2, 3] });
    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call!.url.endsWith("/models/gemini-3.8-flash:generateContent")).toBe(true);
    expect(call!.url).not.toContain("test-key");
    expect(call!.headers["x-goog-api-key"]).toBe("test-key");
    const parts = call!.body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("application/pdf");
    expect(parts[0].inlineData.data).toBe(Buffer.from(PDF).toString("base64"));
    expect(call!.body.generationConfig.responseMimeType).toBe("application/json");
    expect(call!.body.generationConfig.responseSchema.required).toEqual(["pages"]);
    expect(call!.body.generationConfig.maxOutputTokens).toBe(8192);
    expect(parts[1].text).toContain("쪽 번호: 2, 3");
    expect(parts[1].text).toContain("그대로");
  });

  test("result and usage", async () => {
    const res = await provider([answer([{ page_no: 2, text: "가" }, { page_no: 3, text: "나" }])], []).ocr({ pdf: PDF, pages: [2, 3] });
    expect(res.pages).toEqual([
      { page_no: 2, text: "가" },
      { page_no: 3, text: "나" },
    ]);
    expect(res.usage.inputTokens).toBe(3000);
    expect(res.usage.outputTokens).toBe(100);
    expect(res.requestId).toBe("resp-ocr");
  });

  test("unrequested page dropped", async () => {
    const res = await provider(
      [answer([{ page_no: 2, text: "가" }, { page_no: 9, text: "엉뚱한 쪽" }, { page_no: 2, text: "두 번째" }])],
      []
    ).ocr({ pdf: PDF, pages: [2, 3] });
    expect(res.pages).toEqual([{ page_no: 2, text: "가" }]);
  });

  test("blocked and truncated", async () => {
    const blocked = await failure(provider([json({ promptFeedback: { blockReason: "SAFETY" } })], []).ocr({ pdf: PDF, pages: [1] }));
    expect(blocked).toMatchObject({ kind: "output_validation", code: "blocked" });
    const truncated = await failure(
      provider([json({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] })], []).ocr({ pdf: PDF, pages: [1] })
    );
    expect(truncated).toMatchObject({ kind: "output_validation", code: "truncated" });
    expect(truncated.billed).toBeDefined();
    const empty = await failure(provider([json({ candidates: [{ content: { parts: [{ text: "x", thought: true }] }, finishReason: "STOP" }] })], []).ocr({ pdf: PDF, pages: [1] }));
    expect(empty.code).toBe("empty_response");
    const malformed = await failure(provider([json({ candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }] })], []).ocr({ pdf: PDF, pages: [1] }));
    expect(malformed.code).toBe("malformed_json");
    const schema = await failure(provider([answer([{ page_no: "one", text: 1 }])], []).ocr({ pdf: PDF, pages: [1] }));
    expect(schema.code).toBe("schema");
  });

  test("http 429 and 400", async () => {
    const limited = await failure(provider([json({ error: { message: "slow down", details: [{ retryDelay: "3s" }] } }, 429)], []).ocr({ pdf: PDF, pages: [1] }));
    expect(limited.kind).toBe("transient");
    expect(limited.retryAfterMs).toBe(3000);
    const bad = await failure(provider([json({ error: { message: "bad" } }, 400)], []).ocr({ pdf: PDF, pages: [1] }));
    expect(bad.kind).toBe("input");
  });

  test("too large pdf", async () => {
    const seen: Captured[] = [];
    const big = new Uint8Array(19 * 1024 * 1024);
    expect(big.byteLength).toBeGreaterThan(OCR_MAX_PDF_BYTES);
    const err = await failure(provider([answer([])], seen).ocr({ pdf: big, pages: [1] }));
    expect(err).toMatchObject({ kind: "input", code: "pdf_too_large_for_ocr" });
    expect(seen).toHaveLength(0);
  });

  test("unpinned model rejected", () => {
    expect(() => new GeminiOcrProvider("gemini-flash-latest", { apiKey: () => "test-key" })).toThrow(HarnessError);
  });

  test("missing key is a config error before any call", async () => {
    const seen: Captured[] = [];
    const ocr = new GeminiOcrProvider("gemini-3.8-flash", { apiKey: () => undefined, fetch: fakeFetch([answer([])], seen) });
    expect((await failure(ocr.ocr({ pdf: PDF, pages: [1] }))).kind).toBe("config");
    expect(seen).toHaveLength(0);
  });
});
