// 회원가입 and 비밀번호 재설정 against the real v1 auth endpoints (D-P2-1). The e2e server has
// no mail key, so sending a sign-up code fails (an alert) and sign-up goes through without
// one; the code path itself is covered by the fixture suite and the client unit tests.
// The e2e server runs with LECTERN_CALENDAR off: Settings › 연동 says "준비 중입니다." (P4-07).

import { expect, test } from "../fixtures.ts";

test("sign-up without a mailed code signs in", async ({ page, axe }) => {
  await page.goto("/app/signup");
  await expect(page.getByRole("heading", { level: 1, name: "회원가입" })).toBeVisible();
  await axe(page, "회원가입 (서버)");

  const email = `signup-${Date.now()}@example.com`;
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByRole("textbox", { name: "이름" }).fill("E2E 가입자");
  await page.getByLabel("비밀번호", { exact: true }).fill("signup-pass-1");
  await page.getByLabel("비밀번호 확인").fill("signup-pass-1");
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/$/);

  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
});

test("reset does not say whether the account exists", async ({ page }) => {
  await page.goto("/app/reset");
  await expect(page.getByRole("heading", { level: 1, name: "비밀번호 재설정" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(`nobody-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(page.getByRole("status")).toContainText("가입된 계정이라면");
});

test("calendar settings say 준비 중 while the server has calendars off", async ({ page, axe }) => {
  await page.goto("/app/signup");
  await page.getByRole("textbox", { name: "이메일" }).fill(`calendar-${Date.now()}@example.com`);
  await page.getByRole("textbox", { name: "이름" }).fill("E2E 캘린더");
  await page.getByLabel("비밀번호", { exact: true }).fill("signup-pass-1");
  await page.getByLabel("비밀번호 확인").fill("signup-pass-1");
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();

  await page.goto("/app/settings#integrations");
  const section = page.locator("#integrations");
  await expect(section.getByText("준비 중입니다.")).toHaveCount(2);
  await expect(section.getByRole("button", { name: "Google 캘린더 연결" })).toHaveCount(0);
  await expect(page.locator("#reminders").getByRole("checkbox", { name: "일정과 할 일 마감을 이메일로 알려 주기" })).toBeVisible();
  await axe(page, "설정 연동 (준비 중)");

  await page.goto("/app/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "일정" })).toBeVisible();
  await expect(page.getByText("캘린더 앱과 연결하면", { exact: false })).toHaveCount(0);
});
