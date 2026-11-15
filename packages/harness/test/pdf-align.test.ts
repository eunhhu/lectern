// The align stage (P3-04, D-P3-4): 2-minute windows, BM25 over the ask index tokens, top 3
// pages per window, deterministic ties, and the stage memo. No model, no network.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { alignStage, alignWindows, ALIGN_TOP_PAGES, type AlignPage, type AlignSegment } from "../src/pdf/align.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const SEGMENTS: AlignSegment[] = [
  { idx: 0, start_ms: 0, end_ms: 60_000, text: "대칭키 암호의 운영 모드 ECB와 CBC를 설명합니다" },
  { idx: 1, start_ms: 130_000, end_ms: 190_000, text: "해시 함수 SHA와 충돌 저항성을 봅니다" },
  { idx: 2, start_ms: 250_000, end_ms: 300_000, text: "공개키 RSA 암호와 소인수분해 어려움" },
];

const PAGES: AlignPage[] = [
  { asset_id: "ast_a", page_no: 1, text: "운영 모드 ECB CBC 블록 암호 대칭키" },
  { asset_id: "ast_a", page_no: 2, text: "해시 함수 SHA 충돌 저항성 무결성" },
  { asset_id: "ast_a", page_no: 3, text: "공개키 RSA 소인수분해 암호" },
  { asset_id: "ast_a", page_no: 4, text: "점심 메뉴 김밥 라면 학생식당 안내" },
];

describe("alignWindows", () => {
  test("windows are 2 minutes", () => {
    const out = alignWindows(SEGMENTS, PAGES);
    expect(out.windows).toHaveLength(3);
    expect(out.windows.map((w) => w.start_ms)).toEqual([0, 120_000, 240_000]);
    expect(out.windows.map((w) => w.end_ms)).toEqual([60_000, 190_000, 300_000]);
  });

  test("right page ranks first per window", () => {
    const out = alignWindows(SEGMENTS, PAGES);
    expect(out.windows.map((w) => w.pages[0]!.page_no)).toEqual([1, 2, 3]);
    for (const w of out.windows) {
      expect(w.pages[0]!.page_no).not.toBe(4);
      expect(w.pages.every((p) => p.asset_id === "ast_a" && p.score > 0)).toBe(true);
    }
  });

  test("at most 3 pages and sorted", () => {
    const pages = [...PAGES, { asset_id: "ast_a", page_no: 5, text: "블록 암호 운영 모드 정리 대칭키 해시 공개키" }];
    const out = alignWindows(SEGMENTS, pages);
    for (const w of out.windows) {
      expect(w.pages.length).toBeLessThanOrEqual(ALIGN_TOP_PAGES);
      const scores = w.pages.map((p) => p.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  test("deterministic", () => {
    expect(JSON.stringify(alignWindows(SEGMENTS, PAGES))).toBe(JSON.stringify(alignWindows(SEGMENTS, PAGES)));
  });

  test("ties break by asset then page", () => {
    const pages: AlignPage[] = [
      { asset_id: "ast_b", page_no: 1, text: "운영 모드 ECB CBC 블록 암호 대칭키" },
      { asset_id: "ast_a", page_no: 9, text: "운영 모드 ECB CBC 블록 암호 대칭키" },
      { asset_id: "ast_a", page_no: 2, text: "운영 모드 ECB CBC 블록 암호 대칭키" },
    ];
    const [first] = alignWindows([SEGMENTS[0]!], pages).windows;
    expect(first!.pages.map((p) => [p.asset_id, p.page_no])).toEqual([
      ["ast_a", 2],
      ["ast_a", 9],
      ["ast_b", 1],
    ]);
    expect(new Set(first!.pages.map((p) => p.score)).size).toBe(1);
  });

  test("no overlap gives empty pages", () => {
    const out = alignWindows([{ idx: 0, start_ms: 0, end_ms: 5_000, text: "zzz qqq" }], PAGES);
    expect(out.windows).toEqual([{ start_ms: 0, end_ms: 5_000, pages: [] }]);
  });

  test("empty segments are dropped", () => {
    const out = alignWindows([...SEGMENTS, { idx: 3, start_ms: 400_000, end_ms: 410_000, text: "  " }], PAGES);
    expect(out.windows.map((w) => w.start_ms)).toEqual([0, 120_000, 240_000]);
  });

  test("pages without tokens are left out of the corpus", () => {
    const out = alignWindows(SEGMENTS, [...PAGES, { asset_id: "ast_a", page_no: 6, text: "" }]);
    expect(out.windows.flatMap((w) => w.pages).some((p) => p.page_no === 6)).toBe(false);
  });
});

describe("alignStage", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = testEnv();
  });
  afterEach(() => env.close());

  const run = (jobId: string) => env.harness().job({ jobId: env.job(jobId), scope: "ws" });

  test("stage: no model call, memo hit", async () => {
    const first = await run("j1").run(alignStage, { segments: SEGMENTS, pages: PAGES });
    const second = await run("j2").run(alignStage, { segments: SEGMENTS, pages: PAGES });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(rows(env.db, "SELECT id FROM ai_call")).toHaveLength(0);
  });

  test("stage key changes with page text", async () => {
    await run("j1").run(alignStage, { segments: SEGMENTS, pages: PAGES });
    const changed = PAGES.map((p, i) => (i === 3 ? { ...p, text: `${p.text}!` } : p));
    const again = await run("j2").run(alignStage, { segments: SEGMENTS, pages: changed });
    expect(again.cacheHit).toBe(false);
  });
});
