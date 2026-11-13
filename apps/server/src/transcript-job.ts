// The v2 transcript pipeline (packages/harness, AI_HARNESS §11 step 3) as a `transcribe`
// job on the durable queue, behind LECTERN_TRANSCRIPT_ENGINE. Like queue.ts, this module
// must not import index.ts; job-handlers.ts registers the handler.
//
// shadow: after a distillation on the server key has published its notes, the recording is
// transcribed again on the harness: ingest → normalize → speech_map → chunk → transcribe ×N
// → merge → speakers. The transcript stays where the runner stored it, as the `speakers`
// stage's artifact (a blob), and nobody sees it: no lecture writes, no SSE events, only log
// lines and a summary without text in job.result. It goes with the recording or its audio
// (db.ts deleteHarnessArtifacts) or with the job row 30 days after the job (maintenance).
//
// on: the same run, then the transcript is published (transcript_segment, speaker,
// transcript_gap) in one transaction (transcript-publish.ts), the recording is queued for
// the 물어보기 index and v1/v2 clients get a `recording.updated` event.
//
// A job whose lease is reclaimed (worker crash, deploy) runs again with the same job id,
// and the runner resumes it: finished stages and chunks are not redone or paid for again.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { config, readSecret } from "@lectern/config";
import {
  GeminiTranscriptionProvider,
  Harness,
  HarnessError,
  runTranscriptPipeline,
  type PipelineStageEvent,
  type StageEvent,
  type TranscriptionProvider,
  type TranscriptPipelineOptions,
} from "@lectern/harness";
import { lectureRecordingId } from "@lectern/db";
import { isFfmpegAvailable } from "@lectern/media";
import { announceLectures } from "./api/v2/store.ts";
import { scheduleLectureIndex } from "./ask/index-job.ts";
import { personalWorkspaceId } from "./ask/workspace.ts";
import { DATA_DIR, db, getLectureById, getUserById, HARNESS_BLOB_DIR, type LectureRecord } from "./db.ts";
import { logger } from "./log.ts";
import { enqueueJob, type JobOutcome, type LeasedJob } from "./queue.ts";
import { publishTranscript } from "./transcript-publish.ts";

export const TRANSCRIBE_JOB_KIND = "transcribe";

export const TRANSCRIPT_SOURCE_GONE_MESSAGE = "녹음이나 그 오디오가 삭제되어 전사를 중단했습니다.";

/**
 * Spending cap per job, enforced by the runner between stages: about three times the
 * estimated $0.19–0.23 per hour of audio (packages/harness/README.md), never below $0.30.
 * Repair retries and a runaway provider stop here instead of on the bill.
 */
const BUDGET_PER_HOUR_MICROUSD = 600_000;
const BUDGET_FLOOR_MICROUSD = 300_000;

export function transcriptBudgetMicrousd(durationSec: number): number {
  return Math.max(BUDGET_FLOOR_MICROUSD, Math.ceil((Math.max(0, durationSec) / 3600) * BUDGET_PER_HOUR_MICROUSD));
}

/** The lecture's audio file if the lecture and the file still exist. */
function sourceAudio(lectureId: string): string | null {
  const lecture = getLectureById(lectureId);
  return lecture?.audio_path && existsSync(lecture.audio_path) ? lecture.audio_path : null;
}

/** Same rule as index.ts canUseServerKey: shadow runs only ever spend the server key. */
function mayUseServerKey(ownerId: string): boolean {
  const user = getUserById(ownerId);
  return Boolean(user && user.can_use_server_key !== 0 && (user.status || "active") === "active");
}

/**
 * Queues the transcript pipeline for a lecture whose distillation just published, when
 * LECTERN_TRANSCRIPT_ENGINE asks for it. Returns the job id, or null when nothing was
 * queued: engine off, the distillation ran on a key the user supplied (their key is not
 * spent on work they never see, and the server key is not spent on their audio), an
 * account that may not use the server key, no server key, no ffmpeg/ffprobe, or no audio file.
 */
export function enqueueTranscriptAfterDistill(
  lecture: LectureRecord,
  options: { userKey: boolean }
): string | null {
  const mode = config().transcriptEngine;
  if (mode === "off" || options.userKey) return null;
  if (!mayUseServerKey(lecture.owner_id)) return null;
  if (!sourceAudio(lecture.id)) return null;
  if (!readSecret("GEMINI_API_KEY")) {
    logger.warn("transcript engine is on but GEMINI_API_KEY is not set; not transcribing", {
      lecture_id: lecture.id,
      mode,
    });
    return null;
  }
  if (!isFfmpegAvailable()) {
    logger.warn("transcript engine is on but ffmpeg/ffprobe are not available; not transcribing", {
      lecture_id: lecture.id,
      mode,
    });
    return null;
  }
  return enqueueJob({
    kind: TRANSCRIBE_JOB_KIND,
    ownerId: lecture.owner_id,
    subjectId: lecture.id,
    budgetMicrousd: transcriptBudgetMicrousd(lecture.duration_sec),
  }).jobId;
}

let transcriptHarness: Harness | null = null;

/** The harness the transcribe jobs run on (also used to drop a job's artifacts). */
export function defaultTranscriptHarness(): Harness {
  transcriptHarness ??= new Harness({ db, blobDir: HARNESS_BLOB_DIR, logger });
  return transcriptHarness;
}

export interface TranscriptJobDeps {
  harness?: Harness;
  provider?: TranscriptionProvider;
  /** Pipeline settings other than provider and workDir (tests: small chunks, one at a time). */
  pipeline?: Omit<TranscriptPipelineOptions, "provider" | "workDir">;
}

function dropArtifacts(harness: Harness, jobId: string): void {
  try {
    harness.deleteArtifactsForJob(jobId);
  } catch (err) {
    logger.error("could not delete transcript artifacts", { job_id: jobId, err });
  }
}

/**
 * Runs the transcript pipeline for `job.subjectId` (a lecture). In shadow the lecture row
 * and its events are never touched; in `on` the transcript is published to the v2 tables.
 */
export async function runTranscriptJob(job: LeasedJob, deps: TranscriptJobDeps = {}): Promise<JobOutcome> {
  const mode = config().transcriptEngine;
  // Turned off after the job was queued: nothing to do.
  if (mode === "off") return { ok: true, result: { skipped: "engine_off" } };

  const lectureId = job.subjectId!;
  const harness = deps.harness ?? defaultTranscriptHarness();
  const audioPath = sourceAudio(lectureId);
  if (!audioPath) {
    dropArtifacts(harness, job.id);
    return { ok: false, error: TRANSCRIPT_SOURCE_GONE_MESSAGE };
  }

  // Deleting the recording or only its audio cancels the run at the next stage or retry;
  // the provider call in flight is aborted too (its stage gets ctx.signal).
  const controller = new AbortController();
  const checkSource = () => {
    if (!controller.signal.aborted && sourceAudio(lectureId) !== audioPath) {
      controller.abort(new HarnessError("canceled", TRANSCRIPT_SOURCE_GONE_MESSAGE));
    }
  };
  const fields = { job_id: job.id, lecture_id: lectureId, mode };
  const workspaceId = personalWorkspaceId(job.ownerId);
  const run = harness.job({
    jobId: job.id,
    scope: workspaceId,
    workspaceId,
    signal: controller.signal,
    onEvent: (ev: StageEvent) => {
      if (ev.type === "started" || ev.type === "retry") checkSource();
      if (ev.type === "retry") {
        logger.warn("transcript stage retry", {
          ...fields,
          stage: ev.stage,
          attempt: ev.attempt,
          max_attempts: ev.maxAttempts,
          error_kind: ev.error.kind,
          error_code: ev.error.code,
        });
      } else if (ev.type === "failed") {
        logger.warn("transcript stage failed", {
          ...fields,
          stage: ev.stage,
          error_kind: ev.error.kind,
          error_code: ev.error.code,
          error: ev.error.message,
        });
      }
    },
  });
  const provider =
    deps.provider ??
    new GeminiTranscriptionProvider({
      apiKey: () => readSecret("GEMINI_API_KEY"),
      timeoutMs: config().gemini.timeoutMs,
    });

  try {
    const result = await runTranscriptPipeline(
      run,
      { audioPath },
      {
        ...deps.pipeline,
        provider,
        workDir: join(DATA_DIR, "work"),
        onStage: (ev: PipelineStageEvent) => {
          deps.pipeline?.onStage?.(ev);
          logger.info("transcript stage", {
            ...fields,
            stage: ev.stage,
            chunk_index: ev.chunkIndex,
            cache_hit: ev.cacheHit,
            resumed: ev.resumed,
          });
          checkSource();
        },
      }
    );
    // Deleted while the last stage was committing: its artifacts must not stay behind.
    if (sourceAudio(lectureId) !== audioPath) {
      dropArtifacts(harness, job.id);
      return { ok: false, error: TRANSCRIPT_SOURCE_GONE_MESSAGE };
    }

    const { transcript } = result;
    if (mode === "on") {
      try {
        publishTranscript({ recordingId: lectureRecordingId(lectureId), workspaceId, transcript });
      } catch (err) {
        logger.error("could not publish transcript", { ...fields, err });
        return { ok: false, error: "전사를 저장하지 못했습니다." };
      }
      scheduleLectureIndex(lectureId, job.ownerId);
      announceLectures([lectureId]);
    }

    const speakers = result.stageRuns.find((s) => s.stage === "speakers")!;
    const output = db
      .query(`SELECT output_json FROM stage_run WHERE id = ?`)
      .get(speakers.stageRunId) as { output_json: string } | null;
    const spent = db.query(`SELECT spent_microusd FROM job WHERE id = ?`).get(job.id) as {
      spent_microusd: number;
    } | null;
    // Counts and references only: the transcript text stays in its blob.
    const summary = {
      mode,
      published: mode === "on",
      transcript_artifact: output ? (JSON.parse(output.output_json) as { output: string }).output : null,
      duration_ms: transcript.duration_ms,
      chunks: result.chunks.chunks.length,
      segments: transcript.segments.length,
      speakers: transcript.speakers.length,
      gaps: transcript.gaps.length,
      failed_chunks: transcript.failed_chunks,
      resumed_stages: result.stageRuns.filter((s) => s.resumed).length,
      spent_microusd: spent?.spent_microusd ?? 0,
    };
    logger.info(mode === "on" ? "transcript published" : "transcript stored", { ...fields, ...summary });
    return { ok: true, result: summary };
  } catch (err: any) {
    const error = err instanceof HarnessError ? err : null;
    if (error?.kind === "canceled" && error.message === TRANSCRIPT_SOURCE_GONE_MESSAGE) {
      dropArtifacts(harness, job.id);
      return { ok: false, error: TRANSCRIPT_SOURCE_GONE_MESSAGE };
    }
    // Finished stages stay: a later job for the same audio reuses them (shared memo).
    logger.warn("transcript job failed", {
      ...fields,
      error_kind: error?.kind,
      error_code: error?.code,
      error: err?.message || String(err),
    });
    return { ok: false, error: err?.message || String(err) };
  }
}
