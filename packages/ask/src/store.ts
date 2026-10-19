// Reads and writes of the search index tables (packages/db migrations 0001, 0002).
//
// search_chunk rows and their FTS5 rows are written together in one transaction; the
// FTS table is contentless, so the bigram body lives only in the index. Embeddings are
// keyed by (workspace, model, dim, content hash): a chunk whose text did not change
// keeps its embedding, and nothing is embedded twice. Every change bumps the
// workspace's generation so in-memory vector caches know to reload.

import type { Database } from "bun:sqlite";
import type { SourceRef } from "@lectern/domain";
import { CHUNKER_VERSION, type ChunkDraft, type ChunkKind, embeddingText, type SegmentSpan } from "./chunk.ts";
import { ftsBody } from "./text.ts";

export interface ChunkRow extends ChunkDraft {
  seq: number;
}

interface ChunkRecord {
  seq: number;
  id: string;
  workspace_id: string;
  recording_id: string;
  kind: ChunkKind;
  locator: string;
  ordinal: number;
  heading: string | null;
  text: string;
  content_sha256: string;
  tokens: number;
  start_idx: number | null;
  end_idx: number | null;
  start_ms: number | null;
  end_ms: number | null;
  spans_json: string | null;
  document_id: string | null;
  document_version: number | null;
  block_id: string | null;
  sources_json: string | null;
  asset_id: string | null;
  page: number | null;
}

const CHUNK_COLUMN_NAMES = [
  "seq", "id", "workspace_id", "recording_id", "kind", "locator", "ordinal", "heading", "text", "content_sha256",
  "tokens", "start_idx", "end_idx", "start_ms", "end_ms", "spans_json", "document_id", "document_version", "block_id",
  "sources_json", "asset_id", "page",
];

/** The search_chunk columns toChunkRow reads, optionally qualified with a table alias. */
export function chunkColumns(alias?: string): string {
  return CHUNK_COLUMN_NAMES.map((c) => (alias ? `${alias}.${c}` : c)).join(", ");
}

export const CHUNK_COLUMNS = chunkColumns();

export function toChunkRow(r: ChunkRecord): ChunkRow {
  return {
    seq: r.seq,
    id: r.id,
    workspaceId: r.workspace_id,
    recordingId: r.recording_id,
    kind: r.kind,
    locator: r.locator,
    ordinal: r.ordinal,
    heading: r.heading,
    text: r.text,
    contentSha256: r.content_sha256,
    tokens: r.tokens,
    startIdx: r.start_idx,
    endIdx: r.end_idx,
    startMs: r.start_ms,
    endMs: r.end_ms,
    spans: r.spans_json ? (JSON.parse(r.spans_json) as SegmentSpan[]) : null,
    documentId: r.document_id,
    documentVersion: r.document_version,
    blockId: r.block_id,
    sources: r.sources_json ? (JSON.parse(r.sources_json) as SourceRef[]) : null,
    assetId: r.asset_id,
    page: r.page,
  };
}

/** Chunks by seq, restricted to one workspace (never trust seqs from elsewhere). */
export function chunksBySeq(db: Database, workspaceId: string, seqs: readonly number[]): Map<number, ChunkRow> {
  if (seqs.length === 0) return new Map();
  const rows = db
    .query(`SELECT ${CHUNK_COLUMNS} FROM search_chunk WHERE workspace_id = ? AND seq IN (SELECT value FROM json_each(?))`)
    .all(workspaceId, JSON.stringify(seqs)) as ChunkRecord[];
  return new Map(rows.map((r) => [r.seq, toChunkRow(r)]));
}

/** Every chunk of one recording in reading order. */
export function recordingChunks(db: Database, workspaceId: string, recordingId: string): ChunkRow[] {
  const rows = db
    .query(`SELECT ${CHUNK_COLUMNS} FROM search_chunk WHERE workspace_id = ? AND recording_id = ? ORDER BY ordinal`)
    .all(workspaceId, recordingId) as ChunkRecord[];
  return rows.map(toChunkRow);
}

export function bumpGeneration(db: Database, workspaceId: string, now = Date.now()): void {
  db.query(
    `INSERT INTO search_index_state (workspace_id, generation, updated_at) VALUES (?, 1, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET generation = generation + 1, updated_at = excluded.updated_at`,
  ).run(workspaceId, now);
}

export function indexGeneration(db: Database, workspaceId: string): number {
  const row = db.query(`SELECT generation FROM search_index_state WHERE workspace_id = ?`).get(workspaceId) as
    | { generation: number }
    | null;
  return row?.generation ?? 0;
}

export interface SyncResult {
  inserted: number;
  deleted: number;
  kept: number;
}

/**
 * Makes the stored chunks of `kinds` for one recording equal to `chunks`: rows whose id
 * is gone are deleted (with their FTS rows and now-unused embeddings), new ids are
 * inserted, unchanged ids are kept with their embeddings. Idempotent.
 */
export function syncRecordingChunks(
  db: Database,
  args: { workspaceId: string; recordingId: string; kinds: readonly ChunkKind[]; chunks: readonly ChunkDraft[]; now?: number },
): SyncResult {
  const now = args.now ?? Date.now();
  for (const c of args.chunks) {
    if (c.workspaceId !== args.workspaceId || c.recordingId !== args.recordingId || !args.kinds.includes(c.kind)) {
      throw new Error(`chunk ${c.id} does not belong to ${args.workspaceId}/${args.recordingId} (${args.kinds.join(",")})`);
    }
  }
  return db.transaction((): SyncResult => {
    const existing = db
      .query(
        `SELECT seq, id, content_sha256 FROM search_chunk
         WHERE workspace_id = ? AND recording_id = ? AND kind IN (SELECT value FROM json_each(?))`,
      )
      .all(args.workspaceId, args.recordingId, JSON.stringify(args.kinds)) as Array<{ seq: number; id: string; content_sha256: string }>;
    const wanted = new Map(args.chunks.map((c) => [c.id, c]));
    const have = new Set(existing.map((r) => r.id));
    const stale = existing.filter((r) => !wanted.has(r.id));
    for (const row of stale) {
      db.query(`DELETE FROM search_chunk_fts WHERE rowid = ?`).run(row.seq);
      db.query(`DELETE FROM search_chunk WHERE seq = ?`).run(row.seq);
    }
    pruneEmbeddings(db, args.workspaceId, stale.map((r) => r.content_sha256));

    const insert = db.query(
      `INSERT INTO search_chunk (id, workspace_id, recording_id, kind, locator, ordinal, heading, text, content_sha256,
         tokens, chunker_version, start_idx, end_idx, start_ms, end_ms, spans_json, document_id, document_version,
         block_id, sources_json, asset_id, page, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
    );
    const insertFts = db.query(`INSERT INTO search_chunk_fts (rowid, body) VALUES (?, ?)`);
    const reorder = db.query(`UPDATE search_chunk SET ordinal = ? WHERE id = ? AND ordinal != ?`);
    let inserted = 0;
    for (const c of args.chunks) {
      if (have.has(c.id)) {
        reorder.run(c.ordinal, c.id, c.ordinal);
        continue;
      }
      const { seq } = insert.get(
        c.id,
        c.workspaceId,
        c.recordingId,
        c.kind,
        c.locator,
        c.ordinal,
        c.heading,
        c.text,
        c.contentSha256,
        c.tokens,
        CHUNKER_VERSION,
        c.startIdx,
        c.endIdx,
        c.startMs,
        c.endMs,
        c.spans ? JSON.stringify(c.spans) : null,
        c.documentId,
        c.documentVersion,
        c.blockId,
        c.sources ? JSON.stringify(c.sources) : null,
        c.assetId,
        c.page,
        now,
      ) as { seq: number };
      insertFts.run(seq, ftsBody(embeddingText(c)));
      inserted++;
    }
    if (inserted || stale.length) bumpGeneration(db, args.workspaceId, now);
    return { inserted, deleted: stale.length, kept: args.chunks.length - inserted };
  })();
}

/** Removes a recording from the index: chunks, FTS rows and embeddings no other chunk uses. */
export function deleteRecordingIndex(db: Database, workspaceId: string, recordingId: string, now = Date.now()): number {
  return syncRecordingChunks(db, {
    workspaceId,
    recordingId,
    kinds: ["transcript", "document", "pdf_page"],
    chunks: [],
    now,
  }).deleted;
}

function pruneEmbeddings(db: Database, workspaceId: string, contentShas: readonly string[]): void {
  if (contentShas.length === 0) return;
  db.query(
    `DELETE FROM search_embedding
     WHERE workspace_id = ?1 AND content_sha256 IN (SELECT value FROM json_each(?2))
       AND NOT EXISTS (SELECT 1 FROM search_chunk c WHERE c.workspace_id = ?1 AND c.content_sha256 = search_embedding.content_sha256)`,
  ).run(workspaceId, JSON.stringify([...new Set(contentShas)]));
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** Distinct chunk texts of a workspace that have no embedding for `model`/`dim` yet. */
export function chunksMissingEmbedding(
  db: Database,
  args: { workspaceId: string; model: string; dim: number; recordingId?: string; limit?: number },
): Array<{ contentSha256: string; text: string; tokens: number }> {
  const rows = db
    .query(
      `SELECT c.content_sha256, MIN(c.heading) AS heading, MIN(c.text) AS text, MIN(c.tokens) AS tokens
       FROM search_chunk c
       WHERE c.workspace_id = ?1 AND (?2 IS NULL OR c.recording_id = ?2)
         AND NOT EXISTS (SELECT 1 FROM search_embedding e WHERE e.workspace_id = ?1 AND e.model = ?3 AND e.dim = ?4
                         AND e.content_sha256 = c.content_sha256)
       GROUP BY c.content_sha256 ORDER BY MIN(c.seq) LIMIT ?5`,
    )
    .all(args.workspaceId, args.recordingId ?? null, args.model, args.dim, args.limit ?? 10_000) as Array<{
    content_sha256: string;
    heading: string | null;
    text: string;
    tokens: number;
  }>;
  return rows.map((r) => ({ contentSha256: r.content_sha256, text: embeddingText(r), tokens: r.tokens }));
}

export interface QuantizedVector {
  codes: Int8Array;
  /** codes[i] / scale ≈ normalized value. */
  scale: number;
}

/** L2-normalizes, then maps to int8 with a per-vector scale (max |x| → 127). */
export function quantizeInt8(vector: Float32Array): QuantizedVector {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  let max = 0;
  for (const x of vector) max = Math.max(max, Math.abs(x / norm));
  const scale = max > 0 ? 127 / max : 1;
  const codes = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) codes[i] = Math.round((vector[i]! / norm) * scale);
  return { codes, scale };
}

export function putEmbeddings(
  db: Database,
  args: {
    workspaceId: string;
    model: string;
    dim: number;
    items: ReadonlyArray<{ contentSha256: string; vector: Float32Array }>;
    now?: number;
  },
): number {
  const now = args.now ?? Date.now();
  const insert = db.query(
    `INSERT OR IGNORE INTO search_embedding (workspace_id, content_sha256, model, dim, vector, scale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  return db.transaction(() => {
    let n = 0;
    for (const item of args.items) {
      if (item.vector.length !== args.dim) throw new Error(`embedding has ${item.vector.length} dims, expected ${args.dim}`);
      const { codes, scale } = quantizeInt8(item.vector);
      n += insert.run(args.workspaceId, item.contentSha256, args.model, args.dim, new Uint8Array(codes.buffer), scale, now).changes;
    }
    if (n) bumpGeneration(db, args.workspaceId, now);
    return n;
  })();
}

/** Chunks by id within one workspace, in the order given; missing ids are skipped. */
export function chunksById(db: Database, workspaceId: string, ids: readonly string[]): ChunkRow[] {
  if (ids.length === 0) return [];
  const rows = db
    .query(`SELECT ${CHUNK_COLUMNS} FROM search_chunk WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))`)
    .all(workspaceId, JSON.stringify(ids)) as ChunkRecord[];
  const byId = new Map(rows.map((r) => [r.id, toChunkRow(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** The chunk next to `chunk` in reading order within its recording and kind, if any. */
export function neighborChunk(db: Database, chunk: ChunkRow, direction: "before" | "after"): ChunkRow | null {
  const r = db
    .query(
      `SELECT ${CHUNK_COLUMNS} FROM search_chunk WHERE workspace_id = ? AND recording_id = ? AND kind = ?
         AND ordinal ${direction === "before" ? "<" : ">"} ? ORDER BY ordinal ${direction === "before" ? "DESC" : "ASC"} LIMIT 1`,
    )
    .get(chunk.workspaceId, chunk.recordingId, chunk.kind, chunk.ordinal) as ChunkRecord | null;
  return r ? toChunkRow(r) : null;
}
