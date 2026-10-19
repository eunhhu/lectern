/**
 * Half-open millisecond range `[start_ms, end_ms)`. Whether it is original-audio
 * or cut-audio time is stated by whoever holds it (AI_HARNESS §3.2).
 */
export interface Interval {
  start_ms: number;
  end_ms: number;
}

export function intervalLength(interval: Interval): number {
  return interval.end_ms - interval.start_ms;
}

/** Clips to `[0, durationMs]`, drops empty ranges, sorts, and merges overlapping or touching ones. */
export function normalizeIntervals(intervals: readonly Interval[], durationMs: number): Interval[] {
  const clipped = intervals
    .map((i) => ({ start_ms: Math.max(0, i.start_ms), end_ms: Math.min(durationMs, i.end_ms) }))
    .filter((i) => i.end_ms > i.start_ms)
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const merged: Interval[] = [];
  for (const interval of clipped) {
    const last = merged.at(-1);
    if (last && interval.start_ms <= last.end_ms) {
      last.end_ms = Math.max(last.end_ms, interval.end_ms);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** The parts of `[0, durationMs]` not covered by `intervals` (which must be normalized). */
export function complementIntervals(intervals: readonly Interval[], durationMs: number): Interval[] {
  const out: Interval[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    if (interval.start_ms > cursor) out.push({ start_ms: cursor, end_ms: interval.start_ms });
    cursor = Math.max(cursor, interval.end_ms);
  }
  if (cursor < durationMs) out.push({ start_ms: cursor, end_ms: durationMs });
  return out;
}

/** Total length of `intervals` (sorted, non-overlapping) that falls inside `range`. */
export function coveredMs(intervals: readonly Interval[], range: Interval): number {
  let total = 0;
  for (const interval of intervals) {
    if (interval.start_ms >= range.end_ms) break;
    const start = Math.max(interval.start_ms, range.start_ms);
    const end = Math.min(interval.end_ms, range.end_ms);
    if (end > start) total += end - start;
  }
  return total;
}
