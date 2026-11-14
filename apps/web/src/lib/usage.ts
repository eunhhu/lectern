// How 설정 › 사용량 (P5-11, D-P5-7) writes a workspace's usage this month: recording time,
// AI cost in dollars (the ledger is in microdollars; no currency conversion) and storage.
// Pure functions, so the numbers are tested without a screen.

import type { WorkspaceUsage } from "../api/types.ts";

export interface UsageRow {
  label: string;
  used: string;
  /** The limit in the same units, or null when there is none. */
  max: string | null;
  /** used ÷ limit, at most 1; null without a limit. */
  ratio: number | null;
}

/** "3시간 20분", "45분", "0분": whole minutes, rounded down. */
export function formatAudioTime(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/** "$1.23" from microdollars, two decimals. */
export function formatCost(microusd: number): string {
  return `$${(Math.max(0, microusd) / 1_000_000).toFixed(2)}`;
}

/** "1.2GB", "820MB", "0B": binary steps, one decimal under 10, no space. */
export function formatStorage(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.0$/, "")}${units[unit]}`;
}

/** used ÷ limit, clipped to 1; null when there is no limit (a zero limit is full). */
export function usageRatio(used: number, limit: number | null | undefined): number | null {
  if (limit === null || limit === undefined) return null;
  if (limit <= 0) return 1;
  return Math.min(Math.max(used, 0) / limit, 1);
}

export function usageRows(u: WorkspaceUsage): UsageRow[] {
  const q = u.quota;
  return [
    {
      label: "이번 달 녹음 시간",
      used: formatAudioTime(u.audio_ms),
      max: q?.audio_ms_month != null ? formatAudioTime(q.audio_ms_month) : null,
      ratio: usageRatio(u.audio_ms, q?.audio_ms_month),
    },
    {
      label: "이번 달 AI 처리 비용",
      used: formatCost(u.ai_cost_microusd),
      max: q?.ai_microusd_month != null ? formatCost(q.ai_microusd_month) : null,
      ratio: usageRatio(u.ai_cost_microusd, q?.ai_microusd_month),
    },
    {
      label: "저장 공간",
      used: formatStorage(u.storage_bytes),
      max: q?.storage_bytes != null ? formatStorage(q.storage_bytes) : null,
      ratio: usageRatio(u.storage_bytes, q?.storage_bytes),
    },
  ];
}

/** What a row says besides its numbers (not colour alone). */
export function usageNote(ratio: number | null): string | null {
  if (ratio === null) return null;
  if (ratio >= 1) return "한도를 모두 사용했습니다.";
  if (ratio >= 0.9) return "한도에 가까워졌습니다.";
  return null;
}

/** "2026년 11월" from the ledger's "2026-11". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  return `${Number(year)}년 ${Number(month)}월`;
}
