import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscribeResult } from "@lectern/domain";
import type { RenderedChunk } from "@lectern/media";
import {
  BlobStore,
  checkTranscription,
  GEMINI_TRANSCRIBE_SCHEMA,
  GeminiTranscriptionProvider,
  HarnessError,
  normalizeSpeakerLabel,
  parseClock,
  renderTranscribePrompt,
  sha256Hex,
  transcribePromptTemplate,
  transcribeStage,
  type ProviderCallResult,
  type TranscriptionProvider,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const S = 1000;

// ---------------------------------------------------------------------------
// §3.4 checks
// ---------------------------------------------------------------------------

describe("checkTranscription", () => {
  const ctx = { durationMs: 60 * S, silences: [{ start_ms: 30 * S, end_ms: 40 * S }] };
  const seg = (start: number, end: number, text = "오늘은 운영 모드를 봅니다", speaker = "S1") => ({
    start_ms: start * S,
    end_ms: end * S,
    speaker,
    text,
  });
  const good: TranscribeResult = {
    segments: [seg(0, 10), seg(10, 20, "다음은 시험 범위입니다"), seg(20, 29, "질문 있나요"), seg(41, 60, "끝으로 과제입니다")],
    language: "ko",
  };

  test("a plausible answer passes", () => {
    expect(checkTranscription(good, ctx)).toEqual([]);
    expect(checkTranscription({ segments: [] }, { durationMs: 10 * S, silences: [] })).toEqual([]); // too short to judge
  });

  test("times: end before start, past the clip (+1 s allowed), going backwards", () => {
    expect(checkTranscription({ segments: [seg(5, 61)] }, ctx).some((i) => i.includes("past the clip"))).toBe(false);
    const issues = checkTranscription({ segments: [seg(0, 10), seg(20, 15), seg(8, 62)] }, ctx);
    expect(issues).toEqual(
      expect.arrayContaining([
        "segment 1: end before start",
        expect.stringContaining("segment 2: ends at 62000 ms"),
        "segment 2: starts before the previous segment",
      ]),
    );
  });

  test("coverage: too little of the speech transcribed", () => {
    expect(checkTranscription({ segments: [seg(0, 5)] }, ctx)).toEqual([expect.stringContaining("text is missing")]);
  });

  test("more letters than anyone speaks", () => {
    const flood = "가".repeat(40) + "나".repeat(40);
    const issues = checkTranscription({ segments: [seg(0, 2, flood.repeat(20))] }, { durationMs: 2 * S, silences: [] });
    expect(issues).toEqual(expect.arrayContaining([expect.stringContaining("more text than was spoken")]));
  });

  test("repetition loops: a phrase over and over, or the same segment again and again", () => {
    const loop = { segments: [seg(0, 29, "감사합니다 ".repeat(8)), seg(41, 60, "끝으로 과제입니다")] };
    expect(checkTranscription(loop, ctx)).toEqual([expect.stringContaining("repetition loop")]);
    const same = {
      segments: [seg(0, 7, "같은 문장입니다"), seg(7, 14, "같은 문장입니다"), seg(14, 21, "같은 문장입니다"), seg(21, 29, "같은 문장입니다")],
    };
    expect(checkTranscription(same, ctx)).toEqual(["4 consecutive segments have the same text (repetition loop)"]);
    // Short backchannels repeated are speech, not a loop.
    expect(checkTranscription({ segments: [seg(0, 29, "네 네 네 네 네 네"), seg(41, 60, "끝으로 과제입니다")] }, ctx)).toEqual([]);
  });

  test("too many empty segments, and a language other than the expected one", () => {
    const empty = { segments: [seg(0, 6), seg(6, 12, "..."), seg(12, 18, ""), seg(18, 24, "[ ]"), seg(24, 29), seg(41, 60)] };
    expect(checkTranscription(empty, ctx)).toEqual(["3 of 6 segments have no text"]);
    expect(checkTranscription({ ...good, language: "en" }, { ...ctx, language: "ko" })).toEqual(["language en, expected ko"]);
    expect(checkTranscription({ ...good, language: "ko-KR" }, { ...ctx, language: "ko" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gemini adapter (recorded REST shapes; no request leaves the process)
// ---------------------------------------------------------------------------

describe("text helpers", () => {
  test("parseClock", () => {
    expect(["0:07", "01:23", "1:02:03", "75:30", "01:23.5", "83.25"].map(parseClock)).toEqual([
      7_000, 83_000, 3_723_000, 4_530_000, 83_500, 83_250,
    ]);
    expect(["", "1:60", "1:61:00", "abc", "-1:00"].map(parseClock)).toEqual([null, null, null, null, null]);
  });

  test("speaker labels", () => {
    expect(["S1", "s2", "Speaker 3", "화자 4", "S0", "?"].map(normalizeSpeakerLabel)).toEqual(["S1", "S2", "S3", "S4", "S1", "S1"]);
  });

  test("prompt: duration, hints and the repair note are filled in", () => {
    const prompt = renderTranscribePrompt(transcribePromptTemplate(), {
      durationMs: 6 * 60 * S + 5 * S,
      language: "ko",
      speakersHint: 2,
      repair: { issues: "segment 3: starts before the previous segment" },
    });
    expect(prompt).toContain("(길이 6:05)");
    expect(prompt).toContain("예상 언어: ko.");
    expect(prompt).toContain("예상 화자 수: 2명.");
    expect(prompt).toContain("이전 응답이 검증을 통과하지 못했다: segment 3");
    expect(prompt).not.toContain("{{");
    const plain = renderTranscribePrompt(transcribePromptTemplate(), { durationMs: 60 * S });
    expect(plain).not.toContain("예상");
    expect(plain).not.toContain("이전 응답");
  });
});

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

const usageMetadata = { promptTokenCount: 11_652, candidatesTokenCount: 812, thoughtsTokenCount: 120, totalTokenCount: 12_584 };

const answer = (payload: unknown, extra: Record<string, unknown> = {}) => () =>
  Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: "생각 중", thought: true }, { text: JSON.stringify(payload) }] }, finishReason: "STOP" }],
    usageMetadata,
    modelVersion: "gemini-3.8-flash-001",
    responseId: "resp-1",
    ...extra,
  });

describe("GeminiTranscriptionProvider", () => {
  let env: TestEnv;
  let chunk: RenderedChunk;
  beforeEach(() => {
    env = testEnv();
    const path = join(env.dir, "chunk-000.m4a");
    writeFileSync(path, new Uint8Array([0, 1, 2, 3, 250, 251]));
    chunk = {
      index: 0,
      start_ms: 0,
      end_ms: 6 * 60 * S,
      core_start_ms: 0,
      core_end_ms: 6 * 60 * S - 10 * S,
      overlap_prev: null,
      overlap_next: { start_ms: 6 * 60 * S - 20 * S, end_ms: 6 * 60 * S, seam_ms: 6 * 60 * S - 10 * S, seam_in_silence: true },
      path,
      bytes: 6,
      mime: "audio/mp4",
    };
  });
  afterEach(() => env.close());

  const provider = (responses: Array<() => Response>, seen: Captured[]) =>
    new GeminiTranscriptionProvider({ apiKey: () => "test-key", fetch: fakeFetch(responses, seen) });

  test("one inline generateContent call with the schema, low thinking, the key in a header", async () => {
    const seen: Captured[] = [];
    const result = await provider(
      [
        answer({
          language: "ko",
          segments: [
            { start: "00:01", end: "00:04.5", speaker: "S1", text: " 오늘은 운영 모드 " },
            { start: "0:05", end: "0:09", speaker: "Speaker 2", text: "질문 있습니다" },
          ],
        }),
      ],
      seen,
    ).transcribe(chunk, { language: "ko" });

    expect(seen).toHaveLength(1);
    const [req] = seen;
    expect(req!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(req!.url).not.toContain("test-key");
    expect(req!.headers["x-goog-api-key"]).toBe("test-key");
    const parts = req!.body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "audio/mp4", data: Buffer.from([0, 1, 2, 3, 250, 251]).toString("base64") } });
    expect(parts[1].text).toContain("(길이 6:00)");
    expect(parts[1].text).toContain("예상 언어: ko.");
    expect(req!.body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: GEMINI_TRANSCRIBE_SCHEMA,
      thinkingConfig: { thinkingLevel: "low" },
      maxOutputTokens: 16_384,
    });

    expect(result.segments).toEqual([
      { start_ms: 1_000, end_ms: 4_500, speaker: "S1", text: "오늘은 운영 모드" },
      { start_ms: 5_000, end_ms: 9_000, speaker: "S2", text: "질문 있습니다" },
    ]);
    expect(result.language).toBe("ko");
    // Thinking tokens count as output; the audio length goes to the ledger too.
    expect(result.usage).toEqual({ inputTokens: 11_652, cachedTokens: 0, outputTokens: 932, audioSeconds: 360 });
    expect(result.model).toBe("gemini-3.8-flash-001");
    expect(result.requestId).toBe("resp-1");
  });

  test("the memo fingerprint follows the prompt file and the request parameters", () => {
    const p = new GeminiTranscriptionProvider({ apiKey: () => "k" });
    expect(p.model).toBe("gemini-3.8-flash");
    expect(p.fingerprint.prompt).toBe(sha256Hex(transcribePromptTemplate()));
    expect(p.fingerprint.params).toMatchObject({ thinkingLevel: "low", maxOutputTokens: 16_384 });
    const other = new GeminiTranscriptionProvider({ apiKey: () => "k", thinkingLevel: "medium" });
    expect(other.fingerprint.params).not.toEqual(p.fingerprint.params);
    // Not on the allowlist: the pinned default, never an arbitrary id.
    expect(new GeminiTranscriptionProvider({ apiKey: () => "k", model: "gemini-flash-latest" }).model).toBe("gemini-3.8-flash");
  });

  test("billed but unusable answers are output_validation errors that carry their usage", async () => {
    const cases: Array<[string, () => Response]> = [
      ["truncated", answer({ segments: [] }, { candidates: [{ content: { parts: [{ text: '{"segm' }] }, finishReason: "MAX_TOKENS" }] })],
      ["empty_response", answer({}, { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] })],
      ["malformed_json", answer({}, { candidates: [{ content: { parts: [{ text: "죄송합니다" }] }, finishReason: "STOP" }] })],
      ["schema", answer({ segments: [{ start: 1 }] })],
      ["bad_timestamp", answer({ segments: [{ start: "약 1분", end: "1:05", speaker: "S1", text: "음" }] })],
      ["finish_reason", answer({}, { candidates: [{ content: { parts: [] }, finishReason: "RECITATION" }] })],
      ["blocked", answer({}, { candidates: [], promptFeedback: { blockReason: "OTHER" } })],
    ];
    for (const [code, response] of cases) {
      const err = await provider([response], []).transcribe(chunk, {}).catch((e) => e);
      expect(err).toBeInstanceOf(HarnessError);
      expect([err.kind, err.code]).toEqual(["output_validation", code]);
      expect((err.billed as ProviderCallResult).usage.inputTokens).toBe(11_652);
    }
  });

  test("HTTP failures and a missing key are classified", async () => {
    const limited = await provider(
      [() => new Response('{"error":{"details":[{"retryDelay":"7s"}]}}', { status: 429 })],
      [],
    )
      .transcribe(chunk, {})
      .catch((e) => e);
    expect([limited.kind, limited.retryAfterMs]).toEqual(["transient", 7000]);
    const bad = await provider([() => new Response("bad audio", { status: 400 })], []).transcribe(chunk, {}).catch((e) => e);
    expect(bad.kind).toBe("input");
    const noKey = await new GeminiTranscriptionProvider({ apiKey: () => undefined }).transcribe(chunk, {}).catch((e) => e);
    expect(noKey.kind).toBe("config");
  });
});

// ---------------------------------------------------------------------------
// transcribe stage on the runner: checks, one repair, the ledger
// ---------------------------------------------------------------------------

describe("transcribe stage", () => {
  let env: TestEnv;
  beforeEach(() => (env = testEnv()));
  afterEach(() => env.close());

  const usage = { inputTokens: 11_520, cachedTokens: 0, outputTokens: 900, audioSeconds: 360 };

  async function storedChunk(blobs: BlobStore) {
    const ref = await blobs.putBytes(new Uint8Array([9, 9, 9]));
    return {
      index: 0,
      start_ms: 0,
      end_ms: 60 * S,
      core_start_ms: 0,
      core_end_ms: 60 * S,
      overlap_prev: null,
      overlap_next: null,
      sha256: ref.sha256,
      bytes: ref.bytes,
      mime: "audio/mp4",
    };
  }

  function scripted(answers: Array<() => Promise<TranscribeResult & ProviderCallResult>>): TranscriptionProvider & { calls: string[] } {
    const calls: string[] = [];
    return {
      id: "gemini",
      model: "gemini-3.8-flash",
      maxChunkSeconds: 480,
      fingerprint: { prompt: "p", params: {} },
      calls,
      async transcribe(chunk, opts) {
        calls.push(opts.repair ? `repair: ${opts.repair.issues}` : `first: ${Bun.file(chunk.path).size} bytes`);
        return answers[calls.length - 1]!();
      },
    };
  }

  test("a failing answer gets one repair attempt with the issues; both calls are on the ledger", async () => {
    const harness = env.harness();
    const jobId = env.job("job-repair");
    const chunk = await storedChunk(harness.blobs);
    const loop = { segments: [{ start_ms: 0, end_ms: 60 * S, speaker: "S1", text: "감사합니다 ".repeat(10) }] };
    const fine = { segments: [{ start_ms: 0, end_ms: 58 * S, speaker: "S1", text: "오늘은 운영 모드를 봅니다" }], language: "ko" };
    const provider = scripted([async () => ({ ...loop, usage }), async () => ({ ...fine, usage })]);
    const result = await harness.job({ jobId, scope: "ws" }).run(transcribeStage(provider), { chunk, silences: [] }, { chunkIndex: 0 });
    expect(result.value).toEqual(fine);
    expect(provider.calls).toEqual(["first: 3 bytes", expect.stringContaining("repair: chunk 0 transcription failed checks: a phrase repeats")]);
    expect(rows(env.db, `SELECT status, input_tokens, output_tokens, audio_seconds FROM ai_call ORDER BY created_at`)).toEqual([
      { status: "ok", input_tokens: 11_520, output_tokens: 900, audio_seconds: 360 },
      { status: "ok", input_tokens: 11_520, output_tokens: 900, audio_seconds: 360 },
    ]);
    expect(rows(env.db, `SELECT spent_microusd FROM job`)).toEqual([{ spent_microusd: 2 * (11_520 * 0.75 + 900 * 3.75) }]);
  });

  test("an empty 200 answer is billed, recorded as an error call, retried once, then the run fails", async () => {
    const harness = env.harness();
    const jobId = env.job("job-empty");
    const chunk = await storedChunk(harness.blobs);
    const empty = async () => {
      throw new HarnessError("output_validation", "empty response", { code: "empty_response", billed: { usage } });
    };
    const provider = scripted([empty, empty]);
    const err = await harness
      .job({ jobId, scope: "ws" })
      .run(transcribeStage(provider), { chunk, silences: [] }, { chunkIndex: 0 })
      .catch((e) => e);
    expect([err.kind, err.code]).toEqual(["output_validation", "empty_response"]);
    expect(provider.calls).toHaveLength(2);
    expect(rows(env.db, `SELECT status, input_tokens FROM ai_call`)).toEqual([
      { status: "error", input_tokens: 11_520 },
      { status: "error", input_tokens: 11_520 },
    ]);
    expect(rows(env.db, `SELECT state FROM stage_run`)).toEqual([{ state: "failed" }]);
  });

  test("the same chunk audio is transcribed once per workspace (shared memo)", async () => {
    const harness = env.harness();
    const chunk = await storedChunk(harness.blobs);
    const fine = { segments: [{ start_ms: 0, end_ms: 58 * S, speaker: "S1", text: "오늘은 운영 모드를 봅니다" }] };
    const provider = scripted([async () => ({ ...fine, usage })]);
    const stage = transcribeStage(provider);
    await harness.job({ jobId: env.job("job-a"), scope: "ws" }).run(stage, { chunk, silences: [] }, { chunkIndex: 0 });
    // Same audio at another position of another recording: chunk-relative output, same key.
    const moved = { ...chunk, index: 4, start_ms: 600 * S, end_ms: 660 * S, core_start_ms: 600 * S, core_end_ms: 660 * S };
    const again = await harness.job({ jobId: env.job("job-b"), scope: "ws" }).run(stage, { chunk: moved, silences: [] }, { chunkIndex: 4 });
    expect(again.cacheHit).toBe(true);
    expect(provider.calls).toHaveLength(1);
    const otherWorkspace = await harness
      .job({ jobId: env.job("job-c"), scope: "ws-2" })
      .run(transcribeStage(scripted([async () => ({ ...fine, usage })])), { chunk, silences: [] }, { chunkIndex: 0 });
    expect(otherWorkspace.cacheHit).toBe(false);
  });
});
