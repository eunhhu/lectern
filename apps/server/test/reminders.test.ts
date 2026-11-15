import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, uuidv7 } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { createUser, db, deleteUserAndData, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { embeddedWorker, type JobWorker } from "../src/queue.ts";
import {
  enqueueReminderRun,
  pruneReminders,
  REMINDER_JOB_KIND,
  reminderMail,
  reminderSettings,
  sendDueReminders,
  syncRemindersForEvent,
  syncRemindersForWorkspace,
} from "../src/reminders.ts";

// E-mail reminders (P4-05, D-P4-7): one row per lead time, sent once, canceled when the
// target stops qualifying, never sent for something already past.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RESEND_URL = "https://api.resend.com/emails";

const realFetch = globalThis.fetch;
let mails: Array<{ to: string[]; subject: string; html: string }> = [];
let resendStatus = 200;

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

async function api(method: string, path: string, user: UserRecord, body?: unknown): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null };
}

/** A user, their personal workspace (with `settings`) and a recording in it. */
function setup(settings?: unknown) {
  const user = makeUser("rem");
  const workspaceId = personalWorkspaceId(user.id);
  if (settings !== undefined) db.query(`UPDATE workspace SET settings_json = ? WHERE id = ?`).run(JSON.stringify(settings), workspaceId);
  const recordingId = generateId("rec");
  const now = Date.now();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
     VALUES (?, ?, NULL, '운영체제 7주차', ?, 'upload', 'ready', ?, 'private', ?, ?)`,
  ).run(recordingId, workspaceId, now, user.id, now, now);
  return { user, workspaceId, recordingId };
}

function insertEvent(workspaceId: string, recordingId: string, opts: { startAt: number; status?: string; title?: string }): string {
  const id = generateId("evc");
  const now = Date.now();
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
       resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'exam', ?, ?, NULL, 0, 'Asia/Seoul', '다음 주', ?, 0.9, ?, '[]', ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    recordingId,
    opts.title ?? "중간고사",
    opts.startAt,
    JSON.stringify({ method: "parser", rule: "next_week_weekday" }),
    JSON.stringify({ sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }], quote: "시험" }),
    opts.status ?? "suggested",
    now,
    now,
  );
  return id;
}

function insertItem(workspaceId: string, recordingId: string, opts: { dueAt: number | null; status?: string }): string {
  const id = generateId("act");
  const now = Date.now();
  db.query(
    `INSERT INTO action_item (id, workspace_id, recording_id, text, owner_name, due_at, due_raw, status, evidence_json, flags_json, created_at, updated_at)
     VALUES (?, ?, ?, '과제 제출', NULL, ?, NULL, ?, ?, '[]', ?, ?)`,
  ).run(
    id,
    workspaceId,
    recordingId,
    opts.dueAt,
    opts.status ?? "open",
    JSON.stringify({ sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }], quote: "과제" }),
    now,
    now,
  );
  return id;
}

const rowsOf = (targetId: string) =>
  db.query(`SELECT state, send_at FROM reminder WHERE target_id = ? ORDER BY send_at, state`).all(targetId) as Array<{ state: string; send_at: number }>;
const startOf = (eventId: string) => (db.query(`SELECT start_at FROM event_candidate WHERE id = ?`).get(eventId) as { start_at: number }).start_at;

function insertReminder(r: { user: UserRecord; workspaceId: string; targetType?: string; targetId: string; sendAt: number; state?: string; sentAt?: number | null }): string {
  const id = uuidv7();
  db.query(
    `INSERT INTO reminder (id, workspace_id, user_id, target_type, target_id, send_at, state, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.workspaceId, r.user.id, r.targetType ?? "event", r.targetId, r.sendAt, r.state ?? "scheduled", r.sentAt ?? null, Date.now());
  return id;
}

const ON = (lead_minutes: number[]) => ({ reminders: { email: true, lead_minutes } });
const ENV = { LECTERN_CALENDAR: "1", GOOGLE_OAUTH_CLIENT_ID: "test-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-secret", LECTERN_WORKER_MODE: "external" };

// This file runs the reminder job itself: the shared embedded worker must not lease its jobs.
let paused: JobWorker | null = null;

beforeAll(async () => {
  Object.assign(process.env, ENV);
  process.env.RESEND_API_KEY = "test-key-never-sent";
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url) === RESEND_URL) {
      mails.push(JSON.parse(init.body));
      return resendStatus === 200 ? Response.json({ id: "email_test" }) : new Response("upstream error", { status: resendStatus });
    }
    throw new Error(`unexpected outbound request: ${String(url)}`);
  }) as typeof fetch;
});
beforeEach(() => {
  mails = [];
  resendStatus = 200;
  db.query(`DELETE FROM reminder`).run();
});
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(ENV)) delete process.env[key];
  delete process.env.RESEND_API_KEY;
  resetConfigForTests();
  paused?.start();
});

describe("reminders", () => {
  test("setting off creates nothing", async () => {
    const { user, workspaceId, recordingId } = setup();
    const id = insertEvent(workspaceId, recordingId, { startAt: Date.now() + 3 * DAY });
    expect((await api("PATCH", `/calendar/suggestions/${id}`, user, { status: "accepted" })).status).toBe(200);
    expect(rowsOf(id)).toEqual([]);
  });

  test("reminderSettings defaults", () => {
    expect(reminderSettings(setup().workspaceId)).toEqual({ email: false, leadMinutes: [] });
    expect(reminderSettings(setup({ reminders: { email: true } }).workspaceId)).toEqual({ email: true, leadMinutes: [1440] });
    expect(reminderSettings(setup({ reminders: { email: true, lead_minutes: [] } }).workspaceId)).toEqual({ email: true, leadMinutes: [1440] });
    expect(reminderSettings(setup(ON([60, 60, 1440])).workspaceId)).toEqual({ email: true, leadMinutes: [60, 1440] });
    expect(reminderSettings(setup({ reminders: { email: false, lead_minutes: [60] } }).workspaceId).email).toBe(false);
  });

  test("accept schedules one row per lead", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440, 60]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start });
    expect((await api("POST", `/calendar/suggestions/batch`, user, { event_candidate_ids: [id], action: "accept" })).status).toBe(200);
    expect(rowsOf(id)).toEqual([
      { state: "scheduled", send_at: start - DAY },
      { state: "scheduled", send_at: start - HOUR },
    ]);
    // Syncing again changes nothing (the unique index holds one row per lead).
    syncRemindersForEvent(id);
    expect(rowsOf(id)).toHaveLength(2);
  });

  test("a lead already in the past is skipped", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440, 10]));
    const start = Date.now() + 30 * MIN;
    const id = insertEvent(workspaceId, recordingId, { startAt: start });
    await api("PATCH", `/calendar/suggestions/${id}`, user, { status: "accepted" });
    expect(rowsOf(id)).toEqual([{ state: "scheduled", send_at: start - 10 * MIN }]);
  });

  test("sends once", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start, status: "accepted" });
    syncRemindersForEvent(id);
    const due = start - DAY + 1000;
    expect(await sendDueReminders(due)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await sendDueReminders(due)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual([user.email]);
    expect(mails[0]!.subject).toBe("[Lectern] 일정 알림: 중간고사");
    expect(rowsOf(id)).toEqual([{ state: "sent", send_at: start - DAY }]);
    // Syncing after the send does not schedule it again.
    syncRemindersForEvent(id);
    expect(rowsOf(id)).toEqual([{ state: "sent", send_at: start - DAY }]);
  });

  test("dismiss cancels", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start });
    await api("POST", `/calendar/suggestions/batch`, user, { event_candidate_ids: [id], action: "accept" });
    await api("POST", `/calendar/suggestions/batch`, user, { event_candidate_ids: [id], action: "dismiss" });
    expect(rowsOf(id)).toEqual([{ state: "canceled", send_at: start - DAY }]);
    expect(await sendDueReminders(start - DAY + 1000)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mails).toHaveLength(0);
    // Accepted again: the same reminder comes back.
    await api("POST", `/calendar/suggestions/batch`, user, { event_candidate_ids: [id], action: "accept" });
    expect(rowsOf(id)).toEqual([{ state: "scheduled", send_at: start - DAY }]);
  });

  test("moving the event reschedules", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start, status: "accepted" });
    syncRemindersForEvent(id);
    const moved = start + DAY;
    expect((await api("PATCH", `/calendar/suggestions/${id}`, user, { start_at: new Date(moved).toISOString() })).status).toBe(200);
    expect(startOf(id)).toBe(moved);
    expect(rowsOf(id)).toEqual([
      { state: "canceled", send_at: start - DAY },
      { state: "scheduled", send_at: moved - DAY },
    ]);
  });

  test("never sends for a past target", async () => {
    const { user, workspaceId, recordingId } = setup(ON([60]));
    const start = Date.now() - HOUR;
    const id = insertEvent(workspaceId, recordingId, { startAt: start, status: "accepted" });
    insertReminder({ user, workspaceId, targetId: id, sendAt: start - HOUR });
    expect(await sendDueReminders()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(rowsOf(id)).toEqual([{ state: "canceled", send_at: start - HOUR }]);
    expect(mails).toHaveLength(0);
  });

  test("a row whose target changed since it was scheduled is not sent", async () => {
    const { user, workspaceId, recordingId } = setup(ON([60]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start, status: "accepted" });
    syncRemindersForEvent(id);
    // Moved without a sync (e.g. by a republish): the old row no longer matches a lead time.
    db.query(`UPDATE event_candidate SET start_at = ? WHERE id = ?`).run(start + DAY, id);
    expect(await sendDueReminders(start - HOUR + 1000)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(mails).toHaveLength(0);
  });

  test("action item with a due date", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const id = insertItem(workspaceId, recordingId, { dueAt: null });
    const due = Date.now() + 3 * DAY;
    expect((await api("PATCH", `/action-items/${id}`, user, { due_at: new Date(due).toISOString() })).status).toBe(200);
    expect(rowsOf(id)).toEqual([{ state: "scheduled", send_at: due - DAY }]);
    expect((await api("PATCH", `/action-items/${id}`, user, { status: "done" })).status).toBe(200);
    expect(rowsOf(id)).toEqual([{ state: "canceled", send_at: due - DAY }]);
  });

  test("an action item reminder is mailed with its own subject", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const due = Date.now() + 3 * DAY;
    const id = insertItem(workspaceId, recordingId, { dueAt: due });
    syncRemindersForWorkspace(workspaceId);
    expect(await sendDueReminders(due - DAY + 1000)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(mails[0]!.subject).toBe("[Lectern] 할 일 마감 알림: 과제 제출");
    expect(rowsOf(id)[0]!.state).toBe("sent");
  });

  test("updateWorkspace turning reminders on and off", async () => {
    const { user, workspaceId, recordingId } = setup();
    const start = Date.now() + 3 * DAY;
    const event = insertEvent(workspaceId, recordingId, { startAt: start, status: "synced" });
    const item = insertItem(workspaceId, recordingId, { dueAt: start });
    const skipped = insertEvent(workspaceId, recordingId, { startAt: start });
    expect((await api("PATCH", `/workspaces/${workspaceId}`, user, { settings: ON([60]) })).status).toBe(200);
    expect(rowsOf(event)).toEqual([{ state: "scheduled", send_at: start - HOUR }]);
    expect(rowsOf(item)).toEqual([{ state: "scheduled", send_at: start - HOUR }]);
    expect(rowsOf(skipped)).toEqual([]);
    expect((await api("PATCH", `/workspaces/${workspaceId}`, user, { settings: { reminders: { email: false, lead_minutes: [60] } } })).status).toBe(200);
    expect(rowsOf(event)).toEqual([{ state: "canceled", send_at: start - HOUR }]);
    expect(rowsOf(item)).toEqual([{ state: "canceled", send_at: start - HOUR }]);
  });

  test("a deleted target cancels its rows on the next workspace sync", () => {
    const { workspaceId, recordingId } = setup(ON([60]));
    const id = insertEvent(workspaceId, recordingId, { startAt: Date.now() + DAY, status: "accepted" });
    syncRemindersForEvent(id);
    db.query(`DELETE FROM event_candidate WHERE id = ?`).run(id);
    syncRemindersForWorkspace(workspaceId);
    expect(rowsOf(id).map((r) => r.state)).toEqual(["canceled"]);
  });

  test("mail content", () => {
    const at = Date.parse("2026-12-01T05:30:00Z"); // 14:30 in Seoul
    const mail = reminderMail({ kind: "event", title: "중간고사", at, allDay: false, tz: "Asia/Seoul", recordingId: "rec_1", recordingTitle: "운영체제 7주차" });
    expect(mail.subject).toBe("[Lectern] 일정 알림: 중간고사");
    expect(mail.html).toContain("출처 녹음");
    expect(mail.html).toContain("/app/recordings/rec_1");
    expect(mail.html).toContain('설정의 "알림"에서 끌 수 있습니다');
    expect(mail.html).toContain("/app/settings#reminders");
    expect(mail.html).toContain("2026년 12월 1일");
    expect(mail.html).toContain("2:30");

    const escaped = reminderMail({ kind: "event", title: "<b>중간</b>", at, allDay: false, tz: "Asia/Seoul", recordingId: "rec_1", recordingTitle: "<i>녹음</i>" });
    expect(escaped.html).not.toContain("<b>");
    expect(escaped.html).toContain("&lt;b&gt;중간&lt;/b&gt;");
    expect(escaped.html).toContain("&lt;i&gt;녹음&lt;/i&gt;");

    const allDay = reminderMail({ kind: "event", title: "축제", at, allDay: true, tz: "Asia/Seoul", recordingId: "rec_1", recordingTitle: "공지" });
    expect(allDay.html).toContain("2026년 12월 1일");
    expect(allDay.html).not.toContain("2:30");

    const long = "가".repeat(80);
    const item = reminderMail({ kind: "action_item", title: `${long}\n둘째 줄`, at, allDay: false, tz: "Bad/Zone", recordingId: "rec_1", recordingTitle: "회의" });
    expect(item.subject).toBe(`[Lectern] 할 일 마감 알림: ${"가".repeat(60)}`);
  });

  test("send failure marks failed", async () => {
    const { workspaceId, recordingId } = setup(ON([1440]));
    const start = Date.now() + 3 * DAY;
    const id = insertEvent(workspaceId, recordingId, { startAt: start, status: "accepted" });
    syncRemindersForEvent(id);
    resendStatus = 500;
    expect(await sendDueReminders(start - DAY + 1000)).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(rowsOf(id)[0]!.state).toBe("failed");
    expect(mails).toHaveLength(1);
    resendStatus = 200;
    await sendDueReminders(start - DAY + 2000);
    syncRemindersForEvent(id);
    await sendDueReminders(start - DAY + 3000);
    expect(mails).toHaveLength(1);
    expect(rowsOf(id)[0]!.state).toBe("failed");
  });

  test("prune", () => {
    const { user, workspaceId } = setup();
    const now = Date.now();
    const old = insertReminder({ user, workspaceId, targetId: "evc_old", sendAt: now - 91 * DAY, state: "sent", sentAt: now - 91 * DAY });
    const recent = insertReminder({ user, workspaceId, targetId: "evc_recent", sendAt: now - 89 * DAY, state: "sent", sentAt: now - 89 * DAY });
    const scheduled = insertReminder({ user, workspaceId, targetId: "evc_sched", sendAt: now - 100 * DAY });
    expect(pruneReminders(now)).toBe(1);
    const left = (db.query(`SELECT id FROM reminder`).all() as Array<{ id: string }>).map((r) => r.id).sort();
    expect(left).toEqual([recent, scheduled].sort());
    expect(left).not.toContain(old);
  });

  test("account deletion removes the user's reminders", () => {
    const { user, workspaceId, recordingId } = setup(ON([60]));
    const id = insertEvent(workspaceId, recordingId, { startAt: Date.now() + DAY, status: "accepted" });
    syncRemindersForEvent(id);
    insertReminder({ user, workspaceId: "wsp_team", targetId: "evc_team", sendAt: Date.now() + DAY });
    expect(deleteUserAndData(user.id)).toBe(true);
    expect((db.query(`SELECT COUNT(*) AS n FROM reminder WHERE user_id = ?`).get(user.id) as { n: number }).n).toBe(0);
  });

  test("the reminder job is queued once", () => {
    try {
      expect(enqueueReminderRun()).toBe(true);
      expect(enqueueReminderRun()).toBe(false);
    } finally {
      db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(REMINDER_JOB_KIND);
    }
  });

  test("flag off", async () => {
    const { user, workspaceId, recordingId } = setup(ON([1440]));
    const id = insertEvent(workspaceId, recordingId, { startAt: Date.now() + 3 * DAY });
    process.env.LECTERN_CALENDAR = "0";
    resetConfigForTests();
    try {
      await api("PATCH", `/calendar/suggestions/${id}`, user, { status: "accepted" });
      syncRemindersForWorkspace(workspaceId);
      expect(rowsOf(id)).toEqual([]);
    } finally {
      process.env.LECTERN_CALENDAR = "1";
      resetConfigForTests();
    }
  });
});
