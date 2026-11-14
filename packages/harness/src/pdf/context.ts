// The PDF part of the notes prompt (P3-04, CONTRACTS D-P3-4, §1.3): the pages the alignment
// ranked highest over the whole recording, at most 12, each cut to 2,000 characters, in
// reading order and labelled from 1. structure and extract cite pages by these labels
// (`pdf_pages`); verify maps a label back to its asset and page.

import type { AlignOutput, AlignPage } from "./align.ts";

export const PDF_CONTEXT_MAX_PAGES = 12;
export const PDF_CONTEXT_PAGE_CHARS = 2_000;

export interface PdfLabel {
  label: number;
  asset_id: string;
  page_no: number;
}

export interface PdfContext {
  text: string;
  labels: PdfLabel[];
}

const pageKey = (assetId: string, pageNo: number) => `${assetId}\u0000${pageNo}`;

/** `assetOrder` is the recording's PDF asset ids in upload order (part_index, created_at). */
export function buildPdfContext(align: AlignOutput, pages: readonly AlignPage[], assetOrder: readonly string[]): PdfContext {
  const totals = new Map<string, { asset_id: string; page_no: number; score: number }>();
  for (const window of align.windows) {
    for (const p of window.pages) {
      const key = pageKey(p.asset_id, p.page_no);
      const entry = totals.get(key);
      if (entry) entry.score += p.score;
      else totals.set(key, { asset_id: p.asset_id, page_no: p.page_no, score: p.score });
    }
  }
  const position = (assetId: string) => {
    const at = assetOrder.indexOf(assetId);
    return at === -1 ? assetOrder.length : at;
  };
  const readingOrder = (a: { asset_id: string; page_no: number }, b: { asset_id: string; page_no: number }) =>
    position(a.asset_id) - position(b.asset_id) || a.page_no - b.page_no;

  const textOf = new Map(pages.map((p) => [pageKey(p.asset_id, p.page_no), p.text] as const));
  const chosen = [...totals.values()]
    .filter((p) => textOf.has(pageKey(p.asset_id, p.page_no)))
    .sort((a, b) => b.score - a.score || readingOrder(a, b))
    .slice(0, PDF_CONTEXT_MAX_PAGES)
    .sort(readingOrder);
  if (chosen.length === 0) return { text: "", labels: [] };

  const labels = chosen.map((p, i) => ({ label: i + 1, asset_id: p.asset_id, page_no: p.page_no }));
  const text = labels
    .map((l) => {
      const body = [...(textOf.get(pageKey(l.asset_id, l.page_no)) ?? "")].slice(0, PDF_CONTEXT_PAGE_CHARS).join("");
      return `[PDF ${l.label}] (자료 ${position(l.asset_id) + 1}, ${l.page_no}쪽)\n${body}`;
    })
    .join("\n\n");
  return { text, labels };
}
