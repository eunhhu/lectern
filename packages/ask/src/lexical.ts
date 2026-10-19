// Lexical retrieval: FTS5 BM25 over the bigram index (docs/adr/0009-ask-rag.md).

import type { Database } from "bun:sqlite";
import type { AccessScope } from "./scope.ts";
import { CHUNK_COLUMNS, type ChunkRow, chunkColumns, toChunkRow } from "./store.ts";
import { ftsQuery, normalizeText, type QueryTerm } from "./text.ts";

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
  const match = ftsQuery(terms);
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
