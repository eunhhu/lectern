// Workspace usage and quotas (P5-07, CONTRACTS D-P5-7). Usage is counted from the source rows
// (recording, ai_call, asset); usage_ledger keeps a copy per (workspace, month) for the
// operator's list. An operator sets a workspace's limits by hand (D10); a workspace with no
// workspace_quota row has no limit. Over a limit, new uploads (and, for the AI limit, Ask)
// are refused with 409 quota_exceeded. Work already accepted is never stopped.

import { personalWorkspaceId, uuidv7 } from "@lectern/db";
import { db } from "./db.ts";

/** Asia/Seoul has no daylight saving: a month there is a fixed +9h shift of UTC. */
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

export interface Usage {
  period: string;
  audio_ms: number;
  ai_cost_microusd: number;
  storage_bytes: number;
}

export interface Quota {
  audio_ms_month: number | null;
  ai_microusd_month: number | null;
  storage_bytes: number | null;
}

export type QuotaLimit = keyof Quota;

export interface QuotaProblem {
  code: "quota_exceeded";
  message: string;
  details: { limit: QuotaLimit; used: number; max: number };
}

/** "YYYY-MM" of the month in Seoul. */
export function periodOf(now = Date.now()): string {
  return new Date(now + SEOUL_OFFSET_MS).toISOString().slice(0, 7);
}

/** The month's epoch-ms range in Seoul, [from, to). */
export function periodBounds(period: string): { from: number; to: number } {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new Error(`invalid period: ${period}`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return { from: Date.UTC(year, month, 1) - SEOUL_OFFSET_MS, to: Date.UTC(year, month + 1, 1) - SEOUL_OFFSET_MS };
}

const sum = (row: unknown) => Number((row as { n: number | null } | null)?.n ?? 0);

/** The user whose personal workspace this is; "" (matches no job) for a team. */
function personalOwnerOf(workspaceId: string): string {
  const members = db.query(`SELECT user_id FROM membership WHERE workspace_id = ? AND role = 'owner'`).all(workspaceId) as Array<{ user_id: string }>;
  return members.find((m) => personalWorkspaceId(m.user_id) === workspaceId)?.user_id ?? "";
}

/** Counted from the source rows; the ledger only keeps a copy of this. */
export function measureUsage(workspaceId: string, period = periodOf()): Usage {
  const { from, to } = periodBounds(period);
  // Deleted recordings lose their rows (packages/db projection), so they are not counted.
  const audio = db
    .query(`SELECT SUM(COALESCE(duration_ms, 0)) AS n FROM recording WHERE workspace_id = ? AND created_at >= ? AND created_at < ?`)
    .get(workspaceId, from, to);
  // A call of the v1 distillation job (job-handlers.ts runDistillationOnHarness) has no
  // workspace on the row or on its job: it counts toward the job owner's personal workspace,
  // as adminListJobs reads it.
  const ai = db
    .query(
      `SELECT SUM(a.cost_microusd) AS n FROM ai_call a
       WHERE a.created_at >= ? AND a.created_at < ?
         AND (a.workspace_id = ? OR (a.workspace_id IS NULL AND EXISTS (
           SELECT 1 FROM job j WHERE j.id = a.job_id AND (j.workspace_id = ? OR (j.workspace_id IS NULL AND j.owner_id = ?)))))`
    )
    .get(from, to, workspaceId, workspaceId, personalOwnerOf(workspaceId));
  // Storage is what the workspace holds now, whatever the month.
  const storage = db.query(`SELECT SUM(bytes) AS n FROM asset WHERE workspace_id = ?`).get(workspaceId);
  return { period, audio_ms: sum(audio), ai_cost_microusd: sum(ai), storage_bytes: sum(storage) };
}

/** Writes the measured numbers into usage_ledger; returns them. */
export function refreshLedger(workspaceId: string, period = periodOf(), now = Date.now()): Usage {
  const usage = measureUsage(workspaceId, period);
  db.query(
    `INSERT INTO usage_ledger (id, workspace_id, period, audio_ms, ai_cost_microusd, storage_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, period) DO UPDATE SET
       audio_ms = excluded.audio_ms, ai_cost_microusd = excluded.ai_cost_microusd,
       storage_bytes = excluded.storage_bytes, updated_at = excluded.updated_at`
  ).run(uuidv7(now), workspaceId, period, usage.audio_ms, usage.ai_cost_microusd, usage.storage_bytes, now);
  return usage;
}

/** This month's ledger row for every workspace that has a recording; returns how many. */
export function refreshAllLedgers(now = Date.now()): number {
  const period = periodOf(now);
  const workspaces = db.query(`SELECT DISTINCT workspace_id FROM recording ORDER BY workspace_id`).all() as Array<{ workspace_id: string }>;
  db.transaction(() => {
    for (const w of workspaces) refreshLedger(w.workspace_id, period, now);
  })();
  return workspaces.length;
}

interface QuotaRow {
  audio_ms_month: number | null;
  ai_microusd_month: number | null;
  storage_bytes: number | null;
}

/** The workspace's limits, or null when it has none (no limit at all). */
export function quotaOf(workspaceId: string): Quota | null {
  const row = db
    .query(`SELECT audio_ms_month, ai_microusd_month, storage_bytes FROM workspace_quota WHERE workspace_id = ?`)
    .get(workspaceId) as QuotaRow | null;
  return row ? { audio_ms_month: row.audio_ms_month, ai_microusd_month: row.ai_microusd_month, storage_bytes: row.storage_bytes } : null;
}

/** Upserts the limits; three nulls remove the row (back to no limit). */
export function setQuota(workspaceId: string, q: Quota, updatedBy: string, now = Date.now()): void {
  if (q.audio_ms_month === null && q.ai_microusd_month === null && q.storage_bytes === null) {
    db.query(`DELETE FROM workspace_quota WHERE workspace_id = ?`).run(workspaceId);
    return;
  }
  db.query(
    `INSERT INTO workspace_quota (workspace_id, audio_ms_month, ai_microusd_month, storage_bytes, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET
       audio_ms_month = excluded.audio_ms_month, ai_microusd_month = excluded.ai_microusd_month,
       storage_bytes = excluded.storage_bytes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(workspaceId, q.audio_ms_month, q.ai_microusd_month, q.storage_bytes, updatedBy, now);
}

const MESSAGES: Record<QuotaLimit, string> = {
  audio_ms_month: "이번 달 녹음 시간 한도를 모두 사용했습니다. 다음 달에 다시 올리거나 관리자에게 문의해 주세요.",
  ai_microusd_month: "이번 달 AI 처리 한도를 모두 사용했습니다. 다음 달에 다시 시도하거나 관리자에게 문의해 주세요.",
  storage_bytes: "저장 공간 한도를 넘습니다. 필요 없는 녹음이나 오디오를 지운 뒤 다시 시도해 주세요.",
};

/**
 * The first limit the workspace is over (audio, then AI, then storage), or null. No quota row:
 * null without counting anything. `bytes` is the size about to be added (counts toward
 * storage); `only` checks that one limit alone (Ask is held back by the AI limit only).
 */
export function quotaProblem(workspaceId: string, add: { bytes?: number; only?: QuotaLimit } = {}, now = Date.now()): QuotaProblem | null {
  const quota = quotaOf(workspaceId);
  if (!quota) return null;
  const usage = measureUsage(workspaceId, periodOf(now));
  const checks: Array<{ limit: QuotaLimit; over: (max: number) => boolean; used: number }> = [
    { limit: "audio_ms_month", used: usage.audio_ms, over: (max) => usage.audio_ms >= max },
    { limit: "ai_microusd_month", used: usage.ai_cost_microusd, over: (max) => usage.ai_cost_microusd >= max },
    { limit: "storage_bytes", used: usage.storage_bytes, over: (max) => usage.storage_bytes + (add.bytes ?? 0) > max },
  ];
  for (const check of checks) {
    const max = quota[check.limit];
    if (max === null || (add.only && add.only !== check.limit)) continue;
    if (check.over(max)) {
      return { code: "quota_exceeded", message: MESSAGES[check.limit], details: { limit: check.limit, used: check.used, max } };
    }
  }
  return null;
}
