import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, test } from "bun:test";
import { createEmailVerificationCode, db } from "../../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../../src/index.ts";
import { cookieFrom, makeUser, PASSWORD, v2 } from "./helpers.ts";

// P5-15 · Sessions and the session cookie (web sign-in, v1 /api/auth/*): what a browser
// sees and what the server accepts afterwards.

const login = (email: string, init: { cookie?: string; url?: string; headers?: Record<string, string> } = {}) =>
  handleRequest(
    new Request(init.url ?? "http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
  );

const meWith = async (session: string) => (await v2("GET", "/me", { cookie: session })).status;


beforeEach(() => resetAuthRateLimits());

describe("security: sessions", () => {
  test("login issues a new session id", async () => {
    const user = makeUser();
    const planted = "ses_attacker_chosen_0123456789";
    const res = await login(user.email, { cookie: `lectern_session=${planted}` });
    expect(res.status).toBe(200);
    const issued = cookieFrom(res, "lectern_session");
    expect(issued).toBeTruthy();
    expect(issued).not.toBe(planted);
    expect(await meWith(planted)).toBe(401);
    expect(await meWith(issued!)).toBe(200);
  });

  test("session cookie attributes", async () => {
    const user = makeUser();
    for (const init of [{ url: "https://lectern.example/api/auth/login" }, { headers: { "X-Forwarded-Proto": "https" } }]) {
      const res = await login(user.email, init);
      const header = res.headers.get("Set-Cookie") ?? "";
      const attrs = header.split(";").map((p) => p.trim().toLowerCase());
      expect(attrs).toContain("httponly");
      expect(attrs.some((a) => a === "samesite=lax" || a === "samesite=strict")).toBe(true);
      expect(attrs).toContain("path=/");
      expect(attrs).toContain("secure");
    }
  });

  test("logout invalidates the session", async () => {
    const user = makeUser();
    const session = cookieFrom(await login(user.email), "lectern_session")!;
    expect(await meWith(session)).toBe(200);
    const out = await handleRequest(
      new Request("http://localhost/api/auth/logout", { method: "POST", headers: { Cookie: `lectern_session=${encodeURIComponent(session)}` } })
    );
    expect(out.status).toBe(200);
    expect(await meWith(session)).toBe(401);
  });

  test("password reset signs other sessions out", async () => {
    const user = makeUser();
    const session = cookieFrom(await login(user.email), "lectern_session")!;
    expect(await meWith(session)).toBe(200);
    const code = createEmailVerificationCode(user.email, "reset", 10);
    const reset = await handleRequest(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, verificationCode: code, newPassword: "security_password_2" }),
      })
    );
    expect(reset.status).toBe(200);
    expect(await meWith(session)).toBe(401);
  });

  test("expired session", async () => {
    const user = makeUser();
    const session = cookieFrom(await login(user.email), "lectern_session")!;
    expect(await meWith(session)).toBe(200);
    db.query(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`).run(new Date(Date.now() - 60_000).toISOString(), user.id);
    expect(await meWith(session)).toBe(401);
  });
});
