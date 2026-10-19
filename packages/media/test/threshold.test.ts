import { describe, expect, test } from "bun:test";
import { AUTO_THRESHOLD_DEFAULTS, estimateSilenceThreshold, FIXED_NOISE_DB, parseWindowPeaks } from "../src/index.ts";

/** `count` window peaks cycling deterministically through `levels`. */
const windows = (count: number, ...levels: number[]) => Array.from({ length: count }, (_, i) => levels[i % levels.length]!);

/** A noisy lecture: 70% speech windows (peaks -6..-14 dBFS), 30% pause windows at the room's noise floor. */
const lecture = (floorDb: number) => [...windows(700, -6, -8, -10, -12, -14), ...windows(300, floorDb - 1, floorDb, floorDb + 1)];

describe("estimateSilenceThreshold", () => {
  test("a clean recording keeps the fixed threshold", () => {
    expect(estimateSilenceThreshold(lecture(-62), FIXED_NOISE_DB)).toEqual({ noise_db: -35, adaptive: false, floor_db: -63, speech_db: -6 });
  });

  test("digital-silence pauses say nothing about the room", () => {
    const peaks = [...windows(700, -6, -10, -14), ...windows(300, -Infinity, -91)];
    expect(estimateSilenceThreshold(peaks, FIXED_NOISE_DB)).toMatchObject({ noise_db: -35, adaptive: false, floor_db: -14 });
  });

  test("a noisy room (pauses peaking at -34 dBFS) raises the threshold to floor + 6 dB", () => {
    expect(estimateSilenceThreshold(lecture(-34), FIXED_NOISE_DB)).toEqual({ noise_db: -29, adaptive: true, floor_db: -35, speech_db: -6 });
  });

  test("never above the ceiling, however noisy", () => {
    expect(estimateSilenceThreshold(lecture(-28), FIXED_NOISE_DB)).toMatchObject({ noise_db: AUTO_THRESHOLD_DEFAULTS.ceilingDb, adaptive: true });
  });

  test("never within 15 dB of the speech level", () => {
    // Floor -36 wants -30; speech peaks at -16 allow at most -31.
    const peaks = [...windows(700, -16, -18, -20), ...windows(300, -36, -35, -34)];
    expect(estimateSilenceThreshold(peaks, FIXED_NOISE_DB)).toEqual({ noise_db: -31, adaptive: true, floor_db: -36, speech_db: -16 });
  });

  test("no clear gap between floor and speech (very noisy, or no pauses at all) keeps the fixed threshold", () => {
    expect(estimateSilenceThreshold(lecture(-18), FIXED_NOISE_DB)).toMatchObject({ noise_db: -35, adaptive: false });
    expect(estimateSilenceThreshold(windows(1000, -9, -11, -13), FIXED_NOISE_DB)).toMatchObject({ noise_db: -35, adaptive: false });
  });

  test("too little audio to estimate from", () => {
    expect(estimateSilenceThreshold(windows(49, -6, -34), FIXED_NOISE_DB)).toEqual({ noise_db: -35, adaptive: false, floor_db: null, speech_db: null });
    expect(estimateSilenceThreshold([], FIXED_NOISE_DB).adaptive).toBe(false);
  });

  test("order and non-finite values do not matter", () => {
    const peaks = lecture(-33);
    const shuffled = [...peaks].reverse().concat([Number.NaN, -Infinity]);
    expect(estimateSilenceThreshold(shuffled, FIXED_NOISE_DB)).toEqual(estimateSilenceThreshold(peaks, FIXED_NOISE_DB));
  });

  test("tunable", () => {
    expect(estimateSilenceThreshold(lecture(-34), FIXED_NOISE_DB, { marginDb: 3 }).noise_db).toBe(-32);
    expect(estimateSilenceThreshold(lecture(-34), -30).noise_db).toBe(-29);
    expect(estimateSilenceThreshold(lecture(-34), -28)).toMatchObject({ noise_db: -28, adaptive: false });
  });
});

test("parseWindowPeaks reads ametadata output, -inf included", () => {
  const text = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.astats.Overall.Peak_level=-17.661613",
    "frame:1    pts:1600    pts_time:0.1",
    "lavfi.astats.Overall.Peak_level=-inf",
    "frame:2    pts:3200    pts_time:0.2",
    "lavfi.astats.Overall.Peak_level=-40.5",
    "lavfi.astats.Overall.Peak_level=nan",
  ].join("\n");
  expect(parseWindowPeaks(text)).toEqual([-17.661613, -Infinity, -40.5]);
});
