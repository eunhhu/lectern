// Transcript metrics for the eval (AI_HARNESS §8): CER and WER, a speaker-error
// approximation, timestamp offsets, and the deleted/inserted shares (missing and invented
// text). Pure and deterministic.
//
// - CER is over letters and digits only (normalizeForMatch: no spaces or punctuation, NFKC,
//   lowercase), the usual choice for Korean, whose spacing varies between transcribers.
// - Speaker error: the reference and the hypothesis are aligned letter by letter (in
//   windows of reference lines, hypothesis segments assigned by their midpoint), each
//   aligned letter pairs a reference speaker with a hypothesis speaker, and labels are
//   mapped one-to-one to maximize agreement. The error is the share of aligned letters whose
//   speaker disagrees under that mapping: text-weighted, so it ignores silence and
//   overlapping speech (an approximation of diarization error).
// - Timestamp offset: for each reference line whose first letter aligns to an equal
//   hypothesis letter, the hypothesis time of that letter (interpolated within its segment)
//   minus the reference start.

import type { Interval } from "@lectern/media";
import { editCounts, globalAlign } from "../transcript/align.ts";
import { normalizeForMatch } from "../transcript/text.ts";

export interface TimedText {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

export interface TranscriptMetrics {
  /** Reference letters scored. */
  ref_chars: number;
  hyp_chars: number;
  cer: number;
  substitutions: number;
  /** Reference letters missing from the hypothesis, as a share of the reference. */
  deleted_ratio: number;
  /** Hypothesis letters with no reference counterpart, as a share of the reference. */
  inserted_ratio: number;
  ref_words: number;
  wer: number;
  /** Null when no letters aligned (nothing to compare). */
  speaker_error: number | null;
  /** Reference label → hypothesis label under the best mapping. */
  speaker_map: Record<string, string>;
  timestamp_offset_ms: { median: number; p90: number; samples: number } | null;
}

/** Words for WER: whitespace-separated, each reduced like CER letters; empty ones dropped. */
export function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => normalizeForMatch(w).chars.join(""))
    .filter(Boolean);
}

const inRanges = (ranges: readonly Interval[] | null, item: { start_ms: number; end_ms: number }) => {
  if (!ranges) return true;
  const mid = (item.start_ms + item.end_ms) / 2;
  return ranges.some((r) => mid >= r.start_ms && mid < r.end_ms);
};

/**
 * Compares a hypothesis transcript with a reference (both in original-audio time). With
 * `ranges` (the reviewed parts of a partly corrected reference), only lines and segments
 * whose midpoint falls inside them count.
 */
export function compareTranscripts(
  reference: readonly TimedText[],
  hypothesis: readonly TimedText[],
  ranges: readonly Interval[] | null = null,
  options: { windowChars?: number } = {},
): TranscriptMetrics {
  const ref = reference.filter((l) => inRanges(ranges, l));
  const hyp = hypothesis.filter((s) => inRanges(ranges, s));
  const refChars = ref.flatMap((l) => normalizeForMatch(l.text).chars);
  const hypChars = hyp.flatMap((s) => normalizeForMatch(s.text).chars);
  const chars = editCounts(refChars, hypChars);
  const refWords = ref.flatMap((l) => words(l.text));
  const wordEdits = editCounts(refWords, hyp.flatMap((s) => words(s.text)));
  const share = (n: number, of: number) => (of === 0 ? (n === 0 ? 0 : 1) : n / of);

  const { speakerError, speakerMap, offsets } = alignSpeakersAndTimes(ref, hyp, options.windowChars ?? 1_500);
  offsets.sort((a, b) => a - b);
  const pick = (q: number) => offsets[Math.min(offsets.length - 1, Math.floor(q * offsets.length))]!;
  return {
    ref_chars: refChars.length,
    hyp_chars: hypChars.length,
    cer: share(chars.substitutions + chars.deletions + chars.insertions, refChars.length),
    substitutions: chars.substitutions,
    deleted_ratio: share(chars.deletions, refChars.length),
    inserted_ratio: share(chars.insertions, refChars.length),
    ref_words: refWords.length,
    wer: share(wordEdits.substitutions + wordEdits.deletions + wordEdits.insertions, refWords.length),
    speaker_error: speakerError,
    speaker_map: speakerMap,
    timestamp_offset_ms: offsets.length ? { median: pick(0.5), p90: pick(0.9), samples: offsets.length } : null,
  };
}

interface Letter {
  c: string;
  speaker: string;
  /** Interpolated time of the letter; for reference letters, whether it starts its line. */
  t: number;
  lineStart: boolean;
}

function lettersOf(items: readonly TimedText[]): Letter[][] {
  return items.map((item) => {
    const chars = normalizeForMatch(item.text).chars;
    return chars.map((c, i) => ({
      c,
      speaker: item.speaker,
      t: item.start_ms + ((item.end_ms - item.start_ms) * i) / chars.length,
      lineStart: i === 0,
    }));
  });
}

function alignSpeakersAndTimes(ref: readonly TimedText[], hyp: readonly TimedText[], windowChars: number) {
  const refLetters = lettersOf(ref);
  const hypLetters = lettersOf(hyp);
  // Windows of whole reference lines; a hypothesis segment joins the window its midpoint falls in.
  const windows: Array<{ from: number; to: number }> = [];
  let count = 0;
  ref.forEach((_, i) => {
    if (windows.length === 0 || count + refLetters[i]!.length > windowChars) {
      windows.push({ from: i, to: i + 1 });
      count = 0;
    } else {
      windows.at(-1)!.to = i + 1;
    }
    count += refLetters[i]!.length;
  });
  const bounds = windows.map((w) => ref[w.from]!.start_ms);
  const hypByWindow: Letter[][] = windows.map(() => []);
  hyp.forEach((seg, i) => {
    const mid = (seg.start_ms + seg.end_ms) / 2;
    let w = 0;
    while (w + 1 < bounds.length && bounds[w + 1]! <= mid) w++;
    if (windows.length) hypByWindow[w]!.push(...hypLetters[i]!);
  });

  const pairs = new Map<string, Map<string, number>>();
  const offsets: number[] = [];
  let aligned = 0;
  windows.forEach((w, k) => {
    const r = refLetters.slice(w.from, w.to).flat();
    const h = hypByWindow[k]!;
    for (const [i, j] of globalAlign(
      r.map((x) => x.c),
      h.map((x) => x.c),
    )) {
      if (i < 0 || j < 0) continue;
      aligned++;
      const row = pairs.get(r[i]!.speaker) ?? new Map<string, number>();
      row.set(h[j]!.speaker, (row.get(h[j]!.speaker) ?? 0) + 1);
      pairs.set(r[i]!.speaker, row);
      if (r[i]!.lineStart && r[i]!.c === h[j]!.c) offsets.push(Math.round(h[j]!.t - r[i]!.t));
    }
  });
  if (aligned === 0) return { speakerError: null, speakerMap: {}, offsets };
  const { total, map } = bestMapping(pairs);
  return { speakerError: 1 - total / aligned, speakerMap: map, offsets: offsets.map(Math.abs) };
}

/**
 * One-to-one reference → hypothesis label mapping with the most agreeing letters: exact
 * (dynamic programming over subsets) up to 12 hypothesis labels, greedy beyond.
 */
export function bestMapping(pairs: Map<string, Map<string, number>>): { total: number; map: Record<string, string> } {
  const refs = [...pairs.keys()].sort();
  const hyps = [...new Set([...pairs.values()].flatMap((row) => [...row.keys()]))].sort();
  const weight = (r: string, h: string) => pairs.get(r)?.get(h) ?? 0;
  if (hyps.length <= 12) {
    // solve(i, mask): most agreement for refs[i..] using hypothesis labels not in mask.
    const memo = new Map<string, { total: number; picks: Array<number | -1> }>();
    const solve = (i: number, mask: number): { total: number; picks: Array<number | -1> } => {
      if (i === refs.length) return { total: 0, picks: [] };
      const key = `${i}:${mask}`;
      const hit = memo.get(key);
      if (hit) return hit;
      const skip = solve(i + 1, mask);
      let best = { total: skip.total, picks: [-1, ...skip.picks] };
      for (let h = 0; h < hyps.length; h++) {
        if (mask & (1 << h)) continue;
        const rest = solve(i + 1, mask | (1 << h));
        const total = rest.total + weight(refs[i]!, hyps[h]!);
        if (total > best.total) best = { total, picks: [h, ...rest.picks] };
      }
      memo.set(key, best);
      return best;
    };
    const result = solve(0, 0);
    const map: Record<string, string> = {};
    result.picks.forEach((h, i) => {
      if (h >= 0) map[refs[i]!] = hyps[h]!;
    });
    return { total: result.total, map };
  }
  const cells = refs.flatMap((r) => hyps.map((h) => ({ r, h, w: weight(r, h) }))).sort((a, b) => b.w - a.w || a.r.localeCompare(b.r) || a.h.localeCompare(b.h));
  const usedR = new Set<string>();
  const usedH = new Set<string>();
  const map: Record<string, string> = {};
  let total = 0;
  for (const cell of cells) {
    if (cell.w === 0 || usedR.has(cell.r) || usedH.has(cell.h)) continue;
    usedR.add(cell.r);
    usedH.add(cell.h);
    map[cell.r] = cell.h;
    total += cell.w;
  }
  return { total, map };
}
