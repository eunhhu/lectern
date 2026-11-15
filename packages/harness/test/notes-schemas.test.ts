import { describe, expect, test } from "bun:test";
import { ClassifyOutput, NotesResult, VerifiedActionItem, VerifiedEvent, VerifyReport } from "../src/notes/schemas.ts";

const ok = {
  domain: "lecture",
  language: "ko",
  title: "암호 운영 모드",
  participants: [],
  folder_suggestion: { folder_id: null, new_name: null },
  tags: ["암호"],
  confidence: 0.9,
};

const evidence = { sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }], quote: "x" };

const event = {
  title: "중간고사",
  kind: "exam",
  start_at: 1792000000000,
  end_at: null,
  all_day: true,
  tz: "Asia/Seoul",
  raw_expression: "다음 주 화요일",
  resolution: { method: "parser", rule: "tomorrow" },
  confidence: 0.8,
  evidence,
  flags: ["needs_review"],
};

describe("notes schemas", () => {
  test("ClassifyOutput accepts a valid object", () => {
    expect(ClassifyOutput.safeParse(ok).success).toBe(true);
  });

  test("ClassifyOutput bounds", () => {
    expect(ClassifyOutput.safeParse({ ...ok, title: "가".repeat(61) }).success).toBe(false);
    expect(ClassifyOutput.safeParse({ ...ok, tags: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(ClassifyOutput.safeParse({ ...ok, confidence: 1.2 }).success).toBe(false);
    expect(ClassifyOutput.safeParse({ ...ok, domain: "x" }).success).toBe(false);
  });

  test("VerifiedEvent and VerifiedActionItem parse", () => {
    expect(VerifiedEvent.safeParse(event).success).toBe(true);
    expect(VerifiedEvent.safeParse({ ...event, start_at: "2026-11-01" }).success).toBe(false);
    const item = { text: "과제 제출", owner_name: null, due_at: null, due_raw: null, evidence, flags: [] };
    expect(VerifiedActionItem.safeParse(item).success).toBe(true);
  });

  test("NotesResult parses a minimal result", () => {
    const result = NotesResult.safeParse({
      classification: ok,
      template: { id: "lecture", version: 1 },
      body: { sections: [] },
      markdown: "",
      events: [],
      action_items: [],
      report: { repaired: false, dropped_blocks: 0, items: [] },
      partial: false,
    });
    expect(result.success).toBe(true);
  });

  test("VerifyReport rejects an unknown outcome", () => {
    const report = {
      repaired: false,
      dropped_blocks: 0,
      items: [{ kind: "block", ref: "summary/0", outcome: "maybe", reasons: [] }],
    };
    expect(VerifyReport.safeParse(report).success).toBe(false);
  });
});
