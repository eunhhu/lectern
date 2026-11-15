import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DocumentBody, type TemplateOutput } from "@lectern/domain";
import { ScriptedLlmProvider } from "../src/eval/scripted-llm.ts";
import { NotesResult } from "../src/notes/schemas.ts";
import {
  lcsRatio,
  verifyDocument,
  VerifyOutput,
  verifyStage,
  type RepairFix,
  type RepairTarget,
  type VerifyInput,
  type VerifySegment,
} from "../src/notes/verify.ts";
import { loadRouting } from "../src/routing.ts";
import { loadTemplate } from "../src/templates.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const QUOTE3 = "다음 주 화요일까지 과제를 제출하세요";
const segments: VerifySegment[] = Array.from({ length: 6 }, (_, idx) => ({
  idx,
  start_ms: idx * 60000,
  end_ms: idx * 60000 + 55000,
  speaker: "S1",
  text: idx === 3 ? QUOTE3 : `내용 ${idx} 에 대한 설명`,
}));

const recordedAtMs = Date.parse("2026-10-19T14:00:00+09:00");
const para = (text: string, sources: string[]) => ({ type: "paragraph", heading: null, text, sources, pdf_pages: [] });
const baseStructure = (): TemplateOutput =>
  ({
    sections: [
      { key: "summary", blocks: [para("요약", ["#1"])] },
      { key: "topics", blocks: [para("주제", ["#2"])] },
    ],
  }) as TemplateOutput;

type Model = { date: string; time: string | null; end_time: string | null; all_day: boolean };
const ev = (raw: string, model: Model, over: Record<string, unknown> = {}) => ({
  title: "과제",
  kind: "deadline",
  raw_expression: raw,
  model_resolution: model,
  evidence: ["#3"],
  quote: "다음 주 화요일까지 과제를",
  confidence: 0.9,
  ...over,
});
const allDay = (date: string): Model => ({ date, time: null, end_time: null, all_day: true });

const input = (over: Partial<VerifyInput> = {}): VerifyInput => ({
  template: loadTemplate("lecture"),
  structure: baseStructure(),
  extract: { events: [], glossary: [] },
  transcript: { segments, gaps: [] },
  recordedAtMs,
  recordedAtSource: "client",
  tz: "Asia/Seoul",
  language: "ko",
  ...over,
});

function fakeRepair(answer: (targets: RepairTarget[]) => RepairFix[] = () => []) {
  const calls: RepairTarget[][] = [];
  const fn = async (targets: RepairTarget[]) => {
    calls.push(targets);
    return answer(targets);
  };
  return { fn, calls };
}

const topicsWith = (sources: string[]) =>
  ({
    sections: [
      { key: "summary", blocks: [para("요약", ["#1"])] },
      { key: "topics", blocks: [para("주제", sources)] },
    ],
  }) as TemplateOutput;

const firstEvent = async (event: unknown, over: Partial<VerifyInput> = {}) => {
  const out = await verifyDocument(input({ extract: { events: [event as any], glossary: [] }, ...over }), null);
  return { out, event: out.events[0] };
};

describe("verifyDocument: sources", () => {
  test("unknown segment ids are removed", async () => {
    const repair = fakeRepair();
    const structure = baseStructure();
    (structure.sections[0]!.blocks[0] as any).sources = ["#1", "#99"];
    const out = await verifyDocument(input({ structure }), repair.fn);
    expect(out.body.sections[0]!.blocks[0]!.sources).toEqual([{ kind: "transcript", start_idx: 1, end_idx: 1 }]);
    const item = out.report.items.find((i) => i.ref === "summary#1")!;
    expect(item.reasons).toContain("dropped_ref:#99");
    expect(item.outcome).toBe("fixed");
    expect(repair.calls).toHaveLength(0);
  });

  test("ranges are expanded", async () => {
    const structure = baseStructure();
    (structure.sections[0]!.blocks[0] as any).sources = ["#1-#3"];
    const out = await verifyDocument(input({ structure }), null);
    expect(out.body.sections[0]!.blocks[0]!.sources).toEqual([{ kind: "transcript", start_idx: 1, end_idx: 3 }]);
  });

  test("block with no source: one repair then dropped", async () => {
    const repair = fakeRepair();
    const out = await verifyDocument(input({ structure: topicsWith(["#99"]) }), repair.fn);
    expect(repair.calls).toHaveLength(1);
    expect(repair.calls[0]).toHaveLength(1);
    expect(repair.calls[0]![0]!.ref).toBe("topics#1");
    const topics = out.body.sections.find((s) => s.key === "topics")!;
    expect(topics.blocks).toEqual([]);
    expect(out.report.dropped_blocks).toBe(1);
    expect(out.report.repaired).toBe(true);
    expect(out.report.items.find((i) => i.ref === "topics#1")!.outcome).toBe("dropped");
    expect(out.partial).toBe(true);
  });

  test("repair fixes a block", async () => {
    const repair = fakeRepair((targets) =>
      targets.map((t) => ({ ref: t.ref, block: para("주제", ["#2"]) as any, event: null, action_item: null }))
    );
    const out = await verifyDocument(input({ structure: topicsWith(["#99"]) }), repair.fn);
    const topics = out.body.sections.find((s) => s.key === "topics")!;
    expect(topics.blocks).toHaveLength(1);
    expect(out.report.items.find((i) => i.ref === "topics#1")!.outcome).toBe("fixed");
    expect(out.report.dropped_blocks).toBe(0);
    expect(out.partial).toBe(false);
  });

  test("repair that still fails drops", async () => {
    const repair = fakeRepair((targets) =>
      targets.map((t) => ({ ref: t.ref, block: para("주제", ["#98"]) as any, event: null, action_item: null }))
    );
    const out = await verifyDocument(input({ structure: topicsWith(["#99"]) }), repair.fn);
    expect(out.report.dropped_blocks).toBe(1);
    expect(repair.calls).toHaveLength(1);
  });

  test("repair is skipped when nothing to fix", async () => {
    const repair = fakeRepair();
    const out = await verifyDocument(input(), repair.fn);
    expect(repair.calls).toHaveLength(0);
    expect(out.report.repaired).toBe(false);
  });
});

describe("verifyDocument: quotes and dates", () => {
  test("quote mismatch lowers confidence", async () => {
    const { event } = await firstEvent(ev("다음 주 화요일까지", allDay("2026-10-27"), { quote: "전혀 다른 문장입니다 가나다라마바사" }));
    expect(event!.flags).toContain("low_confidence");
    expect(event!.confidence).toBeLessThanOrEqual(0.3);
  });

  test("quote match keeps confidence", async () => {
    const { event } = await firstEvent(ev("다음 주 화요일까지", allDay("2026-10-27"), { quote: QUOTE3 }));
    expect(event!.flags).not.toContain("low_confidence");
    expect(event!.confidence).toBe(0.9);
  });

  test("lcsRatio", () => {
    expect(lcsRatio("ab cd", "xxabcdxx")).toBe(1);
    expect(lcsRatio("가나다라", "가나")).toBe(0.5);
  });

  test("parser date is used and mismatch flagged", async () => {
    const { event } = await firstEvent(ev("다음 주 화요일까지", allDay("2026-10-28")));
    expect(event!.start_at).toBe(Date.parse("2026-10-27T00:00:00+09:00"));
    expect(event!.end_at).toBe(Date.parse("2026-10-28T00:00:00+09:00"));
    expect(event!.all_day).toBe(true);
    expect(event!.resolution).toEqual({ method: "parser", rule: "next_week_weekday" });
    expect(event!.flags).toContain("date_mismatch");
    expect(event!.confidence).toBe(0.6);
  });

  test("agreeing model keeps confidence", async () => {
    const { event } = await firstEvent(ev("다음 주 화요일까지", allDay("2026-10-27")));
    expect(event!.flags).not.toContain("date_mismatch");
    expect(event!.confidence).toBe(0.9);
  });

  test("timed event", async () => {
    const { event } = await firstEvent(
      ev("내일 오후 3시", { date: "2026-10-20", time: "15:00", end_time: null, all_day: false }, { kind: "meeting" })
    );
    expect(event!.start_at).toBe(Date.parse("2026-10-20T15:00:00+09:00"));
    expect(event!.end_at).toBeNull();
    expect(event!.all_day).toBe(false);
  });

  test("parser failure uses the model", async () => {
    const { event } = await firstEvent(ev("학기 말쯤", allDay("2026-12-15")));
    expect(event!.start_at).toBe(Date.parse("2026-12-15T00:00:00+09:00"));
    expect(event!.resolution).toEqual({ method: "model", rule: null });
    expect(event!.flags).toContain("needs_review");
  });

  test("estimated recording time", async () => {
    const { event } = await firstEvent(ev("내일", allDay("2026-10-20")), { recordedAtSource: "upload" });
    expect(event!.flags).toContain("recorded_at_estimated");
    expect(event!.confidence).toBeLessThanOrEqual(0.6);
  });

  test("weekday mismatch is flagged", async () => {
    const { event } = await firstEvent(ev("12월 24일 수요일", allDay("2026-12-24")));
    expect(event!.flags).toContain("weekday_mismatch");
    expect(event!.start_at).toBe(Date.parse("2026-12-24T00:00:00+09:00"));
  });

  test("end before start is dropped", async () => {
    const { out } = await firstEvent(
      ev("학기 말쯤", { date: "2026-12-15", time: "15:00", end_time: "14:00", all_day: false })
    );
    expect(out.events).toEqual([]);
    expect(out.report.items.find((i) => i.ref === "event:0")!.reasons).toContain("end_before_start");
  });

  test("far future is dropped", async () => {
    const { out } = await firstEvent(ev("학기 말쯤", allDay("2028-01-01")));
    expect(out.events).toEqual([]);
    expect(out.report.items.find((i) => i.ref === "event:0")!.reasons).toContain("too_far_future");
  });

  test("past deadline is kept with needs_review", async () => {
    const { event } = await firstEvent(ev("9월 18일", allDay("2026-09-18")));
    expect(event).toBeDefined();
    expect(event!.flags).toContain("needs_review");
  });

  test("duplicate events are removed", async () => {
    const one = ev("내일", allDay("2026-10-20"), { title: "과제 제출" });
    const out = await verifyDocument(input({ extract: { events: [one, { ...one }] as any, glossary: [] } }), null);
    expect(out.events).toHaveLength(1);
    expect(out.report.items.find((i) => i.ref === "event:1")!.reasons).toContain("duplicate");
  });

  test("action item due date", async () => {
    const template = loadTemplate("meeting");
    const item = { text: "보고서 작성", owner_name: "김", due_raw: "금요일까지", evidence: ["#3"], quote: null };
    const out = await verifyDocument(
      input({ template, extract: { events: [], action_items: [item], decisions: [] } }),
      null
    );
    expect(out.action_items[0]!.due_at).toBe(Date.parse("2026-10-23T23:59:00+09:00"));
    const unreadable = await verifyDocument(
      input({ template, extract: { events: [], action_items: [{ ...item, due_raw: "나중에" }], decisions: [] } }),
      null
    );
    expect(unreadable.action_items[0]!.due_at).toBeNull();
    expect(unreadable.action_items[0]!.flags).toContain("needs_review");
  });

  test("decisions and glossary without evidence are dropped", async () => {
    const lecture = await verifyDocument(
      input({ extract: { events: [], glossary: [{ term: "ECB", definition: "모드", evidence: ["#99"] }] } }),
      null
    );
    expect(lecture.body.sections.find((s) => s.key === "glossary")).toBeUndefined();
    expect(lecture.report.items.find((i) => i.ref === "glossary:0")!.outcome).toBe("dropped");
    const meeting = await verifyDocument(
      input({
        template: loadTemplate("meeting"),
        extract: { events: [], action_items: [], decisions: [{ text: "결정", evidence: ["#99"] }] },
      }),
      null
    );
    expect(meeting.body.sections.find((s) => s.key === "decisions")).toBeUndefined();
    expect(meeting.report.items.find((i) => i.ref === "decision:0")!.outcome).toBe("dropped");
  });
});

describe("verifyDocument: assembly", () => {
  const assembled = () =>
    verifyDocument(
      input({
        extract: {
          events: [ev("다음 주 화요일까지", allDay("2026-10-27")) as any],
          glossary: [{ term: "ECB", definition: "블록 암호 운영 모드", evidence: ["#2"] }],
        },
      }),
      null
    );

  test("body sections and block ids", async () => {
    const out = await assembled();
    expect(out.body.sections.map((s) => s.key)).toEqual(["summary", "topics", "glossary", "events"]);
    const def = loadTemplate("lecture").def;
    for (const section of out.body.sections) {
      expect(section.title).toBe(def.sections.find((s) => s.key === section.key)!.title);
    }
    const ids: string[] = out.body.sections.flatMap((s) => s.blocks.map((b) => String(b.id)));
    expect(ids).toEqual(ids.map((_, i) => `b${i + 1}`));
    expect(() => DocumentBody.parse(out.body)).not.toThrow();
    const events = out.body.sections.find((s) => s.key === "events")!.blocks[0] as any;
    expect(events.items[0].text).toBe("과제 (2026-10-27)");
  });

  test("required section empty marks partial", async () => {
    const structure = { sections: [{ key: "summary", blocks: [para("요약", ["#1"])] }, { key: "topics", blocks: [] }] };
    const out = await verifyDocument(input({ structure: structure as TemplateOutput }), null);
    expect(out.partial).toBe(true);
    expect(out.body.sections.find((s) => s.key === "topics")!.blocks).toEqual([]);
  });

  const gapSegments: VerifySegment[] = [0, 60000, 120000, 1380000, 1440000, 1500000].map((start_ms, idx) => ({
    idx,
    start_ms,
    end_ms: start_ms + 55000,
    speaker: "S1",
    text: `내용 ${idx}`,
  }));
  const fourTopics = {
    sections: [
      { key: "summary", blocks: [para("요약", ["#0"])] },
      { key: "topics", blocks: [para("가", ["#0"]), para("나", ["#1"]), para("다", ["#3"]), para("라", ["#4"])] },
    ],
  } as TemplateOutput;

  test("gap block position", async () => {
    const out = await verifyDocument(
      input({
        structure: fourTopics,
        transcript: { segments: gapSegments, gaps: [{ kind: "break", start_ms: 180000, end_ms: 1380000 }] },
      }),
      null
    );
    const topics = out.body.sections.find((s) => s.key === "topics")!;
    expect(topics.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "gap", "paragraph", "paragraph"]);
    const { id: _id, ...gap } = topics.blocks[2] as any;
    expect(gap).toEqual({ type: "gap", kind: "break", start_ms: 180000, end_ms: 1380000, heading: null, sources: [] });
  });

  test("gap after all blocks", async () => {
    const out = await verifyDocument(
      input({
        structure: fourTopics,
        transcript: { segments: gapSegments, gaps: [{ kind: "tail", start_ms: 1600000, end_ms: 1700000 }] },
      }),
      null
    );
    const topics = out.body.sections.find((s) => s.key === "topics")!;
    expect(topics.blocks.at(-1)!.type).toBe("gap");
  });

  test("gap goes to the first structure section when there is no topics", async () => {
    const structure = {
      sections: [
        { key: "summary", blocks: [para("요지", ["#1"])] },
        { key: "claims", blocks: [para("주장", ["#2"])] },
      ],
    } as TemplateOutput;
    const out = await verifyDocument(
      input({
        template: loadTemplate("seminar"),
        structure,
        extract: { glossary: [] },
        transcript: { segments, gaps: [{ kind: "break", start_ms: 0, end_ms: 10 }] },
      }),
      null
    );
    const summary = out.body.sections.find((s) => s.key === "summary")!;
    expect(summary.blocks.some((b) => b.type === "gap")).toBe(true);
  });

  test("result parses", async () => {
    const out = await assembled();
    expect(() => VerifyOutput.parse(out)).not.toThrow();
    const classification = {
      domain: "lecture",
      language: "ko",
      title: "제목",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    };
    const result = NotesResult.safeParse({
      ...out,
      classification,
      template: { id: "lecture", version: 1 },
      markdown: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("verifyStage", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = testEnv();
    env.job("job-1");
  });
  afterEach(() => env.close());
  const jobRun = () => env.harness().job({ jobId: "job-1", scope: "ws" });

  test("stage: repair is metered with the repair model", async () => {
    const llm = ScriptedLlmProvider.fromList([{ fixes: [] }]);
    await jobRun().run(verifyStage(llm, loadRouting()), input({ structure: topicsWith(["#99"]) }));
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.req.model).toBe("gemini-3.8-flash");
    expect(llm.calls[0]!.req.maxOutputTokens).toBe(8192);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(1);
  });

  test("stage: no call when nothing to fix", async () => {
    const llm = ScriptedLlmProvider.fromList([]);
    await jobRun().run(verifyStage(llm, loadRouting()), input());
    expect(llm.calls).toHaveLength(0);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(0);
  });

  test("stage: invalid repair answer drops the item", async () => {
    const llm = ScriptedLlmProvider.fromList([{}, {}]);
    const result = await jobRun().run(verifyStage(llm, loadRouting()), input({ structure: topicsWith(["#99"]) }));
    expect(result.value.report.dropped_blocks).toBe(1);
    expect(result.value.report.repaired).toBe(true);
  });

  test("stage: memo hit", async () => {
    const llm = ScriptedLlmProvider.fromList([]);
    const run = jobRun();
    const stage = verifyStage(llm, loadRouting());
    await run.run(stage, input());
    const second = await run.run(stage, input());
    expect(second.resumed).toBe(true);
  });
});
