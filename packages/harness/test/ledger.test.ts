import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  costMicrousd,
  DEFAULT_PRICING,
  defineStage,
  HarnessError,
  normalizeGeminiUsage,
  priceFor,
  recordAiCall,
  type HarnessLogger,
  type ProviderCallResult,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
});
afterEach(() => env.close());

const OCT_2026 = Date.parse("2026-10-20T00:00:00Z");
const JAN_2027 = Date.parse("2027-01-01T00:00:00Z");

describe("pricing.json", () => {
  test("every model a request may pick by default has a price", () => {
    for (const model of ["gemini-3.8-flash", "gemini-3.5-flash-lite"]) {
      expect(priceFor(DEFAULT_PRICING, "gemini", model, OCT_2026)).not.toBeNull();
    }
    expect(priceFor(DEFAULT_PRICING, "gemini", "gemini-flash-latest", OCT_2026)).toBeNull();
  });

  test("prices apply from their date: Flash doubles on 2027-01-01", () => {
    const usage = { inputTokens: 1000, cachedTokens: 200, outputTokens: 500 };
    // 1000 × 0.75 + 200 × 0.075 + 500 × 3.75 microUSD
    expect(costMicrousd(usage, priceFor(DEFAULT_PRICING, "gemini", "gemini-3.8-flash", OCT_2026)!)).toBe(2640);
    expect(costMicrousd(usage, priceFor(DEFAULT_PRICING, "gemini", "gemini-3.8-flash", JAN_2027)!)).toBe(5280);
    // Before the first entry: the first price.
    expect(priceFor(DEFAULT_PRICING, "gemini", "gemini-3.8-flash", Date.parse("2026-01-01"))!.input).toBe(0.75);
  });

  test("Gemini usageMetadata: cached tokens come out of the prompt count, thinking counts as output", () => {
    expect(
      normalizeGeminiUsage(
        { promptTokenCount: 115_300, cachedContentTokenCount: 300, candidatesTokenCount: 8000, thoughtsTokenCount: 1200 },
        3600
      )
    ).toEqual({ inputTokens: 115_000, cachedTokens: 300, outputTokens: 9200, audioSeconds: 3600 });
    expect(normalizeGeminiUsage(undefined)).toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      audioSeconds: undefined,
    });
  });
});

describe("ai_call ledger", () => {
  test("recordAiCall writes the row and charges the job in one go", () => {
    env.job("j");
    const res = recordAiCall(
      env.db,
      {
        jobId: "j",
        stageRunId: "sr_1",
        provider: "gemini",
        model: "gemini-3.8-flash",
        usage: { inputTokens: 1000, cachedTokens: 200, outputTokens: 500, audioSeconds: 61.6 },
        latencyMs: 1234.4,
        status: "ok",
        requestId: "resp-1",
      },
      { now: OCT_2026 }
    );
    expect(res).toMatchObject({ costMicrousd: 2640, priced: true });
    expect(rows(env.db, `SELECT * FROM ai_call`)).toEqual([
      {
        id: res.id,
        workspace_id: null,
        job_id: "j",
        stage_run_id: "sr_1",
        provider: "gemini",
        model: "gemini-3.8-flash",
        input_tokens: 1000,
        cached_tokens: 200,
        output_tokens: 500,
        audio_seconds: 62,
        cost_microusd: 2640,
        latency_ms: 1234,
        status: "ok",
        request_id: "resp-1",
        created_at: OCT_2026,
      },
    ]);
    expect(rows(env.db, `SELECT spent_microusd FROM job WHERE id = 'j'`)).toEqual([{ spent_microusd: 2640 }]);
  });

  test("an unpriced model is recorded at cost 0 and reported", () => {
    const unpriced: string[] = [];
    const res = recordAiCall(
      env.db,
      {
        provider: "gemini",
        model: "gemini-x",
        usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 10 },
        latencyMs: 1,
        status: "ok",
      },
      { onUnpriced: (p, m) => unpriced.push(`${p}:${m}`) }
    );
    expect(res).toMatchObject({ costMicrousd: 0, priced: false });
    expect(unpriced).toEqual(["gemini:gemini-x"]);
  });

  test("ctx.meter records successful calls and transient provider failures, linked to the stage run", async () => {
    const warnings: string[] = [];
    const logger: HarnessLogger = { info() {}, warn: (m) => warnings.push(m), error() {} };
    let clock = OCT_2026;
    const harness = env.harness({ now: () => clock, logger });
    let calls = 0;
    const fakeProvider = async (): Promise<ProviderCallResult & { text: string }> => {
      calls++;
      clock += 250;
      if (calls === 1) throw new HarnessError("transient", "Gemini generateContent failed (503): unavailable");
      return {
        text: "ok",
        usage: { inputTokens: 2000, cachedTokens: 0, outputTokens: 100 },
        model: "gemini-3.8-flash-001",
        requestId: "resp-2",
      };
    };
    const stage = defineStage({
      name: "classify",
      version: 1,
      output: z.object({ text: z.string() }),
      key: () => ({}),
      async run(_input: null, ctx) {
        const res = await ctx.meter({ provider: "gemini", model: "gemini-3.8-flash" }, fakeProvider);
        return { text: res.text };
      },
    });
    const res = await harness.job({ jobId: env.job("j"), scope: "ws" }).run(stage, null);

    const calls_ = rows(
      env.db,
      `SELECT stage_run_id, status, model, input_tokens, output_tokens, cost_microusd, latency_ms, request_id
       FROM ai_call ORDER BY status DESC`
    );
    expect(calls_).toEqual([
      {
        stage_run_id: res.stageRunId,
        status: "ok",
        model: "gemini-3.8-flash",
        input_tokens: 2000,
        output_tokens: 100,
        cost_microusd: 1875, // 2000 × 0.75 + 100 × 3.75
        latency_ms: 250,
        request_id: "resp-2",
      },
      {
        stage_run_id: res.stageRunId,
        status: "error",
        model: "gemini-3.8-flash",
        input_tokens: 0,
        output_tokens: 0,
        cost_microusd: 0,
        latency_ms: 250,
        request_id: null,
      },
    ]);
    expect(rows(env.db, `SELECT spent_microusd FROM job`)).toEqual([{ spent_microusd: 1875 }]);
    expect(warnings).toEqual([]);
  });

  test("input and config failures are not provider calls", async () => {
    const harness = env.harness();
    const stage = defineStage({
      name: "needs_key",
      version: 1,
      output: z.object({}),
      key: () => ({}),
      async run(_input: null, ctx) {
        return ctx.meter({ provider: "gemini", model: "gemini-3.8-flash" }, async () => {
          throw new HarnessError("config", "GEMINI_API_KEY is not configured.");
        });
      },
    });
    const failure = await harness
      .job({ jobId: env.job("j"), scope: "ws" })
      .run(stage, null)
      .catch((e) => e);
    expect(failure.kind).toBe("config");
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM ai_call`)).toEqual([{ n: 0 }]);
  });
});
