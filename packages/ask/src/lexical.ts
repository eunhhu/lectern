// Lexical retrieval: FTS5 BM25 over the bigram index (docs/adr/0009-ask-rag.md).

import type { Database } from "bun:sqlite";
import type { AccessScope } from "./scope.ts";
import { CHUNK_COLUMNS, type ChunkRow, chunkColumns, toChunkRow } from "./store.ts";
import { compact, ftsQuery, normalizeText, type QueryTerm } from "./text.ts";

/** A term whose rarest token is in more than this share of all chunks is dropped (when others remain). */
export const COMMON_TERM_SHARE = 0.2;
/**
 * Most matches BM25 may rank in one query. Ranking costs about 6 µs per matched chunk on
 * an M3 (~25 µs on a Pi 5), so 20k keeps a query near 100 ms on the Pi.
 */
export const RANK_BUDGET = 20_000;
/**
 * Scopes of at most this many recordings (a few hundred chunks) are scored in code over
 * their own chunks instead of through the global FTS index: walking a common term's
 * posting list to find one note's chunks took 170–520 ms at 400k chunks, scanning the
 * note takes well under a millisecond.
 */
export const SMALL_SCOPE = 20;
/** Newest matches considered in that case. */
const COMMON_TERM_CANDIDATES = 2_000;

/**
 * Keeps the rarest terms whose matches fit the ranking budget. BM25 gives very common
 * terms almost no weight, yet ranking every chunk they match is what makes a query slow
 * (measured on synthetic Korean, 400k chunks: a term in 65k chunks took 385 ms on an M3).
 * A phrase can only match where its rarest token does, so that token's document count
 * (from fts5vocab) bounds the phrase's. The rarest term is always kept; `overBudget`
 * says even it alone exceeds the budget.
 */
export function pruneCommonTerms(db: Database, terms: readonly QueryTerm[]): { terms: QueryTerm[]; overBudget: boolean } {
  if (terms.length === 0) return { terms: [], overBudget: false };
  const total = (db.query(`SELECT COALESCE(MAX(seq), 0) AS n FROM search_chunk`).get() as { n: number }).n;
  if (total === 0) return { terms: [...terms], overBudget: false };
  const docs = db.query(`SELECT doc FROM search_chunk_fts_vocab WHERE term = ?`);
  const scored = terms.map((term, i) => ({
    term,
    i,
    df: Math.min(...term.tokens.map((token) => (docs.get(token) as { doc: number } | null)?.doc ?? 0)),
  }));
  const kept: typeof scored = [];
  let ranked = 0;
  for (const t of [...scored].sort((a, b) => a.df - b.df)) {
    if (kept.length > 0 && (t.df > total * COMMON_TERM_SHARE || ranked + t.df > RANK_BUDGET)) continue;
    kept.push(t);
    ranked += t.df;
  }
  kept.sort((a, b) => a.i - b.i);
  return { terms: kept.map((t) => t.term), overBudget: ranked > RANK_BUDGET };
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
  opts: { limit?: number; fallbackText?: string; smallScope?: number } = {},
): LexicalHit[] {
  const limit = opts.limit ?? 50;
  if (access.recordingIds.length === 0) return [];
  const allow = JSON.stringify(access.recordingIds);
  if (access.recordingIds.length <= (opts.smallScope ?? SMALL_SCOPE)) {
    return scanScope(db, access, terms, limit, opts.fallbackText);
  }
  const pruned = pruneCommonTerms(db, terms);
  const match = ftsQuery(pruned.terms);
  if (match && pruned.overBudget) {
    // Even the rarest term matches more chunks than BM25 may rank: take the newest
    // matches (FTS5 walks rowids backwards and stops) and leave the ordering to the
    // vector half. Measured: 70 ms → 5 ms for a term in 34k of 40k chunks on an M3.
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

/**
 * BM25 over the scope's own chunks, computed in code. Terms match as spacing-insensitive
 * substrings, the same semantics as the bigram phrases of the index, and document
 * frequencies are the scope's own. With no usable term, the raw question is matched.
 */
function scanScope(
  db: Database,
  access: AccessScope,
  terms: readonly QueryTerm[],
  limit: number,
  fallbackText?: string,
): LexicalHit[] {
  const rows = db
    .query(
      `SELECT ${CHUNK_COLUMNS} FROM search_chunk
       WHERE workspace_id = ? AND recording_id IN (SELECT value FROM json_each(?)) ORDER BY recording_id, ordinal`,
    )
    .all(access.workspaceId, JSON.stringify(access.recordingIds)) as Array<Parameters<typeof toChunkRow>[0]>;
  const needles = terms.length ? terms.map((t) => t.text) : fallbackText ? [compact(fallbackText)].filter(Boolean) : [];
  if (needles.length === 0 || rows.length === 0) return [];
  const texts = rows.map((r) => compact(`${r.heading ?? ""}${r.text}`));
  const avgLen = texts.reduce((n, t) => n + t.length, 0) / texts.length || 1;
  const counts = texts.map((t) => needles.map((needle) => occurrences(t, needle)));
  const df = needles.map((_, j) => counts.filter((c) => c[j]! > 0).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = rows
    .map((r, i) => {
      let score = 0;
      needles.forEach((_, j) => {
        const tf = counts[i]![j]!;
        if (tf === 0) return;
        const idf = Math.log(1 + (rows.length - df[j]! + 0.5) / (df[j]! + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * texts[i]!.length) / avgLen));
      });
      return { row: r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score || a.row.seq - b2.row.seq)
    .slice(0, limit);
  return scored.map((x, i) => ({ chunk: toChunkRow(x.row), score: x.score, rank: i + 1 }));
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) n++;
  return n;
}
