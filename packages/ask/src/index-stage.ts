// The `index` stage (AI_HARNESS §3.12, docs/adr/0009-ask-rag.md "색인 단계"): runs after
// `publish`, and again after a user edits a document or a legacy note is backfilled.
//
// It does not import packages/harness. The harness wraps it with
//   defineStage({ name: INDEX_STAGE.name, version: INDEX_STAGE.version, output: IndexStageOutput,
//                 key: (input) => indexStageKey(input, embedder), memo: "shared",
//                 run: (input, ctx) => runIndexStage({ db, embedder, meter: ctx.meter }, input) })
// and `ctx.meter` has the shape of IndexDeps.meter, so every embedding call lands in ai_call.
//
// Idempotent by construction: chunk ids are content-derived and the sync is a diff, and
// embeddings are keyed by content hash, so a rerun or a memo miss never pays twice.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import { CHUNK_RULES, CHUNKER_VERSION, type ChunkKind, chunkRecording, type RecordingSources, sha256Hex } from "./chunk.ts";
import { chunksMissingEmbedding, putEmbeddings, syncRecordingChunks } from "./store.ts";
import type { Embedder } from "./vector.ts";

export const INDEX_STAGE = { name: "index", version: 1 } as const;

/** Texts per embedding request (Gemini batchEmbedContents takes up to 100). */
export const EMBED_BATCH = 100;

export const IndexStageOutput = z.object({
  chunks: z.int().nonnegative(),
  inserted: z.int().nonnegative(),
  deleted: z.int().nonnegative(),
  kept: z.int().nonnegative(),
  embedded: z.int().nonnegative(),
  embedding_tokens: z.int().nonnegative(),
  /** Embedding skipped (no embedder configured, or it failed): search falls back to BM25. */
  embedding_skipped: z.boolean(),
});
export type IndexStageOutput = z.infer<typeof IndexStageOutput>;

/** Same shape as the harness StageContext.meter. */
export type Meter = <T extends { usage: { inputTokens: number; cachedTokens: number; outputTokens: number } }>(
  meta: { provider: string; model: string },
  call: () => Promise<T>,
) => Promise<T>;

export interface IndexDeps {
  db: Database;
  embedder?: Embedder;
  meter?: Meter;
  signal?: AbortSignal;
}

/** Which chunk kinds this input replaces: only those it carries, so a transcript-only run keeps the document. */
export function indexedKinds(input: RecordingSources): ChunkKind[] {
  const kinds: ChunkKind[] = [];
  if (input.document) kinds.push("document");
  if (input.transcript) kinds.push("transcript");
  if (input.pdfs) kinds.push("pdf_page");
  return kinds;
}

/** Memo key parts (AI_HARNESS §4.4): input content hashes, chunker version and rules, embedding model. */
export function indexStageKey(input: RecordingSources, embedder?: Pick<Embedder, "provider" | "model" | "dim">) {
  const inputs: string[] = [`recording:${sha256Hex(input.recordingId)}`];
  if (input.transcript) {
    const speakers = [...(input.transcript.speakers ?? new Map()).entries()].sort();
    inputs.push(`transcript:${sha256Hex(JSON.stringify([input.transcript.segments.map((s) => [s.idx, s.start_ms, s.end_ms, s.speaker_id ?? null, s.text]), speakers]))}`);
  }
  if (input.document?.kind === "blocks") inputs.push(`document:${sha256Hex(JSON.stringify([input.document.documentId, input.document.version, input.document.body]))}`);
  if (input.document?.kind === "markdown") inputs.push(`document:${sha256Hex(JSON.stringify([input.document.documentId, input.document.version, input.document.markdown]))}`);
  for (const pdf of input.pdfs ?? []) inputs.push(`pdf:${sha256Hex(JSON.stringify([pdf.assetId, pdf.pages]))}`);
  return {
    inputs,
    provider: embedder?.provider ?? "",
    model: embedder?.model ?? "",
    config: { chunker: CHUNKER_VERSION, rules: CHUNK_RULES, dim: embedder?.dim ?? null },
  };
}

export async function runIndexStage(deps: IndexDeps, input: RecordingSources): Promise<IndexStageOutput> {
  const kinds = indexedKinds(input);
  const chunks = chunkRecording(input);
  const sync = syncRecordingChunks(deps.db, { workspaceId: input.workspaceId, recordingId: input.recordingId, kinds, chunks });
  let embedded = 0;
  let embeddingTokens = 0;
  if (!deps.embedder) {
    return { chunks: chunks.length, ...sync, embedded, embedding_tokens: 0, embedding_skipped: true };
  }
  const embedder = deps.embedder;
  const meter: Meter = deps.meter ?? ((_meta, call) => call());
  const missing = chunksMissingEmbedding(deps.db, {
    workspaceId: input.workspaceId,
    recordingId: input.recordingId,
    model: embedder.model,
    dim: embedder.dim,
  });
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    const res = await meter({ provider: embedder.provider, model: embedder.model }, async () => {
      const out = await embedder.embed(
        batch.map((m) => m.text),
        "document",
        deps.signal,
      );
      return { ...out, usage: { inputTokens: out.inputTokens, cachedTokens: 0, outputTokens: 0 } };
    });
    embeddingTokens += res.inputTokens;
    embedded += putEmbeddings(deps.db, {
      workspaceId: input.workspaceId,
      model: embedder.model,
      dim: embedder.dim,
      items: batch.map((m, j) => ({ contentSha256: m.contentSha256, vector: res.vectors[j]! })),
    });
  }
  return { chunks: chunks.length, ...sync, embedded, embedding_tokens: embeddingTokens, embedding_skipped: false };
}
