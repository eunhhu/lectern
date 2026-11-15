// Pure helpers of the PDF viewer (D-P3-7): page bounds, zoom steps and the OCR cost line.

import { describe, expect, test } from "bun:test";
import { clampPage, formatCostUsd, nextZoom } from "../src/lib/pdf-view.ts";

describe("pdf view helpers", () => {
  test("clampPage", () => {
    expect([clampPage(0, 10), clampPage(11, 10), clampPage(5, 10), clampPage(Number.NaN, 10), clampPage(-3, 10)]).toEqual([1, 10, 5, 1, 1]);
    expect(clampPage(3.7, 10)).toBe(3);
    expect(clampPage(4, 0)).toBe(1);
  });

  test("nextZoom steps", () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
  });

  test("nextZoom saturates", () => {
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
  });

  test("nextZoom off-grid", () => {
    expect(nextZoom(1.1, 1)).toBe(1.25);
    expect(nextZoom(1.1, -1)).toBe(1);
  });

  test("formatCostUsd", () => {
    expect([formatCostUsd(2818), formatCostUsd(0), formatCostUsd(1_500_000)]).toEqual(["$0.0028", "$0", "$1.5000"]);
  });
});
