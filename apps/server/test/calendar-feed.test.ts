import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH, ApiError } from "@lectern/domain";
import { createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// The ICS subscription (P4-01, D-P4-2, D-0-7) over real rows: create, read, recreate and
// delete a feed; the secret URL serves accepted and synced events the user may read, and
// every way of not being a live feed is the same 404.

interface Res {
  status: number;
  body: any;
  res: Response;
}

async function api(method: string, path: string, user: UserRecord, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, res };
}

/** GET of a feed URL (or a bare path) with no credentials. */
async function fetchFeed(urlOrPath: string): Promise<{ status: number; text: string; res: Response }> {
  const path = urlOrPath.startsWith("/") ? urlOrPath : new URL(urlOrPath).pathname;
  const res = await handleRequest(new Request(`http://localhost${path}`));
  return { status: res.status, text: await res.text(), res };
}

const setCalendar = (on: boolean) => {
  process.env.LECTERN_CALENDAR = on ? "1" : "0";
  resetConfigForTests();
};

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

function seedRecording(workspaceId: string, owner: UserRecord, visibility: "private" | "workspace", title = "자료구조 7주차"): string {
  const id = generateId("rec");
  const now = Date.now();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, recorded_at, recorded_at_source, status, created_by, visibility, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'upload', 'ready', ?, ?, ?, ?)`,
  ).run(id, workspaceId, title, now, owner.id, visibility, now, now);
  return id;
}

function seedEvent(workspaceId: string, recordingId: string, status: string, title: string, startAt = Date.UTC(2026, 10, 20, 6, 0, 0)): string {
  const id = generateId("evc");
  const now = Date.now();
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
       resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'deadline', ?, ?, NULL, 0, 'Asia/Seoul', '다음 주 금요일', '{}', 0.9, '[]', '[]', ?, ?, ?)`,
  ).run(id, workspaceId, recordingId, title, startAt, status, now, now);
  return id;
}

function addMember(workspaceId: string, user: UserRecord, role: "admin" | "member" | "viewer") {
  const now = Date.now();
  db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, user.id, role, now, now);
}

async function createFeed(user: UserRecord, workspaceId: string): Promise<string> {
  const res = await api("POST", "/calendar/feed", user, { workspace_id: workspaceId });
  expect(res.status).toBe(200);
  expect(res.body.url).toMatch(/\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
  return res.body.url as string;
}

beforeAll(() => setCalendar(true));
afterAll(() => {
  delete process.env.LECTERN_CALENDAR;
  resetConfigForTests();
});

describe("calendar feed", () => {
  test("create then fetch", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const rec = seedRecording(ws, me, "private");
    const accepted = seedEvent(ws, rec, "accepted", "과제 제출");
    const url = await createFeed(me, ws);
    const feed = await fetchFeed(url);
    expect(feed.status).toBe(200);
    expect(feed.res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(feed.res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(feed.res.headers.get("x-robots-tag")).toBe("noindex");
    expect(feed.text).toStartWith("BEGIN:VCALENDAR\r\n");
    expect(feed.text).toContain(`UID:${accepted}@lectern\r\n`);
    expect(feed.text).toContain("SUMMARY:과제 제출\r\n");
    expect(feed.text).toContain("DESCRIPTION:녹음: 자료구조 7주차\r\n");
  });

  test("only accepted and synced", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const rec = seedRecording(ws, me, "private");
    const accepted = seedEvent(ws, rec, "accepted", "수락");
    const synced = seedEvent(ws, rec, "synced", "등록됨");
    const suggested = seedEvent(ws, rec, "suggested", "제안");
    const dismissed = seedEvent(ws, rec, "dismissed", "무시");
    const feed = await fetchFeed(await createFeed(me, ws));
    expect(feed.text).toContain(`UID:${accepted}@lectern`);
    expect(feed.text).toContain(`UID:${synced}@lectern`);
    expect(feed.text).not.toContain(suggested);
    expect(feed.text).not.toContain(dismissed);
  });

  test("get never returns the url", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const before = await api("GET", `/calendar/feed?workspace_id=${ws}`, me);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ exists: false, url: null, created_at: null });
    await createFeed(me, ws);
    const after = await api("GET", `/calendar/feed?workspace_id=${ws}`, me);
    expect(after.body.exists).toBe(true);
    expect(after.body.url).toBeNull();
    expect(Date.parse(after.body.created_at)).toBeGreaterThan(0);
  });

  test("recreate revokes the old url", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const first = await createFeed(me, ws);
    const second = await createFeed(me, ws);
    expect(second).not.toBe(first);
    expect((await fetchFeed(first)).status).toBe(404);
    expect((await fetchFeed(second)).status).toBe(200);
    const active = db.query(`SELECT COUNT(*) AS n FROM calendar_feed WHERE user_id = ? AND revoked_at IS NULL`).get(me.id);
    expect(active).toEqual({ n: 1 });
  });

  test("delete", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const url = await createFeed(me, ws);
    const res = await api("DELETE", `/calendar/feed?workspace_id=${ws}`, me);
    expect(res.status).toBe(204);
    expect((await fetchFeed(url)).status).toBe(404);
    expect((await api("GET", `/calendar/feed?workspace_id=${ws}`, me)).body.exists).toBe(false);
    // Deleting again is still 204.
    expect((await api("DELETE", `/calendar/feed?workspace_id=${ws}`, me)).status).toBe(204);
  });

  test("private recordings stay private", async () => {
    const a = makeUser("cala");
    const b = makeUser("calb");
    const team = await api("POST", "/workspaces", a, { name: generateId("팀") });
    expect(team.status).toBe(201);
    const ws = team.body.id as string;
    addMember(ws, b, "member");
    const bPrivate = seedEvent(ws, seedRecording(ws, b, "private"), "accepted", "B의 비공개 일정");
    const bShared = seedEvent(ws, seedRecording(ws, b, "workspace"), "accepted", "B의 공유 일정");
    const aPrivate = seedEvent(ws, seedRecording(ws, a, "private"), "accepted", "A의 비공개 일정");

    const aFeed = await fetchFeed(await createFeed(a, ws));
    expect(aFeed.text).not.toContain(bPrivate);
    expect(aFeed.text).toContain(`UID:${bShared}@lectern`);
    expect(aFeed.text).toContain(`UID:${aPrivate}@lectern`);

    const bFeed = await fetchFeed(await createFeed(b, ws));
    expect(bFeed.text).toContain(`UID:${bPrivate}@lectern`);
    expect(bFeed.text).not.toContain(aPrivate);
  });

  test("a member who left gets an empty calendar", async () => {
    const a = makeUser("cala");
    const b = makeUser("calb");
    const team = await api("POST", "/workspaces", a, { name: generateId("팀") });
    const ws = team.body.id as string;
    addMember(ws, b, "member");
    const shared = seedEvent(ws, seedRecording(ws, a, "workspace"), "accepted", "공유 일정");
    const url = await createFeed(b, ws);
    expect((await fetchFeed(url)).text).toContain(shared);
    db.query(`DELETE FROM membership WHERE workspace_id = ? AND user_id = ?`).run(ws, b.id);
    const after = await fetchFeed(url);
    expect(after.status).toBe(200);
    expect(after.text).not.toContain("BEGIN:VEVENT");
  });

  test("only members may have a feed", async () => {
    const a = makeUser("cala");
    const stranger = makeUser("calx");
    const ws = personalWorkspaceId(a.id);
    expect((await api("POST", "/calendar/feed", stranger, { workspace_id: ws })).status).toBe(403);
    expect((await api("GET", `/calendar/feed?workspace_id=${ws}`, stranger)).status).toBe(403);
    expect((await api("DELETE", `/calendar/feed?workspace_id=${ws}`, stranger)).status).toBe(403);
  });

  test("no plaintext token in the database", async () => {
    const me = makeUser("cal");
    const url = await createFeed(me, personalWorkspaceId(me.id));
    const token = /\/cal\/([A-Za-z0-9_-]+)\.ics$/.exec(url)![1]!;
    const rows = JSON.stringify(db.query(`SELECT * FROM calendar_feed`).all());
    expect(rows).not.toContain(token);
  });

  test("flag off", async () => {
    const me = makeUser("cal");
    const ws = personalWorkspaceId(me.id);
    const url = await createFeed(me, ws);
    setCalendar(false);
    try {
      for (const [method, path, body] of [
        ["GET", `/calendar/feed?workspace_id=${ws}`, undefined],
        ["POST", "/calendar/feed", { workspace_id: ws }],
        ["DELETE", `/calendar/feed?workspace_id=${ws}`, undefined],
      ] as const) {
        const res = await api(method, path, me, body);
        expect(res.status, `${method} ${path}`).toBe(501);
        expect(ApiError.parse(res.body).error.code).toBe("not_implemented");
      }
      expect((await fetchFeed(url)).status).toBe(404);
      expect((await fetchFeed("/cal/x.ics")).status).toBe(404);
    } finally {
      setCalendar(true);
    }
    expect((await fetchFeed(url)).status).toBe(200);
  });

  test("bad file name", async () => {
    for (const path of ["/cal/abc", "/cal/..%2f.ics", "/cal/short.ics", `/cal/${"a".repeat(43)}.ics`, `/cal/${"a".repeat(43)}.ics.bak`]) {
      const res = await fetchFeed(path);
      expect(res.status, path).toBe(404);
    }
    const ours = await fetchFeed(`/cal/${"a".repeat(43)}.ics`);
    expect(ours.text).toBe("Not found");
    expect(ours.res.headers.get("x-robots-tag")).toBe("noindex");
  });
});
