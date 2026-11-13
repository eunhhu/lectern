import { describe, expect, test } from "bun:test";
import { expandSourceTokens, formatCompactTranscript, parseSourceToken } from "../src/notes/compact.ts";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("formatCompactTranscript", () => {
  test("formats lines under an hour", () => {
    const out = formatCompactTranscript({
      segments: [
        { idx: 12, start_ms: 843000, speaker: "S1", text: "안녕하세요" },
        { idx: 13, start_ms: 861000, speaker: "S2", text: "네" },
      ],
    });
    expect(out.text).toBe("#12 [14:03] S1: 안녕하세요\n#13 [14:21] S2: 네");
    expect(out.ids).toEqual([12, 13]);
  });

  test("uses H:MM:SS from one hour", () => {
    const out = formatCompactTranscript({ segments: [{ idx: 1, start_ms: 3725000, speaker: "S1", text: "x" }] });
    expect(out.text).toContain("[1:02:05]");
  });

  test("zero-pads minutes and drops no-speaker label", () => {
    const out = formatCompactTranscript({ segments: [{ idx: 0, start_ms: 185000, speaker: null, text: "본문" }] });
    expect(out.text).toBe("#0 [03:05] 본문");
  });

  test("flattens newlines", () => {
    const out = formatCompactTranscript({ segments: [{ idx: 0, start_ms: 0, speaker: "S1", text: "가\n나" }] });
    expect(out.text).toBe("#0 [00:00] S1: 가 나");
  });
});

describe("source tokens", () => {
  test("parseSourceToken", () => {
    expect(parseSourceToken("#12")).toEqual({ start: 12, end: 12 });
    expect(parseSourceToken("#40-#44")).toEqual({ start: 40, end: 44 });
    expect(parseSourceToken("12")).toBeNull();
    expect(parseSourceToken("#4-#2")).toBeNull();
    expect(parseSourceToken("#a")).toBeNull();
    expect(parseSourceToken("#1-4")).toBeNull();
  });

  test("expands a full range", () => {
    expect(expandSourceTokens(["#40-#44"], range(40, 44))).toEqual({
      refs: [{ kind: "transcript", start_idx: 40, end_idx: 44 }],
      dropped: [],
    });
  });

  test("splits a range around a missing id", () => {
    expect(expandSourceTokens(["#40-#44"], new Set([40, 41, 43, 44]))).toEqual({
      refs: [
        { kind: "transcript", start_idx: 40, end_idx: 41 },
        { kind: "transcript", start_idx: 43, end_idx: 44 },
      ],
      dropped: ["#42"],
    });
  });

  test("drops unknown ids", () => {
    expect(expandSourceTokens(["#99", "#50-#60", "x"], range(1, 10))).toEqual({
      refs: [],
      dropped: ["#99", "#50-#60", "x"],
    });
  });

  test("dedupes refs", () => {
    expect(expandSourceTokens(["#3", "#3"], range(1, 10)).refs).toHaveLength(1);
  });

  test("a huge range counts as unparseable", () => {
    expect(expandSourceTokens(["#0-#200000"], [1]).dropped).toEqual(["#0-#200000"]);
  });
});
