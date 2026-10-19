import { describe, expect, test } from "bun:test";
import { compact, estimateTokens, ftsQuery, indexTokens, queryTerms, stripSuffix, termCoverage } from "../src/text.ts";

describe("index tokens", () => {
  test("Hangul runs become bigrams across single spaces; Latin words stay whole", () => {
    expect(indexTokens("운영 모드를 ECB로")).toEqual(["운영", "영모", "모드", "드를", "ecb", "로"]);
  });

  test("punctuation ends a run", () => {
    expect(indexTokens("시험. 과제")).toEqual(["시험", "과제"]);
  });

  test("a single syllable between other scripts is kept as itself", () => {
    expect(indexTokens("IV가 필요")).toEqual(["iv", "가필", "필요"]);
  });

  test("full-width forms are normalized", () => {
    expect(indexTokens("ＣＢＣ")).toEqual(["cbc"]);
  });
});

describe("query terms", () => {
  const texts = (q: string) => queryTerms(q).map((t) => t.text);

  test("particles and question endings are stripped, interrogatives dropped", () => {
    expect(texts("시험 범위가 어디까지야?")).toEqual(["시험", "범위"]);
    expect(texts("교수님이 ECB에 대해 뭐라고 했지?")).toEqual(["교수님", "ecb"]);
  });

  test("two-syllable nouns survive (the trigram tokenizer could not match them)", () => {
    expect(texts("과제 마감")).toEqual(["과제", "마감"]);
  });

  test("stripping keeps at least two characters", () => {
    expect(stripSuffix("회의")).toBe("회의");
    expect(stripSuffix("강의는")).toBe("강의");
  });

  test("the FTS query quotes every term, so operators in the question are inert", () => {
    const q = ftsQuery(queryTerms('ECB OR NOT "x" AND 운영모드* NEAR(a b)'));
    expect(q).toBe('"ecb" OR "not" OR "운영 영모 모드" OR "near"');
  });

  test("nothing to match gives null", () => {
    expect(ftsQuery(queryTerms("뭐야?"))).toBeNull();
  });
});

describe("coverage and estimates", () => {
  test("coverage ignores spacing", () => {
    const terms = queryTerms("운영모드 시험");
    expect(termCoverage(terms, "운영 모드 설명")).toBe(0.5);
    expect(compact("운영 모드")).toBe("운영모드");
  });

  test("Korean costs about 0.65 tokens a syllable", () => {
    expect(estimateTokens("가".repeat(100))).toBe(65);
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
  });
});
