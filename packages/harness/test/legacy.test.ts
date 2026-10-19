import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DistillationResult, DistillOptions } from "@lectern/core";
import {
  classifyGeminiError,
  geminiLegacyDistillProvider,
  legacyDistillStage,
  type StageEvent,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let audioPath: string;
beforeEach(() => {
  env = testEnv();
  audioPath = join(env.dir, "lecture.m4a");
  writeFileSync(audioPath, "not really audio");
});
afterEach(() => env.close());

/** A recorded-shape distillLectureAudio result (no real Gemini call). */
function recorded(opts: DistillOptions): DistillationResult {
  return {
    markdown: `# 📚 ${opts.courseName} 강의 노트\n\n- [00:01] 대칭키 암호의 운영 모드.`,
    title: `${opts.courseName} 강의 노트`,
    courseName: opts.courseName!,
    excerpt: "대칭키 암호의 운영 모드.",
    modelRequested: opts.model!,
    modelUsed: "gemini-3.8-flash-001",
    durationSec: 1800,
    sizeBytes: 16,
    usage: { promptTokenCount: 58_000, candidatesTokenCount: 6000, thoughtsTokenCount: 500 },
    requestId: "resp-legacy",
    generateMs: 42_000,
  };
}

function fakeDistill(failures: Error[] = []) {
  const seen: DistillOptions[] = [];
  const distill = async (opts: DistillOptions) => {
    seen.push(opts);
    opts.onProgress?.({ stage: "analyzing", message: "분석 중", progress: 65 });
    const failure = failures.shift();
    if (failure) throw failure;
    return recorded(opts);
  };
  return { distill, seen };
}

describe("legacy_distill stage", () => {
  test("runs the existing Gemini path once, stores the result and records the call's cost", async () => {
    const fake = fakeDistill();
    const progress: string[] = [];
    const harness = env.harness({ now: () => Date.parse("2026-10-20T00:00:00Z") });
    const res = await harness.job({ jobId: env.job("j"), scope: "owner:u1" }).run(
      legacyDistillStage(geminiLegacyDistillProvider(fake.distill)),
      {
        audioPath,
        course: "정보보호",
        model: "gemini-flash-latest", // not allowed → the pinned default
        apiKey: "user-key-123",
        onProgress: (ev) => progress.push(ev.message),
      }
    );
    expect(res.value).toEqual({
      markdown: "# 📚 정보보호 강의 노트\n\n- [00:01] 대칭키 암호의 운영 모드.",
      title: "정보보호 강의 노트",
      courseName: "정보보호",
      excerpt: "대칭키 암호의 운영 모드.",
      modelRequested: "gemini-3.8-flash",
      modelUsed: "gemini-3.8-flash-001",
      durationSec: 1800,
      sizeBytes: 16,
    });
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({ courseName: "정보보호", model: "gemini-3.8-flash", apiKey: "user-key-123" });
    expect(fake.seen[0]!.title).toBeUndefined(); // the title is applied at publish, not sent
    expect(progress).toEqual(["분석 중"]);

    expect(rows(env.db, `SELECT provider, model, input_tokens, output_tokens, audio_seconds, cost_microusd, latency_ms, request_id, status FROM ai_call`)).toEqual([
      {
        provider: "gemini",
        model: "gemini-3.8-flash-001",
        input_tokens: 58_000,
        output_tokens: 6500,
        audio_seconds: 1800,
        cost_microusd: 67_875, // 58,000 × 0.75 + 6,500 × 3.75
        latency_ms: 42_000,
        request_id: "resp-legacy",
        status: "ok",
      },
    ]);
    // The user's key is never persisted.
    const everything = JSON.stringify(rows(env.db, `SELECT * FROM stage_run`)) + harness.blobs.readText(res.output.sha256);
    expect(everything).not.toContain("user-key-123");
  });

  test("retries transient failures 3 times, 2.5s × attempt apart, like the direct handler", async () => {
    const fake = fakeDistill([
      new Error("Gemini generateContent failed (503): unavailable"),
      new Error("Gemini File API init failed (500): oops"),
    ]);
    const sleeps: number[] = [];
    const events: StageEvent[] = [];
    const harness = env.harness({ sleep: async (ms) => void sleeps.push(ms) });
    await harness
      .job({ jobId: env.job("j"), scope: "owner:u1", onEvent: (e) => events.push(e) })
      .run(legacyDistillStage(geminiLegacyDistillProvider(fake.distill)), { audioPath, course: "c", model: "" });
    expect(sleeps).toEqual([5000, 7500]);
    expect(events.filter((e) => e.type === "retry").map((e) => (e as any).attempt)).toEqual([2, 3]);
    expect(rows(env.db, `SELECT status FROM ai_call ORDER BY created_at`).map((r) => r.status).sort()).toEqual([
      "error",
      "error",
      "ok",
    ]);
  });

  test("permanent failures (no key, silent audio, 4xx) fail on the first attempt with the original message", async () => {
    for (const [i, message] of [
      "GEMINI_API_KEY is not configured. Pass an API key, set GEMINI_API_KEY in env, or configure ~/local.env.",
      "녹음된 오디오에 음성 신호가 감지되지 않았습니다 (최대 음량 -91.0dB 무음 파일).",
      "Gemini generateContent failed (400): bad request",
    ].entries()) {
      const fake = fakeDistill([new Error(message)]);
      const failure = await env
        .harness()
        .job({ jobId: env.job(`j${i}`), scope: "owner:u1" })
        .run(legacyDistillStage(geminiLegacyDistillProvider(fake.distill)), { audioPath, course: "c", model: "" })
        .catch((e) => e);
      expect(failure.message).toBe(message);
      expect(fake.seen).toHaveLength(1);
    }
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM ai_call`)).toEqual([{ n: 0 }]);
  });

  test("reuse is per job: a resumed job skips Gemini, a new job (재분석) calls it again", async () => {
    const fake = fakeDistill();
    const harness = env.harness();
    const stage = legacyDistillStage(geminiLegacyDistillProvider(fake.distill));
    const input = { audioPath, course: "c", model: "" };
    const run = harness.job({ jobId: env.job("j1"), scope: "owner:u1" });
    await run.run(stage, input);
    expect((await run.run(stage, input)).resumed).toBe(true);
    expect(fake.seen).toHaveLength(1);
    await harness.job({ jobId: env.job("j2"), scope: "owner:u1" }).run(stage, input);
    expect(fake.seen).toHaveLength(2);
  });

  test("the key follows the audio bytes, the course and the model, never the API key", async () => {
    const harness = env.harness();
    const stage = legacyDistillStage(geminiLegacyDistillProvider(fakeDistill().distill));
    const keyOf = async (input: Parameters<typeof stage.key>[0]) => {
      const jobId = env.job(`k${Math.random()}`);
      const res = await harness.job({ jobId, scope: "owner:u1" }).run(stage, input);
      return rows(env.db, `SELECT stage_key FROM stage_run WHERE id = ?`, res.stageRunId)[0].stage_key as string;
    };
    const base = await keyOf({ audioPath, course: "c", model: "", apiKey: "a" });
    expect(await keyOf({ audioPath, course: "c", model: "", apiKey: "b" })).toBe(base);
    expect(await keyOf({ audioPath, course: "d", model: "" })).not.toBe(base);
    expect(await keyOf({ audioPath, course: "c", model: "gemini-3.5-flash-lite" })).not.toBe(base);
    writeFileSync(audioPath, readFileSync(audioPath, "utf8") + "!");
    expect(await keyOf({ audioPath, course: "c", model: "" })).not.toBe(base);
  });

  test("a missing audio file is an input failure with the direct path's message", async () => {
    const failure = await env
      .harness()
      .job({ jobId: env.job("j"), scope: "owner:u1" })
      .run(legacyDistillStage(geminiLegacyDistillProvider(fakeDistill().distill)), {
        audioPath: join(env.dir, "gone.m4a"),
        course: "c",
        model: "",
      })
      .catch((e) => e);
    expect(failure.kind).toBe("input");
    expect(failure.message).toBe(`Audio file not found: ${join(env.dir, "gone.m4a")}`);
  });
});

describe("classifyGeminiError", () => {
  test("splits the direct handler's retryable/permanent cases into §4.5 classes", () => {
    const kind = (m: string) => classifyGeminiError(new Error(m)).kind;
    expect(kind("GEMINI_API_KEY is not configured. Pass an API key")).toBe("config");
    expect(kind("Gemini generateContent failed (400): bad request")).toBe("input");
    expect(kind("Gemini generateContent failed (403): denied")).toBe("config");
    expect(kind("Gemini generateContent failed (429): quota")).toBe("transient");
    expect(kind("Gemini File API init failed (503): unavailable")).toBe("transient");
    expect(kind("Gemini generateContent timed out after 900s")).toBe("transient");
    expect(kind("녹음된 오디오에 음성 신호가 감지되지 않았습니다")).toBe("input");
    expect(kind("Gemini File processing did not reach ACTIVE state (state=FAILED).")).toBe("input");
    expect(kind("Gemini File processing did not reach ACTIVE state (state=PROCESSING).")).toBe("transient");
  });

  test("429 RetryInfo becomes retryAfterMs", () => {
    const err = classifyGeminiError(
      new Error(
        `Gemini generateContent failed (429): {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay": "17.2s"}]}}`
      )
    );
    expect(err.kind).toBe("transient");
    expect(err.retryAfterMs).toBe(17_200);
  });
});
