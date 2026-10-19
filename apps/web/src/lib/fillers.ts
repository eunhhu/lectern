// 읽기 모드: hides Korean interjections (음, 어, 아 …) in transcript text. Display only:
// the stored segment text, its idx and its timing never change, so seeking and sources
// work the same in both modes.
//
// Only interjections followed by a comma or an ellipsis are removed. Connectives that
// carry meaning (그래서, 그러니까, 근데) and answers (네, 예) stay.

const INTERJECTION = "(?:음+|으+음*|어+|아+|에+|흠+|엄+|자|저기|그)";
const LEADING = new RegExp(`^(?:${INTERJECTION}(?:,|\\.{2,}|…)\\s*)+`);
const INNER = new RegExp(`(^|[\\s,.?!])(?:${INTERJECTION}(?:,|\\.{2,}|…)\\s*)+`, "g");

export function readableText(text: string): string {
  return text
    .replace(LEADING, "")
    .replace(INNER, (_match, before: string) => (before.trim() ? `${before} ` : before))
    .replace(/\s{2,}/g, " ")
    .trim();
}
