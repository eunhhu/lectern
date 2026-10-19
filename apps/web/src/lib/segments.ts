// Transcript time lookups. Segments are ordered by `idx` and their times are
// original-audio milliseconds (packages/domain TranscriptSegment), so both lookups are
// binary searches. The player calls `findActiveSegment` on every animation frame.

export interface TimedSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
}

/** Index (array position) of the last segment that starts at or before `ms`, or -1. */
export function findLastStartedIndex(segments: readonly TimedSegment[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid]!.start_ms <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Array position of the segment playing at `ms`: the one containing it, or the previous
 * one for up to `holdMs` after it ended (short pauses between sentences keep the
 * highlight). Returns -1 before the first segment and inside longer gaps (breaks).
 */
export function findActiveSegment(segments: readonly TimedSegment[], ms: number, holdMs = 1500): number {
  const i = findLastStartedIndex(segments, ms);
  if (i < 0) return -1;
  return ms <= segments[i]!.end_ms + holdMs ? i : -1;
}

/** Array position of the segment with `idx`, or -1. */
export function findByIdx(segments: readonly TimedSegment[], idx: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const value = segments[mid]!.idx;
    if (value === idx) return mid;
    if (value < idx) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export interface ResolvedRange {
  /** Array positions of the first and last segment. */
  first: number;
  last: number;
  start_ms: number;
  end_ms: number;
}

/** A transcript SourceRef (`start_idx`..`end_idx`, inclusive) as positions and original-audio ms. */
export function resolveSourceRange(
  segments: readonly TimedSegment[],
  ref: { start_idx: number; end_idx: number },
): ResolvedRange | null {
  const first = findByIdx(segments, ref.start_idx);
  const last = findByIdx(segments, ref.end_idx);
  if (first < 0 || last < 0 || last < first) return null;
  return { first, last, start_ms: segments[first]!.start_ms, end_ms: segments[last]!.end_ms };
}
