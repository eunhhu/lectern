// The `index` job for v1 lectures (docs/adr/0009-ask-rag.md §2, ARCHITECTURE §12.4): runs the harness
// `index` stage over a lecture's Markdown so it can be searched and asked about.
//
// - Queued when a lecture's notes are written (distill done, user edit) while LECTERN_ASK
//   is on, one job per lecture at a time (the queue dedupes on kind:subject).
// - reconcileAskIndex() runs with maintenance: it queues lectures whose stored chunks no
//   longer match their Markdown or that miss embeddings (backfill of existing notes, and
//   any change made while the flag was off), and drops index rows of lectures that are gone.
// - Deleting a lecture deletes its index rows and note-scoped threads directly (db.ts).

import { config, readSecret } from "@lectern/config";
import {
  chunkRecording,
  deleteRecordingIndex,
  failStaleTurns,
  type Embedder,
  INDEX_STAGE,
  IndexStageOutput,
  indexStageKey,
  runIndexStage,
} from "@lectern/ask";
import { lectureRecordingId } from "@lectern/db";
import { defineStage, Harness } from "@lectern/harness";
import { db, HARNESS_BLOB_DIR, onLectureContentChanged } from "../db.ts";
import { logger } from "../log.ts";
import { enqueueJob, type JobOutcome, type LeasedJob, registerJobHandler } from "../queue.ts";
import { type IndexableLecture, isIndexable, lectureSources, personalWorkspaceId } from "./legacy.ts";
import { pdfSourcesOf } from "./pdf-sources.ts";
import { askService, type AskService } from "./service.ts";

export const INDEX_JOB_KIND = "index";

function indexStage(embedder: Embedder | undefined) {
  return defineStage({
    name: INDEX_STAGE.name,
    version: INDEX_STAGE.version,
    output: IndexStageOutput,
    // Indexing is a cheap, idempotent diff and embeddings are memoized by content, so a
    // stage result is never reused across jobs: the index rows may have changed since.
    memo: "job",
    key: (input: ReturnType<typeof lectureSources>) => indexStageKey(input, embedder),
    run: (input, ctx) =>
      runIndexStage({ db, embedder, meter: (meta, call) => ctx.meter(meta, call), signal: ctx.signal }, input),
  });
}

/**
 * What the index stage reads for a lecture: its notes and transcript, and its lecture PDF
 * pages while LECTERN_PDF is on (P3-06). With the flag off `pdfs` is left out, so the PDF
 * chunks already indexed are kept as they are.
 */
export function indexSources(lecture: IndexableLecture): ReturnType<typeof lectureSources> {
  const sources = lectureSources(lecture);
  if (config().pdf) sources.pdfs = pdfSourcesOf(lectureRecordingId(lecture.id));
  return sources;
}

let harness: Harness | null = null;

function readLecture(id: string): IndexableLecture | null {
  return db.query(`SELECT id, owner_id, status, markdown, updated_at FROM lectures WHERE id = ?`).get(id) as IndexableLecture | null;
}

/**
 * Brings one lecture's index up to date. Runs again (at most twice more) if the notes
 * changed while it ran, since an enqueue during the run was deduplicated into this job.
 */
export async function indexLecture(
  lectureId: string,
  options: { jobId: string; embedder?: Embedder; harness?: Harness },
): Promise<JobOutcome> {
  const h = options.harness ?? (harness ??= new Harness({ db, blobDir: HARNESS_BLOB_DIR, logger }));
  try {
    for (let pass = 0; pass < 3; pass++) {
      const lecture = readLecture(lectureId);
      if (!lecture) return { ok: true, result: { removed: true } };
      const workspaceId = personalWorkspaceId(lecture.owner_id);
      if (!isIndexable(lecture)) {
        deleteRecordingIndex(db, workspaceId, lectureId);
        return { ok: true, result: { skipped: lecture.status } };
      }
      const run = h.job({ jobId: options.jobId, scope: workspaceId, workspaceId });
      const { value } = await run.run(indexStage(options.embedder), indexSources(lecture), { chunkIndex: pass });
      if (readLecture(lectureId)?.markdown === lecture.markdown) return { ok: true, result: value };
    }
    return { ok: true, result: { gaveUp: "notes kept changing" } };
  } finally {
    h.deleteArtifactsForJob(options.jobId);
  }
}

/**
 * The embedder to index with, or none (BM25 only) while no Gemini key is configured, so a
 * missing key leaves a quiet lexical index instead of a failing job per lecture.
 */
function usableEmbedder(service: AskService): Embedder | undefined {
  return service.embedder && readSecret("GEMINI_API_KEY") ? service.embedder : undefined;
}

async function runIndexJob(job: LeasedJob): Promise<JobOutcome> {
  const service = askService();
  if (!service) return { ok: true, result: { skipped: "LECTERN_ASK is off" } };
  try {
    return await indexLecture(job.subjectId!, { jobId: job.id, embedder: usableEmbedder(service) });
  } catch (err: any) {
    logger.error("index job failed", { job_id: job.id, lecture_id: job.subjectId, err });
    return { ok: false, error: err?.message ?? String(err) };
  }
}

registerJobHandler(INDEX_JOB_KIND, runIndexJob, { concurrency: 1 });

/** Queues (or keeps the queued) index job of a lecture; a no-op while LECTERN_ASK is off. */
export function scheduleLectureIndex(lectureId: string, ownerId: string): void {
  if (!config().ask.enabled) return;
  enqueueJob({ kind: INDEX_JOB_KIND, ownerId, subjectId: lectureId, priority: -1 });
}

onLectureContentChanged((lectureId, ownerId) => scheduleLectureIndex(lectureId, ownerId));

/**
 * Index upkeep, run with maintenance while LECTERN_ASK is on. Cheap: chunking is local and
 * deterministic, so comparing chunk ids finds every lecture whose index is stale.
 */
export function reconcileAskIndex(service: AskService | null = askService()): { queued: number; removed: number } {
  if (!service) return { queued: 0, removed: 0 };
  const embedder = usableEmbedder(service);
  const pdfOn = config().pdf;
  let queued = 0;
  const lectures = db
    .query(`SELECT id, owner_id, status, markdown, updated_at FROM lectures WHERE status = 'done'`)
    .all() as IndexableLecture[];
  for (const lecture of lectures) {
    if (!isIndexable(lecture)) continue;
    const workspaceId = personalWorkspaceId(lecture.owner_id);
    // The same input the index job reads, or PDF chunks would look stale and requeue forever.
    const expected = chunkRecording(indexSources(lecture)).map((c) => c.id).sort();
    // With LECTERN_PDF off the index keeps PDF chunks it has but reads no PDF: leave them out of the comparison.
    const stored = (
      db
        .query(`SELECT id FROM search_chunk WHERE workspace_id = ? AND recording_id = ? ${pdfOn ? "" : "AND kind != 'pdf_page'"} ORDER BY id`)
        .all(workspaceId, lecture.id) as Array<{ id: string }>
    ).map((r) => r.id);
    const stale = expected.join() !== stored.join();
    const missingEmbedding =
      !stale &&
      embedder !== undefined &&
      db
        .query(
          `SELECT 1 FROM search_chunk c WHERE c.workspace_id = ?1 AND c.recording_id = ?2 AND NOT EXISTS (
             SELECT 1 FROM search_embedding e WHERE e.workspace_id = ?1 AND e.content_sha256 = c.content_sha256
               AND e.model = ?3 AND e.dim = ?4) LIMIT 1`,
        )
        .get(workspaceId, lecture.id, embedder.model, embedder.dim) !== null;
    if (stale || missingEmbedding) {
      if (!enqueueJob({ kind: INDEX_JOB_KIND, ownerId: lecture.owner_id, subjectId: lecture.id, priority: -1 }).deduplicated) queued++;
    }
  }
  // Index rows whose lecture is gone (deleted before this code shipped, or by hand).
  const orphans = db
    .query(`SELECT DISTINCT workspace_id, recording_id FROM search_chunk WHERE recording_id NOT IN (SELECT id FROM lectures)`)
    .all() as Array<{ workspace_id: string; recording_id: string }>;
  for (const o of orphans) deleteRecordingIndex(db, o.workspace_id, o.recording_id);
  return { queued, removed: orphans.length };
}

/** A turn cannot legitimately run this long (three model rounds of at most 120 s each). */
const STALE_TURN_MS = 15 * 60_000;

/** Ask upkeep for the maintenance schedule: index reconciliation and stuck turns. */
export function runAskUpkeep(service: AskService | null = askService()): { queued: number; removed: number; staleTurns: number } {
  if (!service) return { queued: 0, removed: 0, staleTurns: 0 };
  const index = reconcileAskIndex(service);
  return { ...index, staleTurns: failStaleTurns(db, STALE_TURN_MS) };
}
