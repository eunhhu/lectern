import {
  complementIntervals,
  coveredMs,
  intervalLength,
  normalizeIntervals,
  type Interval,
} from "./intervals.ts";
import { buildTimeMap, cutDurationMs, type TimeMapEntry } from "./time-map.ts";

// speech_map (AI_HARNESS §3.2): deterministic rules over silence intervals.
// Nothing here runs ffmpeg; detectSilences() produces the input.

/** Bump when a rule or a default changes, so memoised speech maps are recomputed (§4.4). */
export const SPEECH_MAP_VERSION = 1;

export interface SpeechMapRules {
  /** Silences shorter than this are pauses inside speech: never cut, never a boundary. */
  shortGapMs: number;
  /** Speech separated by less than this belongs to one island. */
  islandJoinMs: number;
  /** An island with at least this much speech is sustained speech. Only sustained speech bounds a cut. */
  anchorSpeechMs: number;
  /**
   * Speech that starts within this distance after sustained speech ends (or
   * ends within it before sustained speech starts) is kept with it, so a
   * closing remark after a pause is not cut with the break that follows.
   */
  edgeKeepMs: number;
  /** A break (mid-recording or leading) is cut only if at least this long. */
  breakMinMs: number;
  /** The tail after the last sustained speech is cut only if at least this long. */
  tailMinMs: number;
  /** A stretch is cut only if speech fills at most this share of it (0..1). */
  maxCutSpeechRatio: number;
  /** Silence left in place next to sustained speech on each side of a cut. */
  cutPadMs: number;
}

export const DEFAULT_SPEECH_MAP_RULES: Readonly<SpeechMapRules> = Object.freeze({
  shortGapMs: 2_000,
  islandJoinMs: 10_000,
  anchorSpeechMs: 20_000,
  edgeKeepMs: 30_000,
  breakMinMs: 5 * 60_000,
  tailMinMs: 60_000,
  maxCutSpeechRatio: 0.1,
  cutPadMs: 1_500,
});

/** Same names as `GapKind` in @lectern/domain; a Cut is structurally a `TranscriptGap`. */
export type CutKind = "break" | "tail";

/** A removed stretch, in original-audio time. */
export interface Cut extends Interval {
  kind: CutKind;
  /** Non-silent time inside the cut (sporadic noise or chatter), for tuning the rules. */
  speech_ms: number;
}

export interface SpeechMap {
  version: typeof SPEECH_MAP_VERSION;
  rules: SpeechMapRules;
  /** Length of the original (normalized) audio. */
  duration_ms: number;
  /** Length of the speech-only audio: the sum of `time_map` lengths. */
  cut_duration_ms: number;
  /** Silences of at least `shortGapMs`, original time. */
  silences: Interval[];
  /** Everything that is not such a silence, original time. */
  speech: Interval[];
  /** Removed stretches in order, original time. */
  cuts: Cut[];
  /** Kept stretches in order, original time. */
  kept: Interval[];
  time_map: TimeMapEntry[];
  /** Silences inside the speech-only audio, cut time: chunk boundary candidates. */
  cut_silences: Interval[];
}

export interface SpeechMapInput {
  duration_ms: number;
  /** Silence intervals in original time, in any order (as detectSilences() returns them). */
  silences: readonly Interval[];
}

interface Island extends Interval {
  speech_ms: number;
}

export function resolveSpeechMapRules(overrides: Partial<SpeechMapRules> = {}): SpeechMapRules {
  const rules = { ...DEFAULT_SPEECH_MAP_RULES, ...overrides };
  for (const [name, value] of Object.entries(rules)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`speech map rule ${name} must be a non-negative number`);
  }
  if (rules.maxCutSpeechRatio > 1) throw new RangeError("maxCutSpeechRatio must be between 0 and 1");
  return rules;
}

/**
 * Decides what to cut. In order:
 * 1. Silences shorter than `shortGapMs` count as speech (short gaps are kept).
 * 2. Speech runs closer than `islandJoinMs` join into islands; islands with at
 *    least `anchorSpeechMs` of speech are sustained speech. Each keeps the
 *    islands within `edgeKeepMs` before and after it.
 * 3. Every stretch between kept extents, before the first or after the last,
 *    is a candidate. It is cut if speech fills at most `maxCutSpeechRatio` of
 *    it and it is long enough: `breakMinMs` for a break (a leading stretch is
 *    a break too), `tailMinMs` for the tail. `cutPadMs` of silence stays next
 *    to the kept speech.
 * Without any sustained speech nothing is cut.
 */
export function buildSpeechMap(input: SpeechMapInput, overrides: Partial<SpeechMapRules> = {}): SpeechMap {
  const rules = resolveSpeechMapRules(overrides);
  const duration = input.duration_ms;
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new RangeError("duration_ms must be a positive integer");

  const silences = normalizeIntervals(input.silences, duration).filter((s) => intervalLength(s) >= rules.shortGapMs);
  const speech = complementIntervals(silences, duration);
  const extents = keptExtents(joinIslands(speech, rules.islandJoinMs), rules);

  const cuts: Cut[] = [];
  const consider = (kind: CutKind, start_ms: number, end_ms: number) => {
    const length = end_ms - start_ms;
    if (length < (kind === "tail" ? rules.tailMinMs : rules.breakMinMs) || length <= 0) return;
    const speech_ms = coveredMs(speech, { start_ms, end_ms });
    if (speech_ms <= rules.maxCutSpeechRatio * length) cuts.push({ kind, start_ms, end_ms, speech_ms });
  };
  if (extents.length > 0) {
    consider("break", 0, extents[0]!.start_ms - rules.cutPadMs);
    for (let i = 1; i < extents.length; i++) {
      consider("break", extents[i - 1]!.end_ms + rules.cutPadMs, extents[i]!.start_ms - rules.cutPadMs);
    }
    consider("tail", extents.at(-1)!.end_ms + rules.cutPadMs, duration);
  }

  const kept = complementIntervals(cuts, duration);
  const time_map = buildTimeMap(kept);
  return {
    version: SPEECH_MAP_VERSION,
    rules,
    duration_ms: duration,
    cut_duration_ms: cutDurationMs(time_map),
    silences,
    speech,
    cuts,
    kept,
    time_map,
    cut_silences: silencesInCutTime(silences, time_map),
  };
}

function joinIslands(speech: readonly Interval[], joinMs: number): Island[] {
  const islands: Island[] = [];
  for (const run of speech) {
    const last = islands.at(-1);
    if (last && run.start_ms - last.end_ms < joinMs) {
      last.end_ms = run.end_ms;
      last.speech_ms += intervalLength(run);
    } else {
      islands.push({ ...run, speech_ms: intervalLength(run) });
    }
  }
  return islands;
}

/** Sustained-speech islands widened by their nearby islands (one hop, not chained), merged. */
function keptExtents(islands: readonly Island[], rules: SpeechMapRules): Interval[] {
  const extents: Interval[] = [];
  islands.forEach((island, i) => {
    if (island.speech_ms < rules.anchorSpeechMs) return;
    let start = island.start_ms;
    let end = island.end_ms;
    for (let j = i - 1; j >= 0 && islands[j]!.end_ms >= island.start_ms - rules.edgeKeepMs; j--) {
      start = islands[j]!.start_ms;
    }
    for (let j = i + 1; j < islands.length && islands[j]!.start_ms <= island.end_ms + rules.edgeKeepMs; j++) {
      end = islands[j]!.end_ms;
    }
    const last = extents.at(-1);
    if (last && start <= last.end_ms) last.end_ms = Math.max(last.end_ms, end);
    else extents.push({ start_ms: start, end_ms: end });
  });
  return extents;
}

/** Original-time silences clipped to the kept ranges, moved to cut time, merged across junctions. */
function silencesInCutTime(silences: readonly Interval[], timeMap: readonly TimeMapEntry[]): Interval[] {
  const out: Interval[] = [];
  for (const entry of timeMap) {
    const keptEnd = entry.orig_start_ms + entry.length_ms;
    for (const silence of silences) {
      if (silence.end_ms <= entry.orig_start_ms) continue;
      if (silence.start_ms >= keptEnd) break;
      out.push({
        start_ms: entry.cut_start_ms + Math.max(silence.start_ms, entry.orig_start_ms) - entry.orig_start_ms,
        end_ms: entry.cut_start_ms + Math.min(silence.end_ms, keptEnd) - entry.orig_start_ms,
      });
    }
  }
  return normalizeIntervals(out, cutDurationMs(timeMap));
}
