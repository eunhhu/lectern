// The transcript pipeline's stages (AI_HARNESS §2, §3.1–§3.5) on the runner (runner.ts):
//
//   ingest → normalize → speech_map → chunk → transcribe (per chunk) → merge → speakers
//
// Every audio file a stage makes is stored with ctx.putArtifactFile and passed on by its
// blob sha256; the next stage reads ctx.blobs.path(sha256). A memo hit after a crash then
// still finds its files (scratch directories do not survive), and equal inputs share one
// blob. All stages memoize per workspace ("shared"): the same upload in the same workspace
// is never normalized, cut or transcribed twice. Keys hold the content hashes of inputs,
// the code and rule versions, and for transcribe the prompt file hash, provider, model and
// request parameters (§4.4).

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildSpeechMap,
  CHUNK_PLAN_VERSION,
  detectSilences,
  MediaError,
  NORMALIZE_DEFAULTS,
  NORMALIZE_VERSION,
  normalizeAudio,
  planChunks,
  renderChunks,
  renderSpeechAudio,
  resolveSpeechMapRules,
  SCREEN_DEFAULTS,
  screenAudio,
  SILENCE_DEFAULTS,
  SPEECH_MAP_VERSION,
  TRANSCRIBE_ENCODING,
  type AudioEncoding,
  type Interval,
  type SpeechMapRules,
} from "@lectern/media";
import { classifyError, HarnessError } from "../errors.ts";
import { canonicalJson, hashFile, sha256Hex } from "../hash.ts";
import type { TranscriptionProvider } from "../providers.ts";
import { defineStage, type StageDefinition } from "../stage.ts";
import { MERGE_DEFAULTS, MERGE_VERSION, mergeTranscripts } from "./merge.ts";
import {
  ChunkOutput,
  IngestOutput,
  MergedTranscript,
  NormalizeOutput,
  SpeechMapOutput,
  Transcript,
  TranscribeResult,
  type BlobAudio,
  type SpeechMapValue,
  type StoredChunk,
} from "./schemas.ts";
import { SPEAKER_DEFAULTS, SPEAKERS_VERSION, unifySpeakers } from "./speakers.ts";
import { checkTranscription } from "./validate.ts";

/**
 * Media failures by class: rejected or unreadable audio is the user's input; a missing
 * ffmpeg is configuration; an ffmpeg crash is retried once (the stages allow 2 attempts),
 * then fails the run.
 */
export function classifyMediaError(err: unknown): HarnessError {
  if (err instanceof MediaError) {
    const kind = err.code === "ffmpeg_missing" ? "config" : err.code === "ffmpeg_failed" ? "transient" : "input";
    return new HarnessError(kind, err.message, { cause: err, code: err.code });
  }
  return classifyError(err);
}

const MEDIA_RETRY = { maxAttempts: 2, repairs: 0 } as const;

/** A fresh scratch directory under `workDir`, removed after `fn` however it ends. */
async function withScratch<T>(workDir: string, stage: string, fn: (dir: string) => Promise<T>): Promise<T> {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(workDir, `${stage}-`));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hashJson = (value: unknown) => sha256Hex(canonicalJson(value));

// ---------------------------------------------------------------------------
// ingest · normalize · speech_map · chunk
// ---------------------------------------------------------------------------

export interface IngestInput {
  /** The upload as stored by the server. Read only, never copied into the blob store. */
  audioPath: string;
}

export const ingestStage: StageDefinition<IngestInput, IngestOutput> = defineStage({
  name: "ingest",
  version: 1,
  output: IngestOutput,
  memo: "shared",
  retry: MEDIA_RETRY,
  classify: classifyMediaError,
  async key(input: IngestInput) {
    if (!existsSync(input.audioPath)) throw new HarnessError("input", `Audio file not found: ${input.audioPath}`);
    return { inputs: [await hashFile(input.audioPath)], config: { screen: SCREEN_DEFAULTS } };
  },
  async run(input, ctx) {
    const verdict = await screenAudio(input.audioPath, { signal: ctx.signal });
    if (!verdict.ok) throw new HarnessError("input", verdict.message, { code: verdict.code });
    const p = verdict.probe;
    return {
      sha256: p.sha256,
      size_bytes: p.size_bytes,
      format: p.format,
      codec: p.codec,
      duration_ms: p.duration_ms,
      channels: p.channels,
      sample_rate: p.sample_rate,
      creation_time: p.creation_time,
      max_volume_db: verdict.max_volume_db,
    };
  },
});

export interface NormalizeInput {
  audioPath: string;
  /** From ingest: the memo key, so the upload is not hashed again. */
  sha256: string;
  workDir: string;
}

export const normalizeStage: StageDefinition<NormalizeInput, NormalizeOutput> = defineStage({
  name: "normalize",
  version: 1,
  output: NormalizeOutput,
  memo: "shared",
  retry: MEDIA_RETRY,
  classify: classifyMediaError,
  key: (input: NormalizeInput) => ({ inputs: [input.sha256], config: { version: NORMALIZE_VERSION, ...NORMALIZE_DEFAULTS } }),
  run: (input, ctx) =>
    withScratch(input.workDir, "normalize", async (dir) => {
      const norm = await normalizeAudio(input.audioPath, join(dir, "work.flac"), { signal: ctx.signal });
      const ref = await ctx.putArtifactFile("audio_work", norm.path);
      return {
        audio: { sha256: ref.sha256, bytes: ref.bytes, mime: "audio/flac", duration_ms: norm.duration_ms },
        integrated_lufs: norm.integrated_lufs,
        gain_db: norm.gain_db,
      };
    }),
});

export interface SpeechMapInput {
  audio: BlobAudio;
  workDir: string;
  rules?: Partial<SpeechMapRules>;
  /** Silence threshold (default: media's fixed -35 dBFS; "auto" adapts to the noise floor). */
  noiseDb?: number | "auto";
}

export const speechMapStage: StageDefinition<SpeechMapInput, SpeechMapOutput> = defineStage({
  name: "speech_map",
  version: 1,
  output: SpeechMapOutput,
  memo: "shared",
  retry: MEDIA_RETRY,
  classify: classifyMediaError,
  key: (input: SpeechMapInput) => ({
    inputs: [input.audio.sha256],
    config: {
      version: SPEECH_MAP_VERSION,
      rules: resolveSpeechMapRules(input.rules),
      noiseDb: input.noiseDb ?? SILENCE_DEFAULTS.noiseDb,
    },
  }),
  async run(input, ctx) {
    const source = ctx.blobs.path(input.audio.sha256);
    const detected = await detectSilences(source, {
      durationMs: input.audio.duration_ms,
      noiseDb: input.noiseDb,
      signal: ctx.signal,
    });
    const map = buildSpeechMap(detected, input.rules);
    // Nothing cut: the work copy already is the speech-only audio (no second copy on disk).
    const speech: BlobAudio =
      map.cuts.length === 0
        ? input.audio
        : await withScratch(input.workDir, "speech_map", async (dir) => {
            const rendered = await renderSpeechAudio(source, map.time_map, join(dir, "speech.flac"), { signal: ctx.signal });
            const ref = await ctx.putArtifactFile("audio_speech", rendered.path);
            return { sha256: ref.sha256, bytes: ref.bytes, mime: rendered.mime, duration_ms: rendered.duration_ms };
          });
    return { map, speech, threshold: detected.threshold };
  },
});

export interface ChunkPlanConfig {
  /** Target length (LLM transcription: 5–8 min), or null for one whole chunk (dedicated STT). */
  targetMs: number | null;
  overlapMinMs?: number;
  overlapMaxMs?: number;
  searchMs?: number;
}

export interface ChunkInput {
  speech: BlobAudio;
  /** speech_map's cut_silences: boundary candidates. */
  cutSilences: Interval[];
  plan: ChunkPlanConfig;
  /** Default: AAC 32 kbps (media TRANSCRIBE_ENCODING). */
  encoding?: AudioEncoding;
  workDir: string;
}

export const chunkStage: StageDefinition<ChunkInput, ChunkOutput> = defineStage({
  name: "chunk",
  version: 1,
  output: ChunkOutput,
  memo: "shared",
  retry: MEDIA_RETRY,
  classify: classifyMediaError,
  key: (input: ChunkInput) => ({
    inputs: [input.speech.sha256, hashJson(input.cutSilences)],
    config: {
      version: CHUNK_PLAN_VERSION,
      cutDurationMs: input.speech.duration_ms,
      plan: input.plan,
      encoding: input.encoding ?? TRANSCRIBE_ENCODING,
    },
  }),
  run: (input, ctx) =>
    withScratch(input.workDir, "chunk", async (dir) => {
      const plan = planChunks(input.speech.duration_ms, input.cutSilences, input.plan);
      const manifest = await renderChunks(ctx.blobs.path(input.speech.sha256), plan, dir, {
        encoding: input.encoding,
        signal: ctx.signal,
      });
      const chunks: StoredChunk[] = [];
      for (const { path, ...chunk } of manifest.chunks) {
        const ref = await ctx.putArtifactFile("audio_chunk", path);
        chunks.push({ ...chunk, sha256: ref.sha256, bytes: ref.bytes });
      }
      return { version: 1, timebase: "cut", cut_duration_ms: manifest.cut_duration_ms, chunks };
    }),
});

// ---------------------------------------------------------------------------
// transcribe (§3.4)
// ---------------------------------------------------------------------------

export interface TranscribeInput {
  chunk: StoredChunk;
  /** Silences inside the chunk, chunk-relative: what the coverage check measures against. */
  silences: Interval[];
  language?: string;
  speakersHint?: number;
}

/** Silences of the speech-only audio that fall inside `chunk`, shifted to chunk-relative time. */
export function chunkSilences(chunk: Interval, cutSilences: readonly Interval[]): Interval[] {
  return cutSilences
    .filter((s) => s.end_ms > chunk.start_ms && s.start_ms < chunk.end_ms)
    .map((s) => ({
      start_ms: Math.max(s.start_ms, chunk.start_ms) - chunk.start_ms,
      end_ms: Math.min(s.end_ms, chunk.end_ms) - chunk.start_ms,
    }));
}

/**
 * One chunk through `provider`. The answer must pass checkTranscription (§3.4); a failing
 * answer gets one repair attempt with the issues in the prompt, then the run fails and the
 * pipeline marks the chunk as missing. The output is the domain TranscribeResult, which
 * depends on the audio alone, so a memo hit serves the same chunk audio anywhere in the
 * workspace. The checks are not in the key: a stored success stays valid.
 */
export function transcribeStage(provider: TranscriptionProvider): StageDefinition<TranscribeInput, TranscribeResult> {
  return defineStage({
    name: "transcribe",
    version: 1,
    output: TranscribeResult,
    memo: "shared",
    retry: { maxAttempts: 4, repairs: 1 },
    key: (input: TranscribeInput) => ({
      inputs: [input.chunk.sha256],
      prompt: provider.fingerprint.prompt,
      provider: provider.id,
      model: provider.model,
      params: { ...(provider.fingerprint.params as object), mime: input.chunk.mime },
      config: { language: input.language ?? null, speakersHint: input.speakersHint ?? null },
    }),
    async run(input, ctx) {
      const { sha256, ...chunk } = input.chunk;
      const answer = await ctx.meter({ provider: provider.id, model: provider.model }, () =>
        provider.transcribe(
          { ...chunk, path: ctx.blobs.path(sha256) },
          { language: input.language, speakersHint: input.speakersHint, signal: ctx.signal, repair: ctx.repair },
        ),
      );
      const result: TranscribeResult = {
        segments: answer.segments,
        ...(answer.language ? { language: answer.language } : {}),
      };
      const issues = checkTranscription(result, {
        durationMs: chunk.end_ms - chunk.start_ms,
        silences: input.silences,
        language: input.language,
      });
      if (issues.length > 0) {
        throw new HarnessError("output_validation", `chunk ${chunk.index} transcription failed checks: ${issues.join("; ")}`, {
          code: "transcript_check",
        });
      }
      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// merge · speakers (§3.5)
// ---------------------------------------------------------------------------

export interface MergeStageInput {
  chunks: ChunkOutput;
  /** By chunk index: the transcribe output and its artifact sha256, or null for a chunk that failed for good. */
  results: Array<{ value: TranscribeResult; sha256: string } | null>;
  speechMap: SpeechMapValue;
}

export const mergeStage: StageDefinition<MergeStageInput, MergedTranscript> = defineStage({
  name: "merge",
  version: MERGE_VERSION,
  output: MergedTranscript,
  memo: "shared",
  key: (input: MergeStageInput) => ({
    inputs: input.results.flatMap((r) => (r ? [r.sha256] : [])),
    config: {
      chunks: hashJson(input.chunks),
      map: hashJson({ time_map: input.speechMap.time_map, cuts: input.speechMap.cuts, duration_ms: input.speechMap.duration_ms }),
      results: input.results.map((r) => r?.sha256 ?? null),
      options: MERGE_DEFAULTS,
    },
  }),
  async run(input) {
    return mergeTranscripts({
      chunks: input.chunks.chunks,
      results: input.results.map((r) => r?.value ?? null),
      timeMap: input.speechMap.time_map,
      cuts: input.speechMap.cuts,
      durationMs: input.speechMap.duration_ms,
    });
  },
});

export interface SpeakersStageInput {
  merged: MergedTranscript;
  /** The merge output artifact's sha256. */
  sha256: string;
}

export const speakersStage: StageDefinition<SpeakersStageInput, Transcript> = defineStage({
  name: "speakers",
  version: SPEAKERS_VERSION,
  output: Transcript,
  memo: "shared",
  key: (input: SpeakersStageInput) => ({ inputs: [input.sha256], config: { options: SPEAKER_DEFAULTS } }),
  async run(input) {
    return unifySpeakers(input.merged);
  },
});
