// The pdf_ocr stage and the OCR estimate (P3-05, D-P3-3): the formula (whole PDF per
// request of 8 pages), the ledger row of a metered call, and the memo. Fake provider.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiOcrProvider, type OcrRequest } from "../src/gemini-ocr.ts";
import { DEFAULT_PRICING, priceFor } from "../src/ledger.ts";
import { estimateOcrCost, ocrStage } from "../src/pdf/ocr.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const AT = Date.parse("2026-11-12");
const MODEL = "gemini-3.8-flash";

describe("estimateOcrCost", () => {
  test("estimate formula", () => {
    const p = priceFor(DEFAULT_PRICING, "gemini", MODEL, AT)!;
    // 2 calls × 10 pages × 258 = 5160 input tokens, 10 × 600 = 6000 output tokens.
    expect(estimateOcrCost({ pagesToOcr: 10, pageCount: 10, model: MODEL, at: AT })).toBe(Math.round(5160 * p.input + 6000 * p.output));
  });

  test("zero pages cost zero", () => {
    expect(estimateOcrCost({ pagesToOcr: 0, pageCount: 40, model: MODEL, at: AT })).toBe(0);
  });

  test("eight pages is one call", () => {
    const p = priceFor(DEFAULT_PRICING, "gemini", MODEL, AT)!;
    expect(estimateOcrCost({ pagesToOcr: 8, pageCount: 8, model: MODEL, at: AT })).toBe(Math.round(8 * 258 * p.input + 8 * 600 * p.output));
  });

  test("unknown model has no price", () => {
    expect(() => estimateOcrCost({ pagesToOcr: 1, pageCount: 1, model: "gemini-unknown", at: AT })).toThrow();
  });
});

describe("ocrStage", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = testEnv();
  });
  afterEach(() => env.close());

  /** The real adapter class with its network call replaced. */
  function fakeProvider() {
    const calls: OcrRequest[] = [];
    const provider = new GeminiOcrProvider(MODEL, { apiKey: () => "test-key" });
    provider.ocr = async (req) => {
      calls.push(req);
      return {
        pages: req.pages.map((page_no) => ({ page_no, text: `${page_no}쪽 글자` })),
        usage: { inputTokens: 2000, cachedTokens: 0, outputTokens: 300 },
        model: MODEL,
        requestId: "r1",
      };
    };
    return { provider, calls };
  }

  const pdfPath = () => {
    const path = join(env.dir, "scan.pdf");
    writeFileSync(path, "%PDF-1.4 scanned");
    return path;
  };
  const run = (jobId: string) => env.harness().job({ jobId: env.job(jobId), scope: "ws", workspaceId: "ws" });

  test("stage meters the call", async () => {
    const { provider } = fakeProvider();
    const res = await run("j1").run(ocrStage(provider), { path: pdfPath(), pages: [2, 3] });
    expect(res.value.pages).toEqual([
      { page_no: 2, text: "2쪽 글자" },
      { page_no: 3, text: "3쪽 글자" },
    ]);
    const calls = rows(env.db, "SELECT provider, model, workspace_id, cost_microusd FROM ai_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "gemini", model: MODEL, workspace_id: "ws" });
    expect(calls[0].cost_microusd).toBeGreaterThan(0);
  });

  test("same input hits memo", async () => {
    const { provider, calls } = fakeProvider();
    const path = pdfPath();
    await run("j1").run(ocrStage(provider), { path, pages: [2, 3] });
    const again = await run("j2").run(ocrStage(provider), { path, pages: [2, 3] });
    expect(again.cacheHit).toBe(true);
    expect(calls).toHaveLength(1);
    const other = await run("j3").run(ocrStage(provider), { path, pages: [5] });
    expect(other.cacheHit).toBe(false);
    expect(calls).toHaveLength(2);
  });
});
