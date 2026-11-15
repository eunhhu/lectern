// The committed query of a search box never follows half-typed Hangul (D-P3-5).

import { describe, expect, test } from "bun:test";
import { nextCommitted } from "../src/lib/ime-query.ts";

describe("nextCommitted", () => {
  test("follows raw when not composing", () => {
    expect(nextCommitted("a", "ab", false)).toBe("ab");
  });

  test("freezes while composing", () => {
    expect(nextCommitted("시", "시험", true)).toBe("시");
  });

  test("commits after composition ends", () => {
    expect(nextCommitted("시", "시험", false)).toBe("시험");
  });
});
