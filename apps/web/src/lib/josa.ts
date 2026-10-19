// Korean particles that depend on the final consonant (DESIGN.md §6.4 "조사").

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;

type Pair = "을/를" | "이/가" | "은/는" | "과/와" | "으로/로";

/** Final consonant index of the last Hangul syllable (0 = none), or null if the word does not end in Hangul. */
function finalConsonant(word: string): number | null {
  const code = word.trim().codePointAt(word.trim().length - 1) ?? 0;
  if (code < SYLLABLE_START || code > SYLLABLE_END) return null;
  return (code - SYLLABLE_START) % 28;
}

/**
 * `word` with the right particle: josa("녹음", "을/를") → "녹음을". Returns null when the
 * word does not end in Hangul (an English name, a number), so the caller rephrases
 * instead of writing "을(를)".
 */
export function josa(word: string, pair: Pair): string | null {
  const final = finalConsonant(word);
  if (final === null) return null;
  const [withFinal, without] = pair.split("/") as [string, string];
  // ㄹ (index 8) takes 로, not 으로.
  if (pair === "으로/로") return word + (final === 0 || final === 8 ? without : withFinal);
  return word + (final === 0 ? without : withFinal);
}
