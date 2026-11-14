// Shared inputs and scripted answers for the notes pipeline tests.

import type { NotesPipelineInput } from "../src/notes/pipeline.ts";
import type { LlmRequest } from "../src/providers.ts";
import type { Transcript } from "../src/transcript/schemas.ts";

export const RECORDED_AT_MS = Date.parse("2026-10-19T14:00:00+09:00");

const TEXTS = [
  "오늘은 운영 모드를 봅니다",
  "ECB는 위험합니다",
  "다음 주 화요일까지 과제를 제출하세요",
  "CBC는 IV가 필요합니다",
  "시험에 나옵니다",
  "수고하셨습니다",
];

export function fixtureTranscript(): Transcript {
  return {
    version: 1,
    duration_ms: 360000,
    failed_chunks: [],
    gaps: [],
    speakers: [
      { label: "S1", confidence: 1, basis: "single_chunk", segments: 6, chars: 60, members: [{ chunk: 0, label: "S1" }] },
    ],
    segments: TEXTS.map((text, idx) => ({
      idx,
      start_ms: idx * 60000,
      end_ms: idx * 60000 + 55000,
      speaker: "S1",
      source_chunk: 0,
      text,
    })),
  };
}

export function pipelineInput(over: Partial<NotesPipelineInput> = {}): NotesPipelineInput {
  return {
    transcript: fixtureTranscript(),
    filename: "lec.m4a",
    hint: { domain: null, folder_id: null },
    folders: [],
    tags: [],
    recordedAtMs: RECORDED_AT_MS,
    recordedAtSource: "client",
    tz: "Asia/Seoul",
    ...over,
  };
}

export const classifyOut = {
  domain: "lecture",
  language: "ko",
  title: "암호 운영 모드",
  participants: [],
  folder_suggestion: { folder_id: null, new_name: null },
  tags: ["암호"],
  confidence: 0.9,
};

export const structureOut = {
  sections: [
    { key: "summary", blocks: [{ type: "paragraph", heading: null, text: "운영 모드를 다룬다", sources: ["#1"], pdf_pages: [] }] },
    {
      key: "topics",
      blocks: [
        { type: "paragraph", heading: null, text: "ECB는 위험하다", sources: ["#1"], pdf_pages: [] },
        { type: "paragraph", heading: null, text: "CBC는 IV가 필요하다", sources: ["#3"], pdf_pages: [] },
      ],
    },
  ],
};

export const extractOut = {
  events: [
    {
      title: "과제 제출",
      kind: "deadline",
      raw_expression: "다음 주 화요일까지",
      model_resolution: { date: "2026-10-27", time: null, end_time: null, all_day: true },
      evidence: ["#2"],
      quote: "다음 주 화요일까지 과제를 제출하세요",
      confidence: 0.9,
    },
  ],
  glossary: [{ term: "IV", definition: "초기화 벡터", evidence: ["#3"] }],
};

export type CallKind = "classify" | "structure" | "extract" | "repair";

export function kindOf(req: LlmRequest<unknown>): CallKind {
  if (req.model === "gemini-3.5-flash-lite") return "classify";
  if (req.instruction.includes("추출 항목:")) return "extract";
  if (req.instruction.includes("이유(issues)")) return "repair";
  return "structure";
}

export function answerFor(req: LlmRequest<unknown>): unknown {
  switch (kindOf(req)) {
    case "classify":
      return classifyOut;
    case "structure":
      return structureOut;
    case "extract":
      return extractOut;
    case "repair":
      return { fixes: [] };
  }
}
