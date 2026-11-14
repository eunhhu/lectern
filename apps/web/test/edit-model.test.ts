import { describe, expect, test } from "bun:test";
import type { BlockId, DocumentBody } from "../src/api/types.ts";
import { applyFields, editableFields } from "../src/routes/recording/edit/edit-model.ts";

// The structured edit (D-P2-2): which text fields a body offers, and that applying values
// changes only those strings.

const id = (s: string) => s as BlockId;

const body: DocumentBody = {
  sections: [
    {
      key: "summary",
      title: "핵심 요약",
      blocks: [
        { id: id("b1"), type: "paragraph", heading: null, text: "FCFS는 도착 순서대로 처리한다.", sources: [{ kind: "transcript", start_idx: 0, end_idx: 1 }] },
        {
          id: id("b2"),
          type: "list",
          heading: "정리",
          style: "bullet",
          items: [
            { text: "호위 효과", sources: [{ kind: "transcript", start_idx: 2, end_idx: 2 }] },
            { text: "SJF는 최적", sources: [] },
          ],
          sources: [],
        },
        { id: id("b3"), type: "gap", kind: "break", start_ms: 60_000, end_ms: 120_000 },
      ],
    },
  ],
} as DocumentBody;

describe("editableFields", () => {
  test("paragraph and list items, no gap", () => {
    const fields = editableFields(body);
    expect(fields.map((f) => f.key)).toEqual(["b1:text", "b2:items.0", "b2:items.1"]);
    expect(fields[0]!.label).toBe("핵심 요약 · 단락");
    expect(fields[2]!.label).toBe("핵심 요약 · 목록 2번째 항목");
    expect(fields[0]!.value).toBe("FCFS는 도착 순서대로 처리한다.");
  });

  test("formula without an explanation has only the expression", () => {
    const formula = {
      sections: [{ key: "topics", title: "주제별 상세", blocks: [{ id: id("f1"), type: "formula", heading: null, expression: "x^2", explanation: null, sources: [] }] }],
    } as DocumentBody;
    expect(editableFields(formula).map((f) => f.key)).toEqual(["f1:expression"]);
  });

  test("two paragraphs in a section get distinct labels", () => {
    const two = {
      sections: [
        {
          key: "summary",
          title: "핵심 요약",
          blocks: [
            { id: id("p1"), type: "paragraph", heading: null, text: "하나", sources: [] },
            { id: id("p2"), type: "paragraph", heading: null, text: "둘", sources: [] },
          ],
        },
      ],
    } as DocumentBody;
    expect(editableFields(two).map((f) => f.label)).toEqual(["핵심 요약 · 단락", "핵심 요약 · 단락 2"]);
  });
});

describe("applyFields", () => {
  test("only the edited text changes", () => {
    const out = applyFields(body, { "b1:text": "새 글", "b2:items.1": "SJF는 평균 대기 시간이 최소" });
    const [p, list, gap] = out.sections[0]!.blocks as any[];
    expect(p.text).toBe("새 글");
    expect(p.sources).toEqual((body.sections[0]!.blocks[0] as any).sources);
    expect(p.id).toBe("b1");
    expect(list.items[0]).toEqual((body.sections[0]!.blocks[1] as any).items[0]);
    expect(list.items[1].text).toBe("SJF는 평균 대기 시간이 최소");
    expect(list.items[1].sources).toEqual([]);
    expect(gap).toEqual(body.sections[0]!.blocks[2]);
    expect(out.sections.map((s) => s.key)).toEqual(["summary"]);
    // The input is not changed.
    expect((body.sections[0]!.blocks[0] as any).text).toBe("FCFS는 도착 순서대로 처리한다.");
  });

  test("unknown keys are ignored", () => {
    expect(applyFields(body, { "x:text": "a" })).toEqual(body);
  });
});
