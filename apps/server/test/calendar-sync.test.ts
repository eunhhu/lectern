import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, uuidv7 } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { CALENDAR_SYNC_JOB_KIND, runCalendarSync, runCalendarSyncJob } from "../src/calendar/sync-job.ts";
import { createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { sealGoogleTokens } from "../src/google/tokens.ts";
import { handleRequest } from "../src/index.ts";
import { embeddedWorker, type JobWorker, type LeasedJob } from "../src/queue.ts";
import { createFakeGoogle } from "./fakes/google.ts";

// The calendar_sync job (P4-03, D-P4-4, D-P4-5, D-P4-6) against the fake Google: accepted
// events go in once, edits patch, dismissals and deleted recordings delete, a lost link row
// is adopted instead of duplicated, and token trouble ends quietly at needs_reauth.

const google = createFakeGoogle();

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

function seedRecording(workspaceId: string, owner: UserRecord, visibility: "private" | "workspace" = "private", title = "운영체제 7주차"): string {
  const id = generateId("rec");
  const now = Date.now();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'upload', 'ready', ?, ?, ?, ?)`,
  ).run(id, workspaceId, title, now, owner.id, visibility, now, now);
  return id;
}

const RESOLUTION = JSON.stringify({ method: "parser", rule: "next_week_weekday" });
const EVIDENCE = JSON.stringify({ sources: [{ kind: "transcript", start_idx: 3, end_idx: 3 }], quote: "다음 주 화요일에 시험" });

function seedEvent(
  workspaceId: string,
  recordingId: string,
  opts: { status?: string; title?: string; allDay?: boolean; startAt?: number; endAt?: number | null } = {},
): string {
  const id = generateId("evc");
  const now = Date.now() - 60_000; // decided a minute ago, so an edit in the test is strictly newer
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
       resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'exam', ?, ?, ?, ?, 'Asia/Seoul', '다음 주 화요일', ?, 0.9, ?, '[]', ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    recordingId,
    opts.title ?? "중간고사",
    opts.startAt ?? Date.UTC(2026, 10, 24, 1, 0, 0),
    opts.endAt === undefined ? Date.UTC(2026, 10, 24, 3, 0, 0) : opts.endAt,
    opts.allDay ? 1 : 0,
    RESOLUTION,
    EVIDENCE,
    opts.status ?? "accepted",
    now,
    now,
  );
  return id;
}

/** An active Google integration whose refresh token and calendar the fake knows. */
function seedIntegration(user: UserRecord, workspaceId = personalWorkspaceId(user.id)): { id: string; calendarId: string } {
  const id = uuidv7();
  const calendarId = `cal-${generateId("t")}@group.calendar.google.com`;
  const refreshToken = `rt-${generateId("seed")}`;
  google.refreshTokens.add(refreshToken);
  google.calendars.set(calendarId, { summary: "Lectern", timeZone: "Asia/Seoul" });
  google.events.set(calendarId, new Map());
  const now = Date.now();
  db.query(
    `INSERT INTO integration (id, workspace_id, user_id, provider, scopes_json, token_enc, calendar_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'google', '[]', ?, ?, 'active', ?, ?)`,
  ).run(id, workspaceId, user.id, sealGoogleTokens({ refresh_token: refreshToken }), calendarId, now, now);
  return { id, calendarId };
}

const eventsIn = (calendarId: string) => [...google.events.get(calendarId)!.values()];
const linkCount = (integrationId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM calendar_event_link WHERE integration_id = ?`).get(integrationId) as { n: number }).n;
const statusOf = (eventId: string) => (db.query(`SELECT status FROM event_candidate WHERE id = ?`).get(eventId) as { status: string }).status;
const requestsSince = (from: number, method?: string, part = "/events") =>
  google.requests.slice(from).filter((r) => (!method || r.method === method) && r.url.includes(part));

/** A personal workspace with one accepted event and an integration, synced once. */
async function syncedSetup() {
  const me = makeUser("sync");
  const ws = personalWorkspaceId(me.id);
  const recordingId = seedRecording(ws, me);
  const eventId = seedEvent(ws, recordingId);
  const integration = seedIntegration(me);
  await runCalendarSync(integration.id);
  return { me, ws, recordingId, eventId, integration };
}

const CLIENT = { GOOGLE_OAUTH_CLIENT_ID: "test-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-secret" };

// This file runs calendar_sync itself: the embedded worker (shared by every test file in this
// process) must not lease the jobs it queues, and with LECTERN_WORKER_MODE=external no new one starts.
let paused: JobWorker | null = null;

beforeAll(async () => {
  google.install();
  Object.assign(process.env, CLIENT, { LECTERN_CALENDAR: "1", LECTERN_WORKER_MODE: "external" });
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
afterEach(() => {
  google.clearFailures();
  // Nothing queued here may run later against the real fetch.
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
});
afterAll(() => {
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
  google.restore();
  for (const key of ["LECTERN_CALENDAR", "LECTERN_WORKER_MODE", ...Object.keys(CLIENT)]) delete process.env[key];
  resetConfigForTests();
  paused?.start();
});

describe("calendar_sync", () => {
  test("accept inserts one event", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    const eventId = seedEvent(ws, seedRecording(ws, me), { title: "과제 제출" });
    const integration = seedIntegration(me);
    const result = await runCalendarSync(integration.id);
    expect(result).toEqual({ inserted: 1, patched: 0, deleted: 0, adopted: 0, failed: 0 });
    const events = eventsIn(integration.calendarId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      summary: "과제 제출",
      description: "녹음: 운영체제 7주차",
      extendedProperties: { private: { lectern_event_id: eventId } },
      start: { dateTime: "2026-11-24T01:00:00.000Z", timeZone: "Asia/Seoul" },
      end: { dateTime: "2026-11-24T03:00:00.000Z", timeZone: "Asia/Seoul" },
    });
    expect(linkCount(integration.id)).toBe(1);
    expect(statusOf(eventId)).toBe("synced");
  });

  test("running again adds nothing", async () => {
    const { integration } = await syncedSetup();
    const from = google.requests.length;
    expect(await runCalendarSync(integration.id)).toEqual({ inserted: 0, patched: 0, deleted: 0, adopted: 0, failed: 0 });
    expect(eventsIn(integration.calendarId)).toHaveLength(1);
    expect(requestsSince(from, "POST")).toHaveLength(0);
    expect(requestsSince(from)).toHaveLength(0);
  });

  test("adopts an existing event when the link row is lost", async () => {
    const { eventId, integration } = await syncedSetup();
    db.query(`DELETE FROM calendar_event_link WHERE event_candidate_id = ?`).run(eventId);
    db.query(`UPDATE event_candidate SET status = 'accepted' WHERE id = ?`).run(eventId);
    const from = google.requests.length;
    const result = await runCalendarSync(integration.id);
    expect(result.adopted).toBe(1);
    expect(result.inserted).toBe(0);
    expect(eventsIn(integration.calendarId)).toHaveLength(1);
    expect(requestsSince(from, "POST")).toHaveLength(0);
    expect(requestsSince(from, "PATCH")).toHaveLength(1);
    expect(linkCount(integration.id)).toBe(1);
    expect(statusOf(eventId)).toBe("synced");
  });

  test("edit patches", async () => {
    const { eventId, integration } = await syncedSetup();
    db.query(`UPDATE event_candidate SET title = '중간고사 (장소 변경)', updated_at = ? WHERE id = ?`).run(Date.now() + 1000, eventId);
    const from = google.requests.length;
    expect((await runCalendarSync(integration.id)).patched).toBe(1);
    expect(requestsSince(from, "PATCH")).toHaveLength(1);
    expect(eventsIn(integration.calendarId)[0]!.summary).toBe("중간고사 (장소 변경)");
    expect(statusOf(eventId)).toBe("synced");
  });

  test("an event deleted in Google is put back", async () => {
    const { integration } = await syncedSetup();
    const [only] = eventsIn(integration.calendarId);
    google.events.get(integration.calendarId)!.delete(only!.id as string);
    db.query(`UPDATE event_candidate SET updated_at = ? WHERE workspace_id = (SELECT workspace_id FROM integration WHERE id = ?)`).run(
      Date.now() + 1000,
      integration.id,
    );
    const result = await runCalendarSync(integration.id);
    expect(result.inserted).toBe(1);
    expect(eventsIn(integration.calendarId)).toHaveLength(1);
  });

  test("dismiss deletes", async () => {
    const { eventId, integration } = await syncedSetup();
    db.query(`UPDATE event_candidate SET status = 'dismissed', updated_at = ? WHERE id = ?`).run(Date.now(), eventId);
    const from = google.requests.length;
    expect((await runCalendarSync(integration.id)).deleted).toBe(1);
    expect(requestsSince(from, "DELETE")).toHaveLength(1);
    expect(eventsIn(integration.calendarId)).toHaveLength(0);
    expect(linkCount(integration.id)).toBe(0);
  });

  test("recording delete removes the event", async () => {
    const { me, recordingId, integration } = await syncedSetup();
    const res = await api("DELETE", `/recordings/${recordingId}`, me);
    expect(res.status).toBe(204);
    // The link outlives the event so the sync can find the Google copy; the delete queued it.
    expect(linkCount(integration.id)).toBe(1);
    expect(db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND subject_id = ?`).get(CALENDAR_SYNC_JOB_KIND, integration.id)).toEqual({ n: 1 });
    const result = await runCalendarSync(integration.id);
    expect(result.deleted).toBe(1);
    expect(eventsIn(integration.calendarId)).toHaveLength(0);
    expect(linkCount(integration.id)).toBe(0);
  });

  test("all-day event", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    // 2026-11-03 00:00 in Seoul.
    seedEvent(ws, seedRecording(ws, me), { allDay: true, startAt: Date.UTC(2026, 10, 2, 15, 0, 0), endAt: null });
    const integration = seedIntegration(me);
    await runCalendarSync(integration.id);
    const [event] = eventsIn(integration.calendarId);
    expect(event!.start).toEqual({ date: "2026-11-03" });
    expect(event!.end).toEqual({ date: "2026-11-04" });
    expect(JSON.stringify(event)).not.toContain("dateTime");
  });

  test("401 refreshes once", async () => {
    const { ws, me, integration } = await syncedSetup();
    seedEvent(ws, seedRecording(ws, me), { title: "두 번째" });
    google.failNext("/events", { status: 401, json: { error: { code: 401 } } });
    const from = google.requests.length;
    const result = await runCalendarSync(integration.id);
    expect(result.inserted).toBe(1);
    expect(requestsSince(from, "POST", "oauth2.googleapis.com/token")).toHaveLength(1);
    expect(db.query(`SELECT status FROM integration WHERE id = ?`).get(integration.id)).toEqual({ status: "active" });
  });

  test("401 twice marks needs_reauth", async () => {
    const { ws, me, integration } = await syncedSetup();
    seedEvent(ws, seedRecording(ws, me), { title: "두 번째" });
    google.failNext("/events", { status: 401, json: { error: { code: 401 } } }, 2);
    await runCalendarSync(integration.id);
    expect(db.query(`SELECT status FROM integration WHERE id = ?`).get(integration.id)).toEqual({ status: "needs_reauth" });
  });

  test("invalid_grant stops quietly", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    seedEvent(ws, seedRecording(ws, me));
    const integration = seedIntegration(me);
    google.failNext("oauth2.googleapis.com/token", { status: 400, json: { error: "invalid_grant" } });
    expect(await runCalendarSync(integration.id)).toEqual({ inserted: 0, patched: 0, deleted: 0, adopted: 0, failed: 0 });
    expect(db.query(`SELECT status FROM integration WHERE id = ?`).get(integration.id)).toEqual({ status: "needs_reauth" });
    const from = google.requests.length;
    await runCalendarSync(integration.id);
    expect(google.requests.length).toBe(from);
  });

  test("429 is retried by the queue", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    seedEvent(ws, seedRecording(ws, me));
    const integration = seedIntegration(me);
    google.failNext("/events", { status: 429, json: { error: { code: 429 } } }, 10);
    await expect(runCalendarSync(integration.id)).rejects.toThrow();

    const job: LeasedJob = { id: "job_t", kind: CALENDAR_SYNC_JOB_KIND, subjectId: integration.id, ownerId: me.id, payload: {}, attempts: 1, secret: () => undefined };
    const outcome = await runCalendarSyncJob(job);
    expect(outcome.ok).toBe(false);
    expect(outcome.followUp).toBeDefined();
    const before = Date.now();
    outcome.followUp!();
    const queued = db.query(`SELECT payload, run_after FROM job WHERE kind = ? AND subject_id = ? AND state = 'queued'`).get(
      CALENDAR_SYNC_JOB_KIND,
      integration.id,
    ) as { payload: string; run_after: number };
    expect(JSON.parse(queued.payload)).toEqual({ retry: 1 });
    expect(queued.run_after).toBeGreaterThanOrEqual(before + 60_000);
    // After the last retry it gives up.
    const last = await runCalendarSyncJob({ ...job, payload: { retry: 5 } });
    expect(last.ok).toBe(false);
    expect(last.followUp).toBeUndefined();
  });

  test("private recordings of others are not synced", async () => {
    const a = makeUser("synca");
    const b = makeUser("syncb");
    const team = await api("POST", "/workspaces", a, { name: generateId("팀") });
    expect(team.status).toBe(201);
    const ws = team.body.id as string;
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)`).run(ws, b.id, now, now);
    const bPrivate = seedEvent(ws, seedRecording(ws, b, "private"), { title: "B의 비공개" });
    const bShared = seedEvent(ws, seedRecording(ws, b, "workspace"), { title: "B의 공유" });
    const integration = seedIntegration(a, ws);
    await runCalendarSync(integration.id);
    const ids = eventsIn(integration.calendarId).map((e) => (e.extendedProperties as { private: { lectern_event_id: string } }).private.lectern_event_id);
    expect(ids).toEqual([bShared]);
    expect(ids).not.toContain(bPrivate);
    expect(statusOf(bPrivate)).toBe("accepted");
  });

  test("an inactive integration never calls Google", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    seedEvent(ws, seedRecording(ws, me));
    const integration = seedIntegration(me);
    db.query(`UPDATE integration SET status = 'needs_reauth' WHERE id = ?`).run(integration.id);
    const from = google.requests.length;
    expect((await runCalendarSync(integration.id)).inserted).toBe(0);
    expect(google.requests.length).toBe(from);
  });

  test("suggestion update enqueues a sync", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    const eventId = seedEvent(ws, seedRecording(ws, me), { status: "suggested" });
    const integration = seedIntegration(me);
    const res = await api("PATCH", `/calendar/suggestions/${eventId}`, me, { status: "accepted" });
    expect(res.status).toBe(200);
    expect(db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND subject_id = ?`).get(CALENDAR_SYNC_JOB_KIND, integration.id)).toEqual({ n: 1 });
  });

  test("a synced event can be edited and dismissed through the API", async () => {
    const { me, eventId, integration } = await syncedSetup();
    const edited = await api("PATCH", `/calendar/suggestions/${eventId}`, me, { title: "기말고사" });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe("synced");
    expect((await runCalendarSync(integration.id)).patched).toBe(1);
    expect(eventsIn(integration.calendarId)[0]!.summary).toBe("기말고사");
    // Accepting again keeps it synced; dismissing takes it out of Google.
    expect((await api("PATCH", `/calendar/suggestions/${eventId}`, me, { status: "accepted" })).body.status).toBe("synced");
    const dismissed = await api("POST", "/calendar/suggestions/batch", me, { event_candidate_ids: [eventId], action: "dismiss" });
    expect(dismissed.body.items[0].status).toBe("dismissed");
    expect((await runCalendarSync(integration.id)).deleted).toBe(1);
    expect(eventsIn(integration.calendarId)).toHaveLength(0);
  });

  test("the flag off queues nothing", async () => {
    const me = makeUser("sync");
    const ws = personalWorkspaceId(me.id);
    const eventId = seedEvent(ws, seedRecording(ws, me), { status: "suggested" });
    const integration = seedIntegration(me);
    process.env.LECTERN_CALENDAR = "0";
    resetConfigForTests();
    try {
      expect((await api("PATCH", `/calendar/suggestions/${eventId}`, me, { status: "accepted" })).status).toBe(200);
      expect(db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND subject_id = ?`).get(CALENDAR_SYNC_JOB_KIND, integration.id)).toEqual({ n: 0 });
    } finally {
      process.env.LECTERN_CALENDAR = "1";
      resetConfigForTests();
    }
  });
});
