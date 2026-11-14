// Scripted notes-pipeline answers for process-job.test.ts and fixtures/process-worker.ts:
// a lecture classified with confidence, two structure sections that cite segments #1 and
// #3, and nothing to extract. The speech is synthetic, so the text need not match it.

import type { LlmRequest } from "@lectern/harness";

export type NotesCall = "classify" | "structure" | "extract" | "repair";

export function notesCallOf(req: LlmRequest<unknown>): NotesCall {
  if (req.model === "gemini-3.5-flash-lite") return "classify";
  if (req.instruction.includes("추출 항목:")) return "extract";
  if (req.instruction.includes("이유(issues)")) return "repair";
  return "structure";
}

export function notesAnswer(req: LlmRequest<unknown>): unknown {
  switch (notesCallOf(req)) {
    case "classify":
      return {
        domain: "lecture",
        language: "ko",
        title: "블록 암호 운영 모드",
        participants: [],
        folder_suggestion: { folder_id: null, new_name: null },
        tags: ["암호"],
        confidence: 0.9,
      };
    case "structure":
      return {
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
    case "extract":
      return { events: [], glossary: [] };
    case "repair":
      return { fixes: [] };
  }
}
