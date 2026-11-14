import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, test } from "bun:test";
import { API_BASE_PATH } from "@lectern/domain";
import { createSession, createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { deviceNameFromUserAgent, sessionIdOf, touchSession } from "../src/session-meta.ts";

// P5-01: the device name and last use of web login sessions (auth_session_meta, D-P5-2).

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const PASSWORD = "session_meta_pw_123";

beforeEach(() => {
  resetAuthRateLimits();
});

function newUser(): UserRecord {
  return createUser({ email: `${generateId("sm")}@test.local`, displayName: "기기 테스트", password: PASSWORD });
}

async function login(user: UserRecord, userAgent?: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;
  const res = await handleRequest(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    })
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

const cookie = (token: string) => ({ Cookie: `lectern_session=${encodeURIComponent(token)}` });

async function devices(token: string): Promise<any[]> {
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}/me/devices`, { headers: cookie(token) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: any[] }).items;
}

const metaRow = (token: string) =>
  db.query(`SELECT * FROM auth_session_meta WHERE session_id = ?`).get(sessionIdOf(token)) as
    | { user_id: string; client_kind: string; device_name: string | null; user_agent: string | null; created_at: number; last_seen_at: number }
    | null;
const sessionRow = (token: string) => db.query(`SELECT token FROM sessions WHERE token = ?`).get(token);

describe("session meta (P5-01)", () => {
  test("device names", () => {
    const cases: Array<[string | null, string | null]> = [
      [MAC_CHROME, "Mac의 Chrome"],
      [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "iPhone의 Safari",
      ],
      [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        "Windows의 Edge",
      ],
      [
        "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
        "Android의 삼성 인터넷",
      ],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux의 Firefox"],
      ["curl/8.7.1", null],
      ["", null],
      [null, null],
    ];
    for (const [ua, name] of cases) expect(deviceNameFromUserAgent(ua), String(ua)).toBe(name);
    // Only one side known: that side alone.
    expect(deviceNameFromUserAgent("Mozilla/5.0 (Windows NT 10.0) SomeApp/1.0")).toBe("Windows");
    expect(deviceNameFromUserAgent("Something Chrome/130.0")).toBe("Chrome");
  });

  test("login records the device", async () => {
    const user = newUser();
    const token = await login(user, MAC_CHROME);
    const row = metaRow(token);
    expect(row?.user_id).toBe(user.id);
    expect(row?.client_kind).toBe("web");

    const list = await devices(token);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sessionIdOf(token));
    expect(list[0].device_name).toBe("Mac의 Chrome");
    expect(list[0].user_agent).toBe(MAC_CHROME);
    expect(list[0].current).toBe(true);
  });

  test("the user agent is kept to 512 characters", async () => {
    const user = newUser();
    const token = await login(user, `${MAC_CHROME} ${"x".repeat(1000)}`);
    expect(metaRow(token)?.user_agent).toHaveLength(512);
  });

  test("sessions from before have null names", async () => {
    const user = newUser();
    const old = createSession(user.id);
    expect(metaRow(old)).toBeNull();

    const [device] = await devices(old);
    expect(device.device_name).toBeNull();
    expect(device.user_agent).toBeNull();
    expect(device.last_seen_at).toBe(device.created_at);
    // Using an old session does not make a row for it.
    expect(metaRow(old)).toBeNull();
  });

  test("last_seen_at moves at most every 5 minutes", async () => {
    const user = newUser();
    const token = await login(user, MAC_CHROME);
    const T = Date.parse("2026-11-01T00:00:00Z");
    db.query(`UPDATE auth_session_meta SET last_seen_at = ? WHERE session_id = ?`).run(T, sessionIdOf(token));

    touchSession(token, T + 1000); // this process's first touch of the session
    expect(metaRow(token)?.last_seen_at).toBe(T + 1000);
    touchSession(token, T + 61_000);
    expect(metaRow(token)?.last_seen_at).toBe(T + 1000);
    touchSession(token, T + 302_000);
    expect(metaRow(token)?.last_seen_at).toBe(T + 302_000);
  });

  test("an authenticated request touches the session, an API token does not", async () => {
    const user = newUser();
    const token = await login(user, MAC_CHROME);
    db.query(`UPDATE auth_session_meta SET last_seen_at = 1 WHERE session_id = ?`).run(sessionIdOf(token));
    const before = Date.now();
    await devices(token);
    expect(metaRow(token)!.last_seen_at).toBeGreaterThanOrEqual(before);

    // API token requests leave session rows alone.
    db.query(`UPDATE auth_session_meta SET last_seen_at = 1 WHERE session_id = ?`).run(sessionIdOf(token));
    const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}/me`, { headers: { "X-Lectern-Token": user.api_token } }));
    expect(res.status).toBe(200);
    expect(metaRow(token)!.last_seen_at).toBe(1);
  });

  test("logout removes the row", async () => {
    const user = newUser();
    const token = await login(user, MAC_CHROME);
    expect(metaRow(token)).not.toBeNull();
    const res = await handleRequest(new Request("http://localhost/api/auth/logout", { method: "POST", headers: cookie(token) }));
    expect(res.status).toBe(200);
    expect(sessionRow(token)).toBeNull();
    expect(metaRow(token)).toBeNull();
  });

  test("revokeDevice removes the row", async () => {
    const user = newUser();
    const mine = await login(user, MAC_CHROME);
    const other = await login(user, "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0");
    expect(await devices(mine)).toHaveLength(2);

    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/me/devices/${sessionIdOf(other)}`, { method: "DELETE", headers: cookie(mine) })
    );
    expect(res.status).toBe(204);
    expect(sessionRow(other)).toBeNull();
    expect(metaRow(other)).toBeNull();
    expect(metaRow(mine)).not.toBeNull();
    const left = await devices(mine);
    expect(left.map((d) => d.id)).toEqual([sessionIdOf(mine)]);
  });

  test("password change keeps only the current session's row", async () => {
    const user = newUser();
    const mine = await login(user, MAC_CHROME);
    const other = await login(user, MAC_CHROME);
    const res = await handleRequest(
      new Request("http://localhost/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookie(mine) },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "session_meta_pw_456" }),
      })
    );
    expect(res.status).toBe(200);
    expect(metaRow(mine)).not.toBeNull();
    expect(metaRow(other)).toBeNull();
  });

  test("the token is not stored", async () => {
    const user = newUser();
    const token = await login(user, MAC_CHROME);
    const everything = JSON.stringify(db.query(`SELECT * FROM auth_session_meta`).all());
    expect(everything).toContain(sessionIdOf(token));
    expect(everything).not.toContain(token);
  });
});
