// 관리 (P5-12) against the real server: the e2e owner is the service owner (LECTERN_OWNER_*),
// so the console opens, the v1 overview parses, and the v2 job and usage lists answer. It
// only reads: no account, job or limit is changed.

import { expect, test } from "../fixtures.ts";
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

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
