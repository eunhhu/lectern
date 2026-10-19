import { describe, expect, test } from "bun:test";
import type { TranscribeResult } from "@lectern/domain";
import { formatGapMarker, type TimeMapEntry } from "@lectern/media";
import { mergeTranscripts, MergedTranscript } from "../src/index.ts";
import { chunkView, letters, plan, script, type Utterance } from "./transcript-helpers.ts";

const S = 1000;
const MIN = 60 * S;

// Pure tests (no ffmpeg), so CI runs them. Every chunk's answer is derived from one truth
// script in absolute cut-audio time, so "nothing duplicated, nothing lost" is checkable.

const identity = (ms: number): TimeMapEntry[] => [{ cut_start_ms: 0, orig_start_ms: 0, length_ms: ms }];

function mergeOf(
  truth: Utterance[],
  chunks: ReturnType<typeof plan>,
  views: Array<TranscribeResult | null>,
  timeMap: TimeMapEntry[],
  cuts: Array<{ kind: "break" | "tail"; start_ms: number; end_ms: number }> = [],
  durationMs = timeMap.at(-1)!.orig_start_ms + timeMap.at(-1)!.length_ms,
  overrides = {},
) {
  void truth;
  const merged = mergeTranscripts({ chunks, results: views, timeMap, cuts, durationMs }, overrides);
  expect(MergedTranscript.safeParse(merged).success).toBe(true);
  return merged;
}

describe("merge: overlaps", () => {
  // 10 min of speech, three chunks overlapping by 20 s.
  const duration = 10 * MIN;
  const truth = script({ seed: 1, from: 0, to: duration });
  const chunks = plan(duration, [
    { start: 0, end: 215 * S },
    { start: 195 * S, end: 415 * S },
    { start: 395 * S, end: duration },
  ]);

  test("identical hearings: every utterance once, times unchanged, seams aligned", () => {
    const merged = mergeOf(truth, chunks, chunks.map((c) => chunkView(truth, c)), identity(duration));
    expect(merged.seams.map((s) => s.method)).toEqual(["aligned", "aligned"]);
    expect(letters(merged.segments.map((s) => s.text))).toBe(letters(truth.map((u) => u.text)));
    // Splices land on segment starts here, so every segment is a whole utterance at its true time.
    expect(merged.segments.map((s) => [s.start_ms, s.end_ms])).toEqual(truth.map((u) => [u.start, u.end]));
    expect(merged.gaps).toEqual([]);
  });

  test("the earlier chunk's timestamps run 15% early and the later one segments differently: no duplicate, no loss", () => {
    // About -30 s by the end of chunk 0: the drift §3.3 reports, inside the §3.4 time checks.
    const views = [
      chunkView(truth, chunks[0]!, { driftRate: -0.15 }),
      chunkView(truth, chunks[1]!, { group: 2 }),
      chunkView(truth, chunks[2]!),
    ];
    const merged = mergeOf(truth, chunks, views, identity(duration));
    expect(merged.seams[0]!.method).toBe("aligned");
    expect(letters(merged.segments.map((s) => s.text))).toBe(letters(truth.map((u) => u.text)));
    // The splice is timed by the later chunk (fresh timestamps), near the seam...
    const fromChunk1 = merged.segments.find((s) => s.chunk === 1)!;
    expect(Math.abs(fromChunk1.start_ms - chunks[0]!.overlap_next!.seam_ms)).toBeLessThanOrEqual(5 * S);
    // ...the drift there is measured, and chunk 0's timeline is rescaled to agree with it.
    expect(merged.seams[0]!.drift_ms).toBeLessThan(-25 * S);
    const byText = new Map(truth.map((u) => [letters([u.text]), u]));
    for (const seg of merged.segments.filter((s) => s.chunk === 0)) {
      const u = byText.get(letters([seg.text]));
      if (u) expect(Math.abs(seg.start_ms - u.start)).toBeLessThanOrEqual(S);
    }

    // Why alignment exists: the core-range rule alone (forced here) keeps the shared audio twice.
    const timeOnly = mergeOf(truth, chunks, views, identity(duration), [], duration, { minScore: Number.MAX_SAFE_INTEGER });
    expect(timeOnly.seams[0]!.method).toBe("time");
    expect(letters(timeOnly.segments.map((s) => s.text)).length).toBeGreaterThan(letters(truth.map((u) => u.text)).length);
  });

  test("timestamps running late past the chunk end: still one copy, reading order and time order agree", () => {
    const views = [chunkView(truth, chunks[0]!, { driftRate: 0.15 }), chunkView(truth, chunks[1]!), chunkView(truth, chunks[2]!)];
    const merged = mergeOf(truth, chunks, views, identity(duration));
    expect(merged.seams[0]!.method).toBe("aligned");
    expect(letters(merged.segments.map((s) => s.text))).toBe(letters(truth.map((u) => u.text)));
    for (let i = 1; i < merged.segments.length; i++) {
      expect(merged.segments[i]!.start_ms).toBeGreaterThanOrEqual(merged.segments[i - 1]!.start_ms);
    }
  });

  test("an overlap in silence falls back to the core range rule", () => {
    // Speech stops 10 s before the first overlap and resumes 10 s after it.
    const quiet = truth.filter((u) => u.end <= 185 * S || u.start >= 225 * S);
    const views = chunks.map((c) => chunkView(quiet, c));
    const merged = mergeOf(quiet, chunks, views, identity(duration));
    expect(merged.seams[0]!.method).toBe("time");
    expect(merged.seams[0]!.links).toEqual([]);
    expect(letters(merged.segments.map((s) => s.text))).toBe(letters(quiet.map((u) => u.text)));
  });

  test("speaker evidence: letters each label pair agreed on in the overlap", () => {
    const two = script({ seed: 2, from: 0, to: duration, speakers: (i) => (i % 3 === 2 ? "S2" : "S1") });
    const swap = (s: string) => (s === "S1" ? "S2" : "S1");
    const views = [chunkView(two, chunks[0]!), chunkView(two, chunks[1]!, { label: swap }), chunkView(two, chunks[2]!)];
    const merged = mergeOf(two, chunks, views, identity(duration));
    const links = merged.seams[0]!.links;
    expect(links.map((l) => [l.prev, l.next])).toEqual(expect.arrayContaining([["S1", "S2"], ["S2", "S1"]]));
    expect(links.every((l) => l.prev !== l.next)).toBe(true);
    // Labels stay chunk-local here; `speakers` unifies them.
    expect(new Set(merged.segments.filter((s) => s.chunk === 1).map((s) => s.speaker))).toEqual(new Set(["S1", "S2"]));
  });
});

describe("merge: original time (a recording with a 20-minute break)", () => {
  // Original: speech 0–5 min, a 20-minute break (5–25 min), speech 25–30 min, tail to 32 min.
  // Cut audio: 10 min. The junction is at cut 5:00 = original 25:00.
  const junction = 5 * MIN;
  const shift = 20 * MIN;
  const timeMap: TimeMapEntry[] = [
    { cut_start_ms: 0, orig_start_ms: 0, length_ms: 5 * MIN },
    { cut_start_ms: 5 * MIN, orig_start_ms: 25 * MIN, length_ms: 5 * MIN },
  ];
  const cuts = [
    { kind: "break" as const, start_ms: 5 * MIN, end_ms: 25 * MIN },
    { kind: "tail" as const, start_ms: 30 * MIN, end_ms: 32 * MIN },
  ];
  const duration = 32 * MIN;
  const cutDuration = 10 * MIN;
  const chunks = plan(cutDuration, [
    { start: 0, end: 205 * S },
    { start: 185 * S, end: 415 * S },
    { start: 395 * S, end: cutDuration },
  ]);
  // One utterance straddles the junction: 3 s before it, 4 s after (the model joined speech across the cut).
  const truth = [
    ...script({ seed: 3, from: 0, to: junction - 5 * S }),
    { start: junction - 3 * S, end: junction + 4 * S, speaker: "S1", text: "자 쉬었다가 다시 시작하겠습니다." },
    ...script({ seed: 4, from: junction + 6 * S, to: cutDuration }),
  ];
  const toOrig = (cut: number) => (cut < junction ? cut : cut + shift);

  test("segments come out in original time, shifted by the break exactly once", () => {
    const merged = mergeOf(truth, chunks, chunks.map((c) => chunkView(truth, c)), timeMap, cuts, duration);
    const expected = truth
      .filter((u) => u.end <= junction || u.start >= junction)
      .map((u) => [toOrig(u.start), u.end <= junction ? u.end : u.end + shift]);
    const got = merged.segments.filter((s) => !s.text.startsWith("자 쉬었다가")).map((s) => [s.start_ms, s.end_ms]);
    expect(got).toEqual(expected);
    // Nothing lies inside the removed break, and nothing past the recording.
    for (const s of merged.segments) {
      expect(s.end_ms <= 5 * MIN || s.start_ms >= 25 * MIN).toBe(true);
      expect(s.end_ms).toBeLessThanOrEqual(30 * MIN);
    }
  });

  test("a segment straddling the cut is clipped to the side holding most of it, never spanning the break", () => {
    const merged = mergeOf(truth, chunks, chunks.map((c) => chunkView(truth, c)), timeMap, cuts, duration);
    const straddler = merged.segments.find((s) => s.text.startsWith("자 쉬었다가"))!;
    expect([straddler.start_ms, straddler.end_ms]).toEqual([25 * MIN, 25 * MIN + 4 * S]);
  });

  test("break and tail gaps come from speech_map as they are", () => {
    const merged = mergeOf(truth, chunks, chunks.map((c) => chunkView(truth, c)), timeMap, cuts, duration);
    expect(merged.gaps).toEqual(cuts);
    expect(merged.gaps.map(formatGapMarker)).toEqual(["[쉬는 시간: 5:00~25:00]", "[종료 후: 30:00~32:00]"]);
  });

  test("a chunk that failed for good: neighbours keep their whole overlap, the rest is a missing gap split around the break", () => {
    const views = chunks.map((c, i) => (i === 1 ? null : chunkView(truth, c)));
    const merged = mergeOf(truth, chunks, views, timeMap, cuts, duration);
    expect(merged.failed_chunks).toEqual([1]);
    expect(merged.seams.map((s) => s.method)).toEqual(["no_partner", "no_partner"]);
    // Chunk 0 transcribed up to 205 s, chunk 2 from 395 s (cut time); in between is missing.
    expect(merged.gaps).toEqual([
      { kind: "missing_transcript", start_ms: 205 * S, end_ms: 5 * MIN },
      { kind: "break", start_ms: 5 * MIN, end_ms: 25 * MIN },
      { kind: "missing_transcript", start_ms: 25 * MIN, end_ms: 395 * S + shift },
      { kind: "tail", start_ms: 30 * MIN, end_ms: 32 * MIN },
    ]);
    expect(merged.gaps.map(formatGapMarker)[0]).toBe("[전사 누락: 3:25~5:00]");
    expect(Math.max(...merged.segments.filter((s) => s.chunk === 0).map((s) => s.end_ms))).toBeLessThanOrEqual(205 * S);
    expect(Math.min(...merged.segments.filter((s) => s.chunk === 2).map((s) => s.start_ms))).toBeGreaterThanOrEqual(395 * S + shift);
  });

  test("two failed chunks in a row make one contiguous missing gap", () => {
    const views = chunks.map((c, i) => (i === 0 ? chunkView(truth, c) : null));
    const merged = mergeOf(truth, chunks, views, timeMap, [], duration);
    expect(merged.gaps).toEqual([
      { kind: "missing_transcript", start_ms: 205 * S, end_ms: 5 * MIN },
      { kind: "missing_transcript", start_ms: 25 * MIN, end_ms: 30 * MIN },
    ]);
  });
});

describe("merge: normalization", () => {
  test("segments longer than 30 s are split at sentence boundaries, timed by letters", () => {
    const sentences = ["가나다라마바사.", "아자차카타파하.", "가나다라마바사아자차카타파하."];
    const views: TranscribeResult[] = [{ segments: [{ start_ms: 0, end_ms: 56 * S, speaker: "S1", text: sentences.join("  ") }] }];
    const chunks = plan(60 * S, [{ start: 0, end: 60 * S }]);
    const merged = mergeOf([], chunks, views, identity(60 * S));
    expect(merged.segments.map((s) => s.text)).toEqual(["가나다라마바사. 아자차카타파하.", "가나다라마바사아자차카타파하."]);
    expect(merged.segments.map((s) => [s.start_ms, s.end_ms])).toEqual([
      [0, 28 * S],
      [28 * S, 56 * S],
    ]);
  });

  test("whitespace is tidied, letterless segments dropped, times past the chunk clamped", () => {
    const views: TranscribeResult[] = [
      {
        segments: [
          { start_ms: 0, end_ms: 2 * S, speaker: "S1", text: "  안녕하세요 ,  여러분 . " },
          { start_ms: 2 * S, end_ms: 3 * S, speaker: "S1", text: " ... " },
          { start_ms: 3 * S, end_ms: 99 * S, speaker: "S1", text: "끝입니다." },
        ],
      },
    ];
    const merged = mergeOf([], plan(10 * S, [{ start: 0, end: 10 * S }]), views, identity(10 * S));
    expect(merged.segments.map((s) => [s.text, s.start_ms, s.end_ms])).toEqual([
      ["안녕하세요, 여러분.", 0, 2 * S],
      ["끝입니다.", 3 * S, 10 * S],
    ]);
  });

  test("deterministic: the same input gives the same output", () => {
    const duration = 10 * MIN;
    const truth = script({ seed: 9, from: 0, to: duration });
    const chunks = plan(duration, [
      { start: 0, end: 215 * S },
      { start: 195 * S, end: duration },
    ]);
    const views = [chunkView(truth, chunks[0]!, { driftRate: 0.1 }), chunkView(truth, chunks[1]!, { group: 3 })];
    expect(mergeOf(truth, chunks, views, identity(duration))).toEqual(mergeOf(truth, chunks, views, identity(duration)));
  });
});
