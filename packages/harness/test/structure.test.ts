import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessError } from "../src/errors.ts";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { formatCompactTranscript, type CompactSegment } from "../src/notes/compact.ts";
import { NOTES_SYSTEM } from "../src/notes/prompt.ts";
import { PartialSummary, splitTranscriptWindows, structureStage, type StructureInput } from "../src/notes/structure.ts";
import { loadRouting } from "../src/routing.ts";
import { loadTemplate, TEMPLATES_DIR } from "../src/templates.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const segs = (n: number, len: number): CompactSegment[] =>
  Array.from({ length: n }, (_, idx) => ({ idx, start_ms: idx * 1000, speaker: "S1", text: "가".repeat(len) }));

const okOut = {
  sections: [
    { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "요약", sources: ["#1"], pdf_pages: [] }] },
    { key: "topics", blocks: [] },
  ],
};

const input = (over: Partial<StructureInput> = {}): StructureInput => ({
  template: loadTemplate("lecture"),
  segments: segs(20, 30),
  language: "ko",
  ...over,
});

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

describe("structureStage", () => {
  test("normal path", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut]);
    const result = await jobRun().run(structureStage(llm, loadRouting()), input());
    expect(result.value).toEqual(okOut as any);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.req.model).toBe("gemini-3.8-flash");
    expect(llm.calls[0]!.req.maxOutputTokens).toBe(16384);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(1);
  });

  test("request order is system, transcript, instruction", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut]);
    await jobRun().run(structureStage(llm, loadRouting()), input());
    const req = llm.calls[0]!.req;
    expect(req.system).toBe(NOTES_SYSTEM);
    const first = req.context[0]!;
    expect(first.type === "text" && first.text.startsWith("전사:\n#0 [00:00] S1: ")).toBe(true);
    expect(req.instruction).toContain("출력 언어: ko");
    expect(req.instruction).toContain("- summary ");
    expect(req.instruction).toContain("- topics ");
    expect(req.instruction).toContain("- exam_points ");
    expect(req.instruction).not.toContain("- glossary ");
    expect(req.instruction).not.toContain("- events ");
  });

  test("schema violation is repaired once", async () => {
    const llm = ScriptedLlmProvider.fromList([{ sections: [] }, okOut]);
    await jobRun().run(structureStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.req.instruction).toContain("이전 응답이 검증을 통과하지 못했다");
  });

  test("two bad answers fail", async () => {
    const llm = ScriptedLlmProvider.fromList([{ sections: [] }, { sections: [] }]);
    const err = await failure(jobRun().run(structureStage(llm, loadRouting()), input()));
    expect(err).toBeInstanceOf(HarnessError);
    expect(err!.kind).toBe("output_validation");
  });

  test("disallowed block type is rejected", async () => {
    const bad = {
      sections: [
        { key: "summary", blocks: [{ type: "quote", text: "인용", speaker: null, sources: ["#1"] }] },
        { key: "topics", blocks: [] },
      ],
    };
    const llm = ScriptedLlmProvider.fromList([bad, bad]);
    const err = await failure(jobRun().run(structureStage(llm, loadRouting()), input()));
    expect(err!.kind).toBe("output_validation");
  });

  test("splitTranscriptWindows", () => {
    expect(splitTranscriptWindows("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
    expect(splitTranscriptWindows("aa\nbbbbbbbbbbbb\ncc", 5)).toEqual(["aa", "bbbbbbbbbbbb", "cc"]);
    expect(splitTranscriptWindows("", 10)).toEqual([]);
  });

  test("long transcript uses map-reduce", async () => {
    const segments = segs(700, 100);
    const text = formatCompactTranscript({ segments }).text;
    expect(text.length).toBeGreaterThan(60_000);
    const windows = splitTranscriptWindows(text, 20_000);
    const llm = new ScriptedLlmProvider((_req, callIndex) =>
      callIndex < windows.length ? { points: [{ text: `요약 ${callIndex}`, sources: [`#${callIndex}`] }] } : okOut
    );
    const result = await jobRun().run(structureStage(llm, loadRouting()), input({ segments }));
    expect(llm.calls).toHaveLength(windows.length + 1);
    expect(llm.calls[0]!.req.schema.safeParse({ points: [] }).success).toBe(true);
    expect(llm.calls[0]!.req.schema).toBe(PartialSummary);
    const last = llm.calls.at(-1)!.req.context[0]!;
    const lastText = last.type === "text" ? last.text : "";
    expect(lastText).toContain("- 요약 0 [#0]");
    expect(lastText).toContain("- 요약 1 [#1]");
    const summary = result.value.sections.find((s) => s.key === "summary")!;
    expect((summary.blocks[0] as any).sources).toEqual(["#1"]);
  });

  test("short transcript never uses map", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut]);
    await jobRun().run(structureStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(1);
  });

  test("memo hit on resume", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut, okOut]);
    const run = jobRun();
    const stage = structureStage(llm, loadRouting());
    await run.run(stage, input());
    const second = await run.run(stage, input());
    expect(second.resumed).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });

  test("editing a template file misses the memo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lectern-structure-tpl-"));
    try {
      cpSync(fileURLToPath(TEMPLATES_DIR), dir, { recursive: true });
      const llm = ScriptedLlmProvider.fromList([okOut, okOut]);
      const run = jobRun();
      const stage = structureStage(llm, loadRouting());
      await run.run(stage, input({ template: loadTemplate("lecture", dir) }));
      appendFileSync(join(dir, "lecture", "prompt.structure.md"), "\n예시를 하나씩 든다.\n");
      await run.run(stage, input({ template: loadTemplate("lecture", dir) }));
      expect(llm.calls).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("changed language misses the memo", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut, okOut]);
    const run = jobRun();
    const stage = structureStage(llm, loadRouting());
    await run.run(stage, input());
    await run.run(stage, input({ language: "en" }));
    expect(llm.calls).toHaveLength(2);
  });

  test("budget stop", async () => {
    env.job("job-b", { budgetMicrousd: 5 });
    env.db.query(`UPDATE job SET spent_microusd = 10 WHERE id = 'job-b'`).run();
    const llm = ScriptedLlmProvider.fromList([okOut]);
    const err = await failure(jobRun("job-b").run(structureStage(llm, loadRouting()), input()));
    expect(err).toBeInstanceOf(HarnessError);
    expect(err!.kind).toBe("budget");
    expect(llm.calls).toHaveLength(0);
  });

  test("transient error is retried", async () => {
    const llm = new ScriptedLlmProvider((_req, callIndex) => {
      if (callIndex === 0) throw new HarnessError("transient", "503");
      return okOut;
    });
    await jobRun().run(structureStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(2);
  });

  test("questions never asked", async () => {
    const llm = ScriptedLlmProvider.fromList([okOut]);
    await jobRun().run(structureStage(llm, loadRouting()), input());
    expect(llm.calls[0]!.req.instruction).not.toContain("- questions ");
  });
});
