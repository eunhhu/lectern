import { intervalLength, normalizeIntervals, type Interval } from "./intervals.ts";

// chunk (AI_HARNESS §3.3): where to split the speech-only audio. Pure; renderChunks() writes the files.
// Every time here is cut-audio time.

/** Bump when the planner's placement rules change, so memoised chunk plans are recomputed (§4.4). */
export const CHUNK_PLAN_VERSION = 1;

export const DEFAULT_OVERLAP_MIN_MS = 15_000;
export const DEFAULT_OVERLAP_MAX_MS = 30_000;

export interface ChunkPlanOptions {
  /**
   * Target chunk length. The audio is split evenly into ceil(duration / target)
   * chunks. `null` (or Infinity) keeps it whole: one chunk, no overlap
   * (dedicated STT up to the provider's maximum length).
   */
  targetMs: number | null;
  /** Shortest overlap between neighbouring chunks. Default 15 s. */
  overlapMinMs?: number;
  /** Longest overlap between neighbouring chunks. Default 30 s. */
  overlapMaxMs?: number;
  /** How far a seam may move from its even-split position to land in silence. Default targetMs / 10. */
  searchMs?: number;
}

/** Audio two neighbouring chunks share. */
export interface ChunkOverlap extends Interval {
  /** Where one chunk hands over to the next, inside the overlap. In silence unless `seam_in_silence` is false. */
  seam_ms: number;
  /** False when no silence was found near the even split and the seam is a hard cut. */
  seam_in_silence: boolean;
}

export interface ChunkSpec extends Interval {
  index: number;
  /** The seam-to-seam part this chunk is authoritative for. Cores tile `[0, duration)` exactly. */
  core_start_ms: number;
  core_end_ms: number;
  /** Shared with chunk `index - 1`, which holds the same object values as its `overlap_next`. */
  overlap_prev: ChunkOverlap | null;
  overlap_next: ChunkOverlap | null;
}

/**
 * Splits `[0, cutDurationMs)` into chunks. Seams sit in the longest silence
 * within `searchMs` of each even split; each neighbour pair overlaps by
 * `overlapMinMs..overlapMaxMs`, and the overlap edges also land in silence
 * when there is one. Chunk length is at most
 * `duration / n + 2 * searchMs + overlapMaxMs`.
 */
export function planChunks(cutDurationMs: number, cutSilences: readonly Interval[], options: ChunkPlanOptions): ChunkSpec[] {
  if (!Number.isSafeInteger(cutDurationMs) || cutDurationMs <= 0) {
    throw new RangeError("cutDurationMs must be a positive integer");
  }
  const target = options.targetMs ?? Infinity;
  if (!(target > 0)) throw new RangeError("targetMs must be positive or null");
  if (!Number.isFinite(target) || cutDurationMs <= target) {
    return [whole(cutDurationMs)];
  }

  const overlapMin = options.overlapMinMs ?? DEFAULT_OVERLAP_MIN_MS;
  const overlapMax = options.overlapMaxMs ?? DEFAULT_OVERLAP_MAX_MS;
  if (!(overlapMin >= 0 && overlapMin <= overlapMax)) throw new RangeError("need 0 <= overlapMinMs <= overlapMaxMs");
  if (target < 4 * overlapMax) throw new RangeError("targetMs must be at least 4 x overlapMaxMs");

  const count = Math.ceil(cutDurationMs / target);
  const span = cutDurationMs / count;
  // Keep neighbouring seams more than an overlap apart so chunks stay ordered.
  const search = Math.max(0, Math.min(options.searchMs ?? target / 10, (span - overlapMax) / 2 - 1));
  const silences = normalizeIntervals(cutSilences, cutDurationMs);
  const overlapMid = (overlapMin + overlapMax) / 2;

  const overlaps: ChunkOverlap[] = [];
  for (let k = 1; k < count; k++) {
    const nominal = k * span;
    const seam = pickBoundary(silences, nominal - search, nominal + search, nominal);
    const start = pickBoundary(silences, seam.ms - overlapMax / 2, seam.ms - overlapMin / 2, seam.ms - overlapMid / 2);
    const end = pickBoundary(silences, seam.ms + overlapMin / 2, seam.ms + overlapMax / 2, seam.ms + overlapMid / 2);
    overlaps.push({
      start_ms: Math.max(0, start.ms),
      end_ms: Math.min(cutDurationMs, end.ms),
      seam_ms: seam.ms,
      seam_in_silence: seam.inSilence,
    });
  }

  return Array.from({ length: count }, (_, index) => {
    const prev = overlaps[index - 1] ?? null;
    const next = overlaps[index] ?? null;
    return {
      index,
      start_ms: prev ? prev.start_ms : 0,
      end_ms: next ? next.end_ms : cutDurationMs,
      core_start_ms: prev ? prev.seam_ms : 0,
      core_end_ms: next ? next.seam_ms : cutDurationMs,
      overlap_prev: prev ? { ...prev } : null,
      overlap_next: next ? { ...next } : null,
    };
  });
}

function whole(durationMs: number): ChunkSpec {
  return {
    index: 0,
    start_ms: 0,
    end_ms: durationMs,
    core_start_ms: 0,
    core_end_ms: durationMs,
    overlap_prev: null,
    overlap_next: null,
  };
}

/**
 * The middle of the longest silence (clipped to `[lo, hi]`); ties go to the
 * one closer to `nominal`, then the earlier. Without silence there, `nominal`.
 */
function pickBoundary(silences: readonly Interval[], lo: number, hi: number, nominal: number): { ms: number; inSilence: boolean } {
  let best: { length: number; distance: number; mid: number } | null = null;
  for (const silence of silences) {
    if (silence.end_ms <= lo) continue;
    if (silence.start_ms >= hi) break;
    const clipped = { start_ms: Math.max(lo, silence.start_ms), end_ms: Math.min(hi, silence.end_ms) };
    const length = intervalLength(clipped);
    const mid = (clipped.start_ms + clipped.end_ms) / 2;
    const distance = Math.abs(mid - nominal);
    if (!best || length > best.length || (length === best.length && distance < best.distance)) {
      best = { length, distance, mid };
    }
  }
  return best ? { ms: Math.round(best.mid), inSilence: true } : { ms: Math.round(nominal), inSilence: false };
}
