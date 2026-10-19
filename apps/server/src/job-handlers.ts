// Job handlers for the durable queue, shared by the API's embedded worker and apps/worker.
// Like queue.ts, this module must not import index.ts.

import { config } from "@lectern/config";
import { distillLectureAudio } from "../../../packages/core/src/index.ts";
import {
  completeLectureRecord,
  failLectureRecord,
  getLectureById,
  getSystemSettings,
  type LectureRecord,
  updateLectureProgress,
} from "./db.ts";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
import { enqueueJob, isLectureBusy, registerJobHandler, type LeasedJob } from "./queue.ts";
import { compactLectureAudio, isFfmpegAvailable } from "./storage.ts";

export const LECTURE_GONE_MESSAGE = "강의가 삭제되어 작업을 중단했습니다.";

export interface DistillInput {
  audioPath: string;
  course: string;
  title: string;
  model: string;
  /** A key the user sent with the upload; sealed in the job row, never stored in clear. */
  apiKey?: string;
}

function emitProgress(ownerId: string, updated: LectureRecord | null): void {
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

/**
 * Only transient failures are worth another attempt: network errors, timeouts, 429 and
 * 5xx from Gemini. Configuration problems, silent recordings, unreadable audio and other
 * 4xx answers fail the same way every time, so retrying them only burns a job slot.
 */
export function isRetryableDistillError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  if (
    msg.includes("GEMINI_API_KEY is not configured") ||
    msg.includes("음성 신호가 감지되지 않았습니다") ||
    msg.includes("Audio file not found") ||
    msg.includes("ffmpeg transcoding failed") ||
    // Gemini rejected this file itself; uploading it again ends the same way.
    msg.includes("did not reach ACTIVE state (state=FAILED)")
  ) {
    return false;
  }
  const status = msg.match(/\((\d{3})\)/);
  if (status) {
    const code = Number(status[1]);
    return code === 408 || code === 429 || code >= 500;
  }
  return true;
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
  if (!queued.deduplicated && queued.position > 0) {
    emitProgress(
      ownerId,
      updateLectureProgress(
        id,
        "queued",
        `분석 대기열 ${queued.position}번째 — 앞선 작업이 끝나면 자동으로 시작됩니다.`,
        5
      )
    );
  }
  return queued;
}

async function runDistillation(job: LeasedJob) {
  const id = job.subjectId!;
  const ownerId = job.ownerId;
  const input = job.payload as Omit<DistillInput, "apiKey">;
  let apiKey: string | undefined;
  try {
    apiKey = job.secret();
  } catch (err: any) {
    const failed = failLectureRecord(id, err.message);
    emitLectureEvent(ownerId, {
      type: "error",
      id,
      error_message: err.message,
      lecture: failed ? toLectureSummaryDto(failed) : undefined,
    });
    return { ok: false, error: err.message };
  }

  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
    try {
      if (attempt > 1) {
        emitProgress(
          ownerId,
          updateLectureProgress(
            id,
            "retrying",
            `일시적 네트워크/API 오류 자동 재시도 중 (${attempt}/${maxAttempts})...`,
            15
          )
        );
        await Bun.sleep(2500 * attempt);
      }

      const res = await distillLectureAudio({
        audioPath: input.audioPath,
        courseName: input.course,
        title: input.title,
        model: input.model,
        apiKey,
        onProgress: (ev) => {
          emitProgress(ownerId, updateLectureProgress(id, ev.stage, ev.message, ev.progress ?? 50));
        },
      });
      // Deleted while Gemini was working: don't write notes (or archive files) for it.
      if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
      const done = completeLectureRecord(id, res);
      emitLectureEvent(ownerId, { type: "completed", id, lecture: toLectureSummaryDto(done) });
      if (getSystemSettings().storage_auto_compact) {
        scheduleCompaction(id, ownerId);
      }
      return { ok: true };
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableDistillError(err)) break;
    }
  }

  const errMsg = lastErr?.message || String(lastErr);
  const failed = failLectureRecord(id, errMsg);
  emitLectureEvent(ownerId, {
    type: "error",
    id,
    error_message: errMsg,
    lecture: failed ? toLectureSummaryDto(failed) : undefined,
  });
  return { ok: false, error: errMsg };
}

/**
 * Queues re-encoding of a finished lecture's audio (see storage.ts). Returns false when
 * compaction is unavailable (no ffmpeg) or the lecture already has one queued/running.
 */
export function scheduleCompaction(id: string, ownerId: string): boolean {
  if (!isFfmpegAvailable()) return false;
  return !enqueueJob({ kind: "compact", ownerId, subjectId: id }).deduplicated;
}

async function runCompaction(job: LeasedJob) {
  const id = job.subjectId!;
  if (isLectureBusy(id, "distill")) {
    return { ok: false, error: "분석 작업이 진행 중인 강의입니다." };
  }
  const res = await compactLectureAudio(id, getSystemSettings().storage_compact_bitrate_kbps);
  if (res.state === "compacted") {
    const updated = getLectureById(id);
    if (updated) {
      emitLectureEvent(job.ownerId, { type: "updated", id, lecture: toLectureSummaryDto(updated) });
    }
  }
  return { ok: res.ok, error: res.error ?? null, savedBytes: res.savedBytes };
}

registerJobHandler("distill", runDistillation, {
  concurrency: config().maxConcurrentJobs,
  // Interrupted too many times (crashes or kills mid-run): leave a retryable error behind
  // instead of a lecture that says "processing" forever.
  onLost: ({ subjectId, ownerId }) => {
    if (!subjectId) return;
    const failed = failLectureRecord(
      subjectId,
      "분석 중 서버 처리 프로세스가 여러 번 중단되었습니다. 다시 시도해주세요."
    );
    if (failed) {
      emitLectureEvent(ownerId, {
        type: "error",
        id: subjectId,
        error_message: failed.error_message,
        lecture: toLectureSummaryDto(failed),
      });
    }
  },
});

registerJobHandler("compact", runCompaction, { concurrency: config().maxConcurrentCompact });
