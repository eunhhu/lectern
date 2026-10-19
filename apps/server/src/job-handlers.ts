// Job handlers for the durable queue, shared by the API's embedded worker and apps/worker.
// Like queue.ts, this module must not import index.ts.

import { config } from "@lectern/config";
import {
  classifyGeminiError,
  Harness,
  HarnessError,
  legacyDistillStage,
  type LegacyDistillProvider,
} from "@lectern/harness";
import { distillLectureAudio } from "../../../packages/core/src/index.ts";
import {
  completeLectureRecord,
  db,
  failLectureRecord,
  HARNESS_BLOB_DIR,
  getLectureById,
  getSystemSettings,
  type LectureRecord,
  updateLectureProgress,
} from "./db.ts";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
import { logger } from "./log.ts";
import { enqueueJob, isLectureBusy, registerJobHandler, type JobOutcome, type LeasedJob } from "./queue.ts";
import { compactLectureAudio, isFfmpegAvailable } from "./storage.ts";
import {
  defaultTranscriptHarness,
  enqueueTranscriptAfterDistill,
  runTranscriptJob,
  TRANSCRIBE_JOB_KIND,
  type TranscriptJobDeps,
} from "./transcript-job.ts";
import "./ask/index-job.ts"; // registers the ask `index` job handler and the lecture-change hook

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
 * The classification lives in @lectern/harness, shared with the harness engine.
 */
export function isRetryableDistillError(err: unknown): boolean {
  return classifyGeminiError(err).kind === "transient";
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

/** Runs a distill job on the engine LECTERN_DISTILL_ENGINE selects (read per job). */
export function runDistillation(job: LeasedJob): Promise<JobOutcome> {
  return config().distillEngine === "harness" ? runDistillationOnHarness(job) : runLegacyDistillation(job);
}

async function runLegacyDistillation(job: LeasedJob): Promise<JobOutcome> {
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
      afterDistillPublished(done, apiKey !== undefined);
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

let distillHarness: Harness | null = null;

function defaultHarness(): Harness {
  distillHarness ??= new Harness({ db, blobDir: HARNESS_BLOB_DIR, logger });
  return distillHarness;
}

export interface HarnessDistillDeps {
  harness?: Harness;
  provider?: LegacyDistillProvider;
}

/**
 * The same distillation as runLegacyDistillation, run as the single `legacy_distill` stage
 * on @lectern/harness: same retries, progress events, lecture writes and SSE, plus
 * stage_run/ai_call records, and a job resumed after a crash reuses a finished Gemini
 * call instead of paying for it again. The stage output (the notes) is deleted when the
 * job ends: `lectures` holds the published copy, and no third copy may outlive a deletion.
 */
export async function runDistillationOnHarness(job: LeasedJob, deps: HarnessDistillDeps = {}): Promise<JobOutcome> {
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

  if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
  const harness = deps.harness ?? defaultHarness();
  const run = harness.job({
    jobId: job.id,
    scope: `owner:${ownerId}`,
    onEvent: (ev) => {
      if (ev.type !== "retry") return;
      emitProgress(
        ownerId,
        updateLectureProgress(
          id,
          "retrying",
          `일시적 네트워크/API 오류 자동 재시도 중 (${ev.attempt}/${ev.maxAttempts})...`,
          15
        )
      );
    },
  });
  try {
    const { value } = await run.run(legacyDistillStage(deps.provider), {
      audioPath: input.audioPath,
      course: input.course,
      model: input.model,
      apiKey,
      onProgress: (ev) => {
        emitProgress(ownerId, updateLectureProgress(id, ev.stage, ev.message, ev.progress ?? 50));
      },
      beforeAttempt: () => {
        if (!getLectureById(id)) throw new HarnessError("canceled", LECTURE_GONE_MESSAGE);
      },
    });
    // Deleted while Gemini was working: don't write notes (or archive files) for it.
    if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
    const done = completeLectureRecord(id, { ...value, title: input.title?.trim() || value.title });
    emitLectureEvent(ownerId, { type: "completed", id, lecture: toLectureSummaryDto(done) });
    afterDistillPublished(done, apiKey !== undefined);
    return { ok: true };
  } catch (err: any) {
    if (err instanceof HarnessError && err.kind === "canceled" && err.message === LECTURE_GONE_MESSAGE) {
      return { ok: false, error: LECTURE_GONE_MESSAGE };
    }
    const errMsg = err?.message || String(err);
    const failed = failLectureRecord(id, errMsg);
    emitLectureEvent(ownerId, {
      type: "error",
      id,
      error_message: errMsg,
      lecture: failed ? toLectureSummaryDto(failed) : undefined,
    });
    return { ok: false, error: errMsg };
  } finally {
    try {
      harness.deleteArtifactsForJob(job.id);
    } catch (err) {
      logger.error("could not delete distill artifacts", { job_id: job.id, err });
    }
  }
}

/**
 * After a distillation published its notes: the v2 transcript pipeline when
 * LECTERN_TRANSCRIPT_ENGINE asks for it (transcript-job.ts), which reads the original audio
 * and so schedules the compaction itself when it ends; otherwise compaction as before.
 */
function afterDistillPublished(lecture: LectureRecord, userKey: boolean): void {
  if (enqueueTranscriptAfterDistill(lecture, { userKey })) return;
  if (getSystemSettings().storage_auto_compact) {
    scheduleCompaction(lecture.id, lecture.owner_id);
  }
}

/** The compaction a transcribe job held back (afterDistillPublished), once it is over. */
function compactAfterTranscript(lectureId: string, ownerId: string): void {
  if (getSystemSettings().storage_auto_compact && getLectureById(lectureId)?.status === "done") {
    scheduleCompaction(lectureId, ownerId);
  }
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
  // A transcribe job reads the original audio, which compaction replaces.
  if (isLectureBusy(id, "distill") || isLectureBusy(id, TRANSCRIBE_JOB_KIND)) {
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
  onLost: ({ id, subjectId, ownerId }) => {
    // The handler never reached its own cleanup (harness engine): drop the stage's copy of the notes.
    try {
      defaultHarness().deleteArtifactsForJob(id);
    } catch (err) {
      logger.error("could not delete distill artifacts", { job_id: id, err });
    }
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

/**
 * Registers the `transcribe` handler (transcript-job.ts). `deps` replace the Gemini provider
 * or the harness, e.g. a worker that runs on recorded answers.
 *
 * One job at a time: each runs ffmpeg over the whole recording and up to three provider
 * calls at once, on a Raspberry Pi. The compaction it held back starts after the job's row
 * is finished (followUp), so it does not find the job still busy.
 */
export function registerTranscriptJobHandler(deps: TranscriptJobDeps = {}): void {
  registerJobHandler(
    TRANSCRIBE_JOB_KIND,
    async (job) => ({
      ...(await runTranscriptJob(job, deps)),
      followUp: () => compactAfterTranscript(job.subjectId!, job.ownerId),
    }),
    {
      concurrency: 1,
      // Interrupted too many times: the lecture itself is fine (its notes are published);
      // drop the partial artifacts and release the compaction.
      onLost: ({ id, subjectId, ownerId }) => {
        try {
          (deps.harness ?? defaultTranscriptHarness()).deleteArtifactsForJob(id);
        } catch (err) {
          logger.error("could not delete transcript artifacts", { job_id: id, err });
        }
        if (subjectId) compactAfterTranscript(subjectId, ownerId);
      },
    }
  );
}

registerTranscriptJobHandler();
