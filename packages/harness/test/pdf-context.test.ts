// The PDF part of the notes prompt (P3-04, D-P3-4): at most 12 pages of at most 2,000
// characters, chosen by total alignment score, labelled from 1 in reading order.

import { describe, expect, test } from "bun:test";
import type { AlignOutput, AlignPage } from "../src/pdf/align.ts";
import { buildPdfContext, PDF_CONTEXT_MAX_PAGES, PDF_CONTEXT_PAGE_CHARS } from "../src/pdf/context.ts";

const window = (start: number, pages: Array<[string, number, number]>): AlignOutput["windows"][number] => ({
  start_ms: start,
  end_ms: start + 60_000,
  pages: pages.map(([asset_id, page_no, score]) => ({ asset_id, page_no, score })),
});

/** The page bodies of a context text, header lines removed. */
const bodies = (text: string) => text.split("\n\n").map((block) => block.slice(block.indexOf("\n") + 1));

describe("buildPdfContext", () => {
  test("caps at 12 pages and 2000 chars", () => {
    const pages: AlignPage[] = Array.from({ length: 20 }, (_, i) => ({ asset_id: "ast_a", page_no: i + 1, text: "가".repeat(3000) }));
    const windows = Array.from({ length: 7 }, (_, w) =>
      window(
        w * 120_000,
        [0, 1, 2].map((k) => ["ast_a", ((w * 3 + k) % 20) + 1, 1 + ((w + k) % 4)] as [string, number, number])
      )
    );
    const ctx = buildPdfContext({ windows }, pages, ["ast_a"]);
    expect(ctx.labels).toHaveLength(PDF_CONTEXT_MAX_PAGES);
    const parts = bodies(ctx.text);
    expect(parts).toHaveLength(PDF_CONTEXT_MAX_PAGES);
    for (const body of parts) expect([...body].length).toBeLessThanOrEqual(PDF_CONTEXT_PAGE_CHARS);
    expect([...parts[0]!].length).toBe(PDF_CONTEXT_PAGE_CHARS);
  });

  test("labels start at 1 and follow reading order", () => {
    const pages: AlignPage[] = [
      { asset_id: "ast_a", page_no: 4, text: "에이 4쪽" },
      { asset_id: "ast_b", page_no: 7, text: "비 7쪽" },
      { asset_id: "ast_a", page_no: 2, text: "에이 2쪽" },
    ];
    const align = { windows: [window(0, [["ast_a", 4, 9], ["ast_b", 7, 5]]), window(120_000, [["ast_a", 2, 1]])] };
    // ast_b was uploaded first, so it is "자료 1".
    const ctx = buildPdfContext(align, pages, ["ast_b", "ast_a"]);
    expect(ctx.labels.map((l) => l.label)).toEqual([1, 2, 3]);
    expect(ctx.labels.map((l) => [l.asset_id, l.page_no])).toEqual([
      ["ast_b", 7],
      ["ast_a", 2],
      ["ast_a", 4],
    ]);
    expect(ctx.text).toBe("[PDF 1] (자료 1, 7쪽)\n비 7쪽\n\n[PDF 2] (자료 2, 2쪽)\n에이 2쪽\n\n[PDF 3] (자료 2, 4쪽)\n에이 4쪽");
  });

  test("highest total score wins the cut", () => {
    const pages: AlignPage[] = Array.from({ length: 14 }, (_, i) => ({ asset_id: "ast_a", page_no: i + 1, text: `쪽 ${i + 1}` }));
    // Pages 1..12 score 2 or more in total, page 13 scores 0.5, page 14 never scores.
    const windows = [
      window(0, [["ast_a", 1, 2], ["ast_a", 2, 2], ["ast_a", 3, 2]]),
      window(120_000, [["ast_a", 4, 2], ["ast_a", 5, 2], ["ast_a", 6, 2]]),
      window(240_000, [["ast_a", 7, 2], ["ast_a", 8, 2], ["ast_a", 13, 0.5]]),
      window(360_000, [["ast_a", 9, 2], ["ast_a", 10, 2], ["ast_a", 11, 1]]),
      window(480_000, [["ast_a", 12, 2], ["ast_a", 11, 1]]),
    ];
    const ctx = buildPdfContext({ windows }, pages, ["ast_a"]);
    const chosen = ctx.labels.map((l) => l.page_no);
    expect(chosen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(chosen).not.toContain(13);
    expect(chosen).not.toContain(14);
  });

  test("empty alignment", () => {
    expect(buildPdfContext({ windows: [] }, [{ asset_id: "ast_a", page_no: 1, text: "글" }], ["ast_a"])).toEqual({ text: "", labels: [] });
    expect(buildPdfContext({ windows: [window(0, [])] }, [], [])).toEqual({ text: "", labels: [] });
  });
});
