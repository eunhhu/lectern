// Deterministic checks on one chunk's transcription (AI_HARNESS §3.4). A failure is an
// output_validation error: the runner retries once with the issues in the prompt, then the
// chunk becomes a "전사 누락" gap. Messages describe the problem, never the transcript text.

import type { TranscribeResult } from "@lectern/domain";
import { complementIntervals, normalizeIntervals, type Interval } from "@lectern/media";
import { normalizeForMatch } from "./text.ts";

export const TRANSCRIBE_CHECKS = Object.freeze({
  /** Providers may report times slightly past the chunk end. */
  endSlackMs: 1_000,
  /** Coverage is judged only when the chunk has at least this much speech. */
  minSpeechForCoverageMs: 20_000,
  /** Share of the chunk's speech that segments must cover; below it, text is missing. */
  minCoverage: 0.3,
  /** More letters per second of speech than anyone speaks: invented or looping text. */
  maxCharsPerSpeechSecond: 30,
  /** A unit of 2..40 letters repeated this many times in a row, over at least `loopMinChars`, is a loop. */
  loopMinRepeats: 6,
  loopMinChars: 24,
  /** The same text (of at least 4 letters) as this many consecutive segments is a loop. */
  maxRepeatedSegments: 4,
  /** Share of segments with no letters at all. */
  maxEmptyRatio: 0.2,
});

export interface ChunkCheckContext {
  /** Chunk length (cut-audio time). */
  durationMs: number;
  /** Silences inside the chunk, chunk-relative (from speech_map's cut_silences). */
  silences: readonly Interval[];
  /** The language the caller expects, if any (compared on the primary subtag). */
  language?: string;
}

/** Problems with a provider's answer for one chunk; empty when it passes. */
export function checkTranscription(
  result: TranscribeResult,
  ctx: ChunkCheckContext,
  checks: typeof TRANSCRIBE_CHECKS = TRANSCRIBE_CHECKS,
): string[] {
  const issues: string[] = [];
  const segments = result.segments;
  const limit = ctx.durationMs + checks.endSlackMs;

  let previousStart = 0;
  segments.forEach((seg, i) => {
    if (seg.start_ms < 0 || seg.end_ms < seg.start_ms) issues.push(`segment ${i}: end before start`);
    if (seg.end_ms > limit) issues.push(`segment ${i}: ends at ${seg.end_ms} ms, past the clip (${ctx.durationMs} ms)`);
    if (seg.start_ms < previousStart) issues.push(`segment ${i}: starts before the previous segment`);
    previousStart = Math.max(previousStart, seg.start_ms);
  });

  const speech = complementIntervals(normalizeIntervals(ctx.silences, ctx.durationMs), ctx.durationMs);
  const speechMs = speech.reduce((n, s) => n + (s.end_ms - s.start_ms), 0);
  const covered = normalizeIntervals(
    segments.map((s) => ({ start_ms: s.start_ms, end_ms: s.end_ms })),
    ctx.durationMs,
  );
  if (speechMs >= checks.minSpeechForCoverageMs) {
    const coveredSpeech = overlapMs(speech, covered);
    if (coveredSpeech < checks.minCoverage * speechMs) {
      issues.push(
        `segments cover ${Math.round((100 * coveredSpeech) / speechMs)}% of the speech (minimum ${Math.round(100 * checks.minCoverage)}%): text is missing`,
      );
    }
  }

  const texts = segments.map((s) => normalizeForMatch(s.text).chars.join(""));
  const letters = texts.reduce((n, t) => n + [...t].length, 0);
  if (speechMs > 0 && letters / (speechMs / 1000) > checks.maxCharsPerSpeechSecond) {
    issues.push(`${letters} letters for ${Math.round(speechMs / 1000)} s of speech: more text than was spoken`);
  }

  const loopPattern = new RegExp(`(.{2,40}?)\\1{${checks.loopMinRepeats - 1},}`, "gu");
  for (const loop of texts.join("").matchAll(loopPattern)) {
    if (loop[0].length >= checks.loopMinChars) {
      issues.push(`a phrase repeats ${Math.round(loop[0].length / loop[1]!.length)} times in a row (repetition loop)`);
      break;
    }
  }
  let run = 1;
  for (let i = 1; i < texts.length; i++) {
    run = texts[i] && texts[i] === texts[i - 1] && [...texts[i]!].length >= 4 ? run + 1 : 1;
    if (run >= checks.maxRepeatedSegments) {
      issues.push(`${run} consecutive segments have the same text (repetition loop)`);
      break;
    }
  }

  const empty = texts.filter((t) => t.length === 0).length;
  if (segments.length >= 5 && empty / segments.length > checks.maxEmptyRatio) {
    issues.push(`${empty} of ${segments.length} segments have no text`);
  }

  if (ctx.language && result.language && primary(ctx.language) !== primary(result.language)) {
    issues.push(`language ${result.language}, expected ${ctx.language}`);
  }
  return issues;
}

function primary(tag: string): string {
  return tag.split("-")[0]!.toLowerCase();
}

/** Total length of the intersection of two normalized interval lists. */
function overlapMs(a: readonly Interval[], b: readonly Interval[]): number {
  let total = 0;
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j]!.end_ms <= x.start_ms) j++;
    for (let k = j; k < b.length && b[k]!.start_ms < x.end_ms; k++) {
      total += Math.max(0, Math.min(x.end_ms, b[k]!.end_ms) - Math.max(x.start_ms, b[k]!.start_ms));
    }
  }
  return total;
}
