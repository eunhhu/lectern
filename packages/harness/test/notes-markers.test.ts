import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { formatCompactTranscript, type CompactSegment } from "../src/notes/compact.ts";
import {
  importantNote,
  markerSegments,
  MAX_IMPORTANT_SEGMENTS,
  splitTranscriptWindows,
  structureStage,
  type StructureInput,
} from "../src/notes/structure.ts";
import { loadRouting } from "../src/routing.ts";
import { stageKey } from "../src/stage.ts";
import { loadTemplate } from "../src/templates.ts";
import { testEnv, type TestEnv } from "./helpers.ts";

// Recording markers (D-P6-3): which transcript segments a marker points at, and how the
// structure stage tells the model about them without changing unmarked recordings.

const seg = (idx: number, start_ms: number): CompactSegment => ({ idx, start_ms, speaker: "S1", text: `구간 ${idx}` });
const mark = (at_ms: number, label: string | null = null) => ({ at_ms, label });

describe("markerSegments", () => {
  test("marker inside a segment", () => {
    // s1 0–4000, s2 4000–9000: the marker plays in s2, and the segment before comes along.
    expect(markerSegments([seg(1, 0), seg(2, 4000)], [mark(5000)])).toEqual([
      { idx: 1, label: null },
      { idx: 2, label: null },
    ]);
  });

  test("marker in a gap", () => {
    // s1 0–4000, s2 6000–9000, marker 5000: the segment that ended before it (nothing before s1).
    expect(markerSegments([seg(1, 0), seg(2, 6000)], [mark(5000)])).toEqual([{ idx: 1, label: null }]);
  });

  test("marker before the first segment", () => {
    expect(markerSegments([seg(1, 1000), seg(2, 4000)], [mark(0)])).toEqual([{ idx: 1, label: null }]);
  });

  test("dedupe and order", () => {
    const segments = [seg(1, 0), seg(2, 4000), seg(3, 9000)];
    // Two marks in s3 and one in s2, given out of order: each segment once, in transcript order.
    expect(markerSegments(segments, [mark(9500), mark(5000), mark(9800)]).map((s) => s.idx)).toEqual([1, 2, 3]);
  });

  test("label is carried", () => {
    const important = markerSegments([seg(1, 0), seg(2, 4000)], [mark(5000, "시험")]);
    expect(important).toEqual([
      { idx: 1, label: null },
      { idx: 2, label: "시험" },
    ]);
    expect(importantNote(important)).toContain(`사용자가 녹음 중에 "중요"라고 표시한 구간: #1, #2(시험)`);
    expect(importantNote([])).toBe("");
    expect(importantNote(undefined)).toBe("");
  });

  test("cap of 40", () => {
    const segments = Array.from({ length: 300 }, (_, i) => seg(i, i * 1000));
    const markers = Array.from({ length: 100 }, (_, i) => mark(i * 3000 + 500));
    const important = markerSegments(segments, markers);
    expect(important).toHaveLength(MAX_IMPORTANT_SEGMENTS);
    expect(important[0]!.idx).toBe(0); // the first ones are kept
  });

  test("no segments or no markers", () => {
    expect(markerSegments([], [mark(1)])).toEqual([]);
    expect(markerSegments([seg(0, 0)], [])).toEqual([]);
  });
});

const okOut = {
  sections: [
    { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "요약", sources: ["#1"], pdf_pages: [] }] },
    { key: "topics", blocks: [] },
  ],
};

const input = (over: Partial<StructureInput> = {}): StructureInput => ({
  template: loadTemplate("lecture"),
  segments: Array.from({ length: 20 }, (_, idx) => seg(idx, idx * 1000)),
  language: "ko",
  ...over,
});

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
  env.job("job-1");
});
afterEach(() => env.close());

describe("structure stage with marks", () => {
  const routing = loadRouting();
  const keyOf = async (value: StructureInput) => {
    const stage = structureStage(ScriptedLlmProvider.fromList([]), routing);
    return stageKey(stage, "ws", await stage.key(value));
  };

  test("cache key changes with markers", async () => {
    const plain = await keyOf(input());
    expect(await keyOf(input({ important: [{ idx: 3, label: null }] }))).not.toBe(plain);
    expect(await keyOf(input({ important: [{ idx: 3, label: "시험" }] }))).not.toBe(await keyOf(input({ important: [{ idx: 3, label: null }] })));
    // An empty list is the same as none: an unmarked recording keeps the key it had.
    expect(await keyOf(input({ important: [] }))).toBe(plain);
    const stage = structureStage(ScriptedLlmProvider.fromList([]), routing);
    expect((await stage.key(input())).inputs).toHaveLength(1);
  });

  test("the instruction names the marks; without marks it is unchanged", async () => {
    const marked = ScriptedLlmProvider.fromList([okOut]);
    await env.harness().job({ jobId: "job-1", scope: "ws" }).run(structureStage(marked, routing), input({ important: [{ idx: 4, label: "시험" }] }));
    expect(marked.calls[0]!.req.instruction).toContain(`사용자가 녹음 중에 "중요"라고 표시한 구간: #4(시험)`);
    expect(marked.calls[0]!.req.instruction).toContain("표시가 없는 구간을 덜 중요하게 다루라는 뜻은 아니다.");

    env.job("job-2");
    const plain = ScriptedLlmProvider.fromList([okOut]);
    await env.harness().job({ jobId: "job-2", scope: "ws2" }).run(structureStage(plain, routing), input());
    expect(plain.calls[0]!.req.instruction).not.toContain("중요");
  });

  test("long transcript: each map window gets its own marks, the reduce gets all", async () => {
    const segments = Array.from({ length: 700 }, (_, idx) => ({ idx, start_ms: idx * 1000, speaker: "S1", text: "가".repeat(100) }));
    const windows = splitTranscriptWindows(formatCompactTranscript({ segments }).text, 20_000);
    expect(windows.length).toBeGreaterThan(2);
    const lastIdx = Number(/^#(\d+) /.exec(windows.at(-1)!.split("\n").at(-1)!)![1]);
    const llm = new ScriptedLlmProvider((_req, callIndex) =>
      callIndex < windows.length ? { points: [{ text: `요약 ${callIndex}`, sources: [`#${callIndex}`] }] } : okOut
    );
    const important = [{ idx: 0, label: null }, { idx: lastIdx, label: "끝" }];
    await env.harness().job({ jobId: "job-1", scope: "ws" }).run(structureStage(llm, routing), input({ segments, important }));
    const map = llm.calls.slice(0, windows.length).map((c) => c.req.instruction);
    expect(map[0]).toContain(`표시한 구간: #0\n`);
    expect(map[0]).not.toContain(`#${lastIdx}(끝)`);
    expect(map.at(-1)).toContain(`표시한 구간: #${lastIdx}(끝)`);
    expect(map.slice(1, -1).every((text) => !text.includes("중요"))).toBe(true);
    expect(llm.calls.at(-1)!.req.instruction).toContain(`표시한 구간: #0, #${lastIdx}(끝)`);
  });
});
