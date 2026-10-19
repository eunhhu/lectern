// Search matching for the command palette (DESIGN.md §3.7): ignores case and spaces,
// and accepts initial consonants (초성) in place of syllables, so "ㄱㅇ" finds "강의" and
// "운ㅇ" finds "운영체제".

const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const CHOSEONG_SET = new Set(CHOSEONG);
const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;

/** Initial consonant of a Hangul syllable, or null for any other character. */
export function choseongOf(char: string): string | null {
  const code = char.codePointAt(0) ?? 0;
  if (code < SYLLABLE_START || code > SYLLABLE_END) return null;
  return CHOSEONG[Math.floor((code - SYLLABLE_START) / 588)]!;
}

/** "운영체제" → "ㅇㅇㅊㅈ"; non-Hangul characters are kept. */
export function toChoseong(text: string): string {
  return [...text].map((c) => choseongOf(c) ?? c).join("");
}

/** NFC, lower case, no whitespace. macOS hands out NFD file names, so normalise first. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

function charMatches(query: string, target: string): boolean {
  return query === target || (CHOSEONG_SET.has(query) && choseongOf(target) === query);
}

/**
 * Match score of `query` against `target` (higher is better), or null when it does not
 * match. Prefix matches beat matches elsewhere; earlier matches beat later ones.
 */
export function matchScore(target: string, query: string): number | null {
  const q = [...normalizeForSearch(query)];
  if (q.length === 0) return 0;
  const t = [...normalizeForSearch(target)];
  for (let start = 0; start + q.length <= t.length; start++) {
    let ok = true;
    for (let i = 0; i < q.length; i++) {
      if (!charMatches(q[i]!, t[start + i]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return (start === 0 ? 1000 : 500) - start;
  }
  return null;
}

/** Best score over the label and its aliases (e.g. English `theme`, `dark`). */
export function bestMatch(label: string, aliases: readonly string[], query: string): number | null {
  let best: number | null = null;
  for (const candidate of [label, ...aliases]) {
    const score = matchScore(candidate, query);
    if (score !== null && (best === null || score > best)) best = candidate === label ? score : score - 1;
  }
  return best;
}
