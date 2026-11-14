// 관리 (P5-12, P5-16, P5-13) against the real server: the e2e owner is the service owner (LECTERN_OWNER_*),
// so the console opens, the v1 overview parses, and the v2 job and usage lists answer. It
// only reads: no account, job or limit is changed.

import { expect, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

test("admin overview renders against the real server", async ({ page, axe }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeHidden();

  await page.getByRole("link", { name: "관리", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "개요" })).toBeVisible();
  const users = page.getByRole("listitem").filter({ hasText: "전체 사용자" });
  await expect(users).toContainText(/\d/);
  await expect(page.getByRole("listitem").filter({ hasText: "실패한 작업" })).toContainText(/\d/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await axe(page, "관리 개요 (서버)");

  await page.getByRole("link", { name: "사용자", exact: true }).click();
  // My own row is there, with no role change and no delete.
  const mine = page.getByRole("row").filter({ hasText: E2E_OWNER_EMAIL });
  await expect(mine).toHaveCount(1);
  await expect(mine.getByRole("button", { name: /역할: / })).toBeDisabled();
  await expect(mine.getByRole("button", { name: /^삭제:/ })).toBeDisabled();

  await page.getByRole("link", { name: "작업", exact: true }).click();
  await expect(page.getByRole("table", { name: "작업" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("link", { name: "사용량", exact: true }).click();
  await expect(page.getByRole("table", { name: /사용량$/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("admin members and recordings render against the real server", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeHidden();

  // Every account's lectures: the seeded notes are there, and one opens without an error.
  await page.goto("/app/admin/recordings");
  const note = E2E_LECTURES[0]!;
  const row = page.getByRole("table", { name: "녹음" }).locator("tbody tr").filter({ hasText: note.title });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await row.getByRole("link", { name: note.title }).click();
  await expect(page.getByRole("heading", { level: 1, name: note.title })).toBeVisible();
  await expect(page.locator("dl")).toContainText(E2E_OWNER_EMAIL);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // My own page: my e-mail, my role and status fixed.
  await page.locator("dl").getByRole("link", { name: E2E_OWNER_EMAIL }).click();
  await expect(page.locator("dl")).toContainText(E2E_OWNER_EMAIL);
  await expect(page.getByRole("button", { name: / 역할$/ })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// P5-13: the storage, ops, settings and audit answers parse (the settings strictly), and
// nothing is run or saved.
test("admin storage and audit render against the real server", async ({ page, axe }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeHidden();

  await page.goto("/app/admin/storage");
  await expect(page.getByRole("heading", { name: "회수 가능 공간" })).toBeVisible();
  await expect(page.getByRole("list", { name: "저장소 수치" })).toContainText("오디오");
  await expect(page.getByRole("table", { name: "가장 큰 녹음" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await axe(page, "관리 저장소 (서버)");

  await page.getByRole("link", { name: "운영", exact: true }).click();
  await expect(page.getByRole("table", { name: "유지보수" })).toBeVisible();
  await expect(page.getByRole("table", { name: "서버" })).toContainText("ffmpeg");
  await expect(page.getByRole("table", { name: "최근 완료된 v1 작업" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("link", { name: "설정", exact: true }).last().click();
  await expect(page.getByRole("switch", { name: "공개 회원가입 허용" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "기본 오디오 한도(MB)" })).toHaveValue(/^\d+$/);
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // This sign-in is in the log.
  await page.getByRole("link", { name: "감사 로그", exact: true }).click();
  await expect(page.getByRole("table", { name: "감사 로그" }).locator("tbody tr").filter({ hasText: "auth.login" }).first()).toContainText(E2E_OWNER_EMAIL);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await axe(page, "관리 감사 로그 (서버)");
});
