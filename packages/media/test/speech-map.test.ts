import { describe, expect, test } from "bun:test";
import {
  buildSpeechMap,
  cutDurationMs,
  DEFAULT_SPEECH_MAP_RULES,
  formatGapMarker,
  intervalLength,
  toCutMs,
  toOriginalMs,
  validateTimeMap,
  type Interval,
  type SpeechMap,
} from "../src/index.ts";

const S = 1000;
const MIN = 60 * S;
const PAD = DEFAULT_SPEECH_MAP_RULES.cutPadMs;

type Part =
  /** Talk for `ms`, with a `pause`-long silence every `every` ms (a lecture: sentences and breaths). */
  | { talk: number; pause?: number; every?: number }
  /** Silence for `ms`, broken by `burst`-long noises every `every` ms (a break: doors, chairs, chatter). */
  | { quiet: number; burst?: number; every?: number };

/** Silence intervals for a scripted recording, as detectSilences() would report them. */
function recording(...parts: Part[]): { duration_ms: number; silences: Interval[] } {
  const silences: Interval[] = [];
  let cursor = 0;
  for (const part of parts) {
    if ("talk" in part) {
      const end = cursor + part.talk;
      if (part.pause && part.every) {
        for (let t = cursor + part.every; t + part.pause < end; t += part.every) {
          silences.push({ start_ms: t, end_ms: t + part.pause });
        }
      }
      cursor = end;
    } else {
      const end = cursor + part.quiet;
      let from = cursor;
      if (part.burst && part.every) {
        for (let t = cursor + part.every; t + part.burst < end; t += part.every) {
          silences.push({ start_ms: from, end_ms: t });
          from = t + part.burst;
        }
      }
      silences.push({ start_ms: from, end_ms: end });
      cursor = end;
    }
  }
  return { duration_ms: cursor, silences };
}

/** Lecture speech: a 3 s pause every 20 s. */
const lecture = (ms: number): Part[] => [{ talk: ms, pause: 3 * S, every: 20 * S }];

function expectConsistent(map: SpeechMap) {
  validateTimeMap(map.time_map);
  const kept = map.kept.reduce((sum, r) => sum + intervalLength(r), 0);
  const cut = map.cuts.reduce((sum, c) => sum + intervalLength(c), 0);
  expect(kept + cut).toBe(map.duration_ms);
  expect(map.cut_duration_ms).toBe(kept);
  expect(cutDurationMs(map.time_map)).toBe(kept);
}

describe("speech_map: the 20-minute gap (AI_HARNESS §3.2 invariant)", () => {
  // 0–30 min lecture, 30–50 min silence, 50–80 min lecture.
  const input = recording(...lecture(30 * MIN), { quiet: 20 * MIN }, ...lecture(30 * MIN));
  const map = buildSpeechMap(input);

  test("the gap is one break cut, padded on both sides", () => {
    expect(map.cuts).toEqual([{ kind: "break", start_ms: 30 * MIN + PAD, end_ms: 50 * MIN - PAD, speech_ms: 0 }]);
    expect(map.time_map).toEqual([
      { cut_start_ms: 0, orig_start_ms: 0, length_ms: 30 * MIN + PAD },
      { cut_start_ms: 30 * MIN + PAD, orig_start_ms: 50 * MIN - PAD, length_ms: 30 * MIN + PAD },
    ]);
    expect(map.cut_duration_ms).toBe(60 * MIN + 2 * PAD);
    expectConsistent(map);
  });

  test("provider times in cut audio land in original time", () => {
    // A segment 5 minutes into the second half of the cut audio.
    expect(toOriginalMs(35 * MIN, map.time_map)).toBe(55 * MIN - 2 * PAD);
    // The first word after the break.
    expect(toOriginalMs(30 * MIN + 2 * PAD, map.time_map)).toBe(50 * MIN);
    // The last word before it.
    expect(toOriginalMs(30 * MIN, map.time_map, "end")).toBe(30 * MIN);
    // A segment that ends exactly at the junction stays before the break.
    expect(toOriginalMs(30 * MIN + PAD, map.time_map, "end")).toBe(30 * MIN + PAD);
  });

  test("chunk-relative times: chunk offset + segment time, mapped once", () => {
    const chunkStart = 28 * MIN; // a chunk spanning the junction
    const segment = { start_ms: 4 * MIN, end_ms: 4 * MIN + 12 * S };
    const start = toOriginalMs(chunkStart + segment.start_ms, map.time_map);
    const end = toOriginalMs(chunkStart + segment.end_ms, map.time_map, "end");
    expect(start).toBe(52 * MIN - 2 * PAD);
    expect(end - start).toBe(12 * S);
  });

  test("round trip over every kept second", () => {
    for (let cut = 0; cut < map.cut_duration_ms; cut += S) {
      expect(toCutMs(toOriginalMs(cut, map.time_map), map.time_map)).toBe(cut);
    }
  });

  test("the junction is a silence in cut time (a natural chunk boundary)", () => {
    expect(map.cut_silences).toContainEqual({ start_ms: 30 * MIN, end_ms: 30 * MIN + 2 * PAD });
  });

  test("document marker in original time", () => {
    expect(formatGapMarker(map.cuts[0]!)).toBe("[쉬는 시간: 30:01~49:58]");
  });
});

describe("speech_map: rules", () => {
  test("short gaps (< 2 s) are speech: never reported as silence, never cut", () => {
    const input = recording({ talk: 40 * MIN, pause: 1_999, every: 5 * S });
    const map = buildSpeechMap(input);
    expect(map.silences).toEqual([]);
    expect(map.speech).toEqual([{ start_ms: 0, end_ms: 40 * MIN }]);
    expect(map.cuts).toEqual([]);
    expect(map.time_map).toEqual([{ cut_start_ms: 0, orig_start_ms: 0, length_ms: 40 * MIN }]);
  });

  test("a 2 s pause is a silence but stays (only long stretches are cut)", () => {
    const map = buildSpeechMap(recording({ talk: 10 * MIN, pause: 2 * S, every: 10 * S }));
    expect(map.silences.length).toBeGreaterThan(0);
    expect(map.cuts).toEqual([]);
  });

  test("break length boundary: exactly 5 min is cut, 1 ms less is kept", () => {
    const at = (gap: number) => buildSpeechMap(recording(...lecture(10 * MIN), { quiet: gap }, ...lecture(10 * MIN)));
    const exact = at(5 * MIN + 2 * PAD);
    expect(exact.cuts).toHaveLength(1);
    expect(intervalLength(exact.cuts[0]!)).toBe(5 * MIN);
    expect(at(5 * MIN + 2 * PAD - 1).cuts).toEqual([]);
  });

  test("4-minute silences (board work, a quiz) are not breaks", () => {
    const map = buildSpeechMap(recording(...lecture(10 * MIN), { quiet: 4 * MIN }, ...lecture(10 * MIN)));
    expect(map.cuts).toEqual([]);
  });

  test("a break with sporadic noise is still cut, and the noise is reported", () => {
    // 12 minutes with a 2 s noise every 45 s: about 4% non-silent.
    const map = buildSpeechMap(recording(...lecture(20 * MIN), { quiet: 12 * MIN, burst: 2 * S, every: 45 * S }, ...lecture(20 * MIN)));
    expect(map.cuts).toHaveLength(1);
    const cut = map.cuts[0]!;
    expect(cut.kind).toBe("break");
    expect(cut.start_ms).toBe(20 * MIN + PAD);
    expect(cut.end_ms).toBe(32 * MIN - PAD);
    expect(cut.speech_ms).toBe(15 * 2 * S);
    expectConsistent(map);
  });

  test("a stretch where speech fills more than 10% is kept (slow talk, Q&A, chatter)", () => {
    // 8 s utterances every 30 s for 10 minutes: never sustained, but 27% speech.
    const map = buildSpeechMap(recording(...lecture(20 * MIN), { quiet: 10 * MIN, burst: 8 * S, every: 30 * S }, ...lecture(20 * MIN)));
    expect(map.cuts).toEqual([]);
  });

  test("the density threshold is inclusive at maxCutSpeechRatio", () => {
    // A 600 s candidate holding exactly 60 s of noise (10 bursts of 6 s): 10%.
    const rules = { cutPadMs: 0, edgeKeepMs: 0 };
    const input = recording(...lecture(20 * MIN), { quiet: 10 * MIN, burst: 6 * S, every: 55 * S }, ...lecture(20 * MIN));
    const map = buildSpeechMap(input, rules);
    expect(map.cuts).toHaveLength(1);
    expect(intervalLength(map.cuts[0]!)).toBe(10 * MIN);
    expect(map.cuts[0]!.speech_ms).toBe(60 * S);
    expect(buildSpeechMap(input, { ...rules, maxCutSpeechRatio: 0.0999 }).cuts).toHaveLength(0);
  });

  test("a remark shortly after the lecture stops is kept with it", () => {
    // Lecture, 15 s pause, a 4 s remark ("과제는 다음 주까지"), 10 min of silence, lecture.
    const map = buildSpeechMap(recording(...lecture(20 * MIN), { quiet: 15 * S }, { talk: 4 * S }, { quiet: 10 * MIN }, ...lecture(20 * MIN)));
    expect(map.cuts).toHaveLength(1);
    expect(map.cuts[0]!.start_ms).toBe(20 * MIN + 19 * S + PAD);
    expect(map.cuts[0]!.speech_ms).toBe(0);
  });

  test("a remark beyond edgeKeepMs is part of the break", () => {
    const map = buildSpeechMap(recording(...lecture(20 * MIN), { quiet: 45 * S }, { talk: 4 * S }, { quiet: 10 * MIN }, ...lecture(20 * MIN)));
    expect(map.cuts).toHaveLength(1);
    expect(map.cuts[0]!.start_ms).toBe(20 * MIN + PAD);
    expect(map.cuts[0]!.speech_ms).toBe(4 * S);
  });

  test("tail: silence after the last sustained speech is cut to the end", () => {
    const map = buildSpeechMap(recording(...lecture(70 * MIN), { quiet: 3 * MIN, burst: 1 * S, every: 40 * S }));
    expect(map.cuts).toEqual([{ kind: "tail", start_ms: 70 * MIN + PAD, end_ms: 73 * MIN, speech_ms: 4 * S }]);
    expect(map.time_map).toEqual([{ cut_start_ms: 0, orig_start_ms: 0, length_ms: 70 * MIN + PAD }]);
    expect(formatGapMarker(map.cuts[0]!)).toBe("[종료 후: 1:10:01~1:13:00]");
    expectConsistent(map);
  });

  test("tail length boundary: tailMinMs is cut, shorter is kept", () => {
    const at = (tail: number) => buildSpeechMap(recording(...lecture(10 * MIN), { quiet: tail }));
    expect(at(MIN + PAD).cuts.map((c) => c.kind)).toEqual(["tail"]);
    expect(at(MIN + PAD - 1).cuts).toEqual([]);
  });

  test("a long silent head is cut as a break; a short one is kept", () => {
    const head = buildSpeechMap(recording({ quiet: 7 * MIN }, ...lecture(30 * MIN)));
    expect(head.cuts).toEqual([{ kind: "break", start_ms: 0, end_ms: 7 * MIN - PAD, speech_ms: 0 }]);
    expect(head.time_map[0]).toEqual({ cut_start_ms: 0, orig_start_ms: 7 * MIN - PAD, length_ms: 30 * MIN + PAD });
    expect(buildSpeechMap(recording({ quiet: 4 * MIN }, ...lecture(30 * MIN))).cuts).toEqual([]);
  });

  test("head, two breaks and a tail in one recording", () => {
    const map = buildSpeechMap(
      recording({ quiet: 6 * MIN }, ...lecture(50 * MIN), { quiet: 12 * MIN }, ...lecture(45 * MIN), { quiet: 8 * MIN }, ...lecture(40 * MIN), { quiet: 5 * MIN }),
    );
    expect(map.cuts.map((c) => c.kind)).toEqual(["break", "break", "break", "tail"]);
    expect(map.time_map).toHaveLength(3);
    expectConsistent(map);
    // Cut audio is the three lectures plus a pad on each side of each.
    expect(map.cut_duration_ms).toBe(135 * MIN + 6 * PAD);
  });

  test("without sustained speech nothing is cut", () => {
    // Only 5 s bursts every 2 minutes: a nearly empty recording is left to the transcriber.
    const map = buildSpeechMap(recording({ quiet: 30 * MIN, burst: 5 * S, every: 2 * MIN }));
    expect(map.cuts).toEqual([]);
    expect(map.time_map).toEqual([{ cut_start_ms: 0, orig_start_ms: 0, length_ms: 30 * MIN }]);
  });

  test("input silences may be unsorted, overlapping or out of range", () => {
    const map = buildSpeechMap({
      duration_ms: 20 * MIN,
      silences: [
        { start_ms: 12 * MIN, end_ms: 25 * MIN },
        { start_ms: -500, end_ms: 1_000 },
        { start_ms: 6 * MIN, end_ms: 9 * MIN },
        { start_ms: 5 * MIN, end_ms: 7 * MIN },
      ],
    });
    expect(map.silences).toEqual([
      { start_ms: 5 * MIN, end_ms: 9 * MIN },
      { start_ms: 12 * MIN, end_ms: 20 * MIN },
    ]);
    expect(map.cuts.map((c) => [c.kind, c.start_ms, c.end_ms])).toEqual([["tail", 12 * MIN + PAD, 20 * MIN]]);
  });

  test("deterministic: same input, same map", () => {
    const input = recording(...lecture(30 * MIN), { quiet: 9 * MIN, burst: 3 * S, every: 50 * S }, ...lecture(30 * MIN));
    expect(buildSpeechMap(input)).toEqual(buildSpeechMap(structuredClone(input)));
  });

  test("rules are validated and echoed in the map", () => {
    expect(() => buildSpeechMap({ duration_ms: 1000, silences: [] }, { breakMinMs: -1 })).toThrow(RangeError);
    expect(() => buildSpeechMap({ duration_ms: 1000, silences: [] }, { maxCutSpeechRatio: 1.5 })).toThrow(RangeError);
    expect(() => buildSpeechMap({ duration_ms: 0, silences: [] })).toThrow(RangeError);
    const map = buildSpeechMap({ duration_ms: 1000, silences: [] }, { breakMinMs: 60_000 });
    expect(map.rules).toEqual({ ...DEFAULT_SPEECH_MAP_RULES, breakMinMs: 60_000 });
  });
});
