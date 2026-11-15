import { describe, expect, test } from "bun:test";
import type { DocumentBlock, DocumentBody, SourceRef } from "@lectern/domain";
import { escapeMarkdown, renderDocumentMarkdown, type RenderContext } from "../src/notes/render.ts";
import { loadTemplate, TEMPLATE_IDS } from "../src/templates.ts";

const ctx: RenderContext = {
  title: "암호 운영 모드",
  segments: [
    { idx: 1, start_ms: 63000 },
    { idx: 2, start_ms: 3725000 },
    { idx: 3, start_ms: 3800000 },
  ],
};
const noTitle: RenderContext = { ...ctx, title: null };
const src = (i: number): SourceRef[] => [{ kind: "transcript", start_idx: i, end_idx: i }];
const block = (b: Record<string, unknown>) => b as unknown as DocumentBlock;
const one = (...blocks: DocumentBlock[]): DocumentBody => ({ sections: [{ key: "s", title: "섹션", blocks }] });

const p9 = block({ id: "b9", type: "paragraph", heading: null, text: "# 제목 아님 *강조* a_b", sources: [] });
const formula = block({
  id: "b5",
  type: "formula",
  heading: null,
  expression: "C_i = E_K(P_i)",
  explanation: "ECB 암호화",
  sources: src(3),
});

const reference: DocumentBody = {
  sections: [
    {
      key: "summary",
      title: "핵심 요약",
      blocks: [
        block({ id: "b1", type: "paragraph", heading: null, text: "ECB는 같은 평문이 같은 암호문이 된다.", sources: src(1) }),
        block({
          id: "b2",
          type: "list",
          heading: null,
          style: "bullet",
          items: [
            { text: "CBC는 IV가 필요하다", sources: src(2) },
            { text: "CTR은 병렬 처리가 된다", sources: [] },
          ],
          sources: src(2),
        }),
      ],
    },
    {
      key: "topics",
      title: "주제별 상세",
      blocks: [
        block({
          id: "b3",
          type: "term",
          heading: "블록 암호",
          term: "ECB",
          definition: "각 블록을 독립적으로 암호화",
          sources: src(1),
        }),
        block({ id: "b4", type: "gap", heading: null, kind: "break", start_ms: 3012000, end_ms: 3760000, sources: [] }),
        formula,
        block({ id: "b6", type: "callout", heading: null, tone: "exam", text: "ECB의 약점이 시험에 나온다", sources: src(1) }),
        block({ id: "b7", type: "quote", heading: null, text: "중요한 건 IV입니다", speaker: "S1", sources: src(2) }),
        block({
          id: "b8",
          type: "list",
          heading: null,
          style: "numbered",
          items: [
            { text: "첫째", sources: [] },
            { text: "둘째", sources: [] },
          ],
          sources: [],
        }),
        p9,
      ],
    },
  ],
};

const EXPECTED = `# 암호 운영 모드

## 핵심 요약

ECB는 같은 평문이 같은 암호문이 된다. [01:03]

- CBC는 IV가 필요하다 [1:02:05]
- CTR은 병렬 처리가 된다

## 주제별 상세

### 블록 암호

**ECB**: 각 블록을 독립적으로 암호화 [01:03]

[쉬는 시간: 50:12~1:02:40]

$C_i = E_K(P_i)$ — ECB 암호화 [1:03:20]

> **[시험]** ECB의 약점이 시험에 나온다 [01:03]

> 중요한 건 IV입니다 — S1 [1:02:05]

1. 첫째
2. 둘째

\\# 제목 아님 \\*강조\\* a\\_b
`;

describe("renderDocumentMarkdown", () => {
  test("exact output of the reference document", () => {
    expect(renderDocumentMarkdown(reference, ctx)).toBe(EXPECTED);
  });

  test("same input gives the same output", () => {
    expect(renderDocumentMarkdown(reference, ctx) === renderDocumentMarkdown(reference, ctx)).toBe(true);
  });

  test("escapes user text", () => {
    expect(renderDocumentMarkdown(one(p9), noTitle)).toContain("\\# 제목 아님 \\*강조\\* a\\_b\n");
  });

  test("escapeMarkdown", () => {
    expect(escapeMarkdown("a[1]<b>$")).toBe("a\\[1\\]\\<b\\>\\$");
    expect(escapeMarkdown("- 항목")).toBe("\\- 항목");
    expect(escapeMarkdown("3. 항목")).toBe("3\\. 항목");
    expect(escapeMarkdown("~|!&")).toBe("~|!&");
  });

  test("formula expression is not escaped", () => {
    expect(renderDocumentMarkdown(one(formula), noTitle)).toContain("$C_i = E_K(P_i)$");
  });

  test("marker uses the first source only", () => {
    const out = renderDocumentMarkdown(
      one(block({ id: "x", type: "paragraph", heading: null, text: "본문", sources: [src(1)[0], src(2)[0]] })),
      noTitle
    );
    expect(out).toContain("본문 [01:03]");
    expect(out).not.toContain("1:02:05");
  });

  test("unknown segment idx gives no marker", () => {
    const out = renderDocumentMarkdown(
      one(block({ id: "x", type: "paragraph", heading: null, text: "본문", sources: src(99) })),
      noTitle
    );
    expect(out).toContain("본문\n");
    expect(out).not.toMatch(/ \n/);
  });

  test("pdf page marker", () => {
    const out = renderDocumentMarkdown(
      one(
        block({ id: "x", type: "paragraph", heading: null, text: "본문", sources: [{ kind: "pdf_page", asset_id: "a1", page: 3 }] })
      ),
      noTitle
    );
    expect(out).toContain("본문 [p.3]");
  });

  test("hour clock", () => {
    const out = renderDocumentMarkdown(reference, ctx);
    expect(out).toContain("[1:02:05]");
    expect(out).toContain("[01:03]");
  });

  test("unknown block type is skipped", () => {
    const body: DocumentBody = {
      sections: [
        {
          key: "s",
          title: "섹션",
          blocks: [
            block({ id: "x", type: "video", sources: [] }),
            block({ id: "y", type: "paragraph", heading: null, text: "ECB", sources: src(1) }),
          ],
        },
      ],
    };
    const out = renderDocumentMarkdown(body, ctx);
    expect(out).not.toContain("video");
    expect(out).not.toContain("\n\n\n");
  });

  test("empty section is skipped", () => {
    const body: DocumentBody = {
      sections: [
        { key: "a", title: "빈 섹션", blocks: [] },
        { key: "b", title: "찬 섹션", blocks: [block({ id: "y", type: "paragraph", heading: null, text: "x", sources: [] })] },
      ],
    };
    const out = renderDocumentMarkdown(body, ctx);
    expect(out).not.toContain("## 빈 섹션");
    expect(out).toContain("## 찬 섹션");
  });

  test("empty body", () => {
    expect(renderDocumentMarkdown({ sections: [] }, { title: null, segments: [] })).toBe("");
  });

  test("title null or blank", () => {
    const body = one(block({ id: "y", type: "paragraph", heading: null, text: "x", sources: [] }));
    expect(renderDocumentMarkdown(body, noTitle).startsWith("# ")).toBe(false);
    expect(renderDocumentMarkdown(body, { ...ctx, title: "  " }).startsWith("# ")).toBe(false);
  });

  test("single-line fields flatten newlines", () => {
    const out = renderDocumentMarkdown(
      one(
        block({
          id: "y",
          type: "list",
          heading: "가\n나",
          style: "bullet",
          items: [{ text: "다\n라", sources: [] }],
          sources: [],
        })
      ),
      noTitle
    );
    expect(out).toContain("### 가 나");
    expect(out).toContain("- 다 라");
  });

  test("multi-line callout and quote", () => {
    const out = renderDocumentMarkdown(
      one(
        block({ id: "c", type: "callout", heading: null, tone: "exam", text: "가\n나", sources: [] }),
        block({ id: "q", type: "quote", heading: null, text: "다\n라", speaker: "S1", sources: [] })
      ),
      noTitle
    );
    expect(out).toContain("> **[시험]** 가\n> 나");
    expect(out).toContain("> 다\n> 라 — S1");
  });

  test("numbered list counts from 1", () => {
    const out = renderDocumentMarkdown(
      one(
        block({
          id: "n",
          type: "list",
          heading: null,
          style: "numbered",
          items: ["a", "b", "c"].map((text) => ({ text, sources: [] })),
          sources: [],
        })
      ),
      noTitle
    );
    expect(out).toContain("1. a\n2. b\n3. c");
  });

  test("snapshot per template", () => {
    for (const id of TEMPLATE_IDS) {
      const def = loadTemplate(id).def;
      const body: DocumentBody = {
        sections: def.sections.map((section, i) => ({
          key: section.key,
          title: section.title,
          blocks: [
            block({ id: `b${i + 1}`, type: "paragraph", heading: null, text: `${section.title} 내용`, sources: src(1) }),
          ],
        })),
      };
      const out = renderDocumentMarkdown(body, ctx);
      let at = -1;
      for (const section of def.sections) {
        const next = out.indexOf(`## ${section.title}\n`);
        expect(next).toBeGreaterThan(at);
        at = next;
      }
      expect(out).toMatchSnapshot(id);
    }
  });

  test("output ends with one newline", () => {
    const out = renderDocumentMarkdown(reference, ctx);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
