import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../src/errors.ts";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { classifyStage, sampleForClassify, type ClassifyInput } from "../src/notes/classify.ts";
import type { CompactSegment } from "../src/notes/compact.ts";
import type { ClassifyOutput } from "../src/notes/schemas.ts";
import { loadRouting } from "../src/routing.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const segments: CompactSegment[] = Array.from({ length: 20 }, (_, idx) => ({
  idx,
  start_ms: idx * 60000,
  speaker: "S1",
  text: `내용 ${idx}`,
}));

const ok: ClassifyOutput = {
  domain: "lecture",
  language: "ko",
  title: "암호 운영 모드",
  participants: [],
  folder_suggestion: { folder_id: null, new_name: null },
  tags: ["암호"],
  confidence: 0.9,
};

const input = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  segments,
  filename: "lecture.m4a",
  hint: { domain: null, folder_id: null },
  folders: [{ id: "f1", name: "보안" }],
  tags: [],
  ...over,
});

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
  env.job("job-1");
});
afterEach(() => env.close());

const jobRun = (jobId = "job-1") => env.harness().job({ jobId, scope: "ws" });

describe("sampleForClassify", () => {
  test("sample is deterministic and bounded", () => {
    const many: CompactSegment[] = Array.from({ length: 2000 }, (_, idx) => ({
      idx,
      start_ms: idx * 5000,
      speaker: "S1",
      text: "가".repeat(100),
    }));
    const a = sampleForClassify(many);
    expect(sampleForClassify(many)).toBe(a);
    expect(a.length).toBeLessThanOrEqual(6000);
    expect(a.startsWith("#0 ")).toBe(true);
    const ids = [...a.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
    // The windows start at quarter midpoints of the rest (idx 772 and 1263 here): the middle is sampled.
    expect(ids.some((id) => id >= 700 && id <= 1300)).toBe(true);
    expect(ids.some((id) => id > 1700)).toBe(true);
  });

  test("sample of a short transcript", () => {
    const sample = sampleForClassify(segments.slice(0, 3));
    expect(sample.split("\n")).toHaveLength(3);
    expect(sample).not.toContain("...");
  });
});

describe("classifyStage", () => {
  test("normal path", async () => {
    const llm = ScriptedLlmProvider.fromList([ok]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value).toEqual(ok);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.req.model).toBe("gemini-3.5-flash-lite");
    const calls = rows<{ model: string }>(env.db, "SELECT model FROM ai_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("gemini-3.5-flash-lite");
  });

  test("the user's domain wins", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, domain: "meeting" }]);
    const result = await jobRun().run(
      classifyStage(llm, loadRouting()),
      input({ hint: { domain: "lecture", folder_id: null } })
    );
    expect(result.value.domain).toBe("lecture");
  });

  test("unknown folder id becomes new_name", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, folder_suggestion: { folder_id: "nope", new_name: "암호론" } }]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value.folder_suggestion).toEqual({ folder_id: null, new_name: "암호론" });
  });

  test("unknown folder id without new_name is dropped", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, folder_suggestion: { folder_id: "nope", new_name: null } }]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value.folder_suggestion).toEqual({ folder_id: null, new_name: null });
  });

  test("known folder id is kept, new_name cleared", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, folder_suggestion: { folder_id: "f1", new_name: "무시" } }]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value.folder_suggestion).toEqual({ folder_id: "f1", new_name: null });
  });

  test("tags are cleaned", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, tags: ["암호", " 암호 ", "AES", "aes"] }]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value.tags).toEqual(["암호", "AES"]);
  });

  test("second identical run hits the memo", async () => {
    const llm = ScriptedLlmProvider.fromList([ok, ok]);
    const run = jobRun();
    const stage = classifyStage(llm, loadRouting());
    await run.run(stage, input());
    const second = await run.run(stage, input());
    expect(second.resumed).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });

  test("a different job in the same scope hits the shared memo", async () => {
    const llm = ScriptedLlmProvider.fromList([ok, ok]);
    const stage = classifyStage(llm, loadRouting());
    await jobRun().run(stage, input());
    env.job("job-2");
    const second = await jobRun("job-2").run(stage, input());
    expect(second.cacheHit).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });

  test("changed filename misses the memo", async () => {
    const llm = ScriptedLlmProvider.fromList([ok, ok]);
    const stage = classifyStage(llm, loadRouting());
    const run = jobRun();
    await run.run(stage, input());
    await run.run(stage, input({ filename: "other.m4a" }));
    expect(llm.calls).toHaveLength(2);
  });

  test("changed routing model misses the memo", async () => {
    const llm = ScriptedLlmProvider.fromList([ok, ok]);
    const run = jobRun();
    const routing = loadRouting();
    await run.run(classifyStage(llm, routing), input());
    const changed = { ...routing, classify: { ...routing.classify, model: "gemini-3.8-flash" } };
    await run.run(classifyStage(llm, changed), input());
    expect(llm.calls).toHaveLength(2);
  });

  test("schema violation is repaired once", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...ok, title: "" }, ok]);
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value.title).toBe(ok.title);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.req.instruction).toContain("이전 응답이 검증을 통과하지 못했다");
  });

  test("two bad answers fail", async () => {
    const llm = ScriptedLlmProvider.fromList([{}, {}]);
    const err = await jobRun()
      .run(classifyStage(llm, loadRouting()), input())
      .then(
        () => null,
        (e) => e
      );
    expect(err).toBeInstanceOf(HarnessError);
    expect((err as HarnessError).kind).toBe("output_validation");
  });

  test("transient error is retried", async () => {
    const llm = new ScriptedLlmProvider((_req, callIndex) => {
      if (callIndex === 0) throw new HarnessError("transient", "503");
      return ok;
    });
    const result = await jobRun().run(classifyStage(llm, loadRouting()), input());
    expect(result.value).toEqual(ok);
    expect(llm.calls).toHaveLength(2);
  });
});
