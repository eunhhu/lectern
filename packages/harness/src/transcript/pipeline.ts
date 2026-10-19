// The transcript pipeline as one job on the runner (AI_HARNESS §2, §11 step 3):
//
//   ingest → normalize → speech_map → chunk → transcribe ×N → merge → speakers
//
// Calling runTranscriptPipeline again for the same job resumes it: stages that already
// succeeded return their stored outputs (no ffmpeg, no provider call), the interrupted one
// runs again. Chunks are transcribed in parallel up to `concurrency`. A chunk that fails for
// good (output checks failed after the repair attempt, transient errors exhausted, or the
// provider refusing that audio) becomes a "전사 누락" gap and the rest goes on (§3.4,
// partial results); configuration, budget and cancellation errors stop the job, and so does
// a job in which no chunk could be transcribed.

import { DEFAULT_OVERLAP_MAX_MS, DEFAULT_OVERLAP_MIN_MS, type SpeechMapRules } from "@lectern/media";
import { classifyError, HarnessError, type ErrorKind } from "../errors.ts";
import type { TranscriptionProvider } from "../providers.ts";
import type { JobRun, StageResult } from "../runner.ts";
import type { StageDefinition } from "../stage.ts";
import type {
  ChunkOutput,
  IngestOutput,
  MergedTranscript,
  NormalizeOutput,
  SpeechMapOutput,
  Transcript,
  TranscribeResult,
} from "./schemas.ts";
import {
  chunkSilences,
  chunkStage,
  ingestStage,
  mergeStage,
  normalizeStage,
  speakersStage,
  speechMapStage,
  transcribeStage,
  type ChunkPlanConfig,
  type TranscribeInput,
} from "./stages.ts";

export const TRANSCRIPT_PIPELINE_DEFAULTS = Object.freeze({
  /** LLM transcription chunk target (§3.3: 5–8 min; Gemini timestamps drift past 5 min). */
  chunkTargetMs: 6 * 60_000,
  overlapMinMs: DEFAULT_OVERLAP_MIN_MS,
  overlapMaxMs: DEFAULT_OVERLAP_MAX_MS,
  /** Chunks in flight at once (provider request cap, §4.2). */
  concurrency: 3,
});

export interface TranscriptPipelineInput {
  /** The uploaded recording as the server stored it. Read only. */
  audioPath: string;
  /** BCP 47 hint for the provider and the language check. */
  language?: string;
  speakersHint?: number;
}

export interface TranscriptPipelineOptions {
  provider: TranscriptionProvider;
  /** Scratch space for ffmpeg outputs; every stage removes its own directory. */
  workDir: string;
  /** Chunk plan; `targetMs: null` sends the whole speech audio as one chunk (dedicated STT). */
  chunk?: Partial<ChunkPlanConfig>;
  speechMap?: { rules?: Partial<SpeechMapRules>; noiseDb?: number | "auto" };
  concurrency?: number;
  /** Called as each stage's result lands (progress events; test doubles that need the time map). */
  onStage?: (event: PipelineStageEvent) => void;
}

export interface PipelineStageEvent {
  stage: string;
  chunkIndex: number | null;
  value: unknown;
  stageRunId: string;
  cacheHit: boolean;
  resumed: boolean;
}

export interface ChunkFailure {
  index: number;
  kind: ErrorKind;
  code?: string;
  message: string;
}

export interface TranscriptPipelineResult {
  /** What to publish: segments in original time with recording-wide speakers, and gaps. */
  transcript: Transcript;
  ingest: IngestOutput;
  normalize: NormalizeOutput;
  speechMap: SpeechMapOutput;
  chunks: ChunkOutput;
  merged: MergedTranscript;
  chunkFailures: ChunkFailure[];
  stageRuns: Array<{ stage: string; chunkIndex: number | null; stageRunId: string; cacheHit: boolean; resumed: boolean }>;
}

/** Failures that end the job rather than one chunk. */
const FATAL: ReadonlySet<ErrorKind> = new Set(["config", "budget", "canceled"]);

export async function runTranscriptPipeline(
  run: JobRun,
  input: TranscriptPipelineInput,
  options: TranscriptPipelineOptions,
): Promise<TranscriptPipelineResult> {
  const stageRuns: TranscriptPipelineResult["stageRuns"] = [];
  const step = async <I, O>(stage: StageDefinition<I, O>, stageInput: I, chunkIndex: number | null = null) => {
    const result = await run.run(stage, stageInput, chunkIndex === null ? {} : { chunkIndex });
    const meta = { stage: stage.name, chunkIndex, stageRunId: result.stageRunId, cacheHit: result.cacheHit, resumed: result.resumed };
    stageRuns.push(meta);
    options.onStage?.({ ...meta, value: result.value });
    return result;
  };
  const { workDir, provider } = options;

  const ingest = await step(ingestStage, { audioPath: input.audioPath });
  const normalize = await step(normalizeStage, { audioPath: input.audioPath, sha256: ingest.value.sha256, workDir });
  const speech = await step(speechMapStage, {
    audio: normalize.value.audio,
    workDir,
    rules: options.speechMap?.rules,
    noiseDb: options.speechMap?.noiseDb,
  });
  const plan: ChunkPlanConfig = {
    targetMs: options.chunk?.targetMs === undefined ? TRANSCRIPT_PIPELINE_DEFAULTS.chunkTargetMs : options.chunk.targetMs,
    overlapMinMs: options.chunk?.overlapMinMs ?? TRANSCRIPT_PIPELINE_DEFAULTS.overlapMinMs,
    overlapMaxMs: options.chunk?.overlapMaxMs ?? TRANSCRIPT_PIPELINE_DEFAULTS.overlapMaxMs,
    ...(options.chunk?.searchMs === undefined ? {} : { searchMs: options.chunk.searchMs }),
  };
  const chunks = await step(chunkStage, {
    speech: speech.value.speech,
    cutSilences: speech.value.map.cut_silences,
    plan,
    workDir,
  });
  const tooLong = chunks.value.chunks.find((c) => c.end_ms - c.start_ms > provider.maxChunkSeconds * 1000);
  if (tooLong) {
    throw new HarnessError(
      "config",
      `청크 ${tooLong.index}(${Math.round((tooLong.end_ms - tooLong.start_ms) / 1000)}초)가 전사 공급자 ${provider.id}의 한도(${provider.maxChunkSeconds}초)를 넘습니다.`,
      { code: "chunk_too_long" },
    );
  }

  // transcribe, `concurrency` chunks at a time.
  const transcribe = transcribeStage(provider);
  const list = chunks.value.chunks;
  const outcomes: Array<StageResult<TranscribeResult> | HarnessError | undefined> = new Array(list.length);
  let next = 0;
  let fatal: HarnessError | null = null;
  const worker = async () => {
    while (fatal === null && next < list.length) {
      const i = next++;
      const chunk = list[i]!;
      const stageInput: TranscribeInput = {
        chunk,
        silences: chunkSilences(chunk, speech.value.map.cut_silences),
        language: input.language,
        speakersHint: input.speakersHint,
      };
      try {
        outcomes[i] = await step(transcribe, stageInput, i);
      } catch (err) {
        const error = err instanceof HarnessError ? err : classifyError(err);
        if (FATAL.has(error.kind)) {
          fatal ??= error;
          return;
        }
        outcomes[i] = error;
      }
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? TRANSCRIPT_PIPELINE_DEFAULTS.concurrency, list.length));
  await Promise.all(Array.from({ length: width }, worker));
  if (fatal) throw fatal;

  const chunkFailures: ChunkFailure[] = [];
  const results = outcomes.map((outcome, index) => {
    if (outcome instanceof HarnessError) {
      chunkFailures.push({ index, kind: outcome.kind, code: outcome.code, message: outcome.message });
      return null;
    }
    return { value: outcome!.value, sha256: outcome!.output.sha256 };
  });
  if (results.every((r) => r === null)) {
    const first = outcomes[0] as HarnessError;
    throw new HarnessError(first.kind, `전사에 성공한 구간이 없습니다: ${first.message}`, { cause: first, code: first.code });
  }

  const merged = await step(mergeStage, { chunks: chunks.value, results, speechMap: speech.value.map });
  const speakers = await step(speakersStage, { merged: merged.value, sha256: merged.output.sha256 });
  return {
    transcript: speakers.value,
    ingest: ingest.value,
    normalize: normalize.value,
    speechMap: speech.value,
    chunks: chunks.value,
    merged: merged.value,
    chunkFailures,
    stageRuns,
  };
}
