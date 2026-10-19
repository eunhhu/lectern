// User-facing Korean labels for domain enums (DESIGN.md §6.5 용어집).

import type { RecordingDomain, RecordingStatus, StageName } from "../api/types.ts";
import type { Tone } from "../ui/controls.tsx";

export const DOMAIN_LABEL: Record<RecordingDomain, string> = {
  lecture: "강의",
  meeting: "회의",
  seminar: "세미나",
  interview: "인터뷰",
  one_on_one: "면담",
  call: "통화",
  other: "기타",
};

export const STATUS: Record<RecordingStatus, { label: string; tone: Tone; busy?: boolean }> = {
  uploading: { label: "올리는 중", tone: "info", busy: true },
  queued: { label: "대기 중", tone: "attention", busy: true },
  processing: { label: "처리 중", tone: "attention", busy: true },
  ready: { label: "완료", tone: "success" },
  partial: { label: "일부 완료", tone: "severe" },
  failed: { label: "실패", tone: "danger" },
  canceled: { label: "취소됨", tone: "neutral" },
};

export const STAGE_LABEL: Partial<Record<StageName, string>> = {
  legacy_distill: "문서 만드는 중",
  ingest: "파일 확인 중",
  normalize: "오디오 정리 중",
  speech_map: "말소리 구간 찾는 중",
  chunk: "나누는 중",
  transcribe: "전사 중",
  merge: "전사 합치는 중",
  speakers: "화자 구분 중",
  pdf_ingest: "PDF 읽는 중",
  align: "PDF 맞추는 중",
  classify: "분류 중",
  structure: "문서 만드는 중",
  extract: "일정·할 일 찾는 중",
  verify: "출처 확인 중",
  publish: "마무리 중",
};

export function stageLabel(stage: StageName | undefined): string {
  return (stage && STAGE_LABEL[stage]) || "처리 중";
}

/** One line for a recording that is not done: "처리 대기 중 · 2번째", "문서 만드는 중 · 40%". */
export function progressLabel(
  status: string,
  progress: { stage: StageName; progress: number | null; message: string | null; queuePosition: number | null } | null,
): string {
  if (status === "uploading") return "올리는 중…";
  if (status === "queued" || (progress?.queuePosition ?? null) !== null) {
    return progress?.queuePosition ? `처리 대기 중 · ${progress.queuePosition}번째` : "처리 대기 중…";
  }
  const what = progress?.message?.trim() || stageLabel(progress?.stage);
  return `${what}${progress?.progress != null ? ` · ${Math.round(progress.progress * 100)}%` : progress?.message ? "" : "…"}`;
}

/** Tag colours are design-token names (packages/domain Tag.color). */
export const TAG_TONE: Record<string, Tone> = {
  red: "danger",
  orange: "severe",
  yellow: "attention",
  green: "success",
  blue: "info",
  indigo: "accent",
};

export function speakerName(label: string, displayName: string | null): string {
  return displayName ?? `화자 ${label.replace(/^S/, "")}`;
}
