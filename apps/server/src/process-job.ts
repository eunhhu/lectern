// The v2 processing of a recording (CONTRACTS §1.1, D-P1-1, D-P1-2) as one `process` job on
// the durable queue, behind LECTERN_PIPELINE=v2: transcript pipeline → publish the
// transcript (it is searchable from here on) → notes pipeline → publish the notes (the v1
// bridge fills `lectures.markdown`) → recording `ready`, `partial` or `failed`. Like
// queue.ts, this module must not import index.ts; job-handlers.ts registers the handler.
//
// Every stage runs on the harness runner, so a job whose lease is reclaimed (worker crash,
// deploy) runs again with the same job id and resumes: finished stages and chunks are not
// redone or paid for again.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config, readSecret } from "@lectern/config";
import { DEFAULT_GEMINI_MODEL } from "../../../packages/core/src/index.ts";
import { lectureRecordingId } from "@lectern/db";
import type { RecordingDomain } from "@lectern/domain";
import {
  GeminiLlmProvider,
  GeminiTranscriptionProvider,
  Harness,
  HarnessError,
  loadRouting,
  runNotesPipeline,
  runTranscriptPipeline,
  type JobRun,
  type LlmProvider,
  type NotesPipelineInput,
  type NotesPipelineOptions,
  type PdfContext,
  type PipelineStageEvent,
  type StageEvent,
  type Transcript,
  type TranscriptionProvider,
  type TranscriptPipelineOptions,
} from "@lectern/harness";
import { concatAudio, isFfmpegAvailable, readStreamInfo } from "@lectern/media";
import { announceLectures, assetPath } from "./api/v2/store.ts";
import { scheduleLectureIndex } from "./ask/index-job.ts";
import { afterNotesPublished } from "./calendar/auto-accept.ts";
import { DATA_DIR, db, failLectureRecord, getLectureById, syncPendingLectures, updateLectureProgress } from "./db.ts";
import { announceQueued, emitProgress, enqueueDistillation, type DistillInput } from "./distill-queue.ts";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
import { logger } from "./log.ts";
import { publishNotes } from "./notes-publish.ts";
import { alignRecording } from "./pdf-align.ts";
import { ingestRecordingPdfs } from "./pdf-publish.ts";
import { enqueueJob, JOB_CANCELED_MESSAGE, type JobOutcome, type LeasedJob } from "./queue.ts";
import { defaultTranscriptHarness } from "./transcript-job.ts";
import { publishTranscript } from "./transcript-publish.ts";

export const PROCESS_JOB_KIND = "process";

export const PROCESS_SOURCE_GONE_MESSAGE = "녹음이나 그 오디오가 삭제되어 처리를 중단했습니다.";

export { JOB_CANCELED_MESSAGE };

/** Progress (percent) and message per stage, shown while the stage runs. */
export const PROCESS_STAGE_PROGRESS: Record<string, [number, string]> = {
  ingest: [8, "오디오 확인 중..."],
  normalize: [14, "오디오 정리 중..."],
  speech_map: [20, "말소리 구간 찾는 중..."],
  chunk: [24, "오디오 나누는 중..."],
  transcribe: [40, "받아쓰는 중..."],
  merge: [60, "전사 합치는 중..."],
  speakers: [64, "화자 구분 중..."],
  classify: [70, "녹음 종류 파악 중..."],
  structure: [80, "노트 구성 중..."],
  extract: [88, "일정·할 일 찾는 중..."],
  verify: [93, "내용 검증 중..."],
  publish: [97, "저장 중..."],
  index: [99, "검색 색인 중..."],
};

const NOTES_PARTIAL_MESSAGE = "일부 내용을 만들지 못했습니다. 전사와 검색은 쓸 수 있습니다.";
const NOTES_FAILED_MESSAGE = "노트를 만들지 못했습니다. 전사는 사용할 수 있습니다.";
const PDF_PARTIAL_MESSAGE = "참고 PDF를 읽지 못했습니다. 노트와 전사는 쓸 수 있습니다.";
const NOTES_BUDGET_MESSAGE = "처리 예산을 다 써서 노트를 만들지 못했습니다. 전사는 사용할 수 있습니다.";
const TRANSCRIPT_FAILED_MESSAGE = "전사를 만들지 못했습니다. 다시 시도해주세요.";
const TRANSCRIPT_BUDGET_MESSAGE = "처리 예산을 다 써서 전사를 끝내지 못했습니다.";

/**
 * Spending cap per job, enforced by the runner between stages: transcript and notes
 * together, about three times the estimate per hour of audio, never below $0.50.
 */
const BUDGET_PER_HOUR_MICROUSD = 900_000;
const BUDGET_FLOOR_MICROUSD = 500_000;

export function processBudgetMicrousd(durationSec: number): number {
  return Math.max(BUDGET_FLOOR_MICROUSD, Math.ceil((Math.max(0, durationSec) / 3600) * BUDGET_PER_HOUR_MICROUSD));
}

/** The lecture's audio file if the lecture and the file still exist. */
function sourceAudio(lectureId: string): string | null {
  const lecture = getLectureById(lectureId);
  return lecture?.audio_path && existsSync(lecture.audio_path) ? lecture.audio_path : null;
}

/**
 * Queues the processing of a lecture whose row is already 'processing': the v2 `process`
 * job when LECTERN_PIPELINE=v2 and it can run here (ffmpeg, the server key), otherwise the
 * v1 distillation exactly as before. Same signature and dedupe as enqueueDistillation.
 * The v2 path only ever spends the server key (v2 uploads never carry a user key).
 */
export function enqueueRecordingProcessing(
  lectureId: string,
  ownerId: string,
  input: DistillInput
): { jobId: string; deduplicated: boolean; position: number } {
  if (config().pipeline === "v2") {
    const missing = !readSecret("GEMINI_API_KEY") ? "GEMINI_API_KEY" : !isFfmpegAvailable() ? "ffmpeg/ffprobe" : null;
    if (!missing) {
      const queued = enqueueJob({
        kind: PROCESS_JOB_KIND,
        ownerId,
        subjectId: lectureId,
        payload: { title: input.title, course: input.course },
        budgetMicrousd: processBudgetMicrousd(getLectureById(lectureId)?.duration_sec ?? 0),
      });
      announceQueued(lectureId, ownerId, queued);
      return queued;
    }
    logger.warn("LECTERN_PIPELINE is v2 but processing cannot run here; distilling instead", {
      lecture_id: lectureId,
      missing,
    });
  }
  return enqueueDistillation(lectureId, ownerId, input);
}

export interface ProcessJobDeps {
  harness?: Harness;
  transcription?: TranscriptionProvider;
  llm?: LlmProvider;
  /** Transcript pipeline settings other than provider and workDir (tests: small chunks). */
  pipeline?: Omit<TranscriptPipelineOptions, "provider" | "workDir">;
  /** Notes pipeline options other than the provider and routing (tests: templatesDir). */
  notes?: Partial<NotesPipelineOptions>;
}

export function defaultProcessHarness(): Harness {
  return defaultTranscriptHarness();
}

function dropArtifacts(harness: Harness, jobId: string): void {
  try {
    harness.deleteArtifactsForJob(jobId);
  } catch (err) {
    logger.error("could not delete process artifacts", { job_id: jobId, err });
  }
}

/**
 * Progress for a stage as it starts: the lecture row (v1 clients) and a `progress` event
 * (v2 `job.progress` carries the stage name). A stage that starts again (the next chunk, a
 * retry) is not announced twice; names without an entry are skipped.
 */
export function stageEmitter(
  lectureId: string,
  ownerId: string,
  options: { persist?: boolean } = {}
): (stage: string) => void {
  let last: string | null = null;
  return (stage) => {
    const entry = PROCESS_STAGE_PROGRESS[stage];
    if (!entry || stage === last) return;
    last = stage;
    const [progress, message] = entry;
    if (options.persist !== false) {
      emitProgress(ownerId, updateLectureProgress(lectureId, stage, message, progress));
      return;
    }
    // `regenerate`: the lecture keeps showing its finished notes; only the event says what runs.
    const lecture = getLectureById(lectureId);
    if (!lecture) return;
    emitLectureEvent(ownerId, {
      type: "progress",
      id: lectureId,
      stage,
      stage_message: message,
      progress,
      lecture: toLectureSummaryDto(lecture),
    });
  };
}

/**
 * Watches job.cancel_requested_at (D-P1-8) and aborts `controller` with a `canceled` error
 * once a user asks to cancel: on `check()` (stage starts, retries) and every second, so a
 * stage in flight is stopped too. `stop()` when the job ends.
 */
export function cancelWatcher(jobId: string, controller: AbortController): { check: () => void; stop: () => void } {
  const check = () => {
    if (controller.signal.aborted) return;
    const row = db.query(`SELECT cancel_requested_at FROM job WHERE id = ?`).get(jobId) as { cancel_requested_at: number | null } | null;
    if (row && row.cancel_requested_at !== null) controller.abort(new HarnessError("canceled", JOB_CANCELED_MESSAGE));
  };
  const timer = setInterval(check, 1000);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}

/** Whether `signal` was aborted by a user's cancel (cancelWatcher), not by a deletion. */
export function canceledByUser(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason instanceof HarnessError && signal.reason.message === JOB_CANCELED_MESSAGE;
}

interface RecordingFacts {
  id: string;
  workspace_id: string;
  title: string;
  language: string | null;
  recorded_at: number;
  recorded_at_source: "client" | "media" | "upload";
}

function recordingFacts(lectureId: string): RecordingFacts | null {
  return db
    .query(`SELECT id, workspace_id, title, language, recorded_at, recorded_at_source FROM recording WHERE id = ?`)
    .get(lectureRecordingId(lectureId)) as RecordingFacts | null;
}

interface UploadHints {
  filename: string | null;
  title: string | null;
  domain: RecordingDomain | null;
  folder_id: string | null;
}

/** What the uploader told us: the upload that created the recording (none for v1 lectures). */
function uploadHints(recordingId: string): UploadHints {
  const hints: UploadHints = { filename: null, title: null, domain: null, folder_id: null };
  const upload = db
    .query(`SELECT files_json, recording_json FROM upload WHERE recording_id = ? AND status = 'completed' ORDER BY created_at LIMIT 1`)
    .get(recordingId) as { files_json: string; recording_json: string | null } | null;
  if (!upload) return hints;
  try {
    const files = JSON.parse(upload.files_json) as Array<{ kind?: string; filename?: string }>;
    hints.filename = files.find((f) => f.kind === "audio")?.filename ?? null;
    const given = (
      JSON.parse(upload.recording_json ?? "{}") as {
        hints?: { title?: string | null; domain?: RecordingDomain; folder_id?: string | null } | null;
      }
    ).hints;
    hints.title = given?.title?.trim() || null;
    hints.domain = given?.domain ?? null;
    hints.folder_id = given?.folder_id ?? null;
  } catch (err) {
    logger.warn("could not read upload hints", { recording_id: recordingId, err });
  }
  return hints;
}

/** The notes pipeline's context: upload hints and the workspace's folder and tag names. */
function notesContext(recording: RecordingFacts): Omit<NotesPipelineInput, "transcript" | "recordedAtMs" | "recordedAtSource" | "tz"> {
  const hints = uploadHints(recording.id);
  const folders = db.query(`SELECT id, name FROM folder WHERE workspace_id = ? ORDER BY name`).all(recording.workspace_id) as Array<{
    id: string;
    name: string;
  }>;
  const tags = (db.query(`SELECT name FROM tag WHERE workspace_id = ? ORDER BY name`).all(recording.workspace_id) as Array<{ name: string }>).map(
    (t) => t.name
  );
  return { filename: hints.filename, hint: { domain: hints.domain, folder_id: hints.folder_id }, folders, tags };
}

/**
 * Whether the notes keep the recording's current title instead of the classified one: the
 * user named it at upload, or it already has notes (a v1 lecture, a reprocess), so its title
 * is one the user has seen and may have changed. An untitled lecture carries a placeholder.
 */
export function keepsTitle(lectureId: string): boolean {
  if ((getLectureById(lectureId)?.markdown ?? "").trim() !== "") return true;
  return uploadHints(lectureRecordingId(lectureId)).title !== null;
}

/** Recording state after a notes run, once the lecture's projection has landed. */
function markPartial(lectureId: string, recordingId: string, code: string, message: string): void {
  syncPendingLectures();
  db.query(`UPDATE recording SET status = 'partial', failure_code = ?, failure_message = ?, updated_at = ? WHERE id = ?`).run(
    code,
    message,
    Date.now(),
    recordingId
  );
  announceLectures([lectureId]);
}

/** A full notes run clears the `partial` an earlier run left (the projection keeps it otherwise). */
function markReady(lectureId: string, recordingId: string): void {
  const cleared = db
    .query(`UPDATE recording SET status = 'ready', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND status = 'partial'`)
    .run(Date.now(), recordingId).changes;
  if (cleared) announceLectures([lectureId]);
}

export interface NotesPhaseContext {
  job: LeasedJob;
  run: JobRun;
  lectureId: string;
  recordingId: string;
  workspaceId: string;
  transcript: Transcript;
  deps: ProcessJobDeps;
  /** Keep the recording's current title (the user chose it) instead of the classified one. */
  keepTitle: boolean;
  /** Stage progress (stageEmitter); the caller's run reports stage starts to it too. */
  emitStage: (stage: string) => void;
  /** Related lecture PDF pages for structure and extract (P3-04, from alignRecording). */
  pdf?: PdfContext;
  /**
   * What a notes failure does: `partial` (default, `process`: the transcript was just
   * published, D-P1-2) or `throw` (`regenerate`: the previous version stays as it is).
   */
  failure?: "partial" | "throw";
}

/**
 * The notes half of processing (D-P1-2), shared with `regenerate`: runs the notes pipeline
 * on a published transcript and publishes the document. A notes failure leaves the
 * transcript usable: the recording ends `partial`, never `failed`. Cancels are rethrown.
 */
export async function runNotesPhase(ctx: NotesPhaseContext): Promise<"ready" | "partial"> {
  const { job, run, lectureId, recordingId, workspaceId, deps } = ctx;
  const recording = recordingFacts(lectureId);
  if (!recording) throw new HarnessError("canceled", PROCESS_SOURCE_GONE_MESSAGE);
  const fields = { job_id: job.id, lecture_id: lectureId };
  const llm =
    deps.llm ??
    new GeminiLlmProvider({
      apiKey: () => readSecret("GEMINI_API_KEY"),
      timeoutMs: config().gemini.timeoutMs,
    });

  try {
    const result = await runNotesPipeline(
      run,
      {
        ...notesContext(recording),
        transcript: ctx.transcript,
        recordedAtMs: recording.recorded_at,
        recordedAtSource: recording.recorded_at_source,
        tz: "Asia/Seoul",
        pdf: ctx.pdf,
      },
      { llm, routing: loadRouting(), ...deps.notes }
    );
    run.context.signal?.throwIfAborted();
    ctx.emitStage("publish");
    const published = publishNotes({ recordingId, workspaceId, result, keepTitle: ctx.keepTitle });
    afterNotesPublished(recordingId, workspaceId); // calendar auto-add and sync (P4-04); never throws
    const lecture = getLectureById(lectureId);
    if (lecture) emitLectureEvent(job.ownerId, { type: "completed", id: lectureId, lecture: toLectureSummaryDto(lecture) });
    scheduleLectureIndex(lectureId, job.ownerId);
    logger.info("notes published", {
      ...fields,
      document_id: published.documentId,
      version: published.version,
      events: published.events,
      action_items: published.actionItems,
      partial: result.partial,
    });
    if (!result.partial) {
      markReady(lectureId, recordingId);
      return "ready";
    }
    markPartial(lectureId, recordingId, "notes_partial", NOTES_PARTIAL_MESSAGE);
    return "partial";
  } catch (err: any) {
    const error = err instanceof HarnessError ? err : null;
    if (error?.kind === "canceled" || run.context.signal?.aborted || ctx.failure === "throw") throw err;
    // The transcript is published already (D-P1-2): the lecture is done without notes.
    const budget = error?.kind === "budget";
    logger.warn("notes failed; the transcript stays", {
      ...fields,
      error_kind: error?.kind,
      error_code: error?.code,
      error: err?.message || String(err),
    });
    db.query(
      `UPDATE lectures SET status = 'done', stage = 'done', stage_message = '완료', progress = 100, excerpt = ?, error_message = NULL,
         updated_at = ? WHERE id = ?`
    ).run(NOTES_FAILED_MESSAGE, new Date().toISOString(), lectureId);
    markPartial(lectureId, recordingId, budget ? "budget_exceeded" : "notes_failed", budget ? NOTES_BUDGET_MESSAGE : NOTES_FAILED_MESSAGE);
    const lecture = getLectureById(lectureId);
    if (lecture) emitLectureEvent(job.ownerId, { type: "completed", id: lectureId, lecture: toLectureSummaryDto(lecture) });
    return "partial";
  }
}

/** A Korean message for a transcript that could not be made (harness messages may be English). */
function transcriptFailureMessage(err: unknown): string {
  if (err instanceof HarnessError && err.kind === "budget") return TRANSCRIPT_BUDGET_MESSAGE;
  const message = err instanceof Error ? err.message : String(err);
  return /\p{Script=Hangul}/u.test(message) ? message : TRANSCRIPT_FAILED_MESSAGE;
}

/**
 * Runs `job.subjectId` (a lecture) through the v2 pipeline. Every end is `ready`,
 * `partial`, `failed` or a cancel (the recording or its audio was deleted).
 */
export async function runProcessJob(job: LeasedJob, deps: ProcessJobDeps = {}): Promise<JobOutcome> {
  const lectureId = job.subjectId!;
  const ownerId = job.ownerId;
  // Switched back to v1 after the job was queued: the v1 distillation takes the lecture over,
  // queued once this job's row is finished (a lecture is never left "processing").
  if (config().pipeline === "v1") {
    const lecture = getLectureById(lectureId);
    return {
      ok: true,
      result: { skipped: "pipeline_v1" },
      followUp: lecture?.audio_path
        ? () =>
            void enqueueDistillation(lectureId, ownerId, {
              audioPath: lecture.audio_path!,
              course: String(job.payload.course ?? lecture.course),
              title: String(job.payload.title ?? ""),
              model: lecture.model_requested || DEFAULT_GEMINI_MODEL,
            })
        : undefined,
    };
  }

  const harness = deps.harness ?? defaultProcessHarness();
  const audioPath = sourceAudio(lectureId);
  const recording = audioPath ? recordingFacts(lectureId) : null;
  if (!audioPath || !recording) {
    dropArtifacts(harness, job.id);
    return { ok: false, error: PROCESS_SOURCE_GONE_MESSAGE };
  }
  const recordingId = recording.id;
  const workspaceId = recording.workspace_id;
  const fields = { job_id: job.id, lecture_id: lectureId };
  const keepTitle = keepsTitle(lectureId);

  // Deleting the recording or only its audio, or a user's cancel, stops the run at the next
  // stage or retry; the provider call in flight is aborted too (its stage gets ctx.signal).
  const controller = new AbortController();
  const sourceGone = () => sourceAudio(lectureId) !== audioPath;
  const checkSource = () => {
    if (!controller.signal.aborted && sourceGone()) {
      controller.abort(new HarnessError("canceled", PROCESS_SOURCE_GONE_MESSAGE));
    }
  };
  const cancel = cancelWatcher(job.id, controller);
  const emitStage = stageEmitter(lectureId, ownerId);
  const run = harness.job({
    jobId: job.id,
    scope: workspaceId,
    workspaceId,
    signal: controller.signal,
    onEvent: (ev: StageEvent) => {
      if (ev.type === "started" || ev.type === "retry") {
        checkSource();
        cancel.check();
      }
      if (ev.type === "started" && !controller.signal.aborted) emitStage(ev.stage);
      if (ev.type === "retry") {
        logger.warn("process stage retry", {
          ...fields,
          stage: ev.stage,
          attempt: ev.attempt,
          max_attempts: ev.maxAttempts,
          error_kind: ev.error.kind,
          error_code: ev.error.code,
        });
      } else if (ev.type === "failed") {
        logger.warn("process stage failed", {
          ...fields,
          stage: ev.stage,
          error_kind: ev.error.kind,
          error_code: ev.error.code,
          error: ev.error.message,
        });
      }
    },
  });
  /** Ends the job without a result: the recording or its audio is gone, or a user canceled it. */
  const stopped = (): JobOutcome | null => {
    if (sourceGone()) {
      dropArtifacts(harness, job.id);
      return { ok: false, error: PROCESS_SOURCE_GONE_MESSAGE };
    }
    if (!canceledByUser(controller.signal)) return null;
    dropArtifacts(harness, job.id);
    logger.info("process canceled by the user", fields);
    const failed = failLectureRecord(lectureId, JOB_CANCELED_MESSAGE);
    emitLectureEvent(ownerId, {
      type: "error",
      id: lectureId,
      error_message: JOB_CANCELED_MESSAGE,
      lecture: failed ? toLectureSummaryDto(failed) : undefined,
    });
    return { ok: false, canceled: true, error: JOB_CANCELED_MESSAGE };
  };

  // D-P1-9: a recording uploaded in several audio parts is transcribed as one timeline, the
  // parts joined in order. The joined file stays when the job fails (a retry reuses it).
  const parts = db
    .query(`SELECT id, blob_key, duration_ms FROM asset WHERE recording_id = ? AND kind = 'audio' ORDER BY part_index`)
    .all(recordingId) as Array<{ id: string; blob_key: string; duration_ms: number | null }>;
  const joined = parts.length > 1 ? join(DATA_DIR, "work", `${job.id}-joined.flac`) : null;
  let keepJoined = false;

  try {
    // 1. Transcript. Nothing is published when it fails, so the recording fails.
    let transcript: Transcript;
    let summary: Record<string, unknown>;
    try {
      let transcriptInput = audioPath;
      if (joined) {
        const paths = parts.map((part) => assetPath(part));
        if (paths.some((path) => path === null)) throw new HarnessError("config", "오디오 파트 파일을 찾을 수 없습니다.");
        if (!existsSync(joined)) {
          mkdirSync(join(DATA_DIR, "work"), { recursive: true });
          const result = await concatAudio(paths as string[], joined, { signal: controller.signal });
          result.parts.forEach((part, i) => db.query(`UPDATE asset SET duration_ms = ? WHERE id = ?`).run(part.duration_ms, parts[i]!.id));
        } else {
          for (const [i, part] of parts.entries()) {
            if (part.duration_ms !== null) continue;
            const info = await readStreamInfo(paths[i]!, { signal: controller.signal });
            db.query(`UPDATE asset SET duration_ms = ? WHERE id = ?`).run(info.duration_ms, part.id);
          }
        }
        transcriptInput = joined;
      }
      const result = await runTranscriptPipeline(
        run,
        { audioPath: transcriptInput, language: recording.language ?? undefined },
        {
          ...deps.pipeline,
          provider:
            deps.transcription ??
            new GeminiTranscriptionProvider({
              apiKey: () => readSecret("GEMINI_API_KEY"),
              timeoutMs: config().gemini.timeoutMs,
            }),
          workDir: join(DATA_DIR, "work"),
          onStage: (ev: PipelineStageEvent) => {
            deps.pipeline?.onStage?.(ev);
            checkSource();
            cancel.check();
          },
        }
      );
      const early = stopped();
      if (early) return early;
      transcript = result.transcript;
      summary = {
        chunks: result.chunks.chunks.length,
        segments: transcript.segments.length,
        speakers: transcript.speakers.length,
        gaps: transcript.gaps.length,
        failed_chunks: transcript.failed_chunks,
        resumed_stages: result.stageRuns.filter((s) => s.resumed).length,
      };
    } catch (err: any) {
      const early = stopped();
      if (early) return early;
      if (err instanceof HarnessError && err.kind === "canceled") {
        dropArtifacts(harness, job.id);
        return { ok: false, error: err.message };
      }
      const message = transcriptFailureMessage(err);
      keepJoined = true;
      logger.warn("process transcript failed", {
        ...fields,
        error_kind: err instanceof HarnessError ? err.kind : undefined,
        error_code: err instanceof HarnessError ? err.code : undefined,
        error: err?.message || String(err),
      });
      // Finished stages stay: a retry of the job resumes after them (same job id, memo).
      const failed = failLectureRecord(lectureId, message);
      emitLectureEvent(ownerId, {
        type: "error",
        id: lectureId,
        error_message: message,
        lecture: failed ? toLectureSummaryDto(failed) : undefined,
      });
      return { ok: false, error: message };
    }

    // 2. Publish the transcript: from here on the recording is searchable whatever the notes do.
    try {
      publishTranscript({ recordingId, workspaceId, transcript });
      db.query(`UPDATE lectures SET duration_sec = ?, updated_at = ? WHERE id = ?`).run(
        Math.round(transcript.duration_ms / 1000),
        new Date().toISOString(),
        lectureId
      );
      syncPendingLectures();
    } catch (err) {
      logger.error("could not publish transcript", { ...fields, err });
      keepJoined = true;
      const message = "전사를 저장하지 못했습니다.";
      const failed = failLectureRecord(lectureId, message);
      emitLectureEvent(ownerId, { type: "error", id: lectureId, error_message: message, lecture: failed ? toLectureSummaryDto(failed) : undefined });
      return { ok: false, error: message };
    }
    scheduleLectureIndex(lectureId, ownerId);
    announceLectures([lectureId]);

    // 2b. Lecture PDFs (P3-03, D-P3-2): page text for the notes and search. A PDF that cannot
    // be read never fails the recording; it ends `partial` like a notes failure (D-P1-2).
    let pdfFailed = false;
    let pdf: PdfContext | null = null;
    if (config().pdf) {
      try {
        pdfFailed = (await ingestRecordingPdfs({ run, recordingId, workspaceId })).failed > 0;
        // P3-04: which pages each stretch of the transcript talks about; null without pages.
        pdf = await alignRecording({ run, recordingId, workspaceId });
      } catch (err: any) {
        const early = stopped();
        if (early) return early;
        dropArtifacts(harness, job.id);
        return { ok: false, error: err?.message || String(err) };
      }
    }

    // 3. Notes.
    let status: "ready" | "partial";
    try {
      status = await runNotesPhase({ job, run, lectureId, recordingId, workspaceId, transcript, deps, keepTitle, emitStage, pdf: pdf ?? undefined });
    } catch (err: any) {
      const early = stopped();
      if (early) return early;
      const message = err?.message || String(err);
      keepJoined = true;
      logger.warn("process notes stopped", { ...fields, error: message });
      return { ok: false, error: message };
    }
    // Deleted while the notes were committing. A cancel that comes after the publish is moot.
    if (sourceGone()) {
      dropArtifacts(harness, job.id);
      return { ok: false, error: PROCESS_SOURCE_GONE_MESSAGE };
    }
    if (pdfFailed && status === "ready") {
      markPartial(lectureId, recordingId, "pdf_failed", PDF_PARTIAL_MESSAGE);
      status = "partial";
    }

    dropArtifacts(harness, job.id);
    const spent = db.query(`SELECT spent_microusd FROM job WHERE id = ?`).get(job.id) as { spent_microusd: number } | null;
    const outcome = { status, ...summary, spent_microusd: spent?.spent_microusd ?? 0 };
    logger.info("recording processed", { ...fields, ...outcome });
    return { ok: true, result: outcome };
  } finally {
    cancel.stop();
    if (joined && !keepJoined) rmSync(joined, { force: true });
  }
}
