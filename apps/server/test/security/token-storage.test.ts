import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { CALENDAR_SYNC_JOB_KIND } from "../../src/calendar/sync-job.ts";
import { createSession, db, generateId, getLectureById } from "../../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../../src/index.ts";
import { embeddedWorker, type JobWorker } from "../../src/queue.ts";
import { openSecret } from "../../src/secrets.ts";
import { createFakeGoogle } from "../fakes/google.ts";
import { createShareLink, makeUser, PASSWORD, seedLecture, tokenAuth, v2 } from "./helpers.ts";

// P5-15 · Tokens at rest (D-0-7, D-0-8): every token the server hands out is looked for in
// every TEXT column of every table of the database file. Only its sha256 may be there; an
// OAuth refresh token only sealed. The v1 tokens that stay plain are listed exactly. Log
// output during the flows is collected and searched too.

const RESEND_URL = "https://api.resend.com/emails";
const google = createFakeGoogle();
const ON = {
  LECTERN_TEAMS: "1",
  LECTERN_CALENDAR: "1",
  LECTERN_GOOGLE_LOGIN: "1",
  GOOGLE_OAUTH_CLIENT_ID: "test-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
  RESEND_API_KEY: "test-key-never-sent",
  LECTERN_WORKER_MODE: "external",
};
const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};

const mails: Array<{ html: string }> = [];
let fakeFetch: typeof fetch;
let paused: JobWorker | null = null;
let logs: Mock<(...args: unknown[]) => void>[] = [];

beforeAll(async () => {
  google.install();
  const googleFetch = globalThis.fetch;
  fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === RESEND_URL) {
      mails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "email_test" });
    }
    return googleFetch(url, init);
  }) as typeof fetch;
  globalThis.fetch = fakeFetch;
  setEnv(ON);
  paused = embeddedWorker();
  await paused?.drain(10_000);
  // Everything the logger writes in this file, kept to search for tokens.
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => spyOn(console, m).mockImplementation(() => {}));
});
beforeEach(() => {
  setEnv(ON);
  resetAuthRateLimits();
});
afterAll(() => {
  for (const spy of logs) spy.mockRestore();
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
  google.restore();
  setEnv(Object.fromEntries(Object.keys(ON).map((k) => [k, undefined])));
});

/** Every `table.column` of a TEXT (or untyped) column in the database whose value contains `needle`. */
function whereStored(needle: string): string[] {
  const tables = db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[];
  const found: string[] = [];
  for (const { name } of tables) {
    let columns: { name: string; type: string }[];
    try {
      columns = db.query(`PRAGMA table_info("${name}")`).all() as { name: string; type: string }[];
    } catch {
      continue;
    }
    for (const col of columns) {
      const type = col.type.toUpperCase();
      if (type && !type.includes("TEXT") && !type.includes("CHAR") && !type.includes("CLOB") && type !== "BLOB") continue;
      let hit: { n: number } | null = null;
      try {
        hit = db.query(`SELECT COUNT(*) AS n FROM "${name}" WHERE instr(CAST("${col.name}" AS TEXT), ?) > 0`).get(needle) as { n: number };
      } catch {
        continue; // a virtual table's shadow column, say
      }
      if (hit && hit.n > 0) found.push(`${name}.${col.name}`);
    }
  }
  return found;
}

const hashIn = (table: string, column: string, raw: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`).get(sha256Hex(raw)) as { n: number }).n;

/** Every token seen in this file, for the log check at the end. */
const seen: string[] = [];
const expectHashedOnly = (raw: string, table: string, column: string) => {
  expect(raw.length).toBeGreaterThan(16);
  seen.push(raw);
  expect(whereStored(raw)).toEqual([]);
  expect(hashIn(table, column, raw)).toBe(1);
};

const get = (path: string, headers: Record<string, string> = {}) => handleRequest(new Request(`http://localhost${path}`, { headers }));

describe("security: tokens at rest", () => {
  test("PAT", async () => {
    const user = makeUser();
    const res = await v2("POST", "/me/tokens", {
      headers: tokenAuth(user),
      body: { workspace_id: personalWorkspaceId(user.id), name: "스크립트", scopes: ["recordings:read"] },
    });
    expect(res.status).toBe(201);
    expect(String(res.body.secret)).toStartWith("lct_pat_");
    expectHashedOnly(res.body.secret, "access_token", "token_hash");
  });

  test("native access", async () => {
    const user = makeUser();
    const res = await v2("POST", "/auth/native/token", { body: { grant_type: "password", email: user.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    expectHashedOnly(res.body.access_token, "native_session", "access_hash");
  });

  test("native refresh", async () => {
    const user = makeUser();
    const first = await v2("POST", "/auth/native/token", { body: { grant_type: "password", email: user.email, password: PASSWORD } });
    expectHashedOnly(first.body.refresh_token, "native_session", "refresh_hash");
    // The rotated pair is stored the same way.
    const next = await v2("POST", "/auth/native/token", { body: { grant_type: "refresh_token", refresh_token: first.body.refresh_token } });
    expect(next.status).toBe(200);
    expectHashedOnly(next.body.refresh_token, "native_session", "refresh_hash");
    expectHashedOnly(next.body.access_token, "native_session", "access_hash");
  });

  test("invite", async () => {
    const owner = makeUser();
    const ws = await v2("POST", "/workspaces", { headers: tokenAuth(owner), body: { name: "보안 스터디" } });
    expect(ws.status).toBe(201);
    const before = mails.length;
    const res = await v2("POST", `/workspaces/${ws.body.id}/invites`, { headers: tokenAuth(owner), body: { email: `${generateId("inv")}@test.local`, role: "member" } });
    expect(res.status).toBe(201);
    expect(mails.length).toBe(before + 1);
    const token = decodeURIComponent(/\/app\/invite\?token=([^"&]+)/.exec(mails.at(-1)!.html)![1]!);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expectHashedOnly(token, "workspace_invite", "token_hash");
  });

  test("ICS feed", async () => {
    const user = makeUser();
    const res = await v2("POST", "/calendar/feed", { headers: tokenAuth(user), body: { workspace_id: personalWorkspaceId(user.id) } });
    expect(res.status).toBe(200);
    const token = /\/cal\/([A-Za-z0-9_-]+)\.ics$/.exec(res.body.url)![1]!;
    expectHashedOnly(token, "calendar_feed", "token_hash");
  });

  test("share link (v2)", async () => {
    const owner = makeUser();
    const { recordingId } = seedLecture(owner);
    const { token } = await createShareLink(owner, recordingId, { password: "correct-horse-1" });
    expectHashedOnly(token, "share_link", "token_hash");
  });

  test("oauth state", async () => {
    // Google sign-in and the calendar connection both keep only the state's hash.
    const signIn = await get(`${API_BASE_PATH}/auth/google/start?next=/app`);
    expect(signIn.status).toBe(302);
    expectHashedOnly(new URL(signIn.headers.get("location")!).searchParams.get("state")!, "oauth_state", "state_hash");
    const user = makeUser();
    const connect = await v2("POST", "/integrations/google", { headers: tokenAuth(user), body: { workspace_id: personalWorkspaceId(user.id) } });
    expect(connect.status).toBe(200);
    expectHashedOnly(new URL(connect.body.authorization_url).searchParams.get("state")!, "oauth_state", "state_hash");
  });

  test("google refresh token is sealed", async () => {
    const user = makeUser();
    const start = await v2("POST", "/integrations/google", { headers: tokenAuth(user), body: { workspace_id: personalWorkspaceId(user.id) } });
    const state = new URL(start.body.authorization_url).searchParams.get("state")!;
    const refreshToken = `rt-${generateId("sealed")}-0123456789`;
    const code = generateId("code");
    google.issueCode(code, { refreshToken });
    const back = await get(`${API_BASE_PATH}/integrations/google/callback?${new URLSearchParams({ code, state })}`, tokenAuth(user));
    expect(back.status).toBe(302);
    seen.push(refreshToken);
    expect(whereStored(refreshToken)).toEqual([]);
    const row = db.query(`SELECT token_enc FROM integration WHERE user_id = ? AND provider = 'google'`).get(user.id) as { token_enc: string };
    expect(row.token_enc).not.toContain(refreshToken);
    expect(JSON.parse(openSecret(row.token_enc)!)).toMatchObject({ refresh_token: refreshToken });
  });

  test("known exceptions are exactly the v1 ones", async () => {
    const user = makeUser();
    const session = createSession(user.id);
    const { lectureId } = seedLecture(user);
    const shareToken = getLectureById(lectureId)!.share_token;
    seen.push(user.api_token, session, shareToken);
    // The v1 contract keeps these three in the clear, each in its own column only.
    expect(whereStored(user.api_token)).toEqual(["users.api_token"]);
    expect(whereStored(session)).toEqual(["sessions.token"]);
    expect(whereStored(shareToken)).toEqual(["lectures.share_token"]);
    // Its v2 link is the hash of the v1 token.
    expect(hashIn("share_link", "token_hash", shareToken)).toBe(1);
  });

  test("tokens do not appear in logs", () => {
    expect(seen.length).toBeGreaterThanOrEqual(12);
    const output = logs.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))).join("\n");
    expect(output.length).toBeGreaterThan(0);
    for (const token of seen) expect(output.includes(token), token.slice(0, 10)).toBe(false);
  });
});
