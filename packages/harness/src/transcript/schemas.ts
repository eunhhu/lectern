// Stage outputs of the transcript pipeline (AI_HARNESS §3.1–§3.5). They are stored as
// artifacts and read back on a memo hit, so every audio file is referenced by its blob
// sha256, never by a scratch path that a crash would leave dangling.
//
// The shapes mirror @lectern/media's types. They live here, not in @lectern/domain, until
// the domain owner adopts them (media hand-over: TimeMapEntry, SpeechMap, ChunkManifest).

import { GapKind, SpeakerLabel, TranscribeResult } from "@lectern/domain";
import { validateTimeMap } from "@lectern/media";
import { z } from "zod";

const Ms = z.number().nonnegative();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const Interval = z.object({ start_ms: Ms, end_ms: Ms });

/** An audio file in the blob store. */
export const BlobAudio = z.object({
  sha256: Sha256,
  bytes: z.int().nonnegative(),
  mime: z.string().min(1),
  duration_ms: Ms,
});
export type BlobAudio = z.infer<typeof BlobAudio>;

// ---------------------------------------------------------------------------
// ingest · normalize · speech_map · chunk
// ---------------------------------------------------------------------------

export const IngestOutput = z.object({
  sha256: Sha256,
  size_bytes: z.int().nonnegative(),
  format: z.string(),
  codec: z.string(),
  duration_ms: Ms,
  channels: z.int().nonnegative(),
  sample_rate: z.int().nonnegative(),
  /** ISO instant from the container metadata, when it had a zone (media parseCreationTime). */
  creation_time: z.string().nullable(),
  max_volume_db: z.number(),
});
export type IngestOutput = z.infer<typeof IngestOutput>;

export const NormalizeOutput = z.object({
  /** Lossless FLAC work copy, mono 16 kHz, original time. */
  audio: BlobAudio,
  integrated_lufs: z.number().nullable(),
  gain_db: z.number(),
});
export type NormalizeOutput = z.infer<typeof NormalizeOutput>;

export const TimeMapEntry = z.object({
  cut_start_ms: z.int().nonnegative(),
  orig_start_ms: z.int().nonnegative(),
  length_ms: z.int().positive(),
});

export const Cut = Interval.extend({ kind: z.enum(["break", "tail"]), speech_ms: Ms });

/** @lectern/media SpeechMap. */
export const SpeechMapValue = z.object({
  version: z.literal(1),
  rules: z.object({
    shortGapMs: Ms,
    islandJoinMs: Ms,
    anchorSpeechMs: Ms,
    edgeKeepMs: Ms,
    breakMinMs: Ms,
    tailMinMs: Ms,
    maxCutSpeechRatio: z.number().min(0).max(1),
    cutPadMs: Ms,
  }),
  duration_ms: Ms,
  cut_duration_ms: Ms,
  silences: z.array(Interval),
  speech: z.array(Interval),
  cuts: z.array(Cut),
  kept: z.array(Interval),
  time_map: z.array(TimeMapEntry).superRefine((map, ctx) => {
    try {
      validateTimeMap(map);
    } catch (err) {
      ctx.addIssue({ code: "custom", message: (err as Error).message });
    }
  }),
  cut_silences: z.array(Interval),
});
export type SpeechMapValue = z.infer<typeof SpeechMapValue>;

export const SpeechMapOutput = z.object({
  map: SpeechMapValue,
  /** The speech-only audio (cut time). The work copy itself when nothing was cut. */
  speech: BlobAudio,
  threshold: z.object({
    noise_db: z.number(),
    adaptive: z.boolean(),
    floor_db: z.number().nullable(),
    speech_db: z.number().nullable(),
  }),
});
export type SpeechMapOutput = z.infer<typeof SpeechMapOutput>;

const Overlap = Interval.extend({ seam_ms: Ms, seam_in_silence: z.boolean() });

/** A planned chunk (media ChunkSpec) stored as a blob. Cut-audio time. */
export const StoredChunk = Interval.extend({
  index: z.int().nonnegative(),
  core_start_ms: Ms,
  core_end_ms: Ms,
  overlap_prev: Overlap.nullable(),
  overlap_next: Overlap.nullable(),
  sha256: Sha256,
  bytes: z.int().nonnegative(),
  mime: z.string().min(1),
});
export type StoredChunk = z.infer<typeof StoredChunk>;

/** chunks.json (§3.3) with blob keys: media ChunkManifest, `path` replaced by `sha256`. */
export const ChunkOutput = z.object({
  version: z.literal(1),
  timebase: z.literal("cut"),
  cut_duration_ms: Ms,
  chunks: z.array(StoredChunk).min(1),
});
export type ChunkOutput = z.infer<typeof ChunkOutput>;

export { TranscribeResult };

// ---------------------------------------------------------------------------
// merge (§3.5)
// ---------------------------------------------------------------------------

export const TranscriptGapValue = Interval.extend({ kind: GapKind });
export type TranscriptGapValue = z.infer<typeof TranscriptGapValue>;

/** Chunk-local label pairs that said the same words in an overlap: the evidence `speakers` links on. */
export const SpeakerLink = z.object({ prev: SpeakerLabel, next: SpeakerLabel, chars: z.int().positive() });
export type SpeakerLink = z.infer<typeof SpeakerLink>;

export const SeamMethod = z.enum([
  "aligned", // the two chunks' texts were aligned in the overlap and spliced on a match
  "time", // no usable text match: each chunk kept what starts on its side of the seam
  "no_partner", // a neighbour failed for good: the surviving chunk kept all of its text
]);

export const MergeSeam = z.object({
  /** Seam between chunk `after_chunk` and the next one. */
  after_chunk: z.int().nonnegative(),
  method: SeamMethod,
  /** Local alignment score (0 unless aligned). */
  score: z.int().nonnegative(),
  /** Earlier chunk's time minus the later chunk's at the splice letter: its drift there (0 unless aligned). */
  drift_ms: z.int(),
  links: z.array(SpeakerLink),
});
export type MergeSeam = z.infer<typeof MergeSeam>;

export const MergedSegment = z.object({
  /** Original-audio time (the §3.2 invariant holds from here on). */
  start_ms: z.int().nonnegative(),
  end_ms: z.int().nonnegative(),
  /** Index of the chunk the text came from. */
  chunk: z.int().nonnegative(),
  /** Chunk-local label, unified by `speakers`. */
  speaker: SpeakerLabel,
  text: z.string().min(1),
});
export type MergedSegment = z.infer<typeof MergedSegment>;

export const MergedTranscript = z.object({
  version: z.literal(1),
  /** Length of the original (normalized) recording. */
  duration_ms: Ms,
  /** In reading order; position is the segment's idx. */
  segments: z.array(MergedSegment),
  /** Breaks and tail (speech_map) and failed chunks (missing_transcript), original time, sorted. */
  gaps: z.array(TranscriptGapValue),
  seams: z.array(MergeSeam),
  failed_chunks: z.array(z.int().nonnegative()),
});
export type MergedTranscript = z.infer<typeof MergedTranscript>;

// ---------------------------------------------------------------------------
// speakers (§3.5): the transcript as published
// ---------------------------------------------------------------------------

export const SpeakerMember = z.object({ chunk: z.int().nonnegative(), label: SpeakerLabel });

export const TranscriptSpeaker = z.object({
  /** Recording-wide label, numbered by first appearance. */
  label: SpeakerLabel,
  /** How sure the cross-chunk identity is (domain Speaker.confidence); 1 for a one-chunk recording. */
  confidence: z.number().min(0).max(1),
  /** What the label rests on: overlap text, the dominant-speaker rule, or nothing. */
  basis: z.enum(["single_chunk", "overlap", "continuity", "unlinked"]),
  segments: z.int().nonnegative(),
  chars: z.int().nonnegative(),
  members: z.array(SpeakerMember).min(1),
});
export type TranscriptSpeaker = z.infer<typeof TranscriptSpeaker>;

/** domain TranscriptSegment without the row keys (workspace, recording, speaker id). */
export const TranscriptSegmentValue = z.object({
  idx: z.int().nonnegative(),
  start_ms: z.int().nonnegative(),
  end_ms: z.int().nonnegative(),
  speaker: SpeakerLabel,
  text: z.string().min(1),
  source_chunk: z.int().nonnegative(),
});
export type TranscriptSegmentValue = z.infer<typeof TranscriptSegmentValue>;

export const Transcript = z.object({
  version: z.literal(1),
  duration_ms: Ms,
  segments: z.array(TranscriptSegmentValue),
  speakers: z.array(TranscriptSpeaker),
  gaps: z.array(TranscriptGapValue),
  failed_chunks: z.array(z.int().nonnegative()),
});
export type Transcript = z.infer<typeof Transcript>;
