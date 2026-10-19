import { describe, expect, test } from "bun:test";
import {
  buildSpeechMap,
  DEFAULT_OVERLAP_MAX_MS,
  DEFAULT_OVERLAP_MIN_MS,
  planChunks,
  toOriginalMs,
  type ChunkSpec,
  type Interval,
} from "../src/index.ts";

const S = 1000;
const MIN = 60 * S;

/** A 3 s pause every 20 s, cut time. */
function pauses(durationMs: number, every = 20 * S, length = 3 * S): Interval[] {
  const out: Interval[] = [];
  for (let t = every; t + length < durationMs; t += every) out.push({ start_ms: t, end_ms: t + length });
  return out;
}

const inSilence = (ms: number, silences: readonly Interval[]) => silences.some((s) => ms >= s.start_ms && ms <= s.end_ms);

function expectWellFormed(chunks: ChunkSpec[], durationMs: number, overlapMin = DEFAULT_OVERLAP_MIN_MS, overlapMax = DEFAULT_OVERLAP_MAX_MS) {
  expect(chunks[0]!.start_ms).toBe(0);
  expect(chunks.at(-1)!.end_ms).toBe(durationMs);
  chunks.forEach((chunk, i) => {
    expect(chunk.index).toBe(i);
    expect(chunk.end_ms).toBeGreaterThan(chunk.start_ms);
    expect(chunk.core_start_ms).toBeGreaterThanOrEqual(chunk.start_ms);
    expect(chunk.core_end_ms).toBeLessThanOrEqual(chunk.end_ms);
    const next = chunks[i + 1];
    if (!next) {
      expect(chunk.overlap_next).toBeNull();
      return;
    }
    // Cores tile the audio; overlaps are shared and within bounds; seams sit inside them.
    expect(next.core_start_ms).toBe(chunk.core_end_ms);
    expect(next.overlap_prev).toEqual(chunk.overlap_next);
    const overlap = chunk.overlap_next!;
    expect(overlap.start_ms).toBe(next.start_ms);
    expect(overlap.end_ms).toBe(chunk.end_ms);
    expect(overlap.end_ms - overlap.start_ms).toBeGreaterThanOrEqual(overlapMin);
    expect(overlap.end_ms - overlap.start_ms).toBeLessThanOrEqual(overlapMax);
    expect(overlap.seam_ms).toBeGreaterThan(overlap.start_ms);
    expect(overlap.seam_ms).toBeLessThan(overlap.end_ms);
    expect(next.start_ms).toBeGreaterThan(chunk.start_ms);
  });
  expect(chunks[0]!.overlap_prev).toBeNull();
  expect(chunks[0]!.core_start_ms).toBe(0);
  expect(chunks.at(-1)!.core_end_ms).toBe(durationMs);
}

describe("planChunks", () => {
  test("dedicated STT (targetMs null or Infinity) keeps the whole audio as one chunk", () => {
    const whole = [{ index: 0, start_ms: 0, end_ms: 3 * 60 * MIN, core_start_ms: 0, core_end_ms: 3 * 60 * MIN, overlap_prev: null, overlap_next: null }];
    expect(planChunks(3 * 60 * MIN, pauses(3 * 60 * MIN), { targetMs: null })).toEqual(whole);
    expect(planChunks(3 * 60 * MIN, [], { targetMs: Infinity })).toEqual(whole);
  });

  test("audio no longer than the target is one chunk", () => {
    expect(planChunks(6 * MIN, pauses(6 * MIN), { targetMs: 6 * MIN })).toHaveLength(1);
    expect(planChunks(6 * MIN + 1, pauses(6 * MIN + 1), { targetMs: 6 * MIN })).toHaveLength(2);
  });

  test("LLM chunks: even split, seams and overlap edges in silence, 15–30 s overlaps", () => {
    const duration = 61 * MIN + 2_500;
    const silences = pauses(duration, 10 * S);
    const chunks = planChunks(duration, silences, { targetMs: 6 * MIN });
    expect(chunks).toHaveLength(11);
    expectWellFormed(chunks, duration);
    const span = duration / 11;
    for (const chunk of chunks.slice(0, -1)) {
      const overlap = chunk.overlap_next!;
      expect(overlap.seam_in_silence).toBe(true);
      expect(inSilence(overlap.seam_ms, silences)).toBe(true);
      expect(inSilence(overlap.start_ms, silences)).toBe(true);
      expect(inSilence(overlap.end_ms, silences)).toBe(true);
    }
    for (const chunk of chunks) {
      // Bound from the doc comment: span + 2 × search (target / 10) + overlapMax.
      expect(chunk.end_ms - chunk.start_ms).toBeLessThanOrEqual(span + 2 * (6 * MIN) / 10 + DEFAULT_OVERLAP_MAX_MS);
      expect(chunk.end_ms - chunk.start_ms).toBeLessThanOrEqual(8 * MIN); // the 5–8 minute LLM window
    }
  });

  test("the seam takes the longest silence near the split, not the nearest", () => {
    // 10 min into 2 chunks: split at 5:00. A 2 s pause right there, a 6 s pause 20 s later.
    const silences = [
      { start_ms: 5 * MIN - S, end_ms: 5 * MIN + S },
      { start_ms: 5 * MIN + 20 * S, end_ms: 5 * MIN + 26 * S },
    ];
    const [first] = planChunks(10 * MIN, silences, { targetMs: 6 * MIN });
    expect(first!.overlap_next!.seam_ms).toBe(5 * MIN + 23 * S);
  });

  test("without silence near a split the seam is a hard cut at the even split", () => {
    const chunks = planChunks(20 * MIN, [], { targetMs: 6 * MIN });
    expect(chunks).toHaveLength(4);
    expectWellFormed(chunks, 20 * MIN);
    chunks.slice(0, -1).forEach((chunk, i) => {
      const overlap = chunk.overlap_next!;
      expect(overlap.seam_in_silence).toBe(false);
      expect(overlap.seam_ms).toBe((i + 1) * 5 * MIN);
      // Overlap centred on the seam at the middle of the 15–30 s range.
      expect(overlap.end_ms - overlap.start_ms).toBe(22_500);
    });
  });

  test("custom overlap bounds and search window", () => {
    const duration = 10 * MIN;
    const chunks = planChunks(duration, pauses(duration, 7 * S, 2 * S), {
      targetMs: 2 * MIN,
      overlapMinMs: 4 * S,
      overlapMaxMs: 8 * S,
      searchMs: 5 * S,
    });
    expect(chunks).toHaveLength(5);
    expectWellFormed(chunks, duration, 4 * S, 8 * S);
    chunks.slice(0, -1).forEach((chunk, i) => {
      expect(Math.abs(chunk.overlap_next!.seam_ms - (i + 1) * 2 * MIN)).toBeLessThanOrEqual(5 * S);
    });
  });

  test("rejects bad input", () => {
    expect(() => planChunks(0, [], { targetMs: null })).toThrow(RangeError);
    expect(() => planChunks(10 * MIN, [], { targetMs: 0 })).toThrow(RangeError);
    expect(() => planChunks(10 * MIN, [], { targetMs: 100 * S })).toThrow(RangeError); // < 4 × 30 s overlap
    expect(() => planChunks(10 * MIN, [], { targetMs: 6 * MIN, overlapMinMs: 20 * S, overlapMaxMs: 10 * S })).toThrow(RangeError);
  });

  test("deterministic", () => {
    const silences = pauses(47 * MIN, 13 * S, 2_500);
    expect(planChunks(47 * MIN, silences, { targetMs: 7 * MIN })).toEqual(planChunks(47 * MIN, [...silences].reverse(), { targetMs: 7 * MIN }));
  });

  test("on a speech map: chunk ranges map back to original time across the cut", () => {
    // 30 min lecture, 20 min gap, 30 min lecture.
    const silences = [...pauses(30 * MIN), { start_ms: 30 * MIN, end_ms: 50 * MIN }, ...pauses(30 * MIN).map((s) => ({ start_ms: s.start_ms + 50 * MIN, end_ms: s.end_ms + 50 * MIN }))];
    const map = buildSpeechMap({ duration_ms: 80 * MIN, silences });
    const chunks = planChunks(map.cut_duration_ms, map.cut_silences, { targetMs: 6 * MIN });
    expectWellFormed(chunks, map.cut_duration_ms);
    chunks.slice(0, -1).forEach((c) => expect(inSilence(c.overlap_next!.seam_ms, map.cut_silences)).toBe(true));
    // The chunk holding the junction spans the break in original time; its neighbours do not.
    const junction = 30 * MIN + map.rules.cutPadMs;
    const holder = chunks.find((c) => c.start_ms < junction && c.end_ms > junction)!;
    const orig = { start: toOriginalMs(holder.start_ms, map.time_map), end: toOriginalMs(holder.end_ms, map.time_map, "end") };
    expect(orig.end - orig.start).toBe(holder.end_ms - holder.start_ms + (map.cuts[0]!.end_ms - map.cuts[0]!.start_ms));
  });
});
