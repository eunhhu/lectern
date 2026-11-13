// `regenerate` (CONTRACTS §1.1 D-P1-4): the notes stages again on the published transcript
// (classify → structure → extract → verify → publish), a new document version, no
// transcription. Started by reprocessRecording `mode: "document"`. While it runs the
// recording keeps showing its current notes; a failure leaves them as they are. Like
// queue.ts, this module must not import index.ts; job-handlers.ts registers the handler.

import { lectureRecordingId } from "@lectern/db";
import { HarnessError, type StageEvent, type Transcript } from "@lectern/harness";
import { db, getLectureById } from "./db.ts";
import { logger } from "./log.ts";
import {
  canceledByUser,
  cancelWatcher,
  defaultProcessHarness,
  JOB_CANCELED_MESSAGE,
  runNotesPhase,
  stageEmitter,
  type ProcessJobDeps,
} from "./process-job.ts";
import { enqueueJob, type JobOutcome, type LeasedJob } from "./queue.ts";

export const REGENERATE_JOB_KIND = "regenerate";

export const REGENERATE_NO_TRANSCRIPT_MESSAGE = "다시 만들 전사가 없습니다.";

export function enqueueRegenerate(
  lectureId: string,
  ownerId: string,
  budgetMicrousd: number
): { jobId: string; deduplicated: boolean; position: number } {
  return enqueueJob({ kind: REGENERATE_JOB_KIND, ownerId, subjectId: lectureId, budgetMicrousd });
}

const SPEAKER_LABEL = /^S\d+$/;

/** The published transcript (transcript-publish.ts rows) as the harness Transcript, or null. */
export function transcriptFromRows(recordingId: string): Transcript | null {
  const rows = db
    .query(
      `SELECT s.idx, s.start_ms, s.end_ms, s.text, s.source_chunk, sp.label
       FROM transcript_segment s LEFT JOIN speaker sp ON sp.id = s.speaker_id
       WHERE s.recording_id = ? ORDER BY s.idx`
    )
    .all(recordingId) as Array<{ idx: number; start_ms: number; end_ms: number; text: string; source_chunk: number | null; label: string | null }>;
  if (rows.length === 0) return null;
  const segments = rows.map((r) => ({
    idx: r.idx,
    start_ms: r.start_ms,
    end_ms: r.end_ms,
    speaker: r.label && SPEAKER_LABEL.test(r.label) ? r.label : "S1",
    text: r.text,
    source_chunk: r.source_chunk ?? 0,
  }));
  const bySpeaker = new Map<string, { segments: number; chars: number }>();
  for (const s of segments) {
    const entry = bySpeaker.get(s.speaker) ?? { segments: 0, chars: 0 };
    entry.segments += 1;
    entry.chars += s.text.length;
    bySpeaker.set(s.speaker, entry);
  }
  const gaps = db
    .query(`SELECT kind, start_ms, end_ms FROM transcript_gap WHERE recording_id = ? ORDER BY start_ms`)
    .all(recordingId) as Transcript["gaps"];
  const recording = db.query(`SELECT duration_ms FROM recording WHERE id = ?`).get(recordingId) as { duration_ms: number | null } | null;
  return {
    version: 1,
    duration_ms: recording?.duration_ms ?? segments[segments.length - 1]!.end_ms,
    segments,
    speakers: [...bySpeaker].map(([label, stats]) => ({
      label,
      confidence: 1,
      basis: "single_chunk" as const,
      segments: stats.segments,
      chars: stats.chars,
      members: [{ chunk: 0, label }],
    })),
    gaps,
    failed_chunks: [],
  };
}

/**
 * Runs the notes stages for `job.subjectId` (a lecture) on its published transcript. Every
 * end leaves the recording in a finished state: the new version, or the previous one.
 */
export async function runRegenerateJob(job: LeasedJob, deps: ProcessJobDeps = {}): Promise<JobOutcome> {
  const lectureId = job.subjectId!;
  const recordingId = lectureRecordingId(lectureId);
  const lecture = getLectureById(lectureId);
  const transcript = lecture ? transcriptFromRows(recordingId) : null;
  const recording = db.query(`SELECT workspace_id FROM recording WHERE id = ?`).get(recordingId) as { workspace_id: string } | null;
  if (!lecture || !transcript || !recording) return { ok: false, error: REGENERATE_NO_TRANSCRIPT_MESSAGE };

  const harness = deps.harness ?? defaultProcessHarness();
  const fields = { job_id: job.id, lecture_id: lectureId };
  const controller = new AbortController();
  const cancel = cancelWatcher(job.id, controller);
  const emitStage = stageEmitter(lectureId, job.ownerId, { persist: false });
  const run = harness.job({
    jobId: job.id,
    scope: recording.workspace_id,
    workspaceId: recording.workspace_id,
    signal: controller.signal,
    onEvent: (ev: StageEvent) => {
      if (ev.type === "started" || ev.type === "retry") {
        cancel.check();
        if (!getLectureById(lectureId)) controller.abort(new HarnessError("canceled", REGENERATE_NO_TRANSCRIPT_MESSAGE));
      }
      if (ev.type === "started" && !controller.signal.aborted) emitStage(ev.stage);
      if (ev.type === "failed") {
        logger.warn("regenerate stage failed", { ...fields, stage: ev.stage, error_kind: ev.error.kind, error_code: ev.error.code });
      }
    },
  });

  try {
    const status = await runNotesPhase({
      job,
      run,
      lectureId,
      recordingId,
      workspaceId: recording.workspace_id,
      transcript,
      deps,
      keepTitle: true,
      emitStage,
      failure: "throw",
    });
    const version = (
      db.query(`SELECT current_version FROM document WHERE recording_id = ? AND template_id != 'legacy-markdown' ORDER BY created_at DESC LIMIT 1`).get(
        recordingId
      ) as { current_version: number } | null
    )?.current_version;
    harness.deleteArtifactsForJob(job.id);
    logger.info("notes regenerated", { ...fields, status, version });
    return { ok: true, result: { status, version } };
  } catch (err: any) {
    if (canceledByUser(controller.signal)) {
      harness.deleteArtifactsForJob(job.id);
      return { ok: false, canceled: true, error: JOB_CANCELED_MESSAGE };
    }
    // The previous version stays current; finished stages stay for an admin retry (same job id).
    const message = err?.message || String(err);
    logger.warn("regenerate failed; the previous notes stay", {
      ...fields,
      error_kind: err instanceof HarnessError ? err.kind : undefined,
      error_code: err instanceof HarnessError ? err.code : undefined,
      error: message,
    });
    return { ok: false, error: /\p{Script=Hangul}/u.test(message) ? message : "노트를 다시 만들지 못했습니다. 이전 노트는 그대로입니다." };
  } finally {
    cancel.stop();
  }
}
