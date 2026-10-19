import { describe, expect, test } from "bun:test";
import {
  buildTimeMap,
  cutDurationMs,
  keptOriginalRanges,
  toCutMs,
  toOriginalMs,
  validateTimeMap,
  type TimeMapEntry,
} from "../src/index.ts";

const MIN = 60_000;

// Kept: 0–30 min and 50–80 min. The 20-minute gap in between was cut (AI_HARNESS §3.2).
const gapMap: TimeMapEntry[] = [
  { cut_start_ms: 0, orig_start_ms: 0, length_ms: 30 * MIN },
  { cut_start_ms: 30 * MIN, orig_start_ms: 50 * MIN, length_ms: 30 * MIN },
];

describe("buildTimeMap", () => {
  test("places kept ranges back to back in cut time", () => {
    expect(buildTimeMap([{ start_ms: 0, end_ms: 30 * MIN }, { start_ms: 50 * MIN, end_ms: 80 * MIN }])).toEqual(gapMap);
  });

  test("merges ranges that touch in original time and skips empty ones", () => {
    expect(
      buildTimeMap([
        { start_ms: 1000, end_ms: 2000 },
        { start_ms: 2000, end_ms: 3000 },
        { start_ms: 4000, end_ms: 4000 },
        { start_ms: 5000, end_ms: 6000 },
      ]),
    ).toEqual([
      { cut_start_ms: 0, orig_start_ms: 1000, length_ms: 2000 },
      { cut_start_ms: 2000, orig_start_ms: 5000, length_ms: 1000 },
    ]);
  });

  test("cut duration and kept ranges read back", () => {
    expect(cutDurationMs(gapMap)).toBe(60 * MIN);
    expect(cutDurationMs([])).toBe(0);
    expect(keptOriginalRanges(gapMap)).toEqual([
      { start_ms: 0, end_ms: 30 * MIN },
      { start_ms: 50 * MIN, end_ms: 80 * MIN },
    ]);
  });
});

describe("validateTimeMap", () => {
  test("accepts a well-formed map", () => {
    expect(validateTimeMap(JSON.parse(JSON.stringify(gapMap)))).toEqual(gapMap);
  });

  test.each([
    ["empty", []],
    ["not an array", { cut_start_ms: 0 }],
    ["non-integer", [{ cut_start_ms: 0, orig_start_ms: 0.5, length_ms: 10 }]],
    ["negative", [{ cut_start_ms: 0, orig_start_ms: -1, length_ms: 10 }]],
    ["zero length", [{ cut_start_ms: 0, orig_start_ms: 0, length_ms: 0 }]],
    ["not starting at 0", [{ cut_start_ms: 5, orig_start_ms: 0, length_ms: 10 }]],
    [
      "a hole in cut time",
      [
        { cut_start_ms: 0, orig_start_ms: 0, length_ms: 10 },
        { cut_start_ms: 11, orig_start_ms: 20, length_ms: 10 },
      ],
    ],
    [
      "overlapping original ranges",
      [
        { cut_start_ms: 0, orig_start_ms: 0, length_ms: 10 },
        { cut_start_ms: 10, orig_start_ms: 5, length_ms: 10 },
      ],
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => validateTimeMap(value)).toThrow();
  });
});

describe("toOriginalMs", () => {
  test("20-minute gap: times after the cut jump over it", () => {
    expect(toOriginalMs(0, gapMap)).toBe(0);
    expect(toOriginalMs(29 * MIN, gapMap)).toBe(29 * MIN);
    expect(toOriginalMs(35 * MIN, gapMap)).toBe(55 * MIN);
    expect(toOriginalMs(60 * MIN - 1, gapMap)).toBe(80 * MIN - 1);
  });

  test("a boundary instant starts the next range but ends the previous one", () => {
    expect(toOriginalMs(30 * MIN, gapMap)).toBe(50 * MIN);
    expect(toOriginalMs(30 * MIN, gapMap, "start")).toBe(50 * MIN);
    expect(toOriginalMs(30 * MIN, gapMap, "end")).toBe(30 * MIN);
    expect(toOriginalMs(0, gapMap, "end")).toBe(0);
  });

  test("a segment ending at the junction does not swallow the break", () => {
    const seg = { start_ms: 29 * MIN, end_ms: 30 * MIN };
    const start = toOriginalMs(seg.start_ms, gapMap, "start");
    const end = toOriginalMs(seg.end_ms, gapMap, "end");
    expect(end - start).toBe(MIN);
  });

  test("clamps times past the end of the cut audio (providers overshoot by up to 1 s)", () => {
    expect(toOriginalMs(60 * MIN, gapMap)).toBe(80 * MIN);
    expect(toOriginalMs(60 * MIN + 900, gapMap)).toBe(80 * MIN);
    expect(toOriginalMs(60 * MIN + 900, gapMap, "end")).toBe(80 * MIN);
  });

  test("rejects negative, non-finite times and an empty map", () => {
    expect(() => toOriginalMs(-1, gapMap)).toThrow(RangeError);
    expect(() => toOriginalMs(Number.NaN, gapMap)).toThrow(RangeError);
    expect(() => toOriginalMs(10, [])).toThrow(RangeError);
  });

  test("a map with a cut head offsets everything", () => {
    const map = buildTimeMap([{ start_ms: 7 * MIN, end_ms: 20 * MIN }]);
    expect(toOriginalMs(0, map)).toBe(7 * MIN);
    expect(toOriginalMs(MIN, map)).toBe(8 * MIN);
  });
});

describe("toCutMs", () => {
  test("kept instants map back; removed ones collapse to the junction", () => {
    expect(toCutMs(10 * MIN, gapMap)).toBe(10 * MIN);
    expect(toCutMs(55 * MIN, gapMap)).toBe(35 * MIN);
    expect(toCutMs(40 * MIN, gapMap)).toBe(30 * MIN); // inside the 20-minute gap
    expect(toCutMs(90 * MIN, gapMap)).toBe(60 * MIN); // past the end
    expect(toCutMs(MIN, buildTimeMap([{ start_ms: 7 * MIN, end_ms: 20 * MIN }]))).toBe(0); // inside a cut head
  });

  test("round trip in both directions over a multi-cut map", () => {
    const map = buildTimeMap([
      { start_ms: 4_000, end_ms: 61_000 },
      { start_ms: 400_000, end_ms: 401_500 },
      { start_ms: 1_000_000, end_ms: 1_250_000 },
    ]);
    const total = cutDurationMs(map);
    for (let cut = 0; cut < total; cut += 250) {
      expect(toCutMs(toOriginalMs(cut, map), map)).toBe(cut);
    }
    for (const range of keptOriginalRanges(map)) {
      for (let orig = range.start_ms; orig < range.end_ms; orig += 250) {
        expect(toOriginalMs(toCutMs(orig, map), map)).toBe(orig);
      }
    }
  });
});
