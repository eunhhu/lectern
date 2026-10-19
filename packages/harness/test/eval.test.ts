import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isFfmpegAvailable } from "@lectern/media";
import {
  bestMapping,
  compareTranscripts,
  csvRecords,
  DEFAULT_PRICING,
  estimateTranscriptionCost,
  EvalSetError,
  EXAMPLE_SET_DIR,
  formatEstimate,
  formatReport,
  loadEvalSet,
  parseAnnotations,
  parseCsv,
  parseReferenceTranscript,
  runEval,
  synthesizeSpeechTone,
  type TimedText,
} from "../src/index.ts";
import { testEnv, type TestEnv } from "./helpers.ts";

const S = 1000;

describe("metrics", () => {
  const line = (start: number, speaker: string, text: string): TimedText => ({ start_ms: start * S, end_ms: start * S + 4 * S, speaker, text });
  const reference = [
    line(0, "S1", "오늘은 운영 모드를 봅니다."),
    line(5, "S2", "질문 있습니다."),
    line(10, "S1", "ECB 모드는 위험합니다."),
  ];

  test("a perfect hypothesis, with any labels and spacing", () => {
    const hyp = [line(0, "S7", "오늘은 운영모드를 봅니다"), line(5, "S3", "질문 있습니다"), line(10, "S7", "ecb 모드는 위험합니다")];
    const m = compareTranscripts(reference, hyp);
    expect([m.cer, m.deleted_ratio, m.inserted_ratio, m.speaker_error]).toEqual([0, 0, 0, 0]);
    expect(m.speaker_map).toEqual({ S1: "S7", S2: "S3" });
    expect(m.timestamp_offset_ms).toEqual({ median: 0, p90: 0, samples: 3 });
    expect(m.wer).toBeGreaterThan(0); // "운영모드" is one word against two: spacing counts for WER only
  });

  test("CER counts substitutions, deletions and insertions over letters", () => {
    // 오늘은운영모드를봅니다 질문있습니다 ecb모드는위험합니다 = 11 + 6 + 11 letters.
    const hyp = [line(0, "S1", "오늘은 운영 모드를 봤니다."), line(10, "S1", "ECB 모드는 아주 위험합니다.")];
    const m = compareTranscripts(reference, hyp);
    expect(m.ref_chars).toBe(28);
    expect(m.substitutions).toBe(1);
    expect(m.deleted_ratio).toBeCloseTo(6 / 28);
    expect(m.inserted_ratio).toBeCloseTo(2 / 28);
    expect(m.cer).toBeCloseTo(9 / 28);
  });

  test("speaker error: letters attributed to the wrong person under the best mapping", () => {
    const hyp = [line(0, "S1", "오늘은 운영 모드를 봅니다."), line(5, "S1", "질문 있습니다."), line(10, "S2", "ECB 모드는 위험합니다.")];
    const m = compareTranscripts(reference, hyp);
    // S1→S1 agrees on 11 letters and leaves S2 nothing; S1→S2 (11) with S2→S1 (6) agrees on 17 of 28.
    expect(m.speaker_map).toEqual({ S1: "S2", S2: "S1" });
    expect(m.speaker_error).toBeCloseTo(11 / 28);
  });

  test("timestamp offsets and reviewed ranges", () => {
    const hyp = [line(2, "S1", "오늘은 운영 모드를 봅니다."), line(5, "S2", "질문 있습니다."), line(14, "S1", "ECB 모드는 위험합니다.")];
    expect(compareTranscripts(reference, hyp).timestamp_offset_ms).toEqual({ median: 2 * S, p90: 4 * S, samples: 3 });
    const partial = compareTranscripts(reference, [line(0, "S1", "엉뚱한 말"), ...hyp.slice(1)], [{ start_ms: 4 * S, end_ms: 20 * S }]);
    expect(partial.ref_chars).toBe(17); // only lines whose midpoint is in 0:04–0:20
  });

  test("bestMapping is exact for small label sets and greedy beyond", () => {
    const pairs = new Map([
      ["A", new Map([["x", 5], ["y", 4]])],
      ["B", new Map([["x", 4], ["y", 0]])],
    ]);
    expect(bestMapping(pairs)).toEqual({ total: 8, map: { A: "y", B: "x" } });
  });
});

describe("set formats", () => {
  test("CSV: quotes, escaped quotes, CRLF, BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", ""],
    ]);
    expect(() => parseCsv('a,"b')).toThrow(EvalSetError);
    expect(() => csvRecords("id,audio\nx,y,z\n", "items.csv", ["id"])).toThrow("items.csv:2");
    expect(() => csvRecords("id\nx\n", "items.csv", ["audio"])).toThrow('missing column "audio"');
  });

  test("reference Markdown: front matter, ranges, ends from the next line, errors with line numbers", () => {
    const ref = parseReferenceTranscript(
      [
        "---",
        "duration: 1:00:00",
        "reviewed: 0:00-10:00, 50:00-1:00:00",
        "---",
        "# 제목",
        "> 메모",
        "[0:03] S1: 첫 문장.",
        "",
        "[0:10-0:14] S2: 둘째 문장.",
        "[1:02:03] S1: 마지막.",
      ].join("\n"),
    );
    expect(ref.duration_ms).toBe(3_600_000);
    expect(ref.reviewed).toEqual([
      { start_ms: 0, end_ms: 600_000 },
      { start_ms: 3_000_000, end_ms: 3_600_000 },
    ]);
    expect(ref.lines).toEqual([
      { start_ms: 3_000, end_ms: 10_000, speaker: "S1", text: "첫 문장." },
      { start_ms: 10_000, end_ms: 14_000, speaker: "S2", text: "둘째 문장." },
      { start_ms: 3_723_000, end_ms: 3_723_000, speaker: "S1", text: "마지막." },
    ]);
    expect(() => parseReferenceTranscript("---\nx: 1\n---\n[0:01] S1: a\n교수: 틀린 줄", "r.md")).toThrow("r.md:5");
    expect(() => parseReferenceTranscript("[0:05] S1: a\n[0:01] S1: b", "r.md")).toThrow("time goes backwards");
  });

  test("annotations CSV", () => {
    const rows = parseAnnotations(
      'item,kind,start,end,text,date,time,owner\nlec,event,24:30,,"과제 제출",2026-10-26,09:00,\nlec,action_item,1:00,1:10,보고서,,,민수\n',
    );
    expect(rows.map((r) => [r.kind, r.start_ms, r.end_ms, r.date, r.time, r.owner])).toEqual([
      ["event", 1_470_000, null, "2026-10-26", "09:00", null],
      ["action_item", 60_000, 70_000, null, null, "민수"],
    ]);
    expect(() => parseAnnotations("item,kind,start,text\nlec,event,0:01,날짜 없음\n")).toThrow("needs its correct date");
    expect(() => parseAnnotations("item,kind,start,text\nlec,todo,0:01,x\n")).toThrow("kind must be");
  });

  test("the bundled example set loads; consent is required for real items", () => {
    const set = loadEvalSet(EXAMPLE_SET_DIR);
    expect(set.items.map((i) => [i.id, i.audio, i.reference.duration_ms])).toEqual([
      ["lecture-break", "synth", 30 * 60 * S],
      ["interview-2p", "synth", 10 * 60 * S],
    ]);
    expect(set.annotations.length).toBeGreaterThan(0);

    const env = testEnv();
    try {
      mkdirSync(join(env.dir, "ref"));
      writeFileSync(join(env.dir, "ref", "a.md"), "[0:00] S1: 안녕하세요.\n");
      writeFileSync(join(env.dir, "items.csv"), "id,audio,reference,consent\na,audio/a.m4a,ref/a.md,no\n");
      expect(() => loadEvalSet(env.dir)).toThrow('consent must be "yes"');
      writeFileSync(join(env.dir, "items.csv"), "id,audio,reference,consent\na,audio/a.m4a,ref/a.md,yes\n");
      expect(loadEvalSet(env.dir).items[0]!.audio).toBe(join(env.dir, "audio/a.m4a"));
    } finally {
      env.close();
    }
  });
});

describe("cost gate", () => {
  test("the estimate uses pricing.json, the overlap share and the output allowance", () => {
    const e = estimateTranscriptionCost("gemini", "gemini-3.8-flash", 3600, 1, Date.UTC(2026, 9, 19));
    const price = DEFAULT_PRICING.models.find((m) => m.model === "gemini-3.8-flash")!;
    const input = 3600 * 1.07 * 32 + 600 * 10;
    expect(e.max_microusd).toBe(Math.round(input * price.input + 60 * 450 * price.output));
    expect(formatEstimate(e)).toContain("예상 비용 (상한): $0.1982");
    expect(() => estimateTranscriptionCost("gemini", "gemini-9-unpriced", 3600, 1)).toThrow("no price in pricing.json");
    // From 2027-01-01 the same hour costs twice as much.
    expect(estimateTranscriptionCost("gemini", "gemini-3.8-flash", 3600, 1, Date.UTC(2027, 0, 2)).max_microusd).toBe(2 * e.max_microusd);
  });

  describe.skipIf(!isFfmpegAvailable())("with audio", () => {
    let env: TestEnv;
    beforeEach(() => (env = testEnv()));
    afterEach(() => env.close());

    test("a real provider is not called unless the estimate is confirmed", async () => {
      mkdirSync(join(env.dir, "set", "ref"), { recursive: true });
      await synthesizeSpeechTone([{ start_ms: 0, end_ms: 4 * S }], 6 * S, join(env.dir, "set", "a.m4a"));
      writeFileSync(join(env.dir, "set", "ref", "a.md"), "[0:00] S1: 안녕하세요.\n");
      writeFileSync(join(env.dir, "set", "items.csv"), "id,audio,reference,consent\na,a.m4a,ref/a.md,yes\n");
      const seen: number[] = [];
      let fetched = false;
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetched = true;
        throw new Error("no network in tests");
      }) as unknown as typeof fetch;
      try {
        const err = await runEval({
          set: loadEvalSet(join(env.dir, "set")),
          provider: "gemini",
          cacheDir: join(env.dir, "cache"),
          confirm: (e) => {
            seen.push(e.max_microusd);
            return false;
          },
        }).catch((e) => e);
        expect(String(err.message)).toContain("cost not confirmed");
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeGreaterThan(0);
      expect(fetched).toBe(false);
    }, 30_000);

    test("the example set end to end with the scripted provider: CER near the injected noise, speakers unified", async () => {
      const run = await runEval({
        set: loadEvalSet(EXAMPLE_SET_DIR),
        provider: "scripted",
        scripted: { charErrorRate: 0.05, seed: 3 },
        cacheDir: join(env.dir, "cache"),
      });
      expect(run.items.map((i) => i.status)).toEqual(["ok", "ok"]);
      const [lecture, interview] = run.items;
      expect(lecture!.cut_duration_ms).toBeLessThan(lecture!.duration_ms * 0.3); // the 20-minute break and the tail are cut
      expect(lecture!.seams.no_partner).toBe(0);
      for (const item of run.items) {
        expect(item.metrics!.cer).toBeGreaterThan(0.03);
        expect(item.metrics!.cer).toBeLessThan(0.08);
        expect(item.metrics!.speaker_error).toBe(0);
        expect(item.metrics!.timestamp_offset_ms!.median).toBeLessThanOrEqual(250);
      }
      expect(interview!.metrics!.ref_chars).toBeLessThan(run.totals.ref_chars); // reviewed ranges only
      expect(run.totals.cost_microusd).toBe(0); // the scripted provider has no price
      const report = formatReport(run, run);
      expect(report).toContain("lecture-break");
      expect(report).toContain("CER +0.0%p");
    }, 60_000);
  });
});
