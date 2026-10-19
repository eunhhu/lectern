// Text handling shared by the index, the query side and the citation checker
// (docs/adr/0009-ask-rag.md, "검색").
//
// Korean has no whitespace-delimited morphemes: particles stick to nouns (`시험은`,
// `시험을`) and spacing in STT output and in queries is inconsistent (`운영 모드` vs
// `운영모드`). The SQLite trigram tokenizer cannot match the many two-syllable nouns
// (`시험`, `과제`, `마감`), so the index stores overlapping character bigrams of every
// CJK run instead, built across single spaces, and Latin/digit runs as whole words.
// A query word becomes the phrase of its bigrams, which behaves like a substring match
// that ignores spacing. FTS5 then only sees space-separated tokens (unicode61).

/** Hangul syllables and jamo, CJK ideographs, kana: scripts indexed as bigrams. */
function isBigramChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff)
  );
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;

export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function pushBigrams(run: string[], out: string[]): void {
  if (run.length === 1) out.push(run[0]!);
  for (let i = 0; i + 1 < run.length; i++) out.push(run[i]! + run[i + 1]!);
}

/**
 * Index tokens of `text`: bigrams of CJK runs (a run continues across whitespace and
 * ends at punctuation or a Latin word), and lowercased Latin/digit words.
 */
export function indexTokens(text: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  let word = "";
  const flushWord = () => {
    if (word) out.push(word);
    word = "";
  };
  const flushRun = () => {
    if (run.length) pushBigrams(run, out);
    run = [];
  };
  for (const ch of normalizeText(text)) {
    if (isBigramChar(ch)) {
      flushWord();
      run.push(ch);
    } else if (WORD_CHAR.test(ch)) {
      flushRun();
      word += ch;
    } else {
      flushWord();
      if (!SPACE.test(ch)) flushRun();
    }
  }
  flushWord();
  flushRun();
  return out;
}

/** The FTS5 `body` for a chunk: index tokens joined by spaces. */
export function ftsBody(text: string): string {
  return indexTokens(text).join(" ");
}

// ---------------------------------------------------------------------------
// Query side
// ---------------------------------------------------------------------------

// Particles and question endings stripped from the end of a Hangul query word, longest
// first. Stripping too much only widens the match (a phrase of the stem's bigrams still
// matches the full word); stripping too little breaks it, so the list is generous.
const SUFFIXES = [
  "에서부터", "으로부터", "이었는지", "였는지", "인가요", "이에요", "이었나", "이었지", "이라고",
  "에게서", "한테서", "으로서", "으로써", "에서는", "에서도", "까지는", "까지도", "부터는", "이라도",
  "했는지", "하는지", "였나요", "했나요", "였어요", "했어요", "하나요", "할까요",
  "에서", "에게", "한테", "께서", "으로", "부터", "까지", "보다", "처럼", "마다", "조차", "이랑",
  "하고", "이나", "이며", "인지", "인가", "이야", "이죠", "였나", "였지", "였어", "했나", "했지",
  "했어", "했던", "해줘", "나요", "까요", "라고", "에는", "에도", "으로는",
  // verb and adjective endings on a noun stem: 결정된 → 결정, 제출할 → 제출
  "되었던", "됐던", "되는", "하는", "하던", "되던", "된다", "한다", "되어", "해서", "된", "한", "할", "될",
  "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "로", "와", "과", "랑", "께", "야", "요", "냐", "니",
].sort((a, b) => b.length - a.length);

// Interrogatives and request verbs: they say what is asked, not what to find.
const STOPWORDS = new Set([
  "무엇", "뭐", "뭘", "뭔", "뭐라고", "뭐라", "뭐야", "뭐지", "뭐였지", "어땠", "어때", "무슨", "어디", "언제", "누구", "누가", "어떻게", "어떤", "어느", "얼마", "얼마나",
  "몇", "왜", "그것", "이것", "저것", "그거", "이거", "저거", "것", "거", "수", "좀", "혹시", "그리고",
  "그런데", "근데", "알려", "알려줘", "정리", "정리해", "설명", "설명해", "말해", "말해줘", "요약해",
  "대해", "대한", "관련", "관련된", "내용", "얘기", "이야기", "있어", "있나", "있었", "있었지", "있는",
  "했던", "하는", "했다", "해서", "했지", "했어", "했나", "했는데", "한다", "하나", "해야", "됐어", "됐나", "됐지",
  "그때", "여기", "거기", "우리", "제가", "내가", "말고", "것은", "것이", "것을", "거는", "건",
  "what", "when", "where", "who", "why", "how", "which", "the", "a", "an", "is", "are", "was", "were",
  "do", "does", "did", "of", "in", "on", "to", "for", "and", "or", "about", "tell", "me",
]);

function stripOnce(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Strips up to two trailing particles/endings (`어디까지야` → `어디까지` → `어디`), keeping at least two characters. */
export function stripSuffix(word: string): string {
  return stripOnce(stripOnce(word));
}

export interface QueryTerm {
  /** Normalized term as it appears in text (no spaces). */
  text: string;
  /** Index tokens of the term, matched as one FTS phrase. */
  tokens: string[];
}

/**
 * Search terms of a question: script runs of each word, Hangul runs stripped of
 * particles and endings, stopwords and one-character Hangul runs dropped, deduplicated.
 */
export function queryTerms(question: string): QueryTerm[] {
  const out: QueryTerm[] = [];
  const seen = new Set<string>();
  for (const [word] of normalizeText(question).matchAll(/[\p{L}\p{N}]+/gu)) {
    // Split a word like `ecb가` into its script runs.
    for (const [run] of word.matchAll(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[^\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)) {
      const cjk = isBigramChar(run[0]!);
      const text = cjk ? stripSuffix(run) : run;
      if (STOPWORDS.has(text) || STOPWORDS.has(run)) continue;
      if (cjk ? text.length < 2 : text.length < 2 && !/\d/.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ text, tokens: indexTokens(text) });
    }
  }
  return out;
}

/** FTS5 MATCH expression: each term a quoted phrase of its tokens, OR'ed. Null when there is nothing to match. */
export function ftsQuery(terms: readonly QueryTerm[]): string | null {
  const phrases = terms
    .filter((t) => t.tokens.length > 0)
    // Tokens only hold letters and digits, so quoting needs no escaping; strip quotes anyway.
    .map((t) => `"${t.tokens.join(" ").replaceAll('"', "")}"`);
  return phrases.length ? phrases.join(" OR ") : null;
}

/** The longest letter/digit run of `text`, for the one-character fallback (`법?` → `법`). */
export function fallbackNeedle(text: string): string {
  const runs = normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return runs.reduce((best, run) => (run.length > best.length ? run : best), "");
}

/** Text without whitespace, for spacing-insensitive containment checks. */
export function compact(text: string): string {
  return normalizeText(text).replace(/\s+/gu, "");
}

/** Share of `terms` that occur in `text`, ignoring spacing. 0 when there are no terms. */
export function termCoverage(terms: readonly QueryTerm[], text: string): number {
  if (terms.length === 0) return 0;
  const haystack = compact(text);
  return terms.filter((t) => haystack.includes(t.text)).length / terms.length;
}

// ---------------------------------------------------------------------------
// Token estimate
// ---------------------------------------------------------------------------

/**
 * Rough model-token count for budgeting (the provider's usage is what gets billed).
 * Korean speech runs about 175 tokens a minute at ~280 syllables, so ~0.65 tokens per
 * CJK character; other text ~4 characters a token.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isBigramChar(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.65 + other / 4);
}
