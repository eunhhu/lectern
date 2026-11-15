// E-mail reminders (P4-05, CONTRACTS D-P4-7). With the workspace setting `reminders.email` on,
// an accepted event and an open action item with a due date get one `reminder` row per lead
// time; the `reminder` job mails the due rows every five minutes. The recipient is the user
// who created the recording (while they are still a member of its workspace).
//
// One reminder is never sent twice: a row is claimed (`scheduled` → `sent`) before the mail
// goes out, and a failed send is not retried. Logs carry the reminder id and the result only.

import { config } from "@lectern/config";
import { escapeHtml } from "@lectern/core";
import { uuidv7 } from "@lectern/db";
import { db } from "./db.ts";
import { logger } from "./log.ts";
import { sendMail } from "./mail.ts";
import { enqueueJob, type JobOutcome, registerJobHandler } from "./queue.ts";

export const REMINDER_JOB_KIND = "reminder";

const DEFAULT_LEAD_MINUTES = [1440];
const SEND_BATCH = 50;
const RETENTION_MS = 90 * 86_400_000;
const SCHEDULE_EVERY_MS = 5 * 60_000;
const DEFAULT_TZ = "Asia/Seoul";

type TargetType = "event" | "action_item";

interface Target {
  type: TargetType;
  id: string;
  workspaceId: string;
  status: string;
  /** start_at or due_at. */
  at: number | null;
  title: string;
  allDay: boolean;
  tz: string | null;
  recordingId: string;
  recordingTitle: string;
  userId: string;
  member: boolean;
}

/** The workspace's reminder setting. Absent or malformed → off; on with no usable lead → [1440]. */
export function reminderSettings(workspaceId: string): { email: boolean; leadMinutes: number[] } {
  const row = db.query(`SELECT settings_json FROM workspace WHERE id = ?`).get(workspaceId) as { settings_json: string } | null;
  let raw: any = null;
  try {
    raw = row ? JSON.parse(row.settings_json)?.reminders : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || raw.email !== true) return { email: false, leadMinutes: [] };
  const leads = Array.isArray(raw.lead_minutes)
    ? [...new Set(raw.lead_minutes.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 5 && (n as number) <= 43200) as number[])].slice(0, 5)
    : [];
  return { email: true, leadMinutes: leads.length ? leads : DEFAULT_LEAD_MINUTES };
}

function loadTarget(type: TargetType, id: string): Target | null {
  const row =
    type === "event"
      ? (db
          .query(
            `SELECT e.id, e.workspace_id, e.status, e.start_at AS at, e.title, e.all_day, e.tz,
                    r.id AS recording_id, r.title AS recording_title, r.created_by AS user_id,
                    EXISTS (SELECT 1 FROM membership m WHERE m.workspace_id = e.workspace_id AND m.user_id = r.created_by) AS member
             FROM event_candidate e JOIN recording r ON r.id = e.recording_id WHERE e.id = ?`
          )
          .get(id) as any)
      : (db
          .query(
            `SELECT a.id, a.workspace_id, a.status, a.due_at AS at, a.text AS title, 0 AS all_day, NULL AS tz,
                    r.id AS recording_id, r.title AS recording_title, r.created_by AS user_id,
                    EXISTS (SELECT 1 FROM membership m WHERE m.workspace_id = a.workspace_id AND m.user_id = r.created_by) AS member
             FROM action_item a JOIN recording r ON r.id = a.recording_id WHERE a.id = ?`
          )
          .get(id) as any);
  if (!row) return null;
  return {
    type,
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    at: row.at ?? null,
    title: row.title,
    allDay: Boolean(row.all_day),
    tz: row.tz ?? null,
    recordingId: row.recording_id,
    recordingTitle: row.recording_title,
    userId: row.user_id,
    member: Boolean(row.member),
  };
}

/** An accepted event, or an open action item with a due date, whose recipient is still a member. */
function qualifies(t: Target): boolean {
  if (!t.member || t.at === null) return false;
  return t.type === "event" ? t.status === "accepted" || t.status === "synced" : t.status === "open";
}

/** Brings one target's `scheduled` rows in line with what it should have now. */
function syncTarget(type: TargetType, id: string, now = Date.now()): void {
  const target = loadTarget(type, id);
  const wanted = new Set<number>();
  if (target && qualifies(target)) {
    const settings = reminderSettings(target.workspaceId);
    if (settings.email) {
      for (const lead of settings.leadMinutes) {
        const sendAt = target.at! - lead * 60_000;
        if (sendAt > now) wanted.add(sendAt);
      }
    }
  }
  db.transaction(() => {
    const scheduled = db
      .query(`SELECT id, user_id, send_at FROM reminder WHERE target_type = ? AND target_id = ? AND state = 'scheduled'`)
      .all(type, id) as Array<{ id: string; user_id: string; send_at: number }>;
    for (const row of scheduled) {
      if (!target || row.user_id !== target.userId || !wanted.has(row.send_at)) {
        db.query(`UPDATE reminder SET state = 'canceled' WHERE id = ? AND state = 'scheduled'`).run(row.id);
      }
    }
    if (!target) return;
    for (const sendAt of wanted) {
      // A row canceled earlier (dismissed, then accepted again; moved, then moved back) comes
      // back; a `sent` or `failed` one stays as it is, so nothing is mailed twice.
      db.query(
        `INSERT INTO reminder (id, workspace_id, user_id, target_type, target_id, send_at, state, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?)
         ON CONFLICT (user_id, target_type, target_id, send_at) DO UPDATE SET state = 'scheduled' WHERE state = 'canceled'`
      ).run(uuidv7(), target.workspaceId, target.userId, type, id, sendAt, now);
    }
  })();
}

/** Never throws: a reminder problem must not fail the change that triggered it. */
function guarded(what: string, ids: Record<string, string>, run: () => void): void {
  if (!config().calendar) return;
  try {
    run();
  } catch (err) {
    logger.warn(`reminder sync failed (${what})`, { ...ids, err });
  }
}

export function syncRemindersForEvent(eventId: string): void {
  guarded("event", { event_candidate_id: eventId }, () => syncTarget("event", eventId));
}

export function syncRemindersForActionItem(actionItemId: string): void {
  guarded("action_item", { action_item_id: actionItemId }, () => syncTarget("action_item", actionItemId));
}

/** Every target of the workspace that could have reminders, and every one that still has some. */
export function syncRemindersForWorkspace(workspaceId: string): void {
  guarded("workspace", { workspace_id: workspaceId }, () => {
    const now = Date.now();
    const targets = new Map<string, TargetType>();
    const events = db
      .query(`SELECT id FROM event_candidate WHERE workspace_id = ? AND status IN ('accepted', 'synced') AND start_at > ?`)
      .all(workspaceId, now) as Array<{ id: string }>;
    for (const e of events) targets.set(`event:${e.id}`, "event");
    const items = db
      .query(`SELECT id FROM action_item WHERE workspace_id = ? AND status = 'open' AND due_at > ?`)
      .all(workspaceId, now) as Array<{ id: string }>;
    for (const a of items) targets.set(`action_item:${a.id}`, "action_item");
    const pending = db
      .query(`SELECT DISTINCT target_type, target_id FROM reminder WHERE workspace_id = ? AND state = 'scheduled'`)
      .all(workspaceId) as Array<{ target_type: TargetType; target_id: string }>;
    for (const r of pending) targets.set(`${r.target_type}:${r.target_id}`, r.target_type);
    for (const [key, type] of targets) syncTarget(type, key.slice(type.length + 1), now);
  });
}

function formatWhen(at: number, tz: string, allDay: boolean): string {
  const options: Intl.DateTimeFormatOptions = allDay ? { dateStyle: "long" } : { dateStyle: "long", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: tz }).format(at);
  } catch {
    return new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: DEFAULT_TZ }).format(at);
  }
}

/** One line of plain text for a subject. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function reminderMail(r: {
  kind: "event" | "action_item";
  title: string;
  at: number;
  allDay: boolean;
  tz: string;
  recordingId: string;
  recordingTitle: string;
}): { subject: string; html: string } {
  const base = config().baseUrl.replace(/\/+$/, "");
  const title = oneLine(r.title);
  const subject =
    r.kind === "event" ? `[Lectern] 일정 알림: ${title}` : `[Lectern] 할 일 마감 알림: ${Array.from(title).slice(0, 60).join("")}`;
  const heading = r.kind === "event" ? "일정 알림" : "할 일 마감 알림";
  const whenLabel = r.kind === "event" ? "일시" : "마감";
  const recordingUrl = `${base}/app/recordings/${encodeURIComponent(r.recordingId)}`;
  const settingsUrl = `${base}/app/settings#reminders`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 28px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; color: #111827;">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #111827;">Lectern</div>
      <div style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 20px;">${heading}</div>
      <p style="font-size: 16px; font-weight: 600; line-height: 24px; color: #111827; margin: 0 0 8px;">${escapeHtml(r.title)}</p>
      <p style="font-size: 14px; line-height: 22px; color: #4b5563; margin: 0 0 20px;">${whenLabel}: ${escapeHtml(formatWhen(r.at, r.tz, r.allDay))}</p>
      <p style="font-size: 14px; line-height: 22px; color: #4b5563; margin: 0 0 20px;">
        출처 녹음: <a href="${escapeHtml(recordingUrl)}" style="color: #2563eb;">${escapeHtml(r.recordingTitle)}</a>
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin: 0;">
        이 알림은 Lectern 설정의 "알림"에서 끌 수 있습니다. <a href="${escapeHtml(settingsUrl)}" style="color: #9ca3af;">알림 설정</a>
      </p>
    </div>
  `;
  return { subject, html };
}

/** Mails up to 50 due reminders. A target that no longer qualifies, or is already past, is canceled. */
export async function sendDueReminders(now = Date.now()): Promise<{ sent: number; failed: number; skipped: number }> {
  const counts = { sent: 0, failed: 0, skipped: 0 };
  const due = db
    .query(`SELECT * FROM reminder WHERE state = 'scheduled' AND send_at <= ? ORDER BY send_at, id LIMIT ?`)
    .all(now, SEND_BATCH) as Array<{ id: string; user_id: string; target_type: TargetType; target_id: string; send_at: number }>;
  for (const row of due) {
    const target = loadTarget(row.target_type, row.target_id);
    const settings = target ? reminderSettings(target.workspaceId) : null;
    const user = db.query(`SELECT email, timezone FROM users WHERE id = ?`).get(row.user_id) as { email: string; timezone: string | null } | null;
    const stillWanted =
      target !== null &&
      qualifies(target) &&
      target.at! > now &&
      target.userId === row.user_id &&
      settings!.email &&
      settings!.leadMinutes.includes((target.at! - row.send_at) / 60_000) &&
      user !== null;
    if (!stillWanted) {
      db.query(`UPDATE reminder SET state = 'canceled' WHERE id = ? AND state = 'scheduled'`).run(row.id);
      counts.skipped++;
      logger.info("reminder skipped", { reminder_id: row.id });
      continue;
    }
    // Claim first: if two runs overlap, only one of them mails it.
    if (db.query(`UPDATE reminder SET state = 'sent', sent_at = ? WHERE id = ? AND state = 'scheduled'`).run(now, row.id).changes === 0) continue;
    const mail = reminderMail({
      kind: target!.type,
      title: target!.title,
      at: target!.at!,
      allDay: target!.allDay,
      tz: target!.tz ?? user!.timezone ?? DEFAULT_TZ,
      recordingId: target!.recordingId,
      recordingTitle: target!.recordingTitle,
    });
    try {
      await sendMail({ to: user!.email, subject: mail.subject, html: mail.html });
      counts.sent++;
      logger.info("reminder sent", { reminder_id: row.id });
    } catch {
      // Not retried: missing one reminder is better than sending it twice. The error text may
      // echo the address, so it is not logged.
      db.query(`UPDATE reminder SET state = 'failed' WHERE id = ?`).run(row.id);
      counts.failed++;
      logger.warn("reminder failed", { reminder_id: row.id });
    }
  }
  return counts;
}

/** Deletes finished rows (sent, canceled, failed) 90 days after they were sent or due (privacy policy). */
export function pruneReminders(now = Date.now()): number {
  return db
    .query(`DELETE FROM reminder WHERE state IN ('sent', 'canceled', 'failed') AND COALESCE(sent_at, send_at) < ?`)
    .run(now - RETENTION_MS).changes;
}

/** Queues the `reminder` job unless one is already queued or running. */
export function enqueueReminderRun(): boolean {
  return !enqueueJob({ kind: REMINDER_JOB_KIND, ownerId: "system", subjectId: "due", priority: -1 }).deduplicated;
}

export async function runReminderJob(): Promise<JobOutcome> {
  const counts = await sendDueReminders();
  const pruned = pruneReminders();
  return { ok: true, result: { ...counts, pruned } };
}

/**
 * Every five minutes, where the maintenance schedule runs (one scheduler). Not started with
 * LECTERN_CALENDAR off.
 */
export function startReminderSchedule(): () => void {
  if (!config().calendar) return () => {};
  const tick = () => {
    try {
      enqueueReminderRun();
    } catch (err) {
      logger.error("could not queue reminders", { err });
    }
  };
  const first = setTimeout(tick, 60_000);
  first.unref?.();
  const every = setInterval(tick, SCHEDULE_EVERY_MS);
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

registerJobHandler(REMINDER_JOB_KIND, () => runReminderJob(), { concurrency: 1 });
