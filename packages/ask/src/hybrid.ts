// Hybrid retrieval: BM25 and vector ranks fused with reciprocal rank fusion
// (docs/adr/0009-ask-rag.md, "검색").
//
// RRF needs no score calibration between the two lists, which matters here because
// BM25 over bigrams and cosine over embeddings live on unrelated scales. The vector
// half is optional: without an embedder (or before a recording's embeddings exist) the
// result is plain BM25, so search and ask degrade instead of failing.

import type { Database } from "bun:sqlite";
import { lexicalSearch } from "./lexical.ts";
import type { AccessScope } from "./scope.ts";
import { type ChunkRow, chunksBySeq } from "./store.ts";
import { queryTerms, type QueryTerm, termCoverage } from "./text.ts";
import type { Embedder, VectorIndex } from "./vector.ts";

export const RETRIEVAL = {
  lexicalLimit: 40,
  vectorLimit: 40,
  /** RRF constant from Cormack et al. (2009). */
  rrfK: 60,
  /** At most this many passages from one recording in a multi-recording scope. */
  perRecordingCap: 3,
  /**
   * Evidence gate, checked before any model call (ADR "모름 판정"): the best passage must
   * contain at least this share of the query terms, or reach this cosine. Provisional
   * values, to be fitted on the eval set (§8).
   */
  minTermCoverage: 0.5,
  minCosine: 0.55,
} as const;

export interface RetrievedChunk {
  chunk: ChunkRow;
  rrf: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  bm25: number | null;
  cosine: number | null;
  /** Share of the query terms the chunk contains (spacing ignored). */
  coverage: number;
}

export interface RetrievalResult {
  terms: QueryTerm[];
  chunks: RetrievedChunk[];
  /** Tokens billed for the query embedding (0 when cached or no embedder). */
  embeddingTokens: number;
  usedVectors: boolean;
}

export interface RetrievalDeps {
  db: Database;
  embedder?: Embedder;
  vectorIndex?: VectorIndex;
  /** Remembers query embeddings so a repeated question costs no embedding call. */
  queryCache?: QueryEmbeddingCache;
  signal?: AbortSignal;
}

/** Small LRU of query embeddings keyed by workspace, model and normalized question. */
export class QueryEmbeddingCache {
  private entries = new Map<string, Float32Array>();
  constructor(private max = 512) {}
  get(key: string): Float32Array | undefined {
    const v = this.entries.get(key);
    if (v) {
      this.entries.delete(key);
      this.entries.set(key, v);
    }
    return v;
  }
  set(key: string, v: Float32Array): void {
    this.entries.set(key, v);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
}

export async function retrieve(
  deps: RetrievalDeps,
  access: AccessScope,
  question: string,
  opts: { limit?: number; perRecordingCap?: number } = {},
): Promise<RetrievalResult> {
  const terms = queryTerms(question);
  const limit = opts.limit ?? 12;
  const lexical = lexicalSearch(deps.db, access, terms, { limit: RETRIEVAL.lexicalLimit, fallbackText: question });

  let embeddingTokens = 0;
  let vectorHits: Array<{ seq: number; score: number; rank: number }> = [];
  if (deps.embedder && deps.vectorIndex && access.recordingIds.length > 0) {
    const key = `${access.workspaceId}\n${deps.embedder.model}\n${deps.embedder.dim}\n${question.normalize("NFKC").trim().toLowerCase()}`;
    let vector = deps.queryCache?.get(key);
    if (!vector) {
      const res = await deps.embedder.embed([question], "query", deps.signal);
      vector = res.vectors[0]!;
      embeddingTokens = res.inputTokens;
      deps.queryCache?.set(key, vector);
    }
    vectorHits = deps.vectorIndex.search(access, vector, RETRIEVAL.vectorLimit);
  }

  const fused = new Map<number, RetrievedChunk>();
  for (const hit of lexical) {
    fused.set(hit.chunk.seq, {
      chunk: hit.chunk,
      rrf: 1 / (RETRIEVAL.rrfK + hit.rank),
      lexicalRank: hit.rank,
      vectorRank: null,
      bm25: hit.score,
      cosine: null,
      coverage: 0,
    });
  }
  const missing = vectorHits.filter((h) => !fused.has(h.seq)).map((h) => h.seq);
  const loaded = chunksBySeq(deps.db, access.workspaceId, missing);
  const allowed = new Set(access.recordingIds);
  for (const hit of vectorHits) {
    const existing = fused.get(hit.seq);
    if (existing) {
      existing.rrf += 1 / (RETRIEVAL.rrfK + hit.rank);
      existing.vectorRank = hit.rank;
      existing.cosine = hit.score;
      continue;
    }
    const chunk = loaded.get(hit.seq);
    if (!chunk || !allowed.has(chunk.recordingId)) continue;
    fused.set(hit.seq, {
      chunk,
      rrf: 1 / (RETRIEVAL.rrfK + hit.rank),
      lexicalRank: null,
      vectorRank: hit.rank,
      bm25: null,
      cosine: hit.score,
      coverage: 0,
    });
  }

  const ranked = [...fused.values()].sort((a, b) => b.rrf - a.rrf || a.chunk.seq - b.chunk.seq);
  const cap = access.recordingIds.length > 1 ? (opts.perRecordingCap ?? RETRIEVAL.perRecordingCap) : Infinity;
  const perRecording = new Map<string, number>();
  const chunks: RetrievedChunk[] = [];
  for (const r of ranked) {
    const n = perRecording.get(r.chunk.recordingId) ?? 0;
    if (n >= cap) continue;
    perRecording.set(r.chunk.recordingId, n + 1);
    r.coverage = termCoverage(terms, `${r.chunk.heading ?? ""}\n${r.chunk.text}`);
    chunks.push(r);
    if (chunks.length >= limit) break;
  }
  return { terms, chunks, embeddingTokens, usedVectors: vectorHits.length > 0 };
}

/**
 * True when the retrieved passages plausibly contain an answer. When false the turn
 * ends as `no_answer` without a model call: the cheapest answer to an unanswerable
 * question is the one never generated.
 */
export function hasEvidence(result: RetrievalResult): boolean {
  // Half the terms, but two terms are always enough: long questions carry filler words.
  const minCoverage = Math.min(RETRIEVAL.minTermCoverage, 2 / Math.max(1, result.terms.length));
  return result.chunks.some((c) => c.coverage >= minCoverage || (c.cosine !== null && c.cosine >= RETRIEVAL.minCosine));
}
