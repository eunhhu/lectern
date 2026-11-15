// Share links on the fixture build (D-P2-3): making a link and copying its address, the
// address gone once the dialog closes, the password rule, 회수 behind a confirmation, the
// whole flow by keyboard, Settings → 공유 링크, and axe. The fixture client keeps links in
// memory, so a test that needs a link makes it first and moves around with in-app links.

import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "./fixtures.ts";

const TITLE = "운영체제 7주차 — CPU 스케줄링";

async function openShare(page: Page) {
  await page.goto("/app/recordings/rec_os07");
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  // Wait for the document and transcript: their arrival re-lays the page and would close an open menu.
  await expect(page.getByRole("heading", { name: "핵심 요약" }).first()).toBeVisible();
  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name: "공유…" }).click();
  const dialog = page.getByRole("dialog", { name: "공유" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("make a link, see its address once, copy it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const dialog = await openShare(page);
  await expect(dialog.getByText("이 녹음의 공유 링크가 없습니다.")).toBeVisible();
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("status")).toContainText("이 링크는 지금만 볼 수 있습니다.");
  const field = dialog.getByLabel("공유 링크", { exact: true });
  await expect(field).toBeFocused();
  const url = await field.inputValue();
  expect(url).toMatch(/^https:\/\/lectern\.example\/s\//);
  await dialog.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByText("링크를 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(dialog.getByRole("button", { name: "공유 링크 회수: 이 녹음" })).toHaveCount(1);
});

test("closing the dialog drops the address; the link stays in the list", async ({ page }) => {
  let dialog = await openShare(page);
  await dialog.locator("label", { hasText: "전사 포함" }).click();
  await expect(dialog.getByRole("checkbox", { name: "전사 포함" })).toBeChecked();
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByLabel("공유 링크", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name: "공유…" }).click();
  dialog = page.getByRole("dialog", { name: "공유" });
  await expect(dialog.getByRole("button", { name: "링크 만들기" })).toBeVisible();
  await expect(dialog.getByLabel("공유 링크", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^공유 링크 회수/ })).toHaveCount(1);
  await expect(dialog.getByText("전사 포함", { exact: true }).last()).toBeVisible();
  expect(await page.content()).not.toContain("fixture-token-");
});

test("a short password is refused before any request", async ({ page }) => {
  const dialog = await openShare(page);
  await dialog.getByLabel("비밀번호 (선택)").fill("short");
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("비밀번호는 8자 이상이어야 합니다.");
  await expect(dialog.getByText("이 녹음의 공유 링크가 없습니다.")).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
});

test("a link with a password shows 비밀번호 있음", async ({ page }) => {
  const dialog = await openShare(page);
  await dialog.getByLabel("비밀번호 (선택)").fill("fixture-pass");
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect(dialog.getByText("비밀번호 있음")).toBeVisible();
});

test("회수 asks first; 취소 keeps the link, 회수 removes it", async ({ page }) => {
  const dialog = await openShare(page);
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  const revoke = dialog.getByRole("button", { name: "공유 링크 회수: 이 녹음" });
  await revoke.click();
  const confirm = page.getByRole("alertdialog", { name: "공유 링크를 회수할까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("되돌릴 수 없습니다.");
  await confirm.getByRole("button", { name: "취소" }).click();
  await expect(confirm).toBeHidden();
  await expect(revoke).toHaveCount(1);

  await revoke.click();
  await confirm.getByRole("button", { name: "회수", exact: true }).click();
  await expect(page.getByText("공유 링크를 회수했습니다.")).toBeVisible();
  await expect(revoke).toHaveCount(0);
  await expect(dialog.getByText("이 녹음의 공유 링크가 없습니다.")).toBeVisible();
});

test("keyboard only: menu, make, copy, Esc, focus back on 녹음 작업", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app/recordings/rec_os07");
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  // Wait for the document and transcript: their arrival re-lays the page and would close an open menu.
  await expect(page.getByRole("heading", { name: "핵심 요약" }).first()).toBeVisible();
  await tabTo(page, "녹음 작업");
  await page.keyboard.press("Enter");
  const share = page.getByRole("menuitem", { name: "공유…" });
  await expect(page.getByRole("menu")).toBeVisible();
  for (let i = 0; i < 5 && !(await share.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
  await expect(share).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "공유" });
  await expect(dialog).toBeVisible();
  await tabTo(page, "링크 만들기");
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("공유 링크", { exact: true })).toBeFocused();
  await tabTo(page, "링크 복사");
  await page.keyboard.press("Enter");
  await expect(page.getByText("링크를 복사했습니다.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "녹음 작업" })).toBeFocused();
});

test("Settings lists the workspace's links with the recording title and 회수", async ({ page }) => {
  const dialog = await openShare(page);
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "설정" }).click();
  await page.getByRole("navigation", { name: "설정 목차" }).getByRole("link", { name: "공유 링크" }).click();
  await expect(page).toHaveURL(/\/app\/settings#share-links$/);
  const section = page.locator("#share-links");
  await expect(section.getByRole("heading", { level: 2, name: "공유 링크" })).toBeVisible();
  await expect(section.getByText(TITLE)).toBeVisible();
  await section.getByRole("button", { name: `공유 링크 회수: ${TITLE}` }).click();
  await page.getByRole("alertdialog", { name: "공유 링크를 회수할까요?" }).getByRole("button", { name: "회수", exact: true }).click();
  await expect(section.getByText("만든 공유 링크가 없습니다.")).toBeVisible();
});

test("share dialog, 회수 confirmation and Settings section have no axe violations, light and dark", async ({ page, axe }) => {
  const dialog = await openShare(page);
  await axe(page, "공유 (만들기 전)");
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await axe(page, "공유 (만든 뒤)");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "공유 (만든 뒤, 다크)");
  await dialog.getByRole("button", { name: /^공유 링크 회수/ }).click();
  await expect(page.getByRole("alertdialog", { name: "공유 링크를 회수할까요?" })).toBeVisible();
  await axe(page, "회수 확인 (다크)");
  await page.emulateMedia({ colorScheme: "light" });
  await axe(page, "회수 확인");
  await page.getByRole("button", { name: "취소" }).click();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "설정" }).click();
  await expect(page.locator("#share-links").getByText(TITLE)).toBeVisible();
  await axe(page, "설정 · 공유 링크");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "설정 · 공유 링크 (다크)");
});
