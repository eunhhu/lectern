// Text helpers shared by transcription, merge and the eval metrics. Pure and deterministic.

/**
 * A transcript text reduced to what two hearings of the same audio should agree on:
 * letters and digits only (NFKC, lowercase), no whitespace or punctuation. Korean syllables
 * are single code points, so a "char" here is a syllable. `index[k]` is the position in the
 * original string of normalized char `k`, so a cut in normalized text maps back.
 */
export interface NormalizedText {
  chars: string[];
  index: number[];
}

const KEEP = /[\p{L}\p{N}]/u;

export function normalizeForMatch(text: string): NormalizedText {
  const chars: string[] = [];
  const index: number[] = [];
  let pos = 0;
  for (const cp of text) {
    for (const c of cp.normalize("NFKC").toLowerCase()) {
      if (KEEP.test(c)) {
        chars.push(c);
        index.push(pos);
      }
    }
    pos += cp.length;
  }
  return { chars, index };
}

/** Collapses whitespace, trims, and drops spaces before closing punctuation. */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.?!…。、，？！:;)\]])/g, "$1")
    .trim();
}

/**
 * The original text between normalized positions `[from, to)`. A cut at `from` starts at
 * that letter; a cut at `to` ends just before the next kept letter, so trailing punctuation
 * stays with the text before it.
 */
export function sliceNormalized(text: string, norm: NormalizedText, from: number, to: number): string {
  const start = from <= 0 ? 0 : (norm.index[from] ?? text.length);
  const end = to >= norm.chars.length ? text.length : (norm.index[to] ?? text.length);
  return cleanText(text.slice(start, end));
}

/**
 * Splits text into sentence-sized pieces: after `.?!…` (and the CJK forms) followed by
 * whitespace or the end. Text without such a boundary is one piece. Pieces keep their
 * punctuation and are cleaned.
 */
export function splitSentences(text: string): string[] {
  const pieces = text.split(/(?<=[.?!…。？！])\s+/u).map(cleanText).filter(Boolean);
  return pieces.length > 0 ? pieces : [cleanText(text)].filter(Boolean);
}

/**
 * Clock text → milliseconds: `M:SS`, `MM:SS` (minutes may exceed 59 without an hour field),
 * `H:MM:SS`, each with an optional fraction (`01:23.5`), or plain seconds (`83.5`). Null for
 * anything else, including a seconds field of 60 or more.
 */
export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const match = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return null;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}
