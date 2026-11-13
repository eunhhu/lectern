// 회원가입 and 비밀번호 재설정 on the fixture build (D-P2-1). The preview starts signed in
// and keeps its session in memory, so each test signs out from the user menu and then moves
// inside the app with links (a reload would sign the preview user back in). The fixture
// client's code is always 000000.

import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "./fixtures.ts";

async function signOut(page: Page) {
  await page.goto("/app/settings");
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
}

async function openSignup(page: Page) {
  await signOut(page);
  await page.getByRole("link", { name: "회원가입" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "회원가입" })).toBeVisible();
}

async function openReset(page: Page) {
  await signOut(page);
  await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "비밀번호 재설정" })).toBeVisible();
}

test("login links to sign-up and reset, not to the old screen", async ({ page }) => {
  await signOut(page);
  await expect(page.getByRole("link", { name: "회원가입" })).toBeVisible();
  await expect(page.getByRole("link", { name: "비밀번호를 잊으셨나요?" })).toBeVisible();
  await expect(page.locator('a[href="/?legacy=1"]')).toHaveCount(0);
});

test("a signed-in visitor on /app/signup goes home", async ({ page }) => {
  await page.goto("/app/signup");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
});

test("sign-up with the keyboard only: code, fields, Enter, home", async ({ page }) => {
  await signOut(page);
  await tabTo(page, "회원가입");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "회원가입" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "이메일" })).toBeFocused();
  await page.keyboard.type("new@example.com");

  await tabTo(page, "인증번호 받기");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("이메일로 6자리 인증번호를 발송했습니다.");
  // The code field is next once the code is on its way.
  await expect(page.getByRole("textbox", { name: "인증번호" })).toBeFocused();
  await page.keyboard.type("000000");
  await page.keyboard.press("Tab");
  await page.keyboard.type("새 사용자");
  await page.keyboard.press("Tab");
  await page.keyboard.type("secret-pass-1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("secret-pass-1");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/$/);
});

test("sign-up errors are alerts", async ({ page }) => {
  await openSignup(page);
  await page.getByRole("textbox", { name: "이메일" }).fill("new@example.com");
  await page.getByRole("textbox", { name: "인증번호" }).fill("000000");
  await page.getByLabel("비밀번호", { exact: true }).fill("secret-pass-1");
  await page.getByLabel("비밀번호 확인").fill("secret-pass-2");
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByRole("alert")).toHaveText("비밀번호가 서로 다릅니다.");

  await page.getByLabel("비밀번호 확인").fill("secret-pass-1");
  await page.getByRole("textbox", { name: "인증번호" }).fill("111111");
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByRole("alert")).toHaveText("이메일 인증번호가 올바르지 않거나 만료되었습니다.");
  await expect(page.getByRole("heading", { level: 1, name: "회원가입" })).toBeVisible();
});

test("password fields ask for a new password", async ({ page }) => {
  await openSignup(page);
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("비밀번호 확인")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByRole("textbox", { name: "인증번호" })).toHaveAttribute("autocomplete", "one-time-code");
  await page.getByRole("link", { name: "로그인" }).click();
  await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(page.getByLabel("새 비밀번호", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("새 비밀번호 확인")).toHaveAttribute("autocomplete", "new-password");
});

test("password reset ends at the login link", async ({ page }) => {
  await openReset(page);
  await page.getByRole("textbox", { name: "이메일" }).fill("someone@example.com");
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(page.getByRole("status")).toContainText("가입된 계정이라면");
  await page.getByRole("textbox", { name: "인증번호" }).fill("000000");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("new-secret-1");
  await page.getByLabel("새 비밀번호 확인").fill("new-secret-1");
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(page.getByRole("status")).toContainText("비밀번호가 재설정되었습니다.");
  const login = page.getByRole("link", { name: "로그인하기" });
  await expect(login).toBeFocused();
  await login.click();
  await expect(page).toHaveURL(/\/app\/login$/);
});

test("sign-up and reset have no axe violations, light and dark", async ({ page, axe }) => {
  await openSignup(page);
  await axe(page, "회원가입");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "회원가입 (다크)");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("link", { name: "로그인" }).click();
  await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "비밀번호 재설정" })).toBeVisible();
  await axe(page, "비밀번호 재설정");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "비밀번호 재설정 (다크)");
});
