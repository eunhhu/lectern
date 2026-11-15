// Sign-up and password reset in both clients (D-P2-1): the HTTP client against a fake fetch
// (the v1 auth endpoints' request and response shapes), and the fixture client's in-memory
// rules (the code is always 000000).

import { describe, expect, test } from "bun:test";
import { ApiClientError } from "../src/api/client.ts";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { createHttpClient } from "../src/api/http/client.ts";

interface Seen {
  url: string;
  method: string;
  body: string | null;
}

function fakeFetch(respond: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const req = { url: input, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null };
    seen.push(req);
    return respond(req);
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("HTTP client: account endpoints", () => {
  test("sendCode posts the email and purpose and returns the server's sentence", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { ok: true, message: "보냈습니다" }));
    const client = createHttpClient({ fetch: fn });
    expect(await client.sendCode("a@example.com", "signup")).toBe("보냈습니다");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/auth/send-code");
    expect(seen[0]!.method).toBe("POST");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ email: "a@example.com", purpose: "signup" });
  });

  test("register signs in and drops the token", async () => {
    const { fn, seen } = fakeFetch(() => json(201, { ok: true, token: "ses_x", user: { id: "u1", email: "a@example.com", displayName: "가" } }));
    const client = createHttpClient({ fetch: fn });
    const result = await client.register({ email: "a@example.com", displayName: "가", password: "secret-1", verificationCode: "123456" });
    expect(result).toEqual({ kind: "signedIn", user: { id: "u1", email: "a@example.com", displayName: "가" } });
    expect(JSON.stringify(result)).not.toContain("ses_x");
    expect(seen[0]!.url).toBe("/api/auth/register");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ email: "a@example.com", displayName: "가", password: "secret-1", verificationCode: "123456" });
  });

  test("register waiting for approval", async () => {
    const { fn } = fakeFetch(() => json(201, { ok: true, pendingApproval: true, message: "접수" }));
    const client = createHttpClient({ fetch: fn });
    expect(await client.register({ email: "a@example.com", displayName: "", password: "secret-1", verificationCode: "" })).toEqual({
      kind: "pending",
      message: "접수",
    });
  });

  test("register error keeps the server's sentence", async () => {
    const { fn } = fakeFetch(() => json(400, { error: "이미 가입된 이메일 주소입니다." }));
    const client = createHttpClient({ fetch: fn });
    const err = await client.register({ email: "a@example.com", displayName: "", password: "secret-1", verificationCode: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("이미 가입된 이메일 주소입니다.");
  });

  test("resetPassword sends the server's key names", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { ok: true, message: "완료" }));
    const client = createHttpClient({ fetch: fn });
    expect(await client.resetPassword({ email: "a@example.com", verificationCode: "123456", newPassword: "new-secret" })).toBe("완료");
    expect(seen[0]!.url).toBe("/api/auth/reset-password");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ email: "a@example.com", verificationCode: "123456", newPassword: "new-secret" });
  });
});

describe("fixture client: account rules", () => {
  test("codes, password length and the taken email", async () => {
    const client = createFixtureClient({ latencyMs: 0 });
    const input = { email: "new@example.com", displayName: "새 사용자", password: "secret-pass-1", verificationCode: "000000" };
    expect(await client.sendCode("new@example.com", "signup")).toContain("6자리 인증번호를 발송했습니다");
    expect(await client.sendCode("new@example.com", "reset")).toContain("가입된 계정이라면");

    const wrongCode = await client.register({ ...input, verificationCode: "111111" }).catch((e) => e);
    expect(wrongCode).toBeInstanceOf(ApiClientError);
    expect(wrongCode.status).toBe(400);
    const short = await client.register({ ...input, password: "12345" }).catch((e) => e);
    expect(short.message).toBe("비밀번호는 최소 6자 이상이어야 합니다.");
    const taken = await client.register({ ...input, email: client.data.me.email }).catch((e) => e);
    expect(taken.message).toBe("이미 가입된 이메일 주소입니다.");

    await client.logout();
    expect(await client.getSession()).toBeNull();
    const ok = await client.register(input);
    expect(ok.kind).toBe("signedIn");
    expect(await client.getSession()).not.toBeNull();
  });

  test("password reset", async () => {
    const client = createFixtureClient({ latencyMs: 0 });
    const reset = { email: "a@example.com", verificationCode: "000000", newPassword: "new-secret" };
    expect((await client.resetPassword({ ...reset, verificationCode: "999999" }).catch((e) => e)).status).toBe(400);
    expect((await client.resetPassword({ ...reset, newPassword: "short" }).catch((e) => e)).message).toBe("새 비밀번호는 최소 6자 이상이어야 합니다.");
    expect(await client.resetPassword(reset)).toBe("비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.");
  });
});
