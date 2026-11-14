import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { API_BASE_PATH } from "@lectern/domain";
import { appleDisplayName } from "../src/api/v2/auth-apple.ts";
import { createSession, createUser, db, generateId, updateSystemSettings, type UserRecord } from "../src/db.ts";
import { clearJwksCache } from "../src/oauth/jwt.ts";
import { handleRequest } from "../src/index.ts";
import { createFakeApple, type FakeAppleIdToken } from "./fakes/apple.ts";

// "Apple로 계속하기" (P5-05, D-P5-5) against the fake Apple: an ES256 client secret signed
// with a .p8 key made here, the form_post callback without cookies, the account rules of
// Google sign-in. The key lives in a temporary directory, never in the repository.

const apple = createFakeApple();
const START = `${API_BASE_PATH}/auth/apple/start`;
const CALLBACK = `${API_BASE_PATH}/auth/apple/callback`;
const CLIENT_ID = "com.example.lectern.web";
const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY1234567";

let keyDir = "";
let keyFile = "";
let publicKey: CryptoKey;

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};
const on = () => ({
  LECTERN_APPLE_LOGIN: "1",
  APPLE_SIGNIN_CLIENT_ID: CLIENT_ID,
  APPLE_SIGNIN_TEAM_ID: TEAM_ID,
  APPLE_SIGNIN_KEY_ID: KEY_ID,
  APPLE_SIGNIN_PRIVATE_KEY_FILE: keyFile,
});

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  keyDir = mkdtempSync(join(tmpdir(), "lectern-apple-"));
  keyFile = join(keyDir, "AuthKey_TEST.p8");
  writeFileSync(keyFile, `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`, { mode: 0o600 });
  apple.install();
  setEnv(on());
});
beforeEach(() => {
  setEnv(on());
  clearJwksCache();
  updateSystemSettings({ allow_public_signup: true, default_require_approval: false });
});
afterAll(() => {
  apple.restore();
  rmSync(keyDir, { recursive: true, force: true });
  setEnv({
    LECTERN_APPLE_LOGIN: undefined,
    APPLE_SIGNIN_CLIENT_ID: undefined,
    APPLE_SIGNIN_TEAM_ID: undefined,
    APPLE_SIGNIN_KEY_ID: undefined,
    APPLE_SIGNIN_PRIVATE_KEY_FILE: undefined,
  });
});

async function start(user: UserRecord | null = null, next = "/app"): Promise<{ status: number; url: URL | null; state: string }> {
  const headers: Record<string, string> = user ? { Cookie: `lectern_session=${encodeURIComponent(createSession(user.id))}` } : {};
  const res = await handleRequest(new Request(`http://localhost${START}?next=${encodeURIComponent(next)}`, { headers }));
  if (res.status !== 302) return { status: res.status, url: null, state: "" };
  const url = new URL(res.headers.get("location")!);
  apple.authorize(url);
  return { status: res.status, url, state: url.searchParams.get("state")! };
}

/** Apple's form_post back: no cookies, Origin appleid.apple.com unless told otherwise. */
async function post(form: Record<string, string>, origin: string | null = "https://appleid.apple.com") {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (origin) headers.Origin = origin;
  const res = await handleRequest(new Request(`http://localhost${CALLBACK}`, { method: "POST", headers, body: new URLSearchParams(form).toString() }));
  return { status: res.status, location: res.headers.get("location") ?? "", setCookies: res.headers.getSetCookie() };
}

async function signIn(idToken: FakeAppleIdToken, extra: Record<string, string> = {}, origin?: string | null) {
  const { state } = await start();
  const code = generateId("code");
  apple.issueCode(code, idToken);
  return post({ code, state, ...extra }, origin);
}

const sub = () => `${generateId("apple")}.0123`;
const newEmail = () => `${generateId("a")}@icloud.test`;
const sessionOf = (cookies: string[]) => cookies.find((c) => c.startsWith("lectern_session="));
const userByEmail = (email: string) => db.query(`SELECT * FROM users WHERE email = ?`).get(email) as UserRecord | null;
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("Sign in with Apple", () => {
  test("start redirects to Apple", async () => {
    const { status, url, state } = await start();
    expect(status).toBe(302);
    expect(`${url!.origin}${url!.pathname}`).toBe("https://appleid.apple.com/auth/authorize");
    expect(url!.searchParams.get("response_mode")).toBe("form_post");
    expect(url!.searchParams.get("response_type")).toBe("code");
    expect(url!.searchParams.get("scope")).toBe("name email");
    expect(url!.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url!.searchParams.get("redirect_uri")).toEndWith(`${API_BASE_PATH}/auth/apple/callback`);
    expect(url!.searchParams.get("nonce")).toBe(state);
  });

  test("client secret claims", async () => {
    const res = await signIn({ sub: sub(), email: newEmail(), email_verified: true });
    expect(res.status).toBe(303);
    const secret = apple.lastClientSecret()!;
    const [h, p, s] = secret.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "ES256", kid: KEY_ID });
    const claims = decode(p);
    expect(claims.iss).toBe(TEAM_ID);
    expect(claims.sub).toBe(CLIENT_ID);
    expect(claims.aud).toBe("https://appleid.apple.com");
    expect(claims.exp - claims.iat).toBe(300);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  test("new user via form_post", async () => {
    const email = newEmail();
    const identities = (db.query(`SELECT COUNT(*) AS n FROM oauth_identity WHERE provider = 'apple'`).get() as { n: number }).n;
    const res = await signIn({ sub: sub(), email, email_verified: true });
    expect(res.status).toBe(303);
    expect(res.location).toBe("/app");
    const session = sessionOf(res.setCookies);
    expect(session).toContain("HttpOnly");
    const user = userByEmail(email);
    expect(user).not.toBeNull();
    expect((db.query(`SELECT COUNT(*) AS n FROM oauth_identity WHERE provider = 'apple'`).get() as { n: number }).n).toBe(identities + 1);
    const token = session!.split(";")[0]!.split("=")[1]!;
    const me = await handleRequest(new Request(`http://localhost${API_BASE_PATH}/me`, { headers: { Cookie: `lectern_session=${token}` } }));
    expect(me.status).toBe(200);
  });

  test("name from the first login", async () => {
    const email = newEmail();
    await signIn({ sub: sub(), email, email_verified: true }, { user: JSON.stringify({ name: { firstName: "선우", lastName: "김" }, email }) });
    expect(userByEmail(email)!.display_name).toBe("김선우");
    expect(appleDisplayName(JSON.stringify({ name: { firstName: "Ada" } }))).toBe("Ada");
    expect(appleDisplayName("{not json")).toBeNull();
    expect(appleDisplayName(null)).toBeNull();
  });

  test("private relay address", async () => {
    const email = `${generateId("abc")}@privaterelay.appleid.com`;
    const res = await signIn({ sub: sub(), email, email_verified: "true" });
    expect(res.location).toBe("/app");
    expect(userByEmail(email)).not.toBeNull();
  });

  test("email_verified as a string", async () => {
    expect((await signIn({ sub: sub(), email: newEmail(), email_verified: "true" })).location).toBe("/app");
    const refused = await signIn({ sub: sub(), email: newEmail(), email_verified: "false" });
    expect(refused.location).toBe("/app/login?error=email_unverified");
    expect(sessionOf(refused.setCookies)).toBeUndefined();
  });

  test("an existing account with the verified e-mail is linked", async () => {
    const existing = createUser({ email: newEmail(), displayName: "기존", password: "correct_password_1" });
    const res = await signIn({ sub: sub(), email: existing.email, email_verified: true });
    expect(res.location).toBe("/app");
    expect(db.query(`SELECT user_id FROM oauth_identity WHERE provider = 'apple' AND user_id = ?`).get(existing.id)).toEqual({ user_id: existing.id });
  });

  test("nonce mismatch", async () => {
    expect((await signIn({ sub: sub(), email: newEmail(), email_verified: true, nonce: "other" })).location).toBe("/app/login?error=oauth");
  });

  test("audience mismatch", async () => {
    expect((await signIn({ sub: sub(), email: newEmail(), email_verified: true, aud: "com.other.app" })).location).toBe("/app/login?error=oauth");
  });

  test("state replay", async () => {
    const { state } = await start();
    const code = generateId("code");
    apple.issueCode(code, { sub: sub(), email: newEmail(), email_verified: true });
    expect((await post({ code, state })).location).toBe("/app");
    const code2 = generateId("code");
    apple.issueCode(code2, { sub: sub(), email: newEmail(), email_verified: true });
    const again = await post({ code: code2, state });
    expect(again.status).toBe(303);
    expect(again.location).toBe("/app/login?error=oauth");
  });

  test("wrong Origin", async () => {
    const res = await signIn({ sub: sub(), email: newEmail(), email_verified: true }, {}, "https://evil.example");
    expect(res.location).toBe("/app/login?error=oauth");
    // Without an Origin header (some browsers), the state alone decides.
    expect((await signIn({ sub: sub(), email: newEmail(), email_verified: true }, {}, null)).location).toBe("/app");
  });

  test("a denied consent", async () => {
    const { state } = await start();
    expect((await post({ state, error: "user_cancelled_authorize" })).location).toBe("/app/login?error=oauth");
  });

  test("link flow without a cookie", async () => {
    const user = createUser({ email: newEmail(), displayName: "연결", password: "correct_password_1" });
    const { state } = await start(user);
    const code = generateId("code");
    const subject = sub();
    apple.issueCode(code, { sub: subject, email: `${generateId("r")}@privaterelay.appleid.com`, email_verified: true });
    const res = await post({ code, state });
    expect(res.location).toBe("/app/settings?identity=linked#account");
    expect(sessionOf(res.setCookies)).toBeUndefined();
    expect(db.query(`SELECT user_id FROM oauth_identity WHERE provider = 'apple' AND subject = ?`).get(subject)).toEqual({ user_id: user.id });
  });

  test("next is kept from start", async () => {
    const { state } = await start(null, "/app/ask");
    const code = generateId("code");
    apple.issueCode(code, { sub: sub(), email: newEmail(), email_verified: true });
    expect((await post({ code, state })).location).toBe("/app/ask");
  });

  test("key file missing", async () => {
    setEnv({ ...on(), APPLE_SIGNIN_PRIVATE_KEY_FILE: join(keyDir, "missing.p8") });
    expect((await start()).status).toBe(501);
    setEnv({ ...on(), APPLE_SIGNIN_TEAM_ID: undefined });
    expect((await start()).status).toBe(501);
  });

  test("flag off", async () => {
    setEnv({ ...on(), LECTERN_APPLE_LOGIN: "0" });
    expect((await start()).status).toBe(404);
    expect((await post({ code: "x", state: "y" })).status).toBe(404);
  });

  test("no secrets in logs", async () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    let logs = "";
    try {
      for (const idToken of [
        { sub: sub(), email: newEmail(), email_verified: true },
        { sub: sub(), email: newEmail(), email_verified: "false" },
        { sub: sub(), email: newEmail(), email_verified: true, nonce: "x" },
      ]) {
        const { state } = await start();
        const code = generateId("code");
        apple.issueCode(code, idToken);
        await post({ code, state });
        seen.push(code, state, apple.lastClientSecret() ?? "");
      }
      logs = [...out.mock.calls, ...err.mock.calls].map((c) => c.join(" ")).join("\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    for (const value of seen.filter(Boolean)) expect(logs).not.toContain(value);
    expect(logs).not.toContain("BEGIN PRIVATE KEY");
    expect(logs).not.toContain("eyJ");
    expect(logs).toContain("apple login");
  });

  test("never calls a host other than Apple", () => {
    for (const r of apple.requests) expect(new URL(r.url).hostname).toBe("appleid.apple.com");
  });
});
