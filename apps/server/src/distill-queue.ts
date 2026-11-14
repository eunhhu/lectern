// Queues the v1 distillation of a lecture. Separate from job-handlers.ts so the `process`
// job (process-job.ts), which job-handlers.ts registers, can fall back to it without an
// import cycle. Like queue.ts, this module must not import index.ts.

import { type LectureRecord, updateLectureProgress } from "./db.ts";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
import { enqueueJob } from "./queue.ts";

export interface DistillInput {
  audioPath: string;
  course: string;
  title: string;
  model: string;
  /** A key the user sent with the upload; sealed in the job row, never stored in clear. */
  apiKey?: string;
}

export function emitProgress(ownerId: string, updated: LectureRecord | null): void {
  if (!updated) return;
  emitLectureEvent(ownerId, {
    type: "progress",
    id: updated.id,
    stage: updated.stage,
    stage_message: updated.stage_message,
    progress: updated.progress,
    lecture: toLectureSummaryDto(updated),
  });
}

/** The "waiting in line" progress a lecture gets when its job cannot start yet. */
export function announceQueued(id: string, ownerId: string, queued: { deduplicated: boolean; position: number }): void {
  if (queued.deduplicated || queued.position <= 0) return;
  emitProgress(
    ownerId,
    updateLectureProgress(id, "queued", `분석 대기열 ${queued.position}번째 — 앞선 작업이 끝나면 자동으로 시작됩니다.`, 5)
  );
}

/**
 * Queues the distillation of a lecture whose row is already 'processing'. A lecture with
 * a distillation already queued or running is not queued twice (the existing job is
 * returned). Lectures that have to wait get a "queued" progress message.
 */
export function enqueueDistillation(
  id: string,
  ownerId: string,
  input: DistillInput
): { jobId: string; deduplicated: boolean; position: number } {
  const { apiKey, ...payload } = input;
  const queued = enqueueJob({
    kind: "distill",
    ownerId,
    subjectId: id,
    payload: { ...payload },
    secret: apiKey,
  });
  announceQueued(id, ownerId, queued);
  return queued;
}
