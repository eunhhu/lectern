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

// --- 설정 › 계정 (P5-10): devices, tokens, sign-ins, export, deletion; Google/Apple buttons.

test("token secret is shown once", async ({ page }) => {
  await page.goto("/app/settings#tokens");
  const section = page.locator("#tokens");
  await section.getByRole("button", { name: "새 토큰" }).click();
  const dialog = page.getByRole("dialog", { name: "새 토큰" });
  await dialog.getByLabel("이름").fill("테스트 스크립트");
  await dialog.getByRole("button", { name: "만들기" }).click();
  const field = dialog.getByLabel("토큰", { exact: true });
  await expect(field).toHaveValue(/^lct_pat_[0-9a-f]{48}$/);
  const secret = await field.inputValue();
  await expect(dialog.getByText("이 토큰은 지금만 볼 수 있습니다. 안전한 곳에 보관하세요.")).toBeVisible();
  await dialog.getByRole("button", { name: "완료" }).click();
  await expect(dialog).toHaveCount(0);

  // The list shows the name and the prefix only; the secret is nowhere any more.
  await expect(section.getByText("테스트 스크립트")).toBeVisible();
  await expect(section.getByText(`${secret.slice(0, 12)}…`)).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(secret);
});

test("revoke a token", async ({ page }) => {
  await page.goto("/app/settings#tokens");
  const section = page.locator("#tokens");
  await expect(section.getByText("API 토큰")).toBeVisible();
  // The v1 API token is listed without 회수.
  await expect(section.getByRole("button", { name: "회수: API 토큰" })).toHaveCount(0);
  await section.getByRole("button", { name: "회수: 노트 동기화 스크립트" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("이 토큰을 회수할까요? 이 토큰을 쓰는 앱은 더 이상 접속할 수 없습니다.");
  await dialog.getByRole("button", { name: "회수" }).click();
  await expect(section.getByText("노트 동기화 스크립트")).toHaveCount(0);
  await expect(section.getByText("API 토큰")).toBeVisible();
});

test("device names", async ({ page }) => {
  await page.goto("/app/settings#devices");
  const section = page.locator("#devices");
  await expect(section.getByText("Mac의 Chrome")).toBeVisible();
  await expect(section.getByText("이 기기", { exact: true })).toBeVisible();
  await expect(section.getByText(/마지막 사용 /).first()).toBeVisible();
  // No 로그아웃시키기 for the device in use.
  await expect(section.getByRole("button", { name: "로그아웃시키기: Mac의 Chrome" })).toHaveCount(0);
  await section.getByRole("button", { name: "로그아웃시키기: Android 빠른 녹음" }).click();
  await expect(page.getByText("Android 빠른 녹음에서 로그아웃했습니다.")).toBeVisible();
  await expect(section.getByText("Android 빠른 녹음")).toHaveCount(0);
});

test("export lifecycle", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/app/settings#exports");
  const section = page.locator("#exports");
  await expect(section.getByText("워크스페이스의 녹음과 노트를 zip 파일로 받습니다. 파일은 7일 동안 내려받을 수 있습니다.")).toBeVisible();
  await section.getByText("오디오와 PDF 원본 포함(용량이 커집니다)").click();
  await section.getByRole("button", { name: "내보내기 만들기" }).click();
  await expect(page.getByText("내보내기를 만들고 있습니다. 준비되면 여기에서 내려받을 수 있습니다.")).toBeVisible();
  await expect(section.getByText("만드는 중")).toBeVisible();
  // The fixture makes it ready after 10 s; the list is read again every 10 s meanwhile.
  const link = section.getByRole("link", { name: /^내려받기/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(link).toHaveAttribute("href", /\/content$/);
  await expect(link).toHaveAttribute("download", "");
  await expect(section.getByText("만드는 중")).toHaveCount(0);
});

test("delete needs the phrase", async ({ page }) => {
  await page.goto("/app/settings#delete-account");
  const section = page.locator("#delete-account");
  await expect(section.getByText("계정을 삭제하면 7일 뒤에 모든 녹음과 노트가 지워집니다. 7일 안에는 취소할 수 있습니다.")).toBeVisible();
  await section.getByRole("button", { name: "계정 삭제 요청" }).click();
  const dialog = page.getByRole("alertdialog", { name: "계정 삭제 요청" });
  const confirm = dialog.getByRole("button", { name: "삭제 요청" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("비밀번호(비밀번호로 가입한 경우)").fill("fixture-pass");
  const phrase = dialog.getByLabel(/삭제합니다/);
  await phrase.fill("삭제");
  await expect(confirm).toBeDisabled();
  await phrase.fill("삭제합니다");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);

  await expect(section.getByText(/에 계정이 삭제됩니다\.$/)).toBeVisible();
  await section.getByRole("button", { name: "삭제 취소" }).click();
  await expect(page.getByText("계정 삭제를 취소했습니다.")).toBeVisible();
  await expect(section.getByRole("button", { name: "계정 삭제 요청" })).toBeVisible();
});

test("sole owner message", async ({ page }) => {
  await page.goto("/app/settings?fixture-deletion=sole-owner#delete-account");
  const section = page.locator("#delete-account");
  await section.getByRole("button", { name: "계정 삭제 요청" }).click();
  const dialog = page.getByRole("alertdialog", { name: "계정 삭제 요청" });
  await dialog.getByLabel(/삭제합니다/).fill("삭제합니다");
  await dialog.getByRole("button", { name: "삭제 요청" }).click();
  // The server's words, inside the dialog (not a toast), and nothing scheduled.
  await expect(dialog.getByRole("alert")).toContainText("워크스페이스의 유일한 owner입니다. 다른 멤버를 owner로 지정하거나 워크스페이스를 비운 뒤 다시 시도해 주세요.");
  await expect(page.getByText("워크스페이스의 유일한 owner입니다.", { exact: false })).toHaveCount(1);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(section.getByRole("button", { name: "계정 삭제 요청" })).toBeVisible();
});

test("oauth buttons start the sign-in and return to next", async ({ page }) => {
  await page.goto("/app/login?fixture-session=none&next=/recordings/rec_os07");
  await expect(page.getByRole("button", { name: "Apple로 계속하기" })).toBeVisible();
  await page.route("**/api/v2/auth/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
  const started = page.waitForRequest((r) => r.url().includes("/api/v2/auth/google/start"));
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  expect(new URL((await started).url()).searchParams.get("next")).toBe("/app/recordings/rec_os07");
});

test("oauth buttons hidden when off", async ({ page }) => {
  await page.goto("/app/login?fixture-session=none&fixture-oauth=off");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  // The providers answer arrives right after the form; give it time to (not) draw buttons.
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: /로 계속하기$/ })).toHaveCount(0);
  await expect(page.getByText("또는", { exact: true })).toHaveCount(0);
});

test("oauth error message", async ({ page }) => {
  await page.goto("/app/login?fixture-session=none&error=email_unverified");
  await expect(page.getByRole("alert")).toContainText("이메일이 인증되지 않은 계정으로는 로그인할 수 없습니다.");
});

test("keyboard only: create a token", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page.locator("#tokens").getByRole("button", { name: "새 토큰" })).toBeVisible();
  await tabTo(page, "새 토큰", 150);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "새 토큰" });
  await expect(dialog.getByLabel("이름")).toBeFocused();
  await page.keyboard.type("키보드 토큰");
  await tabTo(page, "읽기 전용");
  await page.keyboard.press("ArrowRight"); // 읽기·쓰기
  await tabTo(page, "만료");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "1년" })).toBeVisible();
  await page.keyboard.press("ArrowDown"); // 90일 → 1년
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: /1년/ })).toBeVisible();
  await tabTo(page, "만들기");
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("토큰", { exact: true })).toHaveValue(/^lct_pat_/);
  await tabTo(page, "완료");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  const row = page.locator("#tokens li", { hasText: "키보드 토큰" });
  await expect(row).toContainText("읽기·쓰기");
  await expect(row).toContainText("에 만료");
});
