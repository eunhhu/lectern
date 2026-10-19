// Vector retrieval (docs/adr/0009-ask-rag.md, "벡터 저장").
//
// Embeddings live in SQLite (search_embedding, int8 codes). Search is a brute-force scan
// in this process over the caller's workspace, loaded once and cached until the
// workspace's index generation changes:
// - up to FULL_SCAN_MAX vectors in scope: exact int8 dot products;
// - above that: Hamming distance on sign bits (96 bytes per 768-dim vector) picks
//   RESCORE_CANDIDATES, which are rescored exactly from their int8 codes.
// A workspace with more than memoryCodesMax vectors keeps only the sign bits in memory
// (38 MB for 400k vectors instead of 307 MB of int8) and reads the candidates' int8
// codes from SQLite for rescoring.
// Measured on an M3 (×4 for a Pi 5, stated in the ADR): 400k × 768 takes 420 ms exact
// and 23 ms with the binary prefilter. No SQLite extension is needed, so tests on macOS
// (whose system SQLite cannot load extensions) run the same code as the Pi. The
// VectorIndex interface lets sqlite-vec replace this later.

import type { Database } from "bun:sqlite";
import type { AccessScope } from "./scope.ts";
import { indexGeneration } from "./store.ts";
import { indexTokens } from "./text.ts";

export interface EmbeddingResult {
  vectors: Float32Array[];
  /** Billed input tokens. */
  inputTokens: number;
}

/**
 * An embedding model. `purpose` lets an adapter add the model's query/document
 * convention (gemini-embedding-2 uses text prefixes rather than a task type).
 */
export interface Embedder {
  readonly provider: string;
  /** Pinned model id. */
  readonly model: string;
  readonly dim: number;
  embed(texts: readonly string[], purpose: "document" | "query", signal?: AbortSignal): Promise<EmbeddingResult>;
}

export interface VectorHit {
  seq: number;
  recordingId: string;
  /** Cosine similarity of the normalized vectors. */
  score: number;
  rank: number;
}

export interface VectorIndex {
  search(access: AccessScope, query: Float32Array, k: number): VectorHit[];
}

/**
 * Deterministic stand-in for tests and local runs: feature-hashes the index tokens
 * (bigrams, words) into `dim` buckets. Texts sharing words land close together, which is
 * enough to exercise fusion and ranking without a provider.
 */
export class FakeEmbedder implements Embedder {
  readonly provider = "fake";
  readonly model = "fake-hash-embedding";
  calls = 0;
  constructor(readonly dim = 64) {}

  async embed(texts: readonly string[], _purpose?: "document" | "query", _signal?: AbortSignal): Promise<EmbeddingResult> {
    this.calls++;
    let inputTokens = 0;
    const vectors = texts.map((text) => {
      const v = new Float32Array(this.dim);
      const tokens = indexTokens(text);
      inputTokens += tokens.length;
      for (const token of tokens) {
        let h = 2166136261;
        for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
        v[(h >>> 0) % this.dim]! += (h & 0x100) === 0 ? 1 : -1;
      }
      return v;
    });
    return { vectors, inputTokens };
  }
}

export const VECTOR_SEARCH = {
  /** At or below this many vectors in scope, scan int8 exactly. */
  fullScanMax: 20_000,
  /** Candidates kept by the binary prefilter for exact rescoring. */
  rescoreCandidates: 400,
  /** Above this many vectors in a workspace, int8 codes stay on disk (bits only in memory). */
  memoryCodesMax: 50_000,
};

interface WorkspaceVectors {
  generation: number;
  seqs: Int32Array;
  recordingIds: string[];
  /** Empty when the workspace is larger than memoryCodesMax. */
  codes: Int8Array;
  scales: Float32Array;
  bits: Uint32Array;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Indices of the `k` largest scores, best first. */
function topK(scores: Float32Array, candidates: readonly number[], k: number): number[] {
  const best: number[] = [];
  for (const i of candidates) {
    const s = scores[i]!;
    if (best.length === k && s <= scores[best[k - 1]!]!) continue;
    let j = best.length < k ? best.length : k - 1;
    if (best.length < k) best.push(i);
    while (j > 0 && scores[best[j - 1]!]! < s) {
      best[j] = best[j - 1]!;
      j--;
    }
    best[j] = i;
  }
  return best;
}

/** Brute-force index over search_embedding, cached per workspace and generation. */
export class SqliteVectorIndex implements VectorIndex {
  private cache = new Map<string, WorkspaceVectors>();

  constructor(
    private db: Database,
    readonly model: string,
    readonly dim: number,
    private options = { maxCachedWorkspaces: 4, ...VECTOR_SEARCH },
  ) {
    if (dim % 32 !== 0) throw new Error("dim must be a multiple of 32");
  }

  private load(workspaceId: string): WorkspaceVectors {
    const generation = indexGeneration(this.db, workspaceId);
    const hit = this.cache.get(workspaceId);
    if (hit && hit.generation === generation) {
      this.cache.delete(workspaceId); // LRU: move to the end
      this.cache.set(workspaceId, hit);
      return hit;
    }
    const rows = this.db
      .query(
        `SELECT c.seq, c.recording_id, e.vector, e.scale FROM search_chunk c
         JOIN search_embedding e ON e.workspace_id = c.workspace_id AND e.content_sha256 = c.content_sha256
           AND e.model = ? AND e.dim = ?
         WHERE c.workspace_id = ? ORDER BY c.seq`,
      )
      .all(this.model, this.dim, workspaceId) as Array<{ seq: number; recording_id: string; vector: Uint8Array; scale: number }>;
    const n = rows.length;
    const words = this.dim / 32;
    const keepCodes = n <= this.options.memoryCodesMax;
    const v: WorkspaceVectors = {
      generation,
      seqs: new Int32Array(n),
      recordingIds: new Array(n),
      codes: new Int8Array(keepCodes ? n * this.dim : 0),
      scales: new Float32Array(n),
      bits: new Uint32Array(n * words),
    };
    rows.forEach((r, i) => {
      v.seqs[i] = r.seq;
      v.recordingIds[i] = r.recording_id;
      v.scales[i] = r.scale;
      const codes = new Int8Array(r.vector.buffer, r.vector.byteOffset, this.dim);
      if (keepCodes) v.codes.set(codes, i * this.dim);
      for (let d = 0; d < this.dim; d++) if (codes[d]! > 0) v.bits[i * words + (d >> 5)]! |= 1 << (d & 31);
    });
    this.cache.set(workspaceId, v);
    while (this.cache.size > this.options.maxCachedWorkspaces) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }

  private readCodes(workspaceId: string, seqs: readonly number[]): Map<number, Int8Array> {
    const rows = this.db
      .query(
        `SELECT c.seq, e.vector FROM search_chunk c
         JOIN search_embedding e ON e.workspace_id = c.workspace_id AND e.content_sha256 = c.content_sha256
           AND e.model = ? AND e.dim = ?
         WHERE c.workspace_id = ? AND c.seq IN (SELECT value FROM json_each(?))`,
      )
      .all(this.model, this.dim, workspaceId, JSON.stringify(seqs)) as Array<{ seq: number; vector: Uint8Array }>;
    return new Map(rows.map((r) => [r.seq, new Int8Array(r.vector.buffer, r.vector.byteOffset, this.dim)]));
  }

  search(access: AccessScope, query: Float32Array, k: number): VectorHit[] {
    if (query.length !== this.dim) throw new Error(`query has ${query.length} dims, expected ${this.dim}`);
    if (access.recordingIds.length === 0) return [];
    const v = this.load(access.workspaceId);
    const allowed = new Set(access.recordingIds);
    const inScope: number[] = [];
    for (let i = 0; i < v.seqs.length; i++) if (allowed.has(v.recordingIds[i]!)) inScope.push(i);

    let norm = 0;
    for (const x of query) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    const q = query.map((x) => x / norm);
    const codesInMemory = v.codes.length > 0;
    let diskCodes = new Map<number, Int8Array>();
    const exact = (i: number) => {
      let s = 0;
      if (codesInMemory) {
        const o = i * this.dim;
        for (let d = 0; d < this.dim; d++) s += q[d]! * v.codes[o + d]!;
      } else {
        const codes = diskCodes.get(v.seqs[i]!)!;
        for (let d = 0; d < this.dim; d++) s += q[d]! * codes[d]!;
      }
      return s / v.scales[i]!;
    };

    let candidates = inScope;
    if (inScope.length > this.options.fullScanMax || !codesInMemory) {
      const words = this.dim / 32;
      const qbits = new Uint32Array(words);
      for (let d = 0; d < this.dim; d++) if (q[d]! > 0) qbits[d >> 5]! |= 1 << (d & 31);
      const hamming = new Float32Array(v.seqs.length);
      for (const i of inScope) {
        let h = 0;
        for (let w = 0; w < words; w++) h += popcount(v.bits[i * words + w]! ^ qbits[w]!);
        hamming[i] = -h;
      }
      candidates = topK(hamming, inScope, this.options.rescoreCandidates);
    }
    if (!codesInMemory) diskCodes = this.readCodes(access.workspaceId, candidates.map((i) => v.seqs[i]!));
    const scores = new Float32Array(v.seqs.length);
    for (const i of candidates) scores[i] = exact(i);
    return topK(scores, candidates, k).map((i, r) => ({
      seq: v.seqs[i]!,
      recordingId: v.recordingIds[i]!,
      score: scores[i]!,
      rank: r + 1,
    }));
  }
}
