import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { API_BASE_PATH } from "@lectern/domain";
import { createSession, createUser, db, generateId, updateSystemSettings, type UserRecord } from "../src/db.ts";
import { clearJwksCache } from "../src/oauth/jwt.ts";
import { safeNext } from "../src/oauth/login.ts";
import { handleRequest } from "../src/index.ts";
import { createFakeGoogle, type FakeIdToken } from "./fakes/google.ts";

// "Google로 계속하기" (P5-04, D-P5-1, D-P5-5) against the fake Google: OIDC code + PKCE, the
// ID token's signature and claims, account matching by verified e-mail, linking, unlinking.

const google = createFakeGoogle();
const START = `${API_BASE_PATH}/auth/google/start`;
const CALLBACK = `${API_BASE_PATH}/auth/google/callback`;

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};
const ON = { LECTERN_GOOGLE_LOGIN: "1", GOOGLE_OAUTH_CLIENT_ID: "test-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-secret" };

beforeAll(() => {
  google.install();
  setEnv(ON);
});
beforeEach(() => {
  setEnv(ON);
  clearJwksCache();
  updateSystemSettings({ allow_public_signup: true, default_require_approval: false });
});
afterAll(() => {
  google.restore();
  setEnv({ LECTERN_GOOGLE_LOGIN: undefined, GOOGLE_OAUTH_CLIENT_ID: undefined, GOOGLE_OAUTH_CLIENT_SECRET: undefined });
});

/** Cookies a browser keeps between requests (name → value). */
class Browser {
  cookies = new Map<string, string>();
  constructor(readonly user: UserRecord | null = null) {
    if (user) this.cookies.set("lectern_session", encodeURIComponent(createSession(user.id)));
  }
  header(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
  }
  async get(path: string): Promise<{ status: number; location: string; setCookies: string[] }> {
    const res = await handleRequest(new Request(`http://localhost${path}`, { headers: this.header() }));
    const setCookies = res.headers.getSetCookie();
    for (const cookie of setCookies) {
      const [pair, ...attrs] = cookie.split(";");
      const [name, ...value] = pair!.trim().split("=");
      if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.cookies.delete(name!);
      else this.cookies.set(name!, value.join("="));
    }
    return { status: res.status, location: res.headers.get("location") ?? "", setCookies };
  }
}

async function start(browser: Browser, next = "/app/ask"): Promise<{ url: URL; state: string }> {
  const res = await browser.get(`${START}?next=${encodeURIComponent(next)}`);
  expect(res.status).toBe(302);
  const url = new URL(res.location);
  google.authorize(url);
  return { url, state: url.searchParams.get("state")! };
}

/** Starts, lets Google answer with this ID token, and comes back. */
async function signIn(browser: Browser, idToken: FakeIdToken, next = "/app/ask") {
  const { state } = await start(browser, next);
  const code = generateId("code");
  google.issueCode(code, { refreshToken: null, idToken });
  return browser.get(`${CALLBACK}?${new URLSearchParams({ code, state })}`);
}

const newEmail = () => `${generateId("g")}@gmail.test`;
const userCount = () => (db.query(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
const identityCount = () => (db.query(`SELECT COUNT(*) AS n FROM oauth_identity`).get() as { n: number }).n;
const sub = () => generateId("sub");

async function v2(browser: Browser, method: string, path: string): Promise<{ status: number; body: any }> {
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers: browser.header() }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null };
}

/** A password account made a minute ago (an account made by Google sign-in has its identity within seconds). */
function passwordUser(): UserRecord {
  const user = createUser({ email: newEmail(), displayName: "비밀번호 사용자", password: "correct_password_1" });
  db.query(`UPDATE users SET created_at = ? WHERE id = ?`).run(new Date(Date.now() - 60_000).toISOString(), user.id);
  return user;
}

describe("Google sign-in", () => {
  test("start redirects to Google", async () => {
    const browser = new Browser();
    const res = await browser.get(`${START}?next=/app/ask`);
    expect(res.status).toBe(302);
    const url = new URL(res.location);
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBe(url.searchParams.get("state"));
    expect(url.searchParams.get("redirect_uri")).toEndWith(`${API_BASE_PATH}/auth/google/callback`);
    expect(url.searchParams.has("access_type")).toBe(false);
    expect(browser.cookies.has("lectern_oauth")).toBe(true);
  });

  test("new user", async () => {
    const before = { users: userCount(), identities: identityCount() };
    const browser = new Browser();
    const email = newEmail();
    const res = await signIn(browser, { sub: sub(), email, email_verified: true, name: "구글 사용자" });
    expect(res.status).toBe(302);
    expect(res.location).toBe("/app/ask");
    const session = res.setCookies.find((c) => c.startsWith("lectern_session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(userCount()).toBe(before.users + 1);
    expect(identityCount()).toBe(before.identities + 1);
    const me = await v2(browser, "GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body.display_name).toBe("구글 사용자");
    // Sign-in keeps no Google token, and asks for none that lasts.
    expect(db.query(`SELECT COUNT(*) AS n FROM integration WHERE user_id = ?`).get(me.body.id)).toEqual({ n: 0 });
  });

  test("existing verified e-mail links", async () => {
    const existing = passwordUser();
    const users = userCount();
    const browser = new Browser();
    const res = await signIn(browser, { sub: sub(), email: existing.email.toUpperCase(), email_verified: true });
    expect(res.location).toBe("/app/ask");
    expect(userCount()).toBe(users);
    const linked = db.query(`SELECT user_id, provider FROM oauth_identity WHERE user_id = ?`).all(existing.id);
    expect(linked).toEqual([{ user_id: existing.id, provider: "google" }]);
    expect((await v2(browser, "GET", "/me")).body.id).toBe(existing.id);
  });

  test("second login reuses the identity", async () => {
    const subject = sub();
    const email = newEmail();
    await signIn(new Browser(), { sub: subject, email, email_verified: true });
    const counts = { users: userCount(), identities: identityCount() };
    // Even with another e-mail at Google now, the identity decides.
    const again = new Browser();
    const res = await signIn(again, { sub: subject, email: newEmail(), email_verified: true });
    expect(res.location).toBe("/app/ask");
    expect({ users: userCount(), identities: identityCount() }).toEqual(counts);
    expect((await v2(again, "GET", "/me")).body.email).toBe(email);
  });

  test("email_verified=false is refused", async () => {
    const existing = passwordUser();
    const counts = { users: userCount(), identities: identityCount() };
    for (const email of [existing.email, newEmail()]) {
      const res = await signIn(new Browser(), { sub: sub(), email, email_verified: false });
      expect(res.location).toBe("/app/login?error=email_unverified");
      expect(res.setCookies.some((c) => c.startsWith("lectern_session="))).toBe(false);
    }
    expect({ users: userCount(), identities: identityCount() }).toEqual(counts);
  });

  test("no e-mail is refused", async () => {
    const res = await signIn(new Browser(), { sub: sub() });
    expect(res.location).toBe("/app/login?error=no_email");
  });

  test("aud mismatch is refused", async () => {
    const res = await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true, aud: "other-client" });
    expect(res.location).toBe("/app/login?error=oauth");
    expect(res.setCookies.some((c) => c.startsWith("lectern_session="))).toBe(false);
  });

  test("wrong issuer and expired tokens are refused", async () => {
    expect((await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true, iss: "https://evil.test" })).location).toBe(
      "/app/login?error=oauth",
    );
    const past = Math.floor(Date.now() / 1000) - 600;
    expect((await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true, exp: past })).location).toBe("/app/login?error=oauth");
  });

  test("state replay is refused", async () => {
    const browser = new Browser();
    const { state } = await start(browser);
    const code = generateId("code");
    google.issueCode(code, { refreshToken: null, idToken: { sub: sub(), email: newEmail(), email_verified: true } });
    const first = await browser.get(`${CALLBACK}?${new URLSearchParams({ code, state })}`);
    expect(first.location).toBe("/app/ask");
    browser.cookies.set("lectern_oauth", "anything");
    const code2 = generateId("code");
    google.issueCode(code2, { refreshToken: null, idToken: { sub: sub(), email: newEmail(), email_verified: true } });
    const second = await browser.get(`${CALLBACK}?${new URLSearchParams({ code: code2, state })}`);
    expect(second.location).toBe("/app/login?error=oauth");
  });

  test("nonce mismatch is refused", async () => {
    const res = await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true, nonce: "another-nonce" });
    expect(res.location).toBe("/app/login?error=oauth");
  });

  test("another browser cannot finish the sign-in", async () => {
    const attacker = new Browser();
    const { state } = await start(attacker);
    const code = generateId("code");
    google.issueCode(code, { refreshToken: null, idToken: { sub: sub(), email: newEmail(), email_verified: true } });
    const victim = new Browser();
    const res = await victim.get(`${CALLBACK}?${new URLSearchParams({ code, state })}`);
    expect(res.location).toBe("/app/login?error=oauth");
    expect(victim.cookies.has("lectern_session")).toBe(false);
  });

  test("a denied consent goes back to the login screen", async () => {
    const browser = new Browser();
    const { state } = await start(browser);
    const res = await browser.get(`${CALLBACK}?${new URLSearchParams({ error: "access_denied", state })}`);
    expect(res.location).toBe("/app/login?error=oauth");
  });

  test("next must be a local path", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const res = await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true }, next);
      expect(res.location, next).toBe("/app");
    }
    expect(safeNext("/app/ask?x=1#y")).toBe("/app/ask?x=1#y");
    expect(safeNext(`/${"a".repeat(600)}`)).toBe("/app");
    expect(safeNext("/app\r\nSet-Cookie: x=1")).toBe("/app");
  });

  test("closed sign-up and approval follow the operator settings", async () => {
    updateSystemSettings({ allow_public_signup: false });
    const closed = await signIn(new Browser(), { sub: sub(), email: newEmail(), email_verified: true });
    expect(closed.location).toBe("/app/login?error=signup_closed");
    // An existing account still gets in.
    const existing = passwordUser();
    expect((await signIn(new Browser(), { sub: sub(), email: existing.email, email_verified: true })).location).toBe("/app/ask");

    updateSystemSettings({ allow_public_signup: true, default_require_approval: true });
    const email = newEmail();
    const pending = await signIn(new Browser(), { sub: sub(), email, email_verified: true });
    expect(pending.location).toBe("/app/login?error=inactive");
    expect((db.query(`SELECT status FROM users WHERE email = ?`).get(email) as { status: string }).status).toBe("pending");
  });

  test("a suspended account is refused", async () => {
    const existing = passwordUser();
    db.query(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(existing.id);
    const res = await signIn(new Browser(), { sub: sub(), email: existing.email, email_verified: true });
    expect(res.location).toBe("/app/login?error=inactive");
  });

  test("link flow", async () => {
    const user = passwordUser();
    const browser = new Browser(user);
    const res = await signIn(browser, { sub: sub(), email: newEmail(), email_verified: true });
    expect(res.location).toBe("/app/settings?identity=linked#account");
    const list = await v2(browser, "GET", "/me/identities");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].provider).toBe("google");
  });

  test("identity already used by someone else", async () => {
    const subject = sub();
    await signIn(new Browser(), { sub: subject, email: newEmail(), email_verified: true });
    const other = passwordUser();
    const browser = new Browser(other);
    const res = await signIn(browser, { sub: subject, email: newEmail(), email_verified: true });
    expect(res.location).toBe("/app/settings?identity=taken#account");
    expect((await v2(browser, "GET", "/me/identities")).body.items).toHaveLength(0);
  });

  test("unlink keeps the last sign-in method", async () => {
    const browser = new Browser();
    await signIn(browser, { sub: sub(), email: newEmail(), email_verified: true });
    const [identity] = (await v2(browser, "GET", "/me/identities")).body.items;
    const res = await v2(browser, "DELETE", `/me/identities/${identity.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("마지막 로그인 수단은 연결을 해제할 수 없습니다. 먼저 비밀번호를 설정해 주세요.");
    // After a password reset the account has a password of its own: it may go.
    const me = (await v2(browser, "GET", "/me")).body;
    db.query(`INSERT INTO audit_logs (id, actor_id, actor_email, action, target_id, detail, created_at) VALUES (?, ?, ?, 'account.password_reset', ?, '', ?)`).run(
      generateId("audlog"),
      me.id,
      me.email,
      me.id,
      new Date().toISOString(),
    );
    expect((await v2(browser, "DELETE", `/me/identities/${identity.id}`)).status).toBe(204);
  });

  test("unlink with a password", async () => {
    const user = passwordUser();
    const browser = new Browser(user);
    await signIn(browser, { sub: sub(), email: newEmail(), email_verified: true });
    const [identity] = (await v2(browser, "GET", "/me/identities")).body.items;
    expect((await v2(browser, "DELETE", `/me/identities/${identity.id}`)).status).toBe(204);
    expect((await v2(browser, "GET", "/me/identities")).body.items).toHaveLength(0);
    // Someone else's identity: not found.
    const owner = new Browser();
    await signIn(owner, { sub: sub(), email: newEmail(), email_verified: true });
    const [theirs] = (await v2(owner, "GET", "/me/identities")).body.items;
    expect((await v2(browser, "DELETE", `/me/identities/${theirs.id}`)).status).toBe(404);
  });

  test("flag off", async () => {
    setEnv({ LECTERN_GOOGLE_LOGIN: "0" });
    const browser = new Browser();
    expect((await browser.get(START)).status).toBe(404);
    expect((await browser.get(`${CALLBACK}?code=x&state=y`)).status).toBe(404);
    setEnv({ ...ON, GOOGLE_OAUTH_CLIENT_SECRET: undefined });
    expect((await browser.get(START)).status).toBe(404);
  });

  test("no secrets in logs", async () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    let logs = "";
    try {
      for (const idToken of [
        { sub: sub(), email: newEmail(), email_verified: true },
        { sub: sub(), email: newEmail(), email_verified: false },
        { sub: sub(), email: newEmail(), email_verified: true, aud: "other-client" },
      ]) {
        const browser = new Browser();
        const { state } = await start(browser);
        const code = generateId("code");
        google.issueCode(code, { refreshToken: null, idToken });
        await browser.get(`${CALLBACK}?${new URLSearchParams({ code, state })}`);
        seen.push(code, state);
      }
      logs = [...out.mock.calls, ...err.mock.calls].map((c) => c.join(" ")).join("\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    for (const value of seen) expect(logs).not.toContain(value);
    expect(logs).not.toContain("eyJ"); // no JWT
    expect(logs).toContain("google login");
  });

  test("never calls a real host", () => {
    for (const r of google.requests) expect(["oauth2.googleapis.com", "www.googleapis.com"]).toContain(new URL(r.url).hostname);
  });
});
