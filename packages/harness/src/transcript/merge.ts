// merge (AI_HARNESS §3.5): per-chunk transcriptions → one transcript in original-audio time.
//
// 1. Overlaps. Neighbouring chunks share 15–30 s of audio, so both transcribe it. At each
//    seam the two texts are aligned character by character (Smith–Waterman on letters and
//    digits) in a window around the shared audio, and the transcript is spliced at one
//    agreeing letter: the earlier chunk's text up to it, the later chunk's text from it.
//    The window reaches `driftTolMs` before the overlap on the earlier side because LLM
//    timestamps drift within a chunk (§3.3); the later chunk's early timestamps are fresh,
//    so the splice point is chosen by them. Without a usable match (silence in the overlap,
//    or two hearings that disagree) each chunk keeps the segments that start on its side
//    of the seam, which sits in silence.
//    The splice letter has a time in both chunks; their difference is the earlier chunk's
//    drift there. Drift accumulates from the chunk start, so that chunk's timeline is
//    rescaled linearly to agree with the later chunk at the splice (within
//    `maxRescale`; a larger disagreement is left alone and only recorded in `drift_ms`).
// 2. Time. Chunk-relative cut-audio times become absolute cut times, then original-audio
//    times through the speech_map time map. This is the one place that happens (§3.2
//    invariant); everything downstream is original time. A segment that straddles a cut is
//    clipped to the side holding most of it, so no segment spans a removed break.
// 3. Gaps. Breaks and the tail come from speech_map as they are. A chunk that failed for
//    good becomes a "missing_transcript" gap over the audio no neighbour transcribed,
//    mapped piece by piece so it never covers a break.
// 4. Normalization. Segments longer than `maxSegmentMs` are split at sentence boundaries;
//    whitespace is tidied.
//
// Pure and deterministic: the same inputs always give the same transcript.

import type { TranscribeResult } from "@lectern/domain";
import { toOriginalMs, toOriginalRanges, type ChunkSpec, type Interval, type TimeMap } from "@lectern/media";
import { localAlign } from "./align.ts";
import type { MergedSegment, MergedTranscript, MergeSeam, SpeakerLink, TranscriptGapValue } from "./schemas.ts";
import { cleanText, normalizeForMatch, sliceNormalized, splitSentences, type NormalizedText } from "./text.ts";

/** Bump with any rule change below (it is the merge stage's code version). */
export const MERGE_VERSION = 1;

export const MERGE_DEFAULTS = Object.freeze({
  /** How far before the overlap the earlier chunk's copy of the shared audio may sit. */
  driftTolMs: 60_000,
  /** How far past the overlap the later chunk's window reaches. */
  headTolMs: 10_000,
  /** Local alignment score a splice needs (match 2, mismatch -1, gap -1: about 8 agreeing letters net). */
  minScore: 16,
  /** A splice lands only inside a run of this many consecutive agreeing letters. */
  anchorRun: 3,
  /** Letters per side the aligner looks at (the window is cut from the far end). */
  maxWindowChars: 4_000,
  /** Splice cost added when it would split a later-chunk segment, then an earlier-chunk one (ms-equivalent). */
  splitPenaltyLaterMs: 3_000,
  splitPenaltyEarlierMs: 1_500,
  /** Longer segments are split at sentence boundaries (§3.5). */
  maxSegmentMs: 30_000,
  /** Largest drift correction: an earlier chunk's timeline is stretched or shrunk by at most this share. */
  maxRescale: 0.25,
  /** No rescaling when the splice is closer than this to the chunk start (too short a baseline). */
  minRescaleBaseMs: 30_000,
});
export type MergeOptions = typeof MERGE_DEFAULTS;

export interface MergeInput {
  /** The chunk plan (cut-audio time), in index order. */
  chunks: readonly ChunkSpec[];
  /** By chunk index: the transcription, or null for a chunk that failed for good. */
  results: ReadonlyArray<TranscribeResult | null>;
  /** speech_map time map (cut → original). */
  timeMap: TimeMap;
  /** speech_map cuts (original time): the break and tail gaps. */
  cuts: ReadonlyArray<Interval & { kind: "break" | "tail" }>;
  /** Length of the original recording. */
  durationMs: number;
}

interface Work {
  chunk: number;
  speaker: string;
  text: string;
  norm: NormalizedText;
  /** Absolute cut-audio time of the whole segment as the provider placed it. */
  start: number;
  end: number;
  /** Kept range of `norm.chars`; empty (from >= to) means dropped. */
  from: number;
  to: number;
}

interface Piece {
  chunk: number;
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export function mergeTranscripts(input: MergeInput, overrides: Partial<MergeOptions> = {}): MergedTranscript {
  const options = { ...MERGE_DEFAULTS, ...overrides };
  const { chunks, results } = input;
  if (chunks.length === 0) throw new RangeError("merge needs at least one chunk");
  if (results.length !== chunks.length) throw new RangeError(`${results.length} results for ${chunks.length} chunks`);
  chunks.forEach((chunk, i) => {
    if (chunk.index !== i) throw new RangeError(`chunk ${i} has index ${chunk.index}`);
  });

  const work = chunks.map((chunk, k) => workSegments(chunk, k, results[k] ?? null));
  const seams: MergeSeam[] = [];
  const scale = chunks.map(() => 1);
  for (let k = 0; k + 1 < chunks.length; k++) {
    const { seam, factor } = spliceSeam(k, chunks[k]!, work[k]!, work[k + 1]!, results[k] != null && results[k + 1] != null, options);
    seams.push(seam);
    scale[k] = factor;
  }

  const pieces = keptPieces(work, chunks, scale);
  clampAcrossChunks(pieces);
  const segments = pieces
    .map((p) => toOriginalSegment(p, input.timeMap))
    .flatMap((s) => splitLong(s, options.maxSegmentMs))
    .sort((a, b) => a.start_ms - b.start_ms);

  return {
    version: 1,
    duration_ms: input.durationMs,
    segments,
    gaps: gaps(input),
    seams,
    failed_chunks: results.flatMap((r, k) => (r ? [] : [k])),
  };
}

function workSegments(chunk: ChunkSpec, k: number, result: TranscribeResult | null): Work[] {
  if (!result) return [];
  const length = chunk.end_ms - chunk.start_ms;
  const clamp = (ms: number) => chunk.start_ms + Math.min(Math.max(0, ms), length);
  const out: Work[] = [];
  for (const seg of result.segments) {
    const text = cleanText(seg.text);
    const norm = normalizeForMatch(text);
    if (norm.chars.length === 0) continue;
    const start = clamp(seg.start_ms);
    out.push({ chunk: k, speaker: seg.speaker, text, norm, start, end: Math.max(start, clamp(seg.end_ms)), from: 0, to: norm.chars.length });
  }
  return out;
}

const kept = (w: Work) => w.to > w.from;

/**
 * Decides which copy of the shared audio survives at the seam after chunk `k`; trims `a`
 * and `b` in place. `factor` rescales chunk `k`'s chunk-relative times (1: unchanged).
 */
function spliceSeam(
  k: number,
  chunk: ChunkSpec,
  a: Work[],
  b: Work[],
  bothOk: boolean,
  options: MergeOptions,
): { seam: MergeSeam; factor: number } {
  if (!bothOk) return { seam: { after_chunk: k, method: "no_partner", score: 0, drift_ms: 0, links: [] }, factor: 1 };
  const overlap = chunk.overlap_next ?? { start_ms: chunk.core_end_ms, end_ms: chunk.core_end_ms, seam_ms: chunk.core_end_ms };
  const seam = overlap.seam_ms;

  // Windows: a suffix of the earlier chunk, a prefix of the later one, kept text only.
  let aFirst = a.findIndex((w) => w.end > overlap.start_ms - options.driftTolMs);
  if (aFirst < 0) aFirst = a.length;
  let bEnd = b.findIndex((w) => w.start >= overlap.end_ms + options.headTolMs);
  if (bEnd < 0) bEnd = b.length;
  const aWin = capWindow(a.slice(aFirst).filter(kept), options.maxWindowChars, "end");
  const bWin = capWindow(b.slice(0, bEnd).filter(kept), options.maxWindowChars, "start");

  const sa: string[] = [];
  const pa: Array<[Work, number]> = [];
  for (const w of aWin) for (let c = w.from; c < w.to; c++) (sa.push(w.norm.chars[c]!), pa.push([w, c]));
  const sb: string[] = [];
  const pb: Array<[Work, number]> = [];
  for (const w of bWin) for (let c = w.from; c < w.to; c++) (sb.push(w.norm.chars[c]!), pb.push([w, c]));

  const alignment = localAlign(sa, sb);
  if (alignment && alignment.score >= options.minScore) {
    const anchored = anchoredPairs(alignment.pairs, options.anchorRun);
    let best: { i: number; j: number; cost: number } | null = null;
    for (const [i, j] of anchored) {
      const [wb, cb] = pb[j]!;
      const [wa, ca] = pa[i]!;
      const atB = timeAt(wb, cb);
      const cost =
        Math.abs(atB - seam) +
        (cb === wb.from ? 0 : options.splitPenaltyLaterMs) +
        (ca === wa.from ? 0 : options.splitPenaltyEarlierMs);
      if (!best || cost < best.cost) best = { i, j, cost };
    }
    if (best) {
      const [wa, ca] = pa[best.i]!;
      const [wb, cb] = pb[best.j]!;
      const atA = timeAt(wa, ca);
      const atB = timeAt(wb, cb);
      const ai = aWin.indexOf(wa);
      wa.to = Math.min(wa.to, ca);
      for (const w of aWin.slice(ai + 1)) w.to = w.from;
      const bi = bWin.indexOf(wb);
      for (const w of bWin.slice(0, bi)) w.to = w.from;
      wb.from = Math.max(wb.from, cb);
      const base = atA - chunk.start_ms;
      const ratio = base > 0 ? (atB - chunk.start_ms) / base : 1;
      const factor =
        base >= options.minRescaleBaseMs && Math.abs(ratio - 1) <= options.maxRescale ? ratio : 1;
      return {
        seam: {
          after_chunk: k,
          method: "aligned",
          score: alignment.score,
          drift_ms: Math.round(atA - atB),
          links: links(alignment.pairs, pa, pb),
        },
        factor,
      };
    }
  }

  // No usable match: the seam sits in silence, so each side keeps what starts on its side.
  for (const w of aWin) if (w.start >= seam) w.to = w.from;
  for (const w of bWin) if (w.start < seam) w.to = w.from;
  return { seam: { after_chunk: k, method: "time", score: 0, drift_ms: 0, links: [] }, factor: 1 };
}

/** Time of normalized letter `c` of `w`, interpolated over the segment by letter count. */
function timeAt(w: Work, c: number): number {
  return w.start + ((w.end - w.start) * c) / w.norm.chars.length;
}

/** Keeps whole segments from the far end until `maxChars` letters ("end": keep the last ones). */
function capWindow(win: Work[], maxChars: number, keep: "start" | "end"): Work[] {
  const ordered = keep === "end" ? [...win].reverse() : win;
  const out: Work[] = [];
  let total = 0;
  for (const w of ordered) {
    total += w.to - w.from;
    if (total > maxChars && out.length > 0) break;
    out.push(w);
  }
  return keep === "end" ? out.reverse() : out;
}

/** Pairs inside a run of at least `run` consecutive agreeing letters. */
function anchoredPairs(pairs: ReadonlyArray<[number, number]>, run: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  for (let p = 1; p <= pairs.length; p++) {
    const continues =
      p < pairs.length && pairs[p]![0] === pairs[p - 1]![0] + 1 && pairs[p]![1] === pairs[p - 1]![1] + 1;
    if (continues) continue;
    if (p - start >= run) out.push(...pairs.slice(start, p));
    start = p;
  }
  return out;
}

/** Letters each (earlier label, later label) pair agreed on: the evidence `speakers` links chunks with. */
function links(pairs: ReadonlyArray<[number, number]>, pa: Array<[Work, number]>, pb: Array<[Work, number]>): SpeakerLink[] {
  const counts = new Map<string, SpeakerLink>();
  for (const [i, j] of pairs) {
    const prev = pa[i]![0].speaker;
    const next = pb[j]![0].speaker;
    const key = `${prev}\u0000${next}`;
    const link = counts.get(key);
    if (link) link.chars++;
    else counts.set(key, { prev, next, chars: 1 });
  }
  return [...counts.values()].sort(
    (x, y) => y.chars - x.chars || x.prev.localeCompare(y.prev) || x.next.localeCompare(y.next),
  );
}

function keptPieces(work: Work[][], chunks: readonly ChunkSpec[], scale: readonly number[]): Piece[] {
  const pieces: Piece[] = [];
  work.forEach((list, k) => {
    const origin = chunks[k]!.start_ms;
    const length = chunks[k]!.end_ms - origin;
    const rescale = (t: number) => origin + Math.min(length, Math.round((t - origin) * scale[k]!));
    for (const w of list) {
      if (!kept(w)) continue;
      const n = w.norm.chars.length;
      const whole = w.from === 0 && w.to === n;
      const text = whole ? w.text : sliceNormalized(w.text, w.norm, w.from, w.to);
      if (!text) continue;
      pieces.push({
        chunk: w.chunk,
        speaker: w.speaker,
        text,
        start: rescale(timeAt(w, w.from)),
        end: rescale(timeAt(w, w.to)),
      });
    }
  });
  return pieces;
}

/**
 * Where one chunk's text gives way to the next, the earlier chunk's drifted timestamps may
 * run past the later chunk's fresh ones. Its pieces are pulled back so nothing ends after
 * the next chunk's first piece starts: reading order and time order agree again.
 */
function clampAcrossChunks(pieces: Piece[]): void {
  for (let p = 1; p < pieces.length; p++) {
    if (pieces[p]!.chunk === pieces[p - 1]!.chunk) continue;
    const t = pieces[p]!.start;
    for (let q = p - 1; q >= 0 && (pieces[q]!.start > t || pieces[q]!.end > t); q--) {
      pieces[q]!.start = Math.min(pieces[q]!.start, t);
      pieces[q]!.end = Math.min(pieces[q]!.end, t);
    }
  }
}

/** The single cut → original mapping of the pipeline (§3.2 invariant). */
function toOriginalSegment(p: Piece, timeMap: TimeMap): MergedSegment {
  const ranges = toOriginalRanges({ start_ms: p.start, end_ms: p.end }, timeMap);
  let start: number;
  let end: number;
  if (ranges.length === 0) {
    start = end = toOriginalMs(p.start, timeMap, "start"); // zero-length, or past the cut audio
  } else {
    // Straddling a cut: keep the side that holds most of the segment (ties: the earlier).
    let best = ranges[0]!;
    for (const r of ranges) if (r.cut_length_ms > best.cut_length_ms) best = r;
    start = best.start_ms;
    end = best.end_ms;
  }
  return { start_ms: start, end_ms: Math.max(start, end), chunk: p.chunk, speaker: p.speaker, text: p.text };
}

/** Splits a segment longer than `maxMs` at sentence boundaries, timing pieces by letter count. */
function splitLong(seg: MergedSegment, maxMs: number): MergedSegment[] {
  const duration = seg.end_ms - seg.start_ms;
  if (duration <= maxMs) return [seg];
  const sentences = splitSentences(seg.text);
  if (sentences.length < 2) return [seg];
  const weights = sentences.map((t) => Math.max(1, normalizeForMatch(t).chars.length));
  const total = weights.reduce((x, y) => x + y, 0);
  const groups: Array<{ text: string[]; weight: number }> = [];
  for (let i = 0; i < sentences.length; i++) {
    const last = groups.at(-1);
    if (last && ((last.weight + weights[i]!) / total) * duration <= maxMs) {
      last.text.push(sentences[i]!);
      last.weight += weights[i]!;
    } else {
      groups.push({ text: [sentences[i]!], weight: weights[i]! });
    }
  }
  if (groups.length < 2) return [seg];
  let acc = 0;
  return groups.map((g) => {
    const start = seg.start_ms + Math.round((duration * acc) / total);
    acc += g.weight;
    const end = seg.start_ms + Math.round((duration * acc) / total);
    return { ...seg, start_ms: start, end_ms: end, text: g.text.join(" ") };
  });
}

function gaps(input: MergeInput): TranscriptGapValue[] {
  const { chunks, results, timeMap } = input;
  const out: TranscriptGapValue[] = input.cuts.map((c) => ({ kind: c.kind, start_ms: c.start_ms, end_ms: c.end_ms }));
  const missing: Interval[] = [];
  results.forEach((result, k) => {
    if (result) return;
    const chunk = chunks[k]!;
    // The audio no surviving neighbour transcribed: a neighbour that succeeded kept its whole overlap.
    const from = k > 0 && results[k - 1] ? chunks[k - 1]!.end_ms : chunk.core_start_ms;
    const to = k + 1 < chunks.length && results[k + 1] ? chunks[k + 1]!.start_ms : chunk.core_end_ms;
    for (const r of toOriginalRanges({ start_ms: from, end_ms: to }, timeMap)) {
      const last = missing.at(-1);
      if (last && last.end_ms === r.start_ms) last.end_ms = r.end_ms;
      else missing.push({ start_ms: r.start_ms, end_ms: r.end_ms });
    }
  });
  for (const m of missing) out.push({ kind: "missing_transcript", ...m });
  return out.sort((x, y) => x.start_ms - y.start_ms || x.end_ms - y.end_ms);
}
