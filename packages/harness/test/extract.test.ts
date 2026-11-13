import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessError } from "../src/errors.ts";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { GeminiLlmProvider } from "../src/gemini-llm.ts";
import type { CompactSegment } from "../src/notes/compact.ts";
import { extractSchemaFor, extractStage, formatRecordedAt, type ExtractInput } from "../src/notes/extract.ts";
import { structureStage } from "../src/notes/structure.ts";
import { loadRouting } from "../src/routing.ts";
import { loadTemplate, TEMPLATES_DIR } from "../src/templates.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const segments: CompactSegment[] = Array.from({ length: 10 }, (_, idx) => ({
  idx,
  start_ms: idx * 60000,
  speaker: "S1",
  text: `내용 ${idx}`,
}));

const recordedAtMs = Date.parse("2026-10-19T14:00:00+09:00");

const input = (over: Partial<ExtractInput> = {}): ExtractInput => ({
  template: loadTemplate("lecture"),
  segments,
  language: "ko",
  recordedAtMs,
  tz: "Asia/Seoul",
  ...over,
});

const lectureOut = {
  events: [
    {
      title: "과제 제출",
      kind: "deadline",
      raw_expression: "다음 주 화요일까지",
      model_resolution: { date: "2026-10-27", time: null, end_time: null, all_day: true },
      evidence: ["#3"],
      quote: "다음 주 화요일까지 제출",
      confidence: 0.9,
    },
  ],
  glossary: [{ term: "ECB", definition: "블록 암호 운영 모드", evidence: ["#2"] }],
};

const okOut = {
  sections: [
    { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "요약", sources: ["#1"], pdf_pages: [] }] },
    { key: "topics", blocks: [] },
  ],
};

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
  env.job("job-1");
});
afterEach(() => env.close());

const jobRun = (jobId = "job-1") => env.harness().job({ jobId, scope: "ws" });
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as HarnessError
  );

describe("extractStage", () => {
  test("lecture normal path", async () => {
    const llm = ScriptedLlmProvider.fromList([lectureOut]);
    const result = await jobRun().run(extractStage(llm, loadRouting()), input());
    expect(result.value).toEqual(lectureOut as any);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.req.model).toBe("gemini-3.8-flash");
    expect(llm.calls[0]!.req.maxOutputTokens).toBe(8192);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(1);
  });

  test("only enabled fields are asked", async () => {
    const llm = ScriptedLlmProvider.fromList([lectureOut]);
    await jobRun().run(extractStage(llm, loadRouting()), input());
    const instruction = llm.calls[0]!.req.instruction;
    expect(instruction).toContain("- events:");
    expect(instruction).toContain("- glossary:");
    expect(instruction).not.toContain("- action_items:");
    expect(instruction).not.toContain("- decisions:");
    expect(instruction).not.toContain("- questions:");
    expect(instruction).toContain("녹음 시각: 2026-10-19 (월) 14:00 Asia/Seoul");
    expect(instruction).toContain("출력 언어: ko");
  });

  test("meeting asks events, action_items, decisions", async () => {
    const llm = ScriptedLlmProvider.fromList([{ events: [], action_items: [], decisions: [] }]);
    await jobRun().run(extractStage(llm, loadRouting()), input({ template: loadTemplate("meeting") }));
    const instruction = llm.calls[0]!.req.instruction;
    expect(instruction).toContain("- events:");
    expect(instruction).toContain("- action_items:");
    expect(instruction).toContain("- decisions:");
    expect(instruction).not.toContain("- glossary:");
  });

  test("a switched-off field is rejected", async () => {
    const llm = ScriptedLlmProvider.fromList([{ ...lectureOut, action_items: [] }, lectureOut]);
    await jobRun().run(extractStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.req.instruction).toContain("이전 응답이 검증을 통과하지 못했다");
  });

  test("extractSchemaFor is strict", () => {
    const schema = extractSchemaFor(loadTemplate("lecture").def);
    expect(schema.safeParse({ events: [], glossary: [], action_items: [] }).success).toBe(false);
    expect(schema.safeParse({ events: [], glossary: [] }).success).toBe(true);
    expect(schema.safeParse({ events: [] }).success).toBe(false);
  });

  test("interview makes no call", async () => {
    const llm = ScriptedLlmProvider.fromList([]);
    const result = await jobRun().run(extractStage(llm, loadRouting()), input({ template: loadTemplate("interview") }));
    expect(result.value).toEqual({});
    expect(llm.calls).toHaveLength(0);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(0);
  });

  test("same prefix as structure", async () => {
    const structureLlm = ScriptedLlmProvider.fromList([okOut]);
    const extractLlm = ScriptedLlmProvider.fromList([lectureOut]);
    const run = jobRun();
    await run.run(structureStage(structureLlm, loadRouting()), { template: loadTemplate("lecture"), segments, language: "ko" });
    await run.run(extractStage(extractLlm, loadRouting()), input());
    const gemini = new GeminiLlmProvider({ apiKey: () => "k" });
    const a = gemini.requestBody(structureLlm.calls[0]!.req) as any;
    const b = gemini.requestBody(extractLlm.calls[0]!.req) as any;
    expect(a.systemInstruction).toEqual(b.systemInstruction);
    expect(JSON.stringify(a.contents[0].parts.slice(0, -1))).toBe(JSON.stringify(b.contents[0].parts.slice(0, -1)));
    expect(a.contents[0].parts.at(-1).text).not.toBe(b.contents[0].parts.at(-1).text);
  });

  test("memo hit on resume", async () => {
    const llm = ScriptedLlmProvider.fromList([lectureOut, lectureOut]);
    const run = jobRun();
    const stage = extractStage(llm, loadRouting());
    await run.run(stage, input());
    const second = await run.run(stage, input());
    expect(second.resumed).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });

  test("changed recorded time misses memo", async () => {
    const llm = ScriptedLlmProvider.fromList([lectureOut, lectureOut]);
    const run = jobRun();
    const stage = extractStage(llm, loadRouting());
    await run.run(stage, input());
    await run.run(stage, input({ recordedAtMs: recordedAtMs + 86_400_000 }));
    expect(llm.calls).toHaveLength(2);
  });

  test("editing a template prompt misses memo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lectern-extract-tpl-"));
    try {
      cpSync(fileURLToPath(TEMPLATES_DIR), dir, { recursive: true });
      const llm = ScriptedLlmProvider.fromList([lectureOut, lectureOut]);
      const run = jobRun();
      const stage = extractStage(llm, loadRouting());
      await run.run(stage, input({ template: loadTemplate("lecture", dir) }));
      appendFileSync(join(dir, "lecture", "prompt.extract.md"), "\n과제 마감은 빠뜨리지 않는다.\n");
      await run.run(stage, input({ template: loadTemplate("lecture", dir) }));
      expect(llm.calls).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("transient error is retried", async () => {
    const llm = new ScriptedLlmProvider((_req, callIndex) => {
      if (callIndex === 0) throw new HarnessError("transient", "503");
      return lectureOut;
    });
    await jobRun().run(extractStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(2);
  });

  test("budget stop", async () => {
    env.job("job-b", { budgetMicrousd: 5 });
    env.db.query(`UPDATE job SET spent_microusd = 10 WHERE id = 'job-b'`).run();
    const llm = ScriptedLlmProvider.fromList([lectureOut]);
    const err = await failure(jobRun("job-b").run(extractStage(llm, loadRouting()), input()));
    expect(err!.kind).toBe("budget");
    expect(llm.calls).toHaveLength(0);
  });

  test("formatRecordedAt", () => {
    expect(formatRecordedAt(recordedAtMs, "Asia/Seoul")).toBe("2026-10-19 (월) 14:00 Asia/Seoul");
    expect(formatRecordedAt(recordedAtMs, "America/New_York")).toBe("2026-10-19 (월) 01:00 America/New_York");
  });
});
