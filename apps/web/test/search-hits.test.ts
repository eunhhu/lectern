// Search hits as the search screen and the palette show them (D-P3-5): groups by kind in a
// fixed order, the PDF page a hit opens, and snippets cleaned run by run.

import { describe, expect, test } from "bun:test";
import type { SearchHit } from "../src/api/types.ts";
import { asId } from "../src/api/types.ts";
import { cleanSnippet, groupHits, hitPdfTarget, hitTime } from "../src/lib/search-hits.ts";

const base = { recording_id: asId<SearchHit["recording_id"]>("rec_1"), recording_title: "운영체제", snippet: [{ text: "퀀텀", highlight: true }] };
const transcript = (i: number): SearchHit => ({ ...base, kind: "transcript", segment_idx: i, start_ms: i * 1000 });
const doc: SearchHit = { ...base, kind: "document", document_id: asId("doc_1"), block_id: asId("blk_1") };
const pdf: SearchHit = { ...base, kind: "pdf_page", asset_id: asId("ast_1"), page: 4 };
const title: SearchHit = { ...base, kind: "recording" };

describe("search hits", () => {
  test("groupHits order", () => {
    const groups = groupHits([pdf, transcript(1), title, doc, transcript(2)]);
    expect(groups.map((g) => g.key)).toEqual(["recording", "transcript", "document", "pdf_page"]);
    expect(groups.map((g) => g.label)).toEqual(["녹음", "전사", "문서", "PDF"]);
    expect(groups[1]!.hits).toEqual([transcript(1), transcript(2)]);
  });

  test("groupHits omits empty and unknown", () => {
    const future = { ...base, kind: "future" } as unknown as SearchHit;
    const groups = groupHits([transcript(1), future]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("transcript");
  });

  test("hitPdfTarget", () => {
    expect(hitPdfTarget(pdf)).toEqual({ assetId: "ast_1", page: 4 });
    expect(hitPdfTarget(transcript(1))).toBeUndefined();
  });

  test("hitTime for pdf", () => {
    expect(hitTime(pdf)).toBeUndefined();
    expect(hitTime(transcript(3))).toBe(3000);
  });

  test("cleanSnippet strips marks", () => {
    const parts = cleanSnippet([
      { text: "## 제목 [12:03] ", highlight: false },
      { text: "ECB", highlight: true },
      { text: " 모드", highlight: false },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("제목 ECB 모드");
    expect(parts.filter((p) => p.highlight).map((p) => p.text)).toEqual(["ECB"]);
  });

  test("cleanSnippet drops empty", () => {
    expect(cleanSnippet([{ text: "[1:02]", highlight: false }, { text: "x", highlight: true }])).toEqual([{ text: "x", highlight: true }]);
  });

  test("cleanSnippet strips a list mark after a line break", () => {
    const parts = cleanSnippet([
      { text: "…앞 문장\n- ", highlight: false },
      { text: "퀀텀", highlight: true },
      { text: " **크기**", highlight: false },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("…앞 문장 퀀텀 크기");
  });
});
