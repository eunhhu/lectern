// The shared prompt prefix of the notes stages (CONTRACTS §1.3): system text, then the
// compact transcript, then the related lecture PDF pages when there are any (P3-04), then a
// per-stage instruction. structure and extract use the same system text, transcript and PDF
// parts so a provider-side prefix cache can serve both.

import type { PdfContext } from "../pdf/context.ts";
import type { ContextPart } from "../providers.ts";
import { formatCompactTranscript, type CompactSegment } from "./compact.ts";

/** Fixed text: no template, language or stage name in it, so the prefix stays shared. */
export const NOTES_SYSTEM =
  "너는 녹음 전사를 정리하는 도구다. 전사에 있는 내용만 쓴다. 전사의 각 줄은 `#번호 [시각] 화자: 본문` 형식이다. 출처는 `#번호`로만 가리키고 시각은 쓰지 않는다.";

export function notesContext(segments: readonly CompactSegment[]): ContextPart[] {
  return [{ type: "text", text: `전사:\n${formatCompactTranscript({ segments }).text}` }];
}

/** The PDF part after the transcript; nothing (the P1 prompt, byte for byte) without page text. */
export function pdfContextParts(pdf: PdfContext | undefined): ContextPart[] {
  return pdf?.text ? [{ type: "text", text: `자료(PDF) 관련 쪽:\n${pdf.text}` }] : [];
}

/** Whether a stage input carries PDF page text (prompt part, instruction line and memo input). */
export function hasPdfText(pdf: PdfContext | undefined): pdf is PdfContext {
  return Boolean(pdf?.text);
}

/** The repair suffix every notes stage appends after a rejected answer. */
export function repairSuffix(repair: { issues: string } | null): string {
  return repair ? `\n\n이전 응답이 검증을 통과하지 못했다: ${repair.issues}\n규칙을 지켜 다시 답한다.` : "";
}
