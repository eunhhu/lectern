// The legacy (v1) Markdown parser: the subset the v1 renderer draws, [MM:SS] marks as
// times, and hostile input that stays text (the pane renders the tree with React, never
// as HTML, and links are http(s) only).

import { describe, expect, test } from "bun:test";
import type { SearchHit } from "../src/api/types.ts";
import { inlineText, parseClock, parseInline, parseLegacyMarkdown } from "../src/lib/legacy-markdown.ts";
import { hitText, hitTime } from "../src/lib/search-hits.ts";

describe("legacy Markdown", () => {
  test("headings, paragraphs, nested lists, quotes, code, tables and rules", () => {
    const md = [
      "# 정보보호 7주차",
      "",
      "## 운영 모드",
      "[00:03] ECB는 **위험**하다.",
      "이어지는 문장.",
      "",
      "- 첫째 [01:02]",
      "  - 하위 항목",
      "    이어지는 줄",
      "- 둘째",
      "1. 번호",
      "",
      "> 인용 *기울임*",
      "> 둘째 줄",
      "",
      "```ts",
      "const x = `[00:01]`;",
      "```",
      "",
      "| 모드 | 특징 |",
      "|---|:---:|",
      "| ECB | 패턴 노출 |",
      "",
      "---",
    ].join("\n");
    const blocks = parseLegacyMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual(["heading", "heading", "p", "p", "list", "list", "quote", "code", "table", "hr"]);
    expect(blocks[0]).toMatchObject({ t: "heading", level: 1, text: "정보보호 7주차" });
    const p = blocks[2]!;
    expect(p.t === "p" && p.c).toEqual([
      { t: "time", ms: 3000, label: "00:03" },
      { t: "text", v: " ECB는 " },
      { t: "strong", c: [{ t: "text", v: "위험" }] },
      { t: "text", v: "하다." },
    ]);
    // Each line of a v1 note is its own paragraph (a separate timed statement).
    expect(blocks[3]).toEqual({ t: "p", c: [{ t: "text", v: "이어지는 문장." }] });
    const list = blocks[4]!;
    if (list.t !== "list") throw new Error("list");
    expect(list.items.map((i) => inlineText(i.c))).toEqual(["첫째 01:02", "둘째"]);
    const nested = list.items[0]!.children[0]!;
    expect(nested.t === "list" && inlineText(nested.items[0]!.c)).toBe("하위 항목 이어지는 줄");
    expect(blocks[5]).toMatchObject({ t: "list", ordered: true });
    expect(blocks[7]).toEqual({ t: "code", lang: "ts", v: "const x = `[00:01]`;" });
    const table = blocks[8]!;
    expect(table.t === "table" && table.rows.map((r) => r.map(inlineText))).toEqual([["ECB", "패턴 노출"]]);
  });

  test("times, ranges and the v1 filter notes", () => {
    expect(parseClock("12:03")).toBe(723_000);
    expect(parseClock("1:02:40")).toBe(3_760_000);
    expect(parseInline("[12:03 ~ 14:40] 범위")[0]).toEqual({ t: "time", ms: 723_000, label: "12:03–14:40" });
    expect(parseInline("`[쉬는 시간 생략: 10분]`")).toEqual([{ t: "note", kind: "break", v: "쉬는 시간 생략: 10분" }]);
    expect(parseInline("[수업 종료 후 녹음 절단: 1:30:00 이후]")[0]).toMatchObject({ t: "note", kind: "cut" });
    // A code span keeps its content literal.
    expect(parseInline("`**x** [00:01]`")).toEqual([{ t: "code", v: "**x** [00:01]" }]);
  });

  test("hostile input stays text; only http(s) links become links", () => {
    const evil = parseInline('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://example.com/a?b=1) "quote"');
    expect(evil.filter((n) => n.t === "link")).toEqual([{ t: "link", href: "https://example.com/a?b=1", c: [{ t: "text", v: "ok" }] }]);
    expect(inlineText(evil)).toContain("<img src=x onerror=alert(1)>");
    expect(inlineText(evil)).toContain("[click](javascript:alert(1))");
    const blocks = parseLegacyMarkdown("<script>alert(1)</script>\n\n# <b>title</b>");
    expect(blocks[0]).toEqual({ t: "p", c: [{ t: "text", v: "<script>alert(1)</script>" }] });
    expect(blocks[1]).toMatchObject({ t: "heading", text: "<b>title</b>" });
  });

  test("an unterminated fence keeps the rest as code instead of looping", () => {
    expect(parseLegacyMarkdown("```\nline 1\nline 2")).toEqual([{ t: "code", lang: "", v: "line 1\nline 2" }]);
  });
});

describe("search hits in the palette", () => {
  test("a legacy note's hit reads as text and opens at the mark before the match", () => {
    const hit = {
      kind: "document" as const,
      recording_id: "r1",
      recording_title: "정보보호 7주차",
      document_id: "d1",
      block_id: "md-1",
      snippet: [
        { text: "…# 운영 모드\n[00:03] ECB 모드는 위험하다.\n[00:09] ", highlight: false },
        { text: "CBC", highlight: true },
        { text: " 모드는 **초기화 벡터**가 필요하다.", highlight: false },
      ],
    } as unknown as SearchHit;
    expect(hitText(hit)).toBe("…운영 모드 ECB 모드는 위험하다. CBC 모드는 초기화 벡터가 필요하다.");
    expect(hitTime(hit)).toBe(9_000);
    const noMark = { ...hit, snippet: [{ text: "[00:03] 앞줄\n", highlight: false }, { text: "CBC", highlight: true }] } as unknown as SearchHit;
    expect(hitTime(noMark)).toBeUndefined();
  });
});
