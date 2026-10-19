// Groups transcript segments into readable paragraphs (DESIGN.md §3.11 가독성): consecutive
// segments of one speaker become one paragraph, broken at gaps, long pauses and once a
// paragraph gets long. The transcript renders (and virtualizes) paragraphs; segments stay
// the unit of playback, sources and aria-current.

import type { TimedSegment } from "./segments.ts";

export interface ParagraphSegment extends TimedSegment {
  speaker_id: string | null;
  text: string;
}

export interface TimedGap {
  kind: string;
  start_ms: number;
  end_ms: number;
}

export interface Paragraph<G extends TimedGap = TimedGap> {
  /** Array positions (not `idx`) of the first and last segment, inclusive. */
  first: number;
  last: number;
  speakerId: string | null;
  /** The speaker differs from the paragraph before (the name is shown). */
  newSpeaker: boolean;
  startMs: number;
  /** A gap (break, missing transcript) that ends right before this paragraph. */
  gapBefore: G | null;
}

export interface ParagraphLimits {
  maxMs: number;
  maxSegments: number;
  maxChars: number;
  /** A silence at least this long starts a new paragraph. */
  pauseMs: number;
}

const DEFAULT_LIMITS: ParagraphLimits = { maxMs: 75_000, maxSegments: 8, maxChars: 360, pauseMs: 4_000 };

export function buildParagraphs<S extends ParagraphSegment, G extends TimedGap>(
  segments: readonly S[],
  gaps: readonly G[],
  limits: Partial<ParagraphLimits> = {},
): Paragraph<G>[] {
  const { maxMs, maxSegments, maxChars, pauseMs } = { ...DEFAULT_LIMITS, ...limits };
  const sortedGaps = [...gaps].sort((a, b) => a.end_ms - b.end_ms);
  const out: Paragraph<G>[] = [];
  let gapAt = 0;
  let chars = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    // The latest gap that ended at or before this segment and after the previous one.
    let gap: G | null = null;
    while (gapAt < sortedGaps.length && sortedGaps[gapAt]!.end_ms <= seg.start_ms) gap = sortedGaps[gapAt++]!;

    const current = out.at(-1);
    const prev = i > 0 ? segments[i - 1]! : null;
    const startNew =
      !current ||
      gap !== null ||
      seg.speaker_id !== current.speakerId ||
      (prev !== null && seg.start_ms - prev.end_ms >= pauseMs) ||
      i - current.first >= maxSegments ||
      seg.end_ms - current.startMs > maxMs ||
      chars + seg.text.length > maxChars;

    if (startNew) {
      out.push({
        first: i,
        last: i,
        speakerId: seg.speaker_id,
        newSpeaker: !current || current.speakerId !== seg.speaker_id || gap !== null,
        startMs: seg.start_ms,
        gapBefore: gap,
      });
      chars = seg.text.length;
    } else {
      current.last = i;
      chars += seg.text.length + 1;
    }
  }
  return out;
}

/** Position of the paragraph holding the segment at array position `segmentIndex`, or -1. */
export function paragraphOf(paragraphs: readonly Paragraph[], segmentIndex: number): number {
  if (segmentIndex < 0) return -1;
  let lo = 0;
  let hi = paragraphs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (paragraphs[mid]!.first <= segmentIndex) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && paragraphs[found]!.last >= segmentIndex ? found : -1;
}
