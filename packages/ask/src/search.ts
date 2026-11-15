// Search over the hybrid index (P3-06, CONTRACTS D-P3-5): GET /search runs the same
// retrieval as 물어보기 (BM25 + vectors, RRF) over the caller's access scope, keeps the
// passages that pass the same evidence bar, and cuts a highlighted snippet from each.
// Transcript windows, document blocks and PDF pages come back alike; the route maps them
// to its hit kinds. No model is called here besides the query embedding.

import type { ChunkKind } from "./chunk.ts";
import { retrieve, RETRIEVAL, type RetrievalDeps } from "./hybrid.ts";
import type { AccessScope } from "./scope.ts";
import type { ChunkRow } from "./store.ts";
import type { QueryTerm } from "./text.ts";

export interface SnippetRun {
  text: string;
  highlight: boolean;
}

export interface SearchChunkHit {
  chunk: ChunkRow;
  snippet: SnippetRun[];
  rrf: number;
}

export const SNIPPET_RADIUS = 80;

/**
 * Up to `radius` characters each side of the earliest term in `text`, every term occurrence
 * in that window a highlighted run (case-insensitive). Without a term, the first
 * `2 * radius` characters. A cut end gets `…`. The runs, `…` aside, are the window verbatim.
 */
export function makeSnippet(text: string, terms: readonly QueryTerm[], radius = SNIPPET_RADIUS): SnippetRun[] {
  if (text === "") return [];
  const lowered = text.toLowerCase();
  // Matching needs one index space for both strings; a lowercase that changes the length
  // (rare letters) falls back to matching the text as it is.
  const hay = lowered.length === text.length ? lowered : text;
  const needles = [...new Set(terms.map((t) => t.text).filter((t) => t !== ""))].sort((a, b) => b.length - a.length);

  let first = -1;
  let firstLength = 0;
  for (const needle of needles) {
    const at = hay.indexOf(needle);
    if (at !== -1 && (first === -1 || at < first)) {
      first = at;
      firstLength = needle.length;
    }
  }
  const start = first === -1 ? 0 : Math.max(0, first - radius);
  const end = first === -1 ? Math.min(text.length, radius * 2) : Math.min(text.length, first + firstLength + radius);

  const runs: SnippetRun[] = [];
  let plain = start;
  for (let i = start; i < end; ) {
    const needle = needles.find((n) => i + n.length <= end && hay.startsWith(n, i));
    if (!needle) {
      i += 1;
      continue;
    }
    if (i > plain) runs.push({ text: text.slice(plain, i), highlight: false });
    runs.push({ text: text.slice(i, i + needle.length), highlight: true });
    i += needle.length;
    plain = i;
  }
  if (plain < end) runs.push({ text: text.slice(plain, end), highlight: false });
  if (runs.length === 0) return [];
  if (start > 0) runs.unshift({ text: "…", highlight: false });
  if (end < text.length) runs.push({ text: "…", highlight: false });
  return runs;
}

/**
 * The passages of `access` that match `query`, best first, each with a snippet. `kinds`
 * keeps only those chunk kinds. Same evidence bar as 물어보기 (hasEvidence): a passage
 * needs enough of the query terms or a close enough embedding.
 */
export async function searchIndex(
  deps: RetrievalDeps,
  access: AccessScope,
  query: string,
  opts: { kinds?: readonly ChunkKind[]; limit?: number } = {},
): Promise<{ hits: SearchChunkHit[]; embeddingTokens: number }> {
  const limit = opts.limit ?? 50;
  const result = await retrieve(deps, access, query, { limit: opts.kinds ? 100 : limit, perRecordingCap: 5 });
  const minCoverage = Math.min(RETRIEVAL.minTermCoverage, 2 / Math.max(1, result.terms.length));
  const hits = result.chunks
    .filter((c) => c.coverage >= minCoverage || (c.cosine !== null && c.cosine >= RETRIEVAL.minCosine))
    .filter((c) => !opts.kinds || opts.kinds.includes(c.chunk.kind))
    .slice(0, limit)
    .map((c) => ({ chunk: c.chunk, snippet: makeSnippet(c.chunk.text, result.terms), rrf: c.rrf }));
  return { hits, embeddingTokens: result.embeddingTokens };
}
