import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { connectedLocation } from "../src/api/v2/google-callback.ts";
import { createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { CALENDAR_SCOPE, GOOGLE_AUTH_URL, GoogleAuthError } from "../src/google/oauth.ts";
import { accessTokenFor, openGoogleTokens } from "../src/google/tokens.ts";
import { CALENDAR_SYNC_JOB_KIND } from "../src/calendar/sync-job.ts";
import { handleRequest } from "../src/index.ts";
import { embeddedWorker, type JobWorker } from "../src/queue.ts";
import { openSecret } from "../src/secrets.ts";
import { createFakeGoogle } from "./fakes/google.ts";

// Google Calendar connection (P4-02, D-P4-3, D-P4-6) against the fake Google: start with
// PKCE, the callback's state checks, sealed tokens, needs_reauth, and disconnecting.

const google = createFakeGoogle();
const CALLBACK = `${API_BASE_PATH}/integrations/google/callback`;

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

/** The browser coming back from Google (signed in, or not when `user` is null). */
async function callback(user: UserRecord | null, params: Record<string, string>): Promise<{ status: number; location: string }> {
  const headers: Record<string, string> = user ? { "X-Lectern-Token": user.api_token } : {};
  const res = await handleRequest(new Request(`http://localhost${CALLBACK}?${new URLSearchParams(params)}`, { headers }));
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

async function start(user: UserRecord, extra: { return_to?: string } = {}): Promise<{ url: URL; state: string }> {
  const res = await api("POST", "/integrations/google", user, { workspace_id: personalWorkspaceId(user.id), ...extra });
  expect(res.status).toBe(200);
  const url = new URL(res.body.authorization_url);
  return { url, state: url.searchParams.get("state")! };
}

/** Starts and finishes a connection; returns the integration row. */
async function connect(user: UserRecord, code = generateId("code")) {
  const { state } = await start(user);
  google.issueCode(code);
  const back = await callback(user, { code, state });
  expect(back.location).toBe("/app/settings?google=connected#integrations");
  return integrationOf(user)!;
}

const integrationOf = (user: UserRecord) =>
  db.query(`SELECT * FROM integration WHERE user_id = ? AND provider = 'google'`).get(user.id) as
    | { id: string; status: string; calendar_id: string | null; token_enc: string; scopes_json: string; workspace_id: string }
    | null;

const tokenRequests = () => google.requests.filter((r) => r.url.startsWith("https://oauth2.googleapis.com/token")).length;

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};

const ON = { LECTERN_CALENDAR: "1", GOOGLE_OAUTH_CLIENT_ID: "test-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-secret", LECTERN_WORKER_MODE: "external" };

// A connection queues a calendar_sync; the embedded worker (shared by every test file in this
// process) must not run it after this file puts the real fetch back.
let paused: JobWorker | null = null;

beforeAll(async () => {
  google.install();
  setEnv(ON);
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
beforeEach(() => setEnv(ON));
afterAll(() => {
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
  google.restore();
  setEnv({ LECTERN_CALENDAR: undefined, GOOGLE_OAUTH_CLIENT_ID: undefined, GOOGLE_OAUTH_CLIENT_SECRET: undefined, LECTERN_WORKER_MODE: undefined });
  paused?.start();
});

describe("Google Calendar connection", () => {
  test("start returns a Google URL with PKCE", async () => {
    const me = makeUser("g");
    const { url, state } = await start(me);
    expect(url.toString().startsWith(GOOGLE_AUTH_URL)).toBe(true);
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-id");
    expect(url.searchParams.get("redirect_uri")).toEndWith(CALLBACK);
    const rows = db.query(`SELECT * FROM oauth_state WHERE user_id = ?`).all(me.id) as Array<{ state_hash: string; purpose: string; code_verifier: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state_hash).toBe(sha256Hex(state));
    expect(rows[0]!.purpose).toBe("google_calendar");
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  test("callback connects", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    google.issueCode("c1");
    const back = await callback(me, { code: "c1", state });
    expect(back.status).toBe(302);
    expect(back.location).toBe("/app/settings?google=connected#integrations");
    const rows = db.query(`SELECT * FROM integration WHERE user_id = ?`).all(me.id) as Array<{ status: string; calendar_id: string; scopes_json: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.calendar_id).toBeTruthy();
    expect(JSON.parse(rows[0]!.scopes_json)).toEqual([CALENDAR_SCOPE]);
    expect(google.calendars.get(rows[0]!.calendar_id)).toEqual({ summary: "Lectern", timeZone: "Asia/Seoul" });
    const exchange = google.requests.findLast((r) => r.url.startsWith("https://oauth2.googleapis.com/token"))!;
    expect(exchange.form).toMatchObject({ grant_type: "authorization_code", code: "c1", client_id: "test-id", client_secret: "test-secret" });
    expect(exchange.form!.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchange.form!.redirect_uri).toEndWith(CALLBACK);
    // The first sync is queued so events accepted earlier go in.
    expect(db.query(`SELECT COUNT(*) AS n FROM job WHERE kind = ? AND state = 'queued' AND owner_id = ?`).get(CALENDAR_SYNC_JOB_KIND, me.id)).toEqual({ n: 1 });
    const listed = await api("GET", `/integrations?workspace_id=${personalWorkspaceId(me.id)}`, me);
    expect(listed.body.items.map((i: { status: string }) => i.status)).toEqual(["active"]);
    expect(JSON.stringify(listed.body)).not.toContain("token_enc");
  });

  test("tokens are sealed", async () => {
    const me = makeUser("g");
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    let logs = "";
    try {
      const { state } = await start(me);
      google.issueCode("c-sealed", { refreshToken: "rt-sealed-1" });
      await callback(me, { code: "c-sealed", state });
      logs = [...out.mock.calls, ...err.mock.calls].map((c) => c.join(" ")).join("\n");
      expect(logs).not.toContain(state);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const row = integrationOf(me)!;
    expect(row.token_enc).not.toContain("rt-");
    expect(logs).not.toContain("rt-");
    expect(logs).not.toContain("c-sealed");
    expect(JSON.parse(openSecret(row.token_enc)!)).toEqual({ refresh_token: "rt-sealed-1" });
    expect(openGoogleTokens(row.token_enc)).toEqual({ refresh_token: "rt-sealed-1" });
  });

  test("not signed in goes to the login page", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    expect(await callback(null, { code: "x", state })).toEqual({ status: 302, location: "/app/login" });
  });

  test("state is single use", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    google.issueCode("c-once");
    expect((await callback(me, { code: "c-once", state })).location).toContain("google=connected");
    const before = tokenRequests();
    google.issueCode("c-twice");
    expect((await callback(me, { code: "c-twice", state })).location).toBe("/app/settings?google=error#integrations");
    expect(tokenRequests()).toBe(before);
  });

  test("state of another user", async () => {
    const a = makeUser("ga");
    const b = makeUser("gb");
    const { state } = await start(a);
    google.issueCode("c-other");
    const before = tokenRequests();
    expect((await callback(b, { code: "c-other", state })).location).toBe("/app/settings?google=error#integrations");
    expect(tokenRequests()).toBe(before);
    expect(integrationOf(a)).toBeNull();
    expect(integrationOf(b)).toBeNull();
  });

  test("expired state", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    db.query(`UPDATE oauth_state SET expires_at = ? WHERE state_hash = ?`).run(Date.now() - 1, sha256Hex(state));
    google.issueCode("c-late");
    const before = tokenRequests();
    expect((await callback(me, { code: "c-late", state })).location).toBe("/app/settings?google=error#integrations");
    expect(tokenRequests()).toBe(before);
    expect(db.query(`SELECT COUNT(*) AS n FROM oauth_state WHERE expires_at <= ?`).get(Date.now())).toEqual({ n: 0 });
  });

  test("denied consent", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    const before = tokenRequests();
    expect((await callback(me, { error: "access_denied", state })).location).toBe("/app/settings?google=error#integrations");
    expect(tokenRequests()).toBe(before);
    // The state is used up.
    expect(db.query(`SELECT COUNT(*) AS n FROM oauth_state WHERE state_hash = ?`).get(sha256Hex(state))).toEqual({ n: 0 });
  });

  test("a grant without the calendar scope or a refresh token is revoked", async () => {
    const me = makeUser("g");
    let { state } = await start(me);
    google.issueCode("c-noscope", { refreshToken: "rt-noscope", scope: "openid" });
    expect((await callback(me, { code: "c-noscope", state })).location).toBe("/app/settings?google=error#integrations");
    expect(google.revoked).toContain("rt-noscope");
    ({ state } = await start(me));
    google.issueCode("c-nort", { refreshToken: null });
    expect((await callback(me, { code: "c-nort", state })).location).toBe("/app/settings?google=error#integrations");
    expect(integrationOf(me)).toBeNull();
  });

  test("return_to must be a local path", async () => {
    const me = makeUser("g");
    const bad = await api("POST", "/integrations/google", me, { workspace_id: personalWorkspaceId(me.id), return_to: "//evil.example" });
    expect(bad.status).toBe(400);
    const { state } = await start(me);
    db.query(`UPDATE oauth_state SET redirect_after = 'https://evil.example' WHERE state_hash = ?`).run(sha256Hex(state));
    google.issueCode("c-evil");
    const back = await callback(me, { code: "c-evil", state });
    expect(back.location.startsWith("/app/settings")).toBe(true);
    expect(back.location).toBe("/app/settings?google=connected#integrations");
  });

  test("connectedLocation keeps local paths and refuses the rest", () => {
    expect(connectedLocation("/app/settings#integrations")).toBe("/app/settings?google=connected#integrations");
    expect(connectedLocation("/app/calendar?view=week")).toBe("/app/calendar?view=week&google=connected");
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null]) {
      expect(connectedLocation(evil)).toBe("/app/settings?google=connected#integrations");
    }
  });

  test("a custom return_to is honoured", async () => {
    const me = makeUser("g");
    const { state } = await start(me, { return_to: "/app/calendar" });
    google.issueCode("c-ret");
    expect((await callback(me, { code: "c-ret", state })).location).toBe("/app/calendar?google=connected");
  });

  test("invalid_grant marks needs_reauth", async () => {
    const me = makeUser("g");
    const row = await connect(me);
    expect(await accessTokenFor(row.id)).toMatch(/^at-\d+$/);
    // A second call uses the cached access token.
    const before = tokenRequests();
    await accessTokenFor(row.id);
    expect(tokenRequests()).toBe(before);

    const fresh = await connect(makeUser("g2"));
    google.failNext("oauth2.googleapis.com/token", { status: 400, json: { error: "invalid_grant" } });
    const err = await accessTokenFor(fresh.id).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_grant");
    expect(db.query(`SELECT status FROM integration WHERE id = ?`).get(fresh.id)).toEqual({ status: "needs_reauth" });
  });

  test("a token sealed under another host key marks needs_reauth", async () => {
    const row = await connect(makeUser("g"));
    db.query(`UPDATE integration SET token_enc = 'v1:AAAA' WHERE id = ?`).run(row.id);
    const err = await accessTokenFor(row.id).catch((e) => e);
    expect((err as GoogleAuthError).code).toBe("invalid_grant");
    expect(db.query(`SELECT status FROM integration WHERE id = ?`).get(row.id)).toEqual({ status: "needs_reauth" });
  });

  test("reconnecting after needs_reauth keeps the calendar", async () => {
    const me = makeUser("g");
    const first = await connect(me);
    db.query(`UPDATE integration SET status = 'needs_reauth' WHERE id = ?`).run(first.id);
    const calendarsBefore = google.calendars.size;
    const second = await connect(me);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("active");
    expect(second.calendar_id).toBe(first.calendar_id);
    expect(google.calendars.size).toBe(calendarsBefore);
    expect(openGoogleTokens(second.token_enc)).not.toEqual(openGoogleTokens(first.token_enc));
  });

  test("disconnect", async () => {
    const me = makeUser("g");
    const row = await connect(me);
    const refreshToken = openGoogleTokens(row.token_enc)!.refresh_token;
    const ws = personalWorkspaceId(me.id);
    const now = Date.now();
    const events = [generateId("evc"), generateId("evc")];
    for (const [i, id] of events.entries()) {
      db.query(
        `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression,
           resolution_json, confidence, evidence_json, flags_json, status, created_at, updated_at)
         VALUES (?, ?, 'rec_x', 'exam', ?, ?, NULL, 0, 'Asia/Seoul', '다음 주', '{}', 0.9, '[]', '[]', 'synced', ?, ?)`,
      ).run(id, ws, `시험 ${i}`, now, now, now);
      db.query(
        `INSERT INTO calendar_event_link (event_candidate_id, integration_id, external_event_id, external_etag, state, last_synced_at, error_code)
         VALUES (?, ?, ?, NULL, 'synced', ?, NULL)`,
      ).run(id, row.id, `gev-${i}`, now);
      google.events.get(row.calendar_id!)!.set(`gev-${i}`, { id: `gev-${i}`, summary: `시험 ${i}` });
    }
    const googleRequestsBefore = google.requests.length;

    const res = await api("DELETE", `/integrations/${row.id}`, me);
    expect(res.status).toBe(204);
    expect(db.query(`SELECT COUNT(*) AS n FROM calendar_event_link WHERE integration_id = ?`).get(row.id)).toEqual({ n: 0 });
    for (const id of events) expect(db.query(`SELECT status FROM event_candidate WHERE id = ?`).get(id)).toEqual({ status: "accepted" });
    expect(integrationOf(me)).toBeNull();
    expect(google.revoked).toContain(refreshToken);
    // Google's copies stay; the only request was the revoke.
    expect(google.events.get(row.calendar_id!)!.size).toBe(2);
    expect(google.requests.slice(googleRequestsBefore).map((r) => r.url)).toEqual(["https://oauth2.googleapis.com/revoke"]);
  });

  test("disconnect someone else's", async () => {
    const a = makeUser("ga");
    const b = makeUser("gb");
    const row = await connect(a);
    expect((await api("DELETE", `/integrations/${row.id}`, b)).status).toBe(404);
    expect(integrationOf(a)).not.toBeNull();
  });

  test("no client configured", async () => {
    const me = makeUser("g");
    setEnv({ GOOGLE_OAUTH_CLIENT_SECRET: undefined });
    const res = await api("POST", "/integrations/google", me, { workspace_id: personalWorkspaceId(me.id) });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });

  test("flag off", async () => {
    const me = makeUser("g");
    const { state } = await start(me);
    setEnv({ LECTERN_CALENDAR: "0" });
    const res = await api("POST", "/integrations/google", me, { workspace_id: personalWorkspaceId(me.id) });
    expect(res.status).toBe(501);
    google.issueCode("c-off");
    const before = tokenRequests();
    expect((await callback(me, { code: "c-off", state })).location).toBe("/app/settings?google=error#integrations");
    expect(tokenRequests()).toBe(before);
  });

  test("only members of the workspace may start", async () => {
    const a = makeUser("ga");
    const stranger = makeUser("gx");
    const res = await api("POST", "/integrations/google", stranger, { workspace_id: personalWorkspaceId(a.id) });
    expect(res.status).toBe(403);
  });
});
