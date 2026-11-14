import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, test } from "bun:test";
import { sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { createEmailVerificationCode, createUser, db, deleteUserAndData, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { pruneNativeSessions } from "../src/native-auth.ts";

// P5-03: native app access/refresh token pairs (D-P5-4).

const PASSWORD = "native_password_1";

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

async function v2(method: string, path: string, init: { auth?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...init.auth };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null, headers: res.headers };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const signIn = (email: string, password: string, extra: Record<string, unknown> = {}) =>
  v2("POST", "/auth/native/token", { body: { grant_type: "password", email, password, ...extra } });
const refresh = (token: string) => v2("POST", "/auth/native/token", { body: { grant_type: "refresh_token", refresh_token: token } });
const me = (token: string) => v2("GET", "/me", { auth: bearer(token) });

function makeUser(): UserRecord {
  return createUser({ email: `${generateId("native")}@example.com`, displayName: "앱 사용자", password: PASSWORD });
}

async function pairFor(user: UserRecord): Promise<{ access: string; refresh: string }> {
  const res = await signIn(user.email, PASSWORD, { device_name: "내 iPhone", platform: "ios" });
  expect(res.status).toBe(200);
  return { access: res.body.access_token, refresh: res.body.refresh_token };
}

beforeEach(() => {
  resetAuthRateLimits();
});

describe("native token pairs (P5-03)", () => {
  test("password grant", async () => {
    const user = makeUser();
    const res = await signIn(user.email, PASSWORD, { device_name: "내 iPhone", platform: "ios" });
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.access_token.startsWith("lct_at_")).toBe(true);
    expect(res.body.refresh_token.startsWith("lct_rt_")).toBe(true);
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.user.id).toBe(user.id);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const row = db.query(`SELECT device_name, platform FROM native_session WHERE user_id = ?`).get(user.id);
    expect(row).toEqual({ device_name: "내 iPhone", platform: "ios" });
  });

  test("email is matched without case or surrounding spaces", async () => {
    const user = makeUser();
    expect((await signIn(`  ${user.email.toUpperCase()} `, PASSWORD)).status).toBe(200);
  });

  test("access token authenticates v2", async () => {
    const user = makeUser();
    const { access } = await pairFor(user);
    const res = await me(access);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect((await v2("GET", "/me", { auth: { "X-Lectern-Token": access } })).status).toBe(200);
  });

  test("refresh token does not authenticate", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    expect((await me(pair.refresh)).status).toBe(401);
  });

  test("wrong password", async () => {
    const user = makeUser();
    const wrong = await signIn(user.email, "not_the_password");
    const unknown = await signIn(`${generateId("nobody")}@example.com`, "not_the_password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.message).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
  });

  test("rate limited like login", async () => {
    const user = makeUser();
    for (let i = 0; i < 10; i++) expect((await signIn(user.email, "not_the_password")).status).toBe(401);
    const blocked = await signIn(user.email, "not_the_password");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(blocked.body.error.message).toMatch(/^요청이 너무 많습니다\. \d+분 후 다시 시도해주세요\.$/);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // The right password waits too, as in the web login.
    expect((await signIn(user.email, PASSWORD)).status).toBe(429);
  });

  test("suspended and pending accounts are refused like the web login", async () => {
    const user = makeUser();
    db.query(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);
    const suspended = await signIn(user.email, PASSWORD);
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.message).toBe("이용이 정지된 계정입니다. 관리자에게 문의하세요.");
    db.query(`UPDATE users SET status = 'pending' WHERE id = ?`).run(user.id);
    const pending = await signIn(user.email, PASSWORD);
    expect(pending.status).toBe(403);
    expect(pending.body.error.message).toBe("관리자 가입 승인 대기 중인 계정입니다.");
  });

  test("rotation", async () => {
    const user = makeUser();
    const old = await pairFor(user);
    const res = await refresh(old.refresh);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    const fresh = { access: res.body.access_token as string, refresh: res.body.refresh_token as string };
    expect(fresh.refresh).not.toBe(old.refresh);
    expect(fresh.access).not.toBe(old.access);
    expect((await me(fresh.access)).status).toBe(200);
    expect((await me(old.access)).status).toBe(401);
    // The same sign-in: one family, device kept.
    const rows = db.query(`SELECT family_id, device_name FROM native_session WHERE user_id = ?`).all(user.id) as Array<{ family_id: string; device_name: string }>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.family_id)).size).toBe(1);
    expect(rows.every((r) => r.device_name === "내 iPhone")).toBe(true);
  });

  test("reuse kills the family", async () => {
    const user = makeUser();
    const old = await pairFor(user);
    const other = await pairFor(user); // a second sign-in: not affected
    const rotated = await refresh(old.refresh);
    expect(rotated.status).toBe(200);
    const fresh = { access: rotated.body.access_token as string, refresh: rotated.body.refresh_token as string };

    const reused = await refresh(old.refresh);
    expect(reused.status).toBe(401);
    expect(reused.body.error.message).toBe("다시 로그인해 주세요.");
    expect((await me(fresh.access)).status).toBe(401);
    expect((await refresh(fresh.refresh)).status).toBe(401);
    expect((await me(other.access)).status).toBe(200);
  });

  test("expired access", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    db.query(`UPDATE native_session SET access_expires_at = ? WHERE access_hash = ?`).run(Date.now() - 1000, sha256Hex(pair.access));
    expect((await me(pair.access)).status).toBe(401);
    // The refresh token still gets a new pair.
    expect((await refresh(pair.refresh)).status).toBe(200);
  });

  test("expired refresh", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    db.query(`UPDATE native_session SET refresh_expires_at = ? WHERE refresh_hash = ?`).run(Date.now() - 1000, sha256Hex(pair.refresh));
    const res = await refresh(pair.refresh);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("다시 로그인해 주세요.");
  });

  test("an unknown refresh token", async () => {
    const res = await refresh(`lct_rt_${"x".repeat(43)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("다시 로그인해 주세요.");
  });

  test("revoke", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    const res = await v2("POST", "/auth/native/revoke", { body: { refresh_token: pair.refresh } });
    expect(res.status).toBe(204);
    expect((await me(pair.access)).status).toBe(401);
    expect((await refresh(pair.refresh)).status).toBe(401);
    const unknown = await v2("POST", "/auth/native/revoke", { body: { refresh_token: `lct_rt_${"y".repeat(43)}` } });
    expect(unknown.status).toBe(204);
  });

  test("password change signs native sessions out", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    const code = createEmailVerificationCode(user.email, "reset", 10);
    const reset = await handleRequest(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, verificationCode: code, newPassword: "native_password_2" }),
      })
    );
    expect(reset.status).toBe(200);
    expect((await me(pair.access)).status).toBe(401);
    expect((await refresh(pair.refresh)).status).toBe(401);
    // Signing in again with the new password works.
    expect((await signIn(user.email, "native_password_2")).status).toBe(200);
  });

  test("a suspended user's access token stops working", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    db.query(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);
    expect((await me(pair.access)).status).toBe(401);
    expect((await refresh(pair.refresh)).status).toBe(401);
  });

  test("no plaintext in the database", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    const everything = JSON.stringify(db.query(`SELECT * FROM native_session`).all());
    expect(everything).not.toContain(pair.access);
    expect(everything).not.toContain(pair.refresh);
    expect(everything).toContain(sha256Hex(pair.access));
  });

  test("does not open v1", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    for (const auth of [bearer(pair.access), { "X-Lectern-Token": pair.access }]) {
      const res = await handleRequest(new Request("http://localhost/api/lectures", { headers: auth }));
      expect(res.status).toBe(401);
    }
  });

  test("last use is recorded", async () => {
    const user = makeUser();
    const pair = await pairFor(user);
    await me(pair.access);
    const row = db.query(`SELECT last_used_at FROM native_session WHERE access_hash = ?`).get(sha256Hex(pair.access)) as { last_used_at: number | null };
    expect(row.last_used_at).not.toBeNull();
  });

  test("maintenance prunes expired and revoked pairs; user deletion removes them", async () => {
    const user = makeUser();
    const kept = await pairFor(user);
    const gone = await pairFor(user);
    db.query(`UPDATE native_session SET refresh_expires_at = ? WHERE refresh_hash = ?`).run(Date.now() - 1000, sha256Hex(gone.refresh));
    pruneNativeSessions();
    expect(db.query(`SELECT COUNT(*) AS n FROM native_session WHERE user_id = ?`).get(user.id)).toEqual({ n: 1 });
    expect((await me(kept.access)).status).toBe(200);

    deleteUserAndData(user.id);
    expect(db.query(`SELECT COUNT(*) AS n FROM native_session WHERE user_id = ?`).get(user.id)).toEqual({ n: 0 });
  });
});
