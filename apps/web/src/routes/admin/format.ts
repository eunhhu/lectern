// How the admin console writes money, durations and states (P5-12). Pure functions.

import type { AdminUser } from "../../api/admin.ts";
import type { Job, StageRun } from "../../api/types.ts";

/** "$0.0123", "$1.23", "$0": microdollars ÷ 1e6, at least three significant digits. */
export function formatUsd(microusd: number): string {
  if (!microusd) return "$0";
  const usd = microusd / 1_000_000;
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toPrecision(3)}`;
}

/** "0.4초", "12초", "3분 2초", "1시간 4분". */
export function formatElapsed(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}초`;
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

export const JOB_STATE_LABEL: Record<Job["state"], string> = {
  queued: "대기",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
  canceled: "취소",
};

export const JOB_KIND_LABEL: Record<Job["kind"], string> = {
  process: "녹음 처리",
  regenerate: "다시 만들기",
  compact: "오디오 압축",
  calendar_sync: "캘린더 동기화",
  reminder: "알림",
  maintenance: "유지보수",
  index: "색인",
  export: "내보내기",
  account_deletion: "계정 삭제",
};

export const STAGE_STATE_LABEL: Record<StageRun["state"], string> = {
  pending: "시작 전",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
  skipped: "건너뜀",
  canceled: "취소",
};

export const USER_STATUS_LABEL: Record<AdminUser["status"], string> = { active: "활성", pending: "승인 대기", suspended: "정지" };

const FINISHED = new Set<Job["state"]>(["succeeded", "failed", "canceled"]);

/** A finished job's time from queued to done (the list has no start time), else null. */
export function jobElapsedMs(job: Pick<Job, "state" | "created_at" | "updated_at">): number | null {
  if (!FINISHED.has(job.state)) return null;
  return Math.max(0, Date.parse(job.updated_at) - Date.parse(job.created_at));
}

/** A stage's run time; a running one counts to `now`, one never started is null. */
export function stageElapsedMs(run: Pick<StageRun, "started_at" | "finished_at">, now = Date.now()): number | null {
  if (!run.started_at) return null;
  const end = run.finished_at ? Date.parse(run.finished_at) : now;
  return Math.max(0, end - Date.parse(run.started_at));
}

/** This month and the six before it, "2026-11" first (Seoul time, like the ledger). */
export function recentPeriods(now = Date.now(), count = 7): string[] {
  const seoul = new Date(now + 9 * 3_600_000);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
