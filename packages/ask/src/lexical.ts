// Lexical retrieval: FTS5 BM25 over the bigram index (docs/adr/0009-ask-rag.md).

import type { Database } from "bun:sqlite";
import type { AccessScope } from "./scope.ts";
import { CHUNK_COLUMNS, type ChunkRow, chunkColumns, toChunkRow } from "./store.ts";
import { ftsQuery, normalizeText, type QueryTerm } from "./text.ts";

/** A term whose rarest token is in more than this share of all chunks is dropped (when others remain). */
export const COMMON_TERM_SHARE = 0.2;
/** Scopes with more recordings than this skip BM25 ranking when every term is common. */
const BROAD_SCOPE = 50;
/** Newest matches considered in that case. */
const COMMON_TERM_CANDIDATES = 2_000;

/**
 * Drops terms that match most of the index. BM25 gives them almost no weight, yet
 * ranking every chunk they match is what makes a query slow (measured: 40k matches of
 * 40k chunks take 70 ms on an M3 against 3 ms for a selective term). A phrase can only
 * match where its rarest token does, so that token's document count bounds the phrase's.
 * The rarest term is always kept.
 */
export function pruneCommonTerms(db: Database, terms: readonly QueryTerm[]): { terms: QueryTerm[]; allCommon: boolean } {
  if (terms.length === 0) return { terms: [], allCommon: false };
  const total = (db.query(`SELECT COALESCE(MAX(seq), 0) AS n FROM search_chunk`).get() as { n: number }).n;
  if (total === 0) return { terms: [...terms], allCommon: false };
  const docs = db.query(`SELECT doc FROM search_chunk_fts_vocab WHERE term = ?`);
  const df = terms.map((t) =>
    Math.min(...t.tokens.map((token) => (docs.get(token) as { doc: number } | null)?.doc ?? 0)),
  );
  const kept = terms.filter((_, i) => df[i]! <= total * COMMON_TERM_SHARE);
  if (kept.length > 0) return { terms: kept, allCommon: false };
  const rarest = df.indexOf(Math.min(...df));
  return { terms: [terms[rarest]!], allCommon: true };
}

export interface LexicalHit {
  chunk: ChunkRow;
  /** Positive BM25 (higher is better). */
  score: number;
  rank: number;
}

/**
 * Best chunks for `terms` inside `access`. Filters on the workspace and the recording
 * allowlist in the same statement as the MATCH. When no term is long enough for the
 * index (all one character, e.g. `법`), falls back to a bounded LIKE scan.
 */
export function lexicalSearch(
  db: Database,
  access: AccessScope,
  terms: readonly QueryTerm[],
  opts: { limit?: number; fallbackText?: string } = {},
): LexicalHit[] {
  const limit = opts.limit ?? 50;
  if (access.recordingIds.length === 0) return [];
  const allow = JSON.stringify(access.recordingIds);
  const pruned = pruneCommonTerms(db, terms);
  const match = ftsQuery(pruned.terms);
  if (match && pruned.allCommon && access.recordingIds.length > BROAD_SCOPE) {
    // Even the rarest term is in most chunks: BM25 order carries almost no signal and
    // ranking every match is the slow part. Take the newest matches (FTS5 walks rowids
    // backwards and stops) and leave the ordering to the vector half. Measured: 70 ms →
    // 5 ms for a term in 34k of 40k chunks on an M3.
    const rows = db
      .query(
        `SELECT ${chunkColumns("c")}
         FROM (SELECT rowid AS r FROM search_chunk_fts WHERE search_chunk_fts MATCH ?1 ORDER BY rowid DESC LIMIT ?5) f
         JOIN search_chunk c ON c.seq = f.r
         WHERE c.workspace_id = ?2 AND c.recording_id IN (SELECT value FROM json_each(?3))
         LIMIT ?4`,
      )
      .all(match, access.workspaceId, allow, limit, COMMON_TERM_CANDIDATES) as Array<Parameters<typeof toChunkRow>[0]>;
    return rows.map((r, i) => ({ chunk: toChunkRow(r), score: 0, rank: i + 1 }));
  }
  if (match) {
    const rows = db
      .query(
        `SELECT ${chunkColumns("c")}, bm25(search_chunk_fts) AS bm25
         FROM search_chunk_fts JOIN search_chunk c ON c.seq = search_chunk_fts.rowid
         WHERE search_chunk_fts MATCH ?1 AND c.workspace_id = ?2
           AND c.recording_id IN (SELECT value FROM json_each(?3))
         ORDER BY bm25 LIMIT ?4`,
      )
      .all(match, access.workspaceId, allow, limit) as Array<Parameters<typeof toChunkRow>[0] & { bm25: number }>;
    return rows.map((r, i) => ({ chunk: toChunkRow(r), score: -r.bm25, rank: i + 1 }));
  }
  const needle = opts.fallbackText ? normalizeText(opts.fallbackText).trim() : "";
  if (!needle) return [];
  const rows = db
    .query(
      `SELECT ${CHUNK_COLUMNS} FROM search_chunk
       WHERE workspace_id = ?1 AND recording_id IN (SELECT value FROM json_each(?2))
         AND lower(text) LIKE ?3 ESCAPE '\\'
       ORDER BY recording_id, ordinal LIMIT ?4`,
    )
    .all(access.workspaceId, allow, `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit) as Array<
    Parameters<typeof toChunkRow>[0]
  >;
  return rows.map((r, i) => ({ chunk: toChunkRow(r), score: 0, rank: i + 1 }));
}
