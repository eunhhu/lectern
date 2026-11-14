// The search benchmark's synthesizer and statistics (P3-10), and two small runs of the
// script itself in a child process (scripts/ is outside tsconfig, so running it is the check).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mulberry32, percentile, SEGMENTS_PER_RECORDING, synthQuery, synthRecording, WORDS } from "../../../scripts/bench/synth.ts";

const ROOT = join(import.meta.dir, "../../..");
const SCRIPT = join(ROOT, "scripts/bench/search.ts");

function runBench(args: string[]) {
  return Bun.spawnSync([process.execPath, SCRIPT, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
}

describe("synth", () => {
  test("synthRecording is deterministic", () => {
    expect(synthRecording(3, mulberry32(1))).toEqual(synthRecording(3, mulberry32(1)));
    expect(synthQuery(mulberry32(9))).toBe(synthQuery(mulberry32(9)));
  });

  test("synthRecording shape", () => {
    const rec = synthRecording(3, mulberry32(1));
    expect(rec.segments).toHaveLength(SEGMENTS_PER_RECORDING);
    expect(rec.segments).toHaveLength(300);
    rec.segments.forEach((s, i) => {
      expect(s.idx).toBe(i);
      expect(s.end_ms).toBeGreaterThanOrEqual(s.start_ms);
      if (i > 0) expect(s.start_ms).toBeGreaterThan(rec.segments[i - 1]!.start_ms);
      const words = s.text.replace(/\.$/, "").split(" ");
      expect(words.length).toBeGreaterThanOrEqual(12);
      expect(words.length).toBeLessThanOrEqual(20);
      expect(words.every((w) => WORDS.includes(w))).toBe(true);
    });
  });

  test("the word list has 200 distinct words", () => {
    expect(WORDS).toHaveLength(200);
    expect(new Set(WORDS).size).toBe(200);
  });

  test("percentile", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("bench script", () => {
  test("bench runs small", () => {
    const run = runBench(["--recordings", "5", "--queries", "30"]);
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(run.stdout.toString().trim());
    expect(out.recordings).toBe(5);
    expect(out.queries).toBe(30);
    expect(out.chunks).toBeGreaterThan(0);
    expect(out.p95_ms).toBeGreaterThanOrEqual(out.p50_ms);
    expect(out.max_ms).toBeGreaterThanOrEqual(out.p95_ms);
  }, 30_000);

  test("bench fails over the limit", () => {
    const run = runBench(["--recordings", "5", "--queries", "30", "--max-p95-ms", "0"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("exceeds 0ms");
  }, 30_000);
});
