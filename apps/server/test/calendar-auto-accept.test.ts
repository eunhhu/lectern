import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId, uuidv7 } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import type { NotesResult } from "@lectern/harness";
import { mergeSettings } from "../src/api/v2/workspaces.ts";
import { afterNotesPublished, autoAcceptEvents } from "../src/calendar/auto-accept.ts";
import { CALENDAR_SYNC_JOB_KIND, runCalendarSync } from "../src/calendar/sync-job.ts";
import { createPendingLecture, createUser, DATA_DIR, db, generateId, type UserRecord } from "../src/db.ts";
import { sealGoogleTokens } from "../src/google/tokens.ts";
import { handleRequest } from "../src/index.ts";
import { publishNotes } from "../src/notes-publish.ts";
import { embeddedWorker, type JobWorker } from "../src/queue.ts";
import { createFakeGoogle } from "./fakes/google.ts";

// Calendar auto-add (P4-04, D-P4-1) and the roadmap's P4 exit check: reprocessing a recording
// never adds Google events (D-P4-4 with the D-P1-5 republish rules).

const google = createFakeGoogle();
const DAY = 86_400_000;

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

/** A pending lecture of `owner` (its recording is projected into the personal workspace). */
function lecture(owner: UserRecord) {
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audio = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audio, "audio");
  const row = createPendingLecture({
    id: generateId("lec"),
    ownerId: owner.id,
    title: "",
    course: "운영체제",
    audioPath: audio,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  return { recordingId: lectureRecordingId(row.id), workspaceId: personalWorkspaceId(owner.id) };
}

/** An extracted event that qualifies for auto-add (parser, no flags, 0.9, in the future). */
function event(title: string, startAt: number) {
  return {
    title,
    kind: "exam" as const,
    start_at: startAt,
    end_at: startAt + 2 * 3_600_000,
    all_day: false,
    tz: "Asia/Seoul",
    raw_expression: "다음 주 화요일",
    resolution: { method: "parser" as const, rule: "next_week_weekday" },
    confidence: 0.9,
    evidence: { sources: [{ kind: "transcript" as const, start_idx: 2, end_idx: 2 }], quote: "다음 주 화요일에 시험" },
    flags: [] as string[],
  };
}

function result(events: ReturnType<typeof event>[]): NotesResult {
  return {
    classification: {
      domain: "lecture",
      language: "ko",
      title: "AI 제목",
      participants: [],
      folder_suggestion: { folder_id: null, new_name: null },
      tags: [],
      confidence: 0.9,
    },
    template: { id: "lecture", version: 1 },
    body: {
      sections: [
        {
          key: "summary",
          title: "핵심 요약",
          blocks: [{ id: "b1", type: "paragraph", heading: null, text: "요약", sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }] }],
        },
      ],
    },
    markdown: "# AI 제목\n\n## 핵심 요약\n\n요약 [00:10]\n",
    events,
    action_items: [],
    report: { repaired: false, dropped_blocks: 0, items: [] },
    partial: false,
  } as unknown as NotesResult; // literal ids and flags are plain strings here
}

function insertEvent(
  workspaceId: string,
  recordingId: string,
  opts: { method?: string; flags?: string[]; confidence?: number; startAt?: number; status?: string },
): string {
  const id = generateId("evc");
  const now = Date.now();
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
       resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'exam', '시험', ?, NULL, 0, 'Asia/Seoul', '다음 주', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    recordingId,
    opts.startAt ?? now + 7 * DAY,
    JSON.stringify({ method: opts.method ?? "parser", rule: "next_week_weekday" }),
    opts.confidence ?? 0.9,
    JSON.stringify({ sources: [{ kind: "transcript", start_idx: 1, end_idx: 1 }], quote: "시험" }),
    JSON.stringify(opts.flags ?? []),
    opts.status ?? "suggested",
    now,
    now,
  );
  return id;
}

const setSettings = (workspaceId: string, settings: unknown) =>
  db.query(`UPDATE workspace SET settings_json = ? WHERE id = ?`).run(typeof settings === "string" ? settings : JSON.stringify(settings), workspaceId);
const statusOf = (id: string) => (db.query(`SELECT status FROM event_candidate WHERE id = ?`).get(id) as { status: string }).status;
const AUTO_ON = { calendar_auto_add: { enabled: true, min_confidence: 0.8 } };

function seedIntegration(user: UserRecord): { id: string; calendarId: string } {
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
  ).run(id, personalWorkspaceId(user.id), user.id, sealGoogleTokens({ refresh_token: refreshToken }), calendarId, now, now);
  return { id, calendarId };
}

const syncJobs = (integrationId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND subject_id = ?`).get(CALENDAR_SYNC_JOB_KIND, integrationId) as { n: number }).n;

const ENV = { LECTERN_CALENDAR: "1", GOOGLE_OAUTH_CLIENT_ID: "test-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-secret", LECTERN_WORKER_MODE: "external" };

// This file runs calendar_sync itself: the shared embedded worker must not lease its jobs.
let paused: JobWorker | null = null;

beforeAll(async () => {
  google.install();
  Object.assign(process.env, ENV);
  resetConfigForTests();
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
afterEach(() => {
  google.clearFailures();
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
});
afterAll(() => {
  google.restore();
  for (const key of Object.keys(ENV)) delete process.env[key];
  resetConfigForTests();
  paused?.start();
});

describe("calendar auto-add", () => {
  test("off by default: everything stays suggested", () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    const a = insertEvent(workspaceId, recordingId, {});
    const b = insertEvent(workspaceId, recordingId, {});
    expect(autoAcceptEvents(recordingId, workspaceId)).toBe(0);
    expect([statusOf(a), statusOf(b)]).toEqual(["suggested", "suggested"]);
  });

  test("accepts only qualifying events", () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    setSettings(workspaceId, AUTO_ON);
    const ok = insertEvent(workspaceId, recordingId, {});
    const model = insertEvent(workspaceId, recordingId, { method: "model" });
    const flagged = insertEvent(workspaceId, recordingId, { flags: ["ambiguous_date"] });
    const unsure = insertEvent(workspaceId, recordingId, { confidence: 0.7 });
    const past = insertEvent(workspaceId, recordingId, { startAt: Date.now() - DAY });
    const dismissed = insertEvent(workspaceId, recordingId, { status: "dismissed" });
    expect(autoAcceptEvents(recordingId, workspaceId)).toBe(1);
    expect(statusOf(ok)).toBe("accepted");
    for (const id of [model, flagged, unsure, past]) expect(statusOf(id)).toBe("suggested");
    expect(statusOf(dismissed)).toBe("dismissed");
  });

  test("flag off", () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    setSettings(workspaceId, AUTO_ON);
    const id = insertEvent(workspaceId, recordingId, {});
    process.env.LECTERN_CALENDAR = "0";
    resetConfigForTests();
    try {
      expect(autoAcceptEvents(recordingId, workspaceId)).toBe(0);
      expect(statusOf(id)).toBe("suggested");
    } finally {
      process.env.LECTERN_CALENDAR = "1";
      resetConfigForTests();
    }
  });

  test("afterNotesPublished enqueues a sync", () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    setSettings(workspaceId, AUTO_ON);
    const integration = seedIntegration(me);
    insertEvent(workspaceId, recordingId, {});
    afterNotesPublished(recordingId, workspaceId);
    expect(syncJobs(integration.id)).toBe(1);
  });

  test("afterNotesPublished never throws", () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    setSettings(workspaceId, "{");
    const id = insertEvent(workspaceId, recordingId, {});
    expect(() => afterNotesPublished(recordingId, workspaceId)).not.toThrow();
    expect(statusOf(id)).toBe("suggested");
  });

  test("reprocess does not add Google events", async () => {
    const me = makeUser("auto");
    const { recordingId, workspaceId } = lecture(me);
    setSettings(workspaceId, AUTO_ON);
    const integration = seedIntegration(me);
    const events = [event("중간고사", Date.now() + 7 * DAY), event("과제 제출", Date.now() + 9 * DAY)];
    const inserts = () => google.requests.filter((r) => r.method === "POST" && r.url.includes("/events")).length;
    const from = inserts();

    publishNotes({ recordingId, workspaceId, result: result(events) });
    afterNotesPublished(recordingId, workspaceId);
    expect((await runCalendarSync(integration.id)).inserted).toBe(2);
    expect(google.events.get(integration.calendarId)!.size).toBe(2);

    publishNotes({ recordingId, workspaceId, result: result(events) });
    afterNotesPublished(recordingId, workspaceId);
    await runCalendarSync(integration.id);
    expect(google.events.get(integration.calendarId)!.size).toBe(2);
    expect(inserts() - from).toBe(2);
    const rows = db.query(`SELECT status FROM event_candidate WHERE recording_id = ?`).all(recordingId) as Array<{ status: string }>;
    expect(rows.map((r) => r.status)).toEqual(["synced", "synced"]);

    // An event dropped by a republish is removed: the user had put it back to suggested, so
    // the republish replaces it (D-P1-5) and the sync deletes the Google copy.
    db.query(`UPDATE event_candidate SET status = 'suggested' WHERE recording_id = ? AND title = '과제 제출'`).run(recordingId);
    publishNotes({ recordingId, workspaceId, result: result([events[0]!]) });
    afterNotesPublished(recordingId, workspaceId);
    expect((await runCalendarSync(integration.id)).deleted).toBe(1);
    const left = [...google.events.get(integration.calendarId)!.values()];
    expect(left.map((e) => e.summary)).toEqual(["중간고사"]);
  });

  test("updateWorkspace merges settings", async () => {
    const me = makeUser("auto");
    const workspaceId = personalWorkspaceId(me.id);
    setSettings(workspaceId, { reminders: { email: true, lead_minutes: [1440] }, default_language: "ko" });
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "X-Lectern-Token": me.api_token, "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { calendar_auto_add: { enabled: true, min_confidence: 0.85 } } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, unknown> };
    expect(body.settings).toEqual({
      reminders: { email: true, lead_minutes: [1440] },
      default_language: "ko",
      calendar_auto_add: { enabled: true, min_confidence: 0.85 },
    });
  });

  test("updateWorkspace refuses null and mergeSettings removes a null key", async () => {
    const me = makeUser("auto");
    const workspaceId = personalWorkspaceId(me.id);
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "X-Lectern-Token": me.api_token, "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { reminders: null } }),
      }),
    );
    // WorkspaceSettings fields are optional, not nullable (packages/domain).
    expect(res.status).toBe(400);
    expect(mergeSettings(JSON.stringify({ reminders: { email: true, lead_minutes: [60] }, default_language: "ko" }), { reminders: null })).toEqual({
      default_language: "ko",
    });
    expect(mergeSettings("{", { default_language: "en" })).toEqual({ default_language: "en" });
  });
});
