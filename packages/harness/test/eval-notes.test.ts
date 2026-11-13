import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateNotesCost,
  EXAMPLE_SET_DIR,
  formatNotesReport,
  loadEvalSet,
  runNotesEval,
  scoreNotes,
  totalsOf,
  type Annotation,
  type EvalRun,
  type NotesItemMetrics,
  type NotesResult,
  type Transcript,
  type VerifiedActionItem,
  type VerifiedEvent,
  type VerifyReport,
} from "../src/index.ts";

// The notes eval (`bun run harness eval --notes`): metrics on hand-made results, and whole
// runs over the bundled example set with the scripted oracle. No real provider is called.

const dir = mkdtempSync(join(process.env.LECTERN_TEST_SANDBOX ?? tmpdir(), "notes-eval-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const M = 60_000;

/** Segments #0..#9, one a minute. */
const transcript: Transcript = {
  version: 1,
  duration_ms: 10 * M,
  failed_chunks: [],
  gaps: [],
  speakers: [{ label: "S1", confidence: 1, basis: "single_chunk", segments: 10, chars: 100, members: [{ chunk: 0, label: "S1" }] }],
  segments: Array.from({ length: 10 }, (_, idx) => ({ idx, start_ms: idx * M, end_ms: idx * M + 50_000, speaker: "S1", source_chunk: 0, text: `문장 ${idx}` })),
};

function event(date: string, time: string | null, idx: number, title = "과제 마감"): VerifiedEvent {
  return {
    title,
    kind: "deadline",
    start_at: Date.parse(`${date}T${time ?? "00:00"}:00+09:00`),
    end_at: null,
    all_day: time === null,
    tz: "Asia/Seoul",
    raw_expression: "다음 주",
    resolution: { method: "model", rule: null },
    confidence: 0.9,
    evidence: { sources: [{ kind: "transcript", start_idx: idx, end_idx: idx }], quote: null },
    flags: [],
  };
}

function action(idx: number): VerifiedActionItem {
  return { text: "보고서 제출", owner_name: null, due_at: null, due_raw: null, evidence: { sources: [{ kind: "transcript", start_idx: idx, end_idx: idx }], quote: null }, flags: [] };
}

function result(events: VerifiedEvent[], actions: VerifiedActionItem[] = [], items: VerifyReport["items"] = []): NotesResult {
  return {
    classification: {
      domain: "lecture",
      language: "ko",
      title: "테스트",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    },
    template: { id: "lecture", version: 1 },
    body: { sections: [] },
    markdown: "",
    events,
    action_items: actions,
    report: { repaired: false, dropped_blocks: 0, items },
    partial: false,
  };
}

function annotation(kind: Annotation["kind"], startMs: number, date: string | null = null, time: string | null = null): Annotation {
  return { item: "x", kind, start_ms: startMs, end_ms: null, text: "주석", date, time, owner: null };
}

describe("scoreNotes", () => {
  test("scoreNotes: perfect result", () => {
    const m = scoreNotes({ result: result([event("2026-10-26", null, 3)]), transcript, annotations: [annotation("event", 3 * M, "2026-10-26")] });
    expect(m.events).toEqual({ annotated: 1, correct: 1 });
    expect(m.extracted).toEqual({ total: 1, unmatched: 0 });
    expect(m.schema_valid).toBe(true);
  });

  test("scoreNotes: wrong date", () => {
    const m = scoreNotes({ result: result([event("2026-10-27", null, 3)]), transcript, annotations: [annotation("event", 3 * M, "2026-10-26")] });
    expect(m.events.correct).toBe(0);
    expect(m.extracted.unmatched).toBe(0); // paired by time, just wrong
  });

  test("scoreNotes: time must match when annotated", () => {
    const annotations = [annotation("event", 3 * M, "2026-10-26", "14:00")];
    expect(scoreNotes({ result: result([event("2026-10-26", "15:00", 3)]), transcript, annotations }).events.correct).toBe(0);
    expect(scoreNotes({ result: result([event("2026-10-26", null, 3)]), transcript, annotations }).events.correct).toBe(0);
    expect(scoreNotes({ result: result([event("2026-10-26", "14:00", 3)]), transcript, annotations }).events.correct).toBe(1);
  });

  test("scoreNotes: extra extraction", () => {
    const m = scoreNotes({
      result: result([event("2026-10-26", null, 3), event("2026-10-30", null, 8, "추가")]),
      transcript,
      annotations: [annotation("event", 3 * M, "2026-10-26")],
    });
    expect(m.extracted).toEqual({ total: 2, unmatched: 1 });
    expect(m.events.correct).toBe(1);
  });

  test("scoreNotes: outside the 60 s window", () => {
    // Evidence at 3:00, annotation at 4:30: 90 s apart.
    const m = scoreNotes({ result: result([event("2026-10-26", null, 3)]), transcript, annotations: [annotation("event", 4.5 * M, "2026-10-26")] });
    expect(m.events).toEqual({ annotated: 1, correct: 0 });
    expect(m.extracted.unmatched).toBe(1);
  });

  test("one extraction answers one annotation", () => {
    const m = scoreNotes({
      result: result([event("2026-10-26", null, 3)]),
      transcript,
      annotations: [annotation("event", 3 * M, "2026-10-26"), annotation("event", 3 * M + 20_000, "2026-10-26")],
    });
    expect(m.events).toEqual({ annotated: 2, correct: 1 });
  });

  test("action items match by time within their own kind", () => {
    const m = scoreNotes({ result: result([], [action(2), action(9)]), transcript, annotations: [annotation("action_item", 2 * M), annotation("event", 9 * M, "2026-10-26")] });
    expect(m.extracted).toEqual({ total: 2, unmatched: 1 });
  });

  test("kinds the template does not extract are skipped, not missed", () => {
    const m = scoreNotes({
      result: result([]),
      transcript,
      annotations: [annotation("event", 3 * M, "2026-10-26"), annotation("action_item", 5 * M)],
      extracts: { events: false, action_items: false },
    });
    expect(m.events).toEqual({ annotated: 0, correct: 0 });
    expect(m.skipped).toBe(2);
  });

  test("grounding from the verify report", () => {
    const block = (outcome: "ok" | "fixed" | "dropped", ref: string) => ({ kind: "block" as const, ref, outcome, reasons: [] });
    const items = [block("ok", "b1"), block("ok", "b2"), block("ok", "b3"), block("fixed", "b4"), block("dropped", "b5"), { kind: "event" as const, ref: "e1", outcome: "ok" as const, reasons: [] }];
    expect(scoreNotes({ result: result([], [], items), transcript, annotations: [] }).blocks).toEqual({ total: 5, grounded: 3 });
  });

  test("a repaired result is not schema-valid", () => {
    const repaired = { ...result([]), report: { repaired: true, dropped_blocks: 0, items: [] } };
    expect(scoreNotes({ result: repaired, transcript, annotations: [] }).schema_valid).toBe(false);
  });

  test("totalsOf handles zero denominators", () => {
    const empty: NotesItemMetrics = { schema_valid: true, blocks: { total: 0, grounded: 0 }, events: { annotated: 0, correct: 0 }, extracted: { total: 0, unmatched: 0 }, skipped: 0 };
    const totals = totalsOf([empty], 0, 0);
    expect(totals).toEqual({
      schema_valid_rate: 1,
      grounding_rate: null,
      event_date_accuracy: null,
      over_extraction_rate: null,
      cost_microusd: 0,
      audio_hours: 0,
      usd_per_audio_hour: null,
    });
    expect(totalsOf([], 0, 0).schema_valid_rate).toBeNull();
  });
});

describe("runNotesEval on the example set", () => {
  const set = loadEvalSet(EXAMPLE_SET_DIR);

  test("example set is deterministic", async () => {
    const a = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "a") });
    const b = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "b") });
    expect(a.totals).toEqual(b.totals);
    expect(a.items.map((i) => [i.id, i.status, i.metrics])).toEqual(b.items.map((i) => [i.id, i.status, i.metrics]));
    expect(a.kind).toBe("notes");
    expect(a.items.every((i) => i.status === "ok")).toBe(true);
    expect(a.totals).toMatchObject({ schema_valid_rate: 1, grounding_rate: 1, event_date_accuracy: 1, over_extraction_rate: 0, cost_microusd: 0 });
    // lecture-break's action item and interview-2p's annotations are not extracted by their templates.
    expect(a.items.find((i) => i.id === "lecture-break")!.metrics).toMatchObject({ events: { annotated: 3, correct: 3 }, skipped: 1 });
    expect(a.items.find((i) => i.id === "interview-2p")!.metrics!.skipped).toBe(2);
  });

  let accurate: Awaited<ReturnType<typeof runNotesEval>> | null = null;
  let shifted: Awaited<ReturnType<typeof runNotesEval>> | null = null;

  test("knobs move the metrics", async () => {
    accurate = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "knobs") });
    // Same cache: the knobs get their own memo scope, so nothing stale comes back.
    shifted = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "knobs"), oracle: { wrongDateRate: 1 } });
    expect(shifted.totals.event_date_accuracy).toBe(0);
    const extra = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "knobs"), oracle: { extraRate: 1 } });
    expect(extra.totals.over_extraction_rate!).toBeGreaterThan(0);
    const dropped = await runNotesEval({ set, provider: "scripted", cacheDir: join(dir, "knobs"), oracle: { dropRate: 1 } });
    expect(dropped.totals.event_date_accuracy).toBe(0);
    expect(dropped.totals.over_extraction_rate).toBeNull(); // nothing extracted
  });

  test("baseline comparison", () => {
    const report = formatNotesReport(shifted!, accurate!);
    expect(report).toContain("기준(");
    expect(report).toContain("%p");
    expect(report).toContain("일정 날짜 정확도 -100.0%p");
  });

  test("baseline of the wrong kind", () => {
    const transcriptRun = { ...accurate!, kind: undefined } as unknown as EvalRun;
    expect(() => formatNotesReport(accurate!, transcriptRun)).toThrow("노트 평가 결과가 아닙니다");
  });

  test("real provider needs confirmation", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
    try {
      let asked = 0;
      await expect(
        runNotesEval({
          set,
          provider: "gemini",
          cacheDir: join(dir, "gemini"),
          confirm: (estimate) => {
            asked += 1;
            expect(estimate.max_microusd).toBeGreaterThan(0);
            expect(estimate.audio_seconds).toBe(40 * 60); // 30:00 + 10:00
            return false;
          },
        })
      ).rejects.toThrow("cost not confirmed");
      expect(asked).toBe(1);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("estimate uses pricing.json", () => {
    const estimate = estimateNotesCost("gemini-3.8-flash", 20_000, 2, Date.parse("2026-11-01"));
    expect(estimate.model).toBe("gemini-3.8-flash");
    expect(estimate.items).toBe(2);
    expect(estimate.max_microusd).toBeGreaterThan(0);
    expect(() => estimateNotesCost("gemini-unknown-model", 1, 1)).toThrow("no price");
  });
});
