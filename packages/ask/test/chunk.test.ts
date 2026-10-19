import { describe, expect, test } from "bun:test";
import {
  blockText,
  CHUNK_RULES,
  chunkLegacyMarkdown,
  chunkPdf,
  chunkRecording,
  chunkTranscript,
  parseTimestampMs,
  type SegmentInput,
} from "../src/chunk.ts";
import { CRYPTO_DOC, cryptoSources, longSources, REC, SPEAKERS, WS } from "./fixtures.ts";

describe("transcript windows", () => {
  test("never split a segment, keep idx ranges contiguous and times in original audio", () => {
    const segments = longSources().transcript!.segments;
    const windows = chunkTranscript(segments);
    expect(windows.length).toBeGreaterThan(5);
    let next = 0;
    for (const w of windows) {
      expect(w.startIdx).toBe(next);
      expect(w.endIdx!).toBeGreaterThanOrEqual(w.startIdx!);
      next = w.endIdx! + 1;
      expect(w.startMs).toBe(segments[w.startIdx!]!.start_ms);
      expect(w.spans!.map((s) => s[0])).toEqual(Array.from({ length: w.endIdx! - w.startIdx! + 1 }, (_, i) => w.startIdx! + i));
    }
    expect(next).toBe(segments.length);
  });

  test("windows stay within the size rules", () => {
    const windows = chunkTranscript(longSources().transcript!.segments);
    for (const w of windows.slice(0, -1)) {
      const tokens = Math.ceil([...w.text].length * 0.65);
      expect(tokens).toBeLessThanOrEqual(CHUNK_RULES.maxTokens * 1.25);
    }
  });

  test("a long time jump (a cut break) always closes the window", () => {
    const windows = chunkTranscript(cryptoSources().transcript!.segments, SPEAKERS);
    // segment 6 starts 90 s after segment 5 ends
    expect(windows.some((w) => w.startIdx === 6)).toBe(true);
  });

  test("speaker turns become lines and spans point at each segment's text", () => {
    const [first] = chunkTranscript(cryptoSources().transcript!.segments, SPEAKERS);
    expect(first!.text.split("\n")[0]!.startsWith("S1: 오늘은")).toBe(true);
    expect(first!.text).toContain("\nS2: 질문 있는데요");
    for (const [idx, , , from, to] of first!.spans!) {
      const seg = cryptoSources().transcript!.segments.find((s) => s.idx === idx)!;
      expect(first!.text.slice(from, to)).toBe(seg.text);
    }
  });

  test("a tiny tail merges into the previous window", () => {
    const segs: SegmentInput[] = [];
    for (let i = 0; i < 30; i++) segs.push({ idx: i, start_ms: i * 10_000, end_ms: i * 10_000 + 9_000, text: "가".repeat(40) });
    segs.push({ idx: 30, start_ms: 300_000, end_ms: 301_000, text: "끝" });
    const windows = chunkTranscript(segs);
    expect(windows.at(-1)!.endIdx).toBe(30);
    expect(windows.at(-1)!.startIdx).not.toBe(30);
  });
});

describe("document blocks", () => {
  test("one chunk per text block; gap blocks are skipped", () => {
    const chunks = chunkRecording(cryptoSources()).filter((c) => c.kind === "document");
    expect(chunks.map((c) => c.blockId)).toEqual(["b1", "b2", "b3"]);
    expect(chunks[2]!.text).toBe("[시험] 시험 범위는 운영 모드까지, CBC 복호화 그림 출제.");
    expect(chunks[2]!.heading).toBe("시험·과제");
  });

  test("list items carry their own sources and the block gets their start time", () => {
    const b2 = chunkRecording(cryptoSources()).find((c) => c.blockId === "b2")!;
    expect(b2.text).toBe("- CBC는 IV가 필요하다.\n- IV는 예측할 수 없어야 한다.");
    expect(b2.sources).toEqual([{ kind: "transcript", start_idx: 5, end_idx: 5 }]);
    const seg5 = cryptoSources().transcript!.segments[5]!;
    expect(b2.startMs).toBe(seg5.start_ms);
  });

  test("unknown block types produce no text", () => {
    const block = { ...CRYPTO_DOC.sections[0]!.blocks[0]!, type: "chart" } as unknown as Parameters<typeof blockText>[0];
    expect(blockText(block)).toBeNull();
  });
});

describe("recording chunks", () => {
  test("documents first, then transcript; ordinals follow", () => {
    const chunks = chunkRecording(cryptoSources());
    expect(chunks.map((c) => c.kind)).toEqual([...Array(3).fill("document"), ...Array(chunks.length - 3).fill("transcript")]);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.workspaceId === WS && c.recordingId === REC.crypto)).toBe(true);
  });

  test("ids are stable for unchanged text and change with it", () => {
    const a = chunkRecording(cryptoSources());
    const b = chunkRecording(cryptoSources());
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id));
    const edited = cryptoSources();
    edited.transcript = { ...edited.transcript!, segments: edited.transcript!.segments.map((s) => (s.idx === 7 ? { ...s, text: "과제 3은 금요일까지입니다." } : s)) };
    const c = chunkRecording(edited);
    const changed = c.filter((x, i) => x.id !== a[i]!.id);
    expect(changed.length).toBe(1);
    expect(changed[0]!.kind).toBe("transcript");
  });

  test("ids differ across workspaces even for identical text", () => {
    const a = chunkRecording(cryptoSources());
    const b = chunkRecording({ ...cryptoSources(), workspaceId: "ws_elsewhere" });
    expect(a[0]!.contentSha256).toBe(b[0]!.contentSha256);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

describe("legacy Markdown and PDF", () => {
  test("legacy notes split under headings and pick up [MM:SS] marks", () => {
    const md = "# 7주차\n\n## 운영 모드\n[12:03] ECB는 위험하다.\n\n## 시험\n[1:02:40] 시험 범위는 운영 모드까지.\n";
    const chunks = chunkLegacyMarkdown({ documentId: "doc_legacy", version: 1, markdown: md });
    expect(chunks.map((c) => c.heading)).toEqual(["7주차 › 운영 모드", "7주차 › 시험"]);
    expect(chunks.map((c) => c.startMs)).toEqual([723_000, 3_760_000]);
    expect(chunks.every((c) => c.blockId === null)).toBe(true);
    expect(parseTimestampMs("no mark")).toBeNull();
  });

  test("PDF pages keep asset and page; blank pages are skipped", () => {
    const chunks = chunkPdf({ assetId: "ast_pdf", pages: [{ page: 1, text: "표지" }, { page: 2, text: "  " }, { page: 3, text: "CBC 그림" }] });
    expect(chunks.map((c) => [c.page, c.locator])).toEqual([
      [1, "p:ast_pdf:1"],
      [3, "p:ast_pdf:3"],
    ]);
  });
});
