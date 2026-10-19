import type { Interval } from "./intervals.ts";

/**
 * One kept stretch of the original audio, placed in the speech-only ("cut")
 * audio. Entries are contiguous in cut time and increasing in original time;
 * what lies between two entries' original ranges was cut (AI_HARNESS §3.2).
 */
export interface TimeMapEntry {
  cut_start_ms: number;
  orig_start_ms: number;
  length_ms: number;
}

export type TimeMap = readonly TimeMapEntry[];

/**
 * Which side of an entry boundary a cut-audio instant belongs to. A segment
 * start that falls exactly on a boundary belongs to the following entry
 * ("start"); a segment end there belongs to the preceding one ("end"), so a
 * segment that stops at a cut never stretches across the removed break.
 */
export type TimeEdge = "start" | "end";

/** Builds the time map for kept original ranges (sorted, non-overlapping, non-empty). */
export function buildTimeMap(kept: readonly Interval[]): TimeMapEntry[] {
  const map: TimeMapEntry[] = [];
  let cursor = 0;
  for (const range of kept) {
    const length = range.end_ms - range.start_ms;
    if (length <= 0) continue;
    const last = map.at(-1);
    if (last && last.orig_start_ms + last.length_ms === range.start_ms) {
      last.length_ms += length; // adjacent in original time too: nothing was cut between them
    } else {
      map.push({ cut_start_ms: cursor, orig_start_ms: range.start_ms, length_ms: length });
    }
    cursor += length;
  }
  return map;
}

/** Length of the speech-only audio the map describes. */
export function cutDurationMs(timeMap: TimeMap): number {
  const last = timeMap.at(-1);
  return last ? last.cut_start_ms + last.length_ms : 0;
}

/** Original ranges the map keeps. */
export function keptOriginalRanges(timeMap: TimeMap): Interval[] {
  return timeMap.map((e) => ({ start_ms: e.orig_start_ms, end_ms: e.orig_start_ms + e.length_ms }));
}

/**
 * Checks a time map read back from an artifact: non-empty, integer fields,
 * positive lengths, contiguous in cut time from 0, increasing and
 * non-overlapping in original time. Returns it typed, or throws.
 */
export function validateTimeMap(value: unknown): TimeMapEntry[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("time map must be a non-empty array");
  let expectedCut = 0;
  let minOrig = 0;
  value.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) throw new TypeError(`time map entry ${i} is not an object`);
    const { cut_start_ms, orig_start_ms, length_ms } = entry as Record<string, unknown>;
    for (const [name, field] of [["cut_start_ms", cut_start_ms], ["orig_start_ms", orig_start_ms], ["length_ms", length_ms]] as const) {
      if (!Number.isSafeInteger(field) || (field as number) < 0) {
        throw new TypeError(`time map entry ${i}: ${name} must be a non-negative integer`);
      }
    }
    const e = entry as TimeMapEntry;
    if (e.length_ms === 0) throw new RangeError(`time map entry ${i}: length_ms must be positive`);
    if (e.cut_start_ms !== expectedCut) {
      throw new RangeError(`time map entry ${i}: cut_start_ms ${e.cut_start_ms}, expected ${expectedCut}`);
    }
    if (e.orig_start_ms < minOrig) {
      throw new RangeError(`time map entry ${i}: orig_start_ms ${e.orig_start_ms} overlaps the previous entry`);
    }
    expectedCut += e.length_ms;
    minOrig = e.orig_start_ms + e.length_ms;
  });
  return value as TimeMapEntry[];
}

/**
 * Maps a cut-audio instant to original-audio time. The harness applies this
 * exactly once, in `merge` (AI_HARNESS §3.2 invariant).
 *
 * Instants at or past the end of the cut audio map to the end of the last
 * kept range: providers may report times slightly past the chunk end (§3.4
 * allows up to 1 s), and the result must stay inside the recording.
 */
export function toOriginalMs(cutMs: number, timeMap: TimeMap, edge: TimeEdge = "start"): number {
  if (!Number.isFinite(cutMs) || cutMs < 0) throw new RangeError(`cut time must be a non-negative number, got ${cutMs}`);
  if (timeMap.length === 0) throw new RangeError("empty time map");
  const last = timeMap[timeMap.length - 1]!;
  if (cutMs >= last.cut_start_ms + last.length_ms) return last.orig_start_ms + last.length_ms;
  // Last entry whose cut start is <= cutMs ("start") or < cutMs ("end").
  let lo = 0;
  let hi = timeMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const start = timeMap[mid]!.cut_start_ms;
    if (edge === "start" ? start <= cutMs : start < cutMs) lo = mid;
    else hi = mid - 1;
  }
  const entry = timeMap[lo]!;
  return entry.orig_start_ms + (cutMs - entry.cut_start_ms);
}

/**
 * Maps a cut-audio range to the original ranges it covers: one piece per time
 * map entry it touches, in order. A range that crosses a junction comes back
 * as two pieces with the removed stretch between them, never as one range
 * spanning it. `cut_length_ms` is how much of the cut range each piece holds.
 * The range is clipped to the cut audio; an empty range gives no pieces.
 */
export function toOriginalRanges(range: Interval, timeMap: TimeMap): Array<Interval & { cut_length_ms: number }> {
  if (timeMap.length === 0) throw new RangeError("empty time map");
  const out: Array<Interval & { cut_length_ms: number }> = [];
  for (const entry of timeMap) {
    const start = Math.max(range.start_ms, entry.cut_start_ms);
    const end = Math.min(range.end_ms, entry.cut_start_ms + entry.length_ms);
    if (end <= start) continue;
    out.push({
      start_ms: entry.orig_start_ms + (start - entry.cut_start_ms),
      end_ms: entry.orig_start_ms + (end - entry.cut_start_ms),
      cut_length_ms: end - start,
    });
  }
  return out;
}

/**
 * Maps an original-audio instant to cut-audio time. An instant inside a cut
 * range maps to the junction where that range was removed; one before the
 * first kept range maps to 0, one after the last to the cut duration.
 */
export function toCutMs(origMs: number, timeMap: TimeMap): number {
  if (!Number.isFinite(origMs) || origMs < 0) throw new RangeError(`original time must be a non-negative number, got ${origMs}`);
  if (timeMap.length === 0) throw new RangeError("empty time map");
  if (origMs < timeMap[0]!.orig_start_ms) return 0;
  let lo = 0;
  let hi = timeMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeMap[mid]!.orig_start_ms <= origMs) lo = mid;
    else hi = mid - 1;
  }
  const entry = timeMap[lo]!;
  return entry.cut_start_ms + Math.min(origMs - entry.orig_start_ms, entry.length_ms);
}
