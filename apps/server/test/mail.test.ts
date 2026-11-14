import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { config } from "@lectern/config";
import { createUser, generateId } from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { sendMail } from "../src/mail.ts";

// The Resend client (mail.ts, P4-05) and the verification mails that moved onto it: their
// subjects and bodies must stay exactly as they were.

const RESEND_URL = "https://api.resend.com/emails";
const realFetch = globalThis.fetch;
let sent: Array<{ from: string; to: string[]; subject: string; html: string }> = [];
let answer: () => Response = () => Response.json({ id: "email_test" });

beforeEach(() => {
  sent = [];
  answer = () => Response.json({ id: "email_test" });
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url) === RESEND_URL) {
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer test-key-never-sent");
      sent.push(JSON.parse(init.body));
      return answer();
    }
    throw new Error(`unexpected outbound request: ${String(url)}`);
  }) as typeof fetch;
  process.env.RESEND_API_KEY = "test-key-never-sent";
  resetAuthRateLimits();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
});

/** The body with the code replaced, hashed: pins every character of the template. */
const templateHash = (html: string, code: string) => createHash("sha256").update(html.split(code).join("{CODE}")).digest("hex");

const sendCode = (email: string, purpose: "signup" | "reset") =>
  handleRequest(
    new Request("http://localhost/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose }),
    })
  );

describe("mail", () => {
  test("sendMail posts to Resend", async () => {
    const res = await sendMail({ to: "someone@example.com", subject: "제목", html: "<p>본문</p>" });
    expect(res).toEqual({ id: "email_test" });
    expect(sent).toEqual([{ from: config().resend.fromEmail, to: ["someone@example.com"], subject: "제목", html: "<p>본문</p>" }]);
  });

  test("sendMail reports a Resend failure", async () => {
    answer = () => new Response("bad", { status: 500 });
    await expect(sendMail({ to: "someone@example.com", subject: "s", html: "h" })).rejects.toThrow("이메일 발송 실패 (500): bad");
  });

  test("no key", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendMail({ to: "someone@example.com", subject: "s", html: "h" })).rejects.toThrow(
      "이메일 발송 API 키(RESEND_API_KEY)가 설정되지 않았습니다."
    );
    expect(sent).toHaveLength(0);
  });

  test("signup mail is unchanged", async () => {
    const email = `${generateId("signup")}@example.com`;
    const res = await sendCode(email, "signup");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    const code = /\(([0-9]{6})\)$/.exec(mail.subject)?.[1] ?? "";
    expect(mail.subject).toBe(`[Lectern] 회원가입 이메일 인증번호 (${code})`);
    expect(mail.to).toEqual([email]);
    expect(mail.from).toBe(config().resend.fromEmail);
    expect(templateHash(mail.html, code)).toBe(SIGNUP_HTML_HASH);
  });

  test("reset mail is unchanged", async () => {
    const user = createUser({ email: `${generateId("reset")}@example.com`, displayName: "재설정", password: "correct_password_1" });
    const res = await sendCode(user.email, "reset");
    expect(res.status).toBe(200);
    // The reset mail is sent without waiting, so the answer never depends on the account.
    for (let i = 0; i < 50 && sent.length === 0; i++) await Bun.sleep(10);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    const code = /\(([0-9]{6})\)$/.exec(mail.subject)?.[1] ?? "";
    expect(mail.subject).toBe(`[Lectern] 비밀번호 재설정 인증번호 (${code})`);
    expect(mail.to).toEqual([user.email]);
    expect(templateHash(mail.html, code)).toBe(RESET_HTML_HASH);
  });
});

// Hashes of the templates as they were before mail.ts (P4-05): a change here is a change to
// what users receive.
const SIGNUP_HTML_HASH = "01a24e584752a8578213818a67cda6823a78a220cb954c36f5f2621639091613";
const RESET_HTML_HASH = "f8490cbd38eee9aeb09475ac035eeff3d66a2082b54f8163c092e6ab164e0818";
