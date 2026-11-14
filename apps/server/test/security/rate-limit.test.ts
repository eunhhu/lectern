import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { config, resetConfigForTests } from "@lectern/config";
import { generateId } from "../../src/db.ts";
import { resetAuthRateLimits } from "../../src/index.ts";
import { call, createShareLink, makeUser, seedLecture, tokenAuth, v2, type Res } from "./helpers.ts";

// P5-15 · Attempt limits (rate-limit.ts, share-page.ts): each guessable secret is tried up to
// its limit, then the next try is refused.
//
// Proxy setup, as in production: one trusted proxy (the Cloudflare tunnel) in front, so
// LECTERN_TRUSTED_PROXY_HOPS is 1 (the default) and the client address is the last
// X-Forwarded-For entry, the one that proxy appends. Anything to its left is what the client
// sent. Limits: login 10 per e-mail and 30 per address in 15 minutes; codes 5 per e-mail;
// reset 10 per e-mail; native sign-in 10 per e-mail; invitations 10 per user; a share link's
// password 10 a minute per link and address.

beforeAll(() => {
  process.env.LECTERN_TEAMS = "1";
  resetConfigForTests();
  expect(config().trustedProxyHops).toBe(1);
});
beforeEach(() => resetAuthRateLimits());
afterAll(() => {
  delete process.env.LECTERN_TEAMS;
  resetConfigForTests();
  resetAuthRateLimits();
});

const login = (email: string, ip?: string, password = "wrong_password_0") =>
  call("POST", "/api/auth/login", { body: { email, password }, headers: ip ? { "X-Forwarded-For": ip } : {} });

/** Sends `n` attempts and checks none of them was refused for the limit. */
async function under(n: number, attempt: (i: number) => Promise<Res>) {
  for (let i = 0; i < n; i++) {
    const res = await attempt(i);
    expect(res.status, `attempt ${i + 1}`).not.toBe(429);
  }
}

const refused = (res: Res) => {
  expect(res.status).toBe(429);
  expect(Number(res.res.headers.get("Retry-After"))).toBeGreaterThan(0);
};

const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

describe("security: rate limits", () => {
  test("login", async () => {
    const user = makeUser();
    await under(10, () => login(user.email));
    refused(await login(user.email));
    // The right password is refused too until the window ends.
    refused(await login(user.email, undefined, "security_password_1"));
  });

  test("native token password grant", async () => {
    const user = makeUser();
    const attempt = () => v2("POST", "/auth/native/token", { body: { grant_type: "password", email: user.email, password: "wrong_password_0" } });
    await under(10, attempt);
    refused(await attempt());
  });

  test("share link password", async () => {
    const owner = makeUser();
    const { recordingId } = seedLecture(owner);
    const { token } = await createShareLink(owner, recordingId, { password: "correct-horse-1" });
    const attempt = (password: string) =>
      call("POST", `/s/${token}`, { raw: new URLSearchParams({ password }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    await under(10, (i) => attempt(`wrong-${i}`));
    refused(await attempt("correct-horse-1"));
  });

  test("invite accept", async () => {
    const user = makeUser();
    const attempt = () => v2("POST", "/invites/accept", { headers: tokenAuth(user), body: { token: `inv_${generateId("guess")}_0123456789` } });
    await under(10, attempt);
    refused(await attempt());
  });

  test("signup code and reset code", async () => {
    const email = `${generateId("code")}@test.local`.toLowerCase();
    const sendCode = (purpose: string) => call("POST", "/api/auth/send-code", { body: { email, purpose } });
    await under(5, () => sendCode("signup"));
    refused(await sendCode("signup"));
    refused(await sendCode("reset"));

    const user = makeUser();
    const reset = () =>
      call("POST", "/api/auth/reset-password", { body: { email: user.email, verificationCode: "000000", newPassword: "security_password_9" } });
    await under(10, reset);
    refused(await reset());
  });

  test("limits are per e-mail and per IP", async () => {
    // Different e-mails from one address: up to the address's 30, then refused, whatever the e-mail.
    const ip = "203.0.113.10";
    await under(30, (i) => login(`${generateId(`ip${i}`)}@test.local`, ip));
    refused(await login(`${generateId("fresh")}@test.local`, ip));
    // Another address is not affected.
    expect((await login(`${generateId("other")}@test.local`, "203.0.113.11")).status).toBe(401);

    // One e-mail from different addresses: up to the e-mail's 10, then refused from anywhere.
    resetAuthRateLimits();
    const user = makeUser();
    await under(10, (i) => login(user.email, `192.0.2.${i + 1}`));
    refused(await login(user.email, "192.0.2.200"));
  });

  test("X-Forwarded-For cannot dodge the limit", async () => {
    // A client writing its own X-Forwarded-For only adds entries to the left of the one the
    // proxy appends, so the address the limit counts stays the real one.
    const real = "203.0.113.20";
    await under(30, (i) => login(`${generateId(`xff${i}`)}@test.local`, `${randomIp()}, ${real}`));
    refused(await login(`${generateId("xff")}@test.local`, `${randomIp()}, 10.0.0.1, ${real}`));

    // And one account cannot be guessed at from "many addresses": its e-mail limit holds.
    resetAuthRateLimits();
    const user = makeUser();
    await under(10, () => login(user.email, randomIp()));
    refused(await login(user.email, randomIp()));
  });
});
