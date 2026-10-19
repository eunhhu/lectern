import { TemplateDefinition } from "./harness.ts";

// Two placeholder templates that prove the TemplateDefinition shape (AI_HARNESS §7).
// The real ones, with prompts and renderers, belong to packages/harness/templates.
// Parsing at module load keeps them honest.

// Both placeholders still enable `questions` to prove the definition shape. Real
// templates (packages/harness, P1) leave it off by default: review questions were
// dropped from the default pipeline in ADR-0009 in favour of /ask.
export const LECTURE_TEMPLATE = TemplateDefinition.parse({
  id: "lecture",
  version: 1,
  name: "강의 노트",
  domains: ["lecture"],
  sections: [
    {
      key: "summary",
      title: "핵심 요약",
      fill: "structure",
      instructions: "강의 전체의 핵심을 짧은 문단이나 목록으로 요약한다.",
      block_types: ["paragraph", "list"],
      required: true,
    },
    {
      key: "exam_points",
      title: "시험·과제 포인트",
      fill: "structure",
      instructions: "시험, 과제, 강조된 내용을 모은다.",
      block_types: ["callout", "list"],
      required: false,
    },
    {
      key: "topics",
      title: "주제별 상세",
      fill: "structure",
      instructions: "주제마다 heading을 두고 용어, 공식, 예시를 정리한다.",
      block_types: ["paragraph", "list", "term", "formula", "callout"],
      required: true,
    },
    {
      key: "quotes",
      title: "주요 발언",
      fill: "structure",
      instructions: "그대로 옮길 가치가 있는 발언만 고른다.",
      block_types: ["quote"],
      required: false,
    },
    { key: "questions", title: "질문", fill: "questions", instructions: "", block_types: ["list"], required: false },
  ],
  extract: { events: true, action_items: false, questions: true, decisions: false, glossary: true },
  question_kinds: ["recall"],
});

export const MEETING_TEMPLATE = TemplateDefinition.parse({
  id: "meeting",
  version: 1,
  name: "회의록",
  domains: ["meeting", "one_on_one", "call"],
  sections: [
    {
      key: "summary",
      title: "요약",
      fill: "structure",
      instructions: "회의 목적과 결론을 짧게 요약한다.",
      block_types: ["paragraph", "list"],
      required: true,
    },
    { key: "decisions", title: "결정 사항", fill: "decisions", instructions: "", block_types: ["list"], required: false },
    { key: "action_items", title: "할 일", fill: "action_items", instructions: "", block_types: ["list"], required: false },
    {
      key: "topics",
      title: "논의 주제별 요점",
      fill: "structure",
      instructions: "논의 주제마다 heading을 두고 요점과 근거를 정리한다.",
      block_types: ["paragraph", "list", "quote"],
      required: true,
    },
    {
      key: "open_issues",
      title: "미결 쟁점",
      fill: "structure",
      instructions: "결론이 나지 않은 쟁점과 이유를 적는다.",
      block_types: ["list", "paragraph"],
      required: false,
    },
    { key: "next_events", title: "다음 일정", fill: "events", instructions: "", block_types: ["list"], required: false },
  ],
  extract: { events: true, action_items: true, questions: true, decisions: true, glossary: false },
  question_kinds: ["issue", "discussion"],
});

export const TEMPLATES = {
  lecture: LECTURE_TEMPLATE,
  meeting: MEETING_TEMPLATE,
} as const;
