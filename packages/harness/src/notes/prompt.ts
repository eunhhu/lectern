// The shared prompt prefix of the notes stages (CONTRACTS §1.3): system text, then the
// compact transcript, then a per-stage instruction. structure and extract use the same
// system text and transcript part so a provider-side prefix cache can serve both.

import type { ContextPart } from "../providers.ts";
import { formatCompactTranscript, type CompactSegment } from "./compact.ts";

/** Fixed text: no template, language or stage name in it, so the prefix stays shared. */
export const NOTES_SYSTEM =
  "너는 녹음 전사를 정리하는 도구다. 전사에 있는 내용만 쓴다. 전사의 각 줄은 `#번호 [시각] 화자: 본문` 형식이다. 출처는 `#번호`로만 가리키고 시각은 쓰지 않는다.";

export function notesContext(segments: readonly CompactSegment[]): ContextPart[] {
  return [{ type: "text", text: `전사:\n${formatCompactTranscript({ segments }).text}` }];
}

/** The repair suffix every notes stage appends after a rejected answer. */
export function repairSuffix(repair: { issues: string } | null): string {
  return repair ? `\n\n이전 응답이 검증을 통과하지 못했다: ${repair.issues}\n규칙을 지켜 다시 답한다.` : "";
}
