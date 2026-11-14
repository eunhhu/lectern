// The `align` stage (P3-04, CONTRACTS D-P3-4, AI_HARNESS §3.6): which lecture PDF pages a
// stretch of the transcript talks about, without any model. The transcript is cut into
// 2-minute windows; each window is scored against every PDF page with BM25 over the ask
// index tokens (character bigrams of Korean runs, whole Latin words) and keeps its top 3
// pages. The result feeds the notes context (context.ts) and GET /recordings/{id}/alignment.

import { indexTokens } from "@lectern/ask";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../hash.ts";
import { defineStage, type StageDefinition } from "../stage.ts";

export const ALIGN_WINDOW_MS = 120_000;
export const ALIGN_TOP_PAGES = 3;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export interface AlignSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface AlignPage {
  asset_id: string;
  page_no: number;
  text: string;
}

export const AlignOutput = z.object({
  windows: z.array(
    z.object({
      start_ms: z.int().nonnegative(),
      end_ms: z.int().nonnegative(),
      pages: z.array(z.object({ asset_id: z.string(), page_no: z.int().min(1), score: z.number() })),
    })
  ),
});
export type AlignOutput = z.infer<typeof AlignOutput>;

export interface AlignInput {
  segments: AlignSegment[];
  pages: AlignPage[];
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Transcript text by 2-minute window number, ascending; segments without text are left out. */
function windowsOf(segments: readonly AlignSegment[]): Array<{ n: number; text: string; end_ms: number }> {
  const byWindow = new Map<number, { texts: string[]; end_ms: number }>();
  for (const s of segments) {
    if (s.text.trim() === "") continue;
    const n = Math.floor(s.start_ms / ALIGN_WINDOW_MS);
    const w = byWindow.get(n);
    if (w) {
      w.texts.push(s.text);
      w.end_ms = Math.max(w.end_ms, s.end_ms);
    } else {
      byWindow.set(n, { texts: [s.text], end_ms: s.end_ms });
    }
  }
  return [...byWindow.entries()].sort(([a], [b]) => a - b).map(([n, w]) => ({ n, text: w.texts.join(" "), end_ms: w.end_ms }));
}

/** Top pages per 2-minute window by BM25 (k1 1.2, b 0.75). Pure and deterministic. */
export function alignWindows(segments: readonly AlignSegment[], pages: readonly AlignPage[]): AlignOutput {
  const corpus = pages
    .map((page) => {
      const tokens = indexTokens(page.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { page, len: tokens.length, tf };
    })
    .filter((doc) => doc.len > 0);
  const N = corpus.length;
  const avgdl = N > 0 ? corpus.reduce((sum, doc) => sum + doc.len, 0) / N : 0;
  const df = new Map<string, number>();
  for (const doc of corpus) for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  return {
    windows: windowsOf(segments).map((w) => {
      const terms = [...new Set(indexTokens(w.text))];
      const scored = corpus
        .map((doc) => {
          let score = 0;
          for (const t of terms) {
            const f = doc.tf.get(t);
            if (!f) continue;
            score += (idf(t) * (f * (BM25_K1 + 1))) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / avgdl));
          }
          return { asset_id: doc.page.asset_id, page_no: doc.page.page_no, score: round4(score) };
        })
        .filter((p) => p.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0) || a.page_no - b.page_no
        );
      return { start_ms: w.n * ALIGN_WINDOW_MS, end_ms: w.end_ms, pages: scored.slice(0, ALIGN_TOP_PAGES) };
    }),
  };
}

export const alignStage: StageDefinition<AlignInput, AlignOutput> = defineStage({
  name: "align",
  version: 1,
  output: AlignOutput,
  memo: "shared",
  retry: { maxAttempts: 1, repairs: 0 },
  key(input: AlignInput) {
    return {
      inputs: [
        sha256Hex(canonicalJson(input.segments.map((s) => [s.idx, s.start_ms, s.end_ms, s.text]))),
        sha256Hex(canonicalJson(input.pages.map((p) => [p.asset_id, p.page_no, p.text]))),
      ],
      config: { window_ms: ALIGN_WINDOW_MS, top: ALIGN_TOP_PAGES, k1: BM25_K1, b: BM25_B, tokenizer: "ask.indexTokens" },
    };
  },
  async run(input) {
    return alignWindows(input.segments, input.pages);
  },
});
