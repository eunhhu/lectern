// Document editing on the fixture build (D-P2-2): a structured document's block text,
// saving with the button and with ⌘S/Ctrl+S, Esc with and without changes, leaving the
// page with unsaved changes, the Korean IME guard, empty fields, and axe. The fixture
// client keeps its data in memory, so each test starts from the seeded document.

import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "./fixtures.ts";

const FIRST_PARAGRAPH = "핵심 요약 · 단락";
const ORIGINAL = "CPU 스케줄링은 준비 큐의 여러 프로세스 중";

async function openRecording(page: Page): Promise<number> {
  await page.goto("/app/recordings/rec_os07");
  await expect(page.getByRole("heading", { name: "핵심 요약" }).first()).toBeVisible();
  const label = await page.getByText(/^버전 \d+$/).first().textContent();
  return Number(label!.replace(/\D/g, ""));
}

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeVisible();
}

test("structured edit: save adds a version marked 직접 수정", async ({ page }) => {
  const version = await openRecording(page);
  await openEditor(page);
  await expect(page.getByText("블록의 글자만 고칠 수 있습니다.")).toBeVisible();
  await page.getByLabel(FIRST_PARAGRAPH, { exact: true }).fill("수정한 요약입니다.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(`저장했습니다. 버전 ${version + 1}`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeHidden();
  await expect(page.getByText("수정한 요약입니다.")).toBeVisible();
  await expect(page.getByText("직접 수정")).toBeVisible();
  await expect(page.getByText(`버전 ${version + 1}`, { exact: true })).toBeVisible();
});

test("keyboard only: open, type, Ctrl+S, focus back on 편집", async ({ page }) => {
  const version = await openRecording(page);
  await tabTo(page, /^편집$/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeVisible();
  await expect(page.getByLabel(FIRST_PARAGRAPH, { exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" 키보드로 덧붙임.");
  await page.keyboard.press("Control+s");
  await expect(page.getByText(`저장했습니다. 버전 ${version + 1}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeFocused();
  await expect(page.getByText("키보드로 덧붙임.", { exact: false })).toBeVisible();
});

test("Esc with changes asks; 계속 수정 keeps the editor, 수정 버리기 drops the edit", async ({ page }) => {
  await openRecording(page);
  await openEditor(page);
  const field = page.getByLabel(FIRST_PARAGRAPH, { exact: true });
  await field.fill("버릴 글");
  await field.press("Escape");
  const dialog = page.getByRole("alertdialog", { name: "저장하지 않은 수정이 있습니다" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "계속 수정" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeVisible();
  await expect(field).toHaveValue("버릴 글");

  await field.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "수정 버리기" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeHidden();
  await expect(page.getByText(ORIGINAL)).toBeVisible();
  await expect(page.getByText("버릴 글")).toHaveCount(0);
});

test("Esc without changes just closes", async ({ page }) => {
  await openRecording(page);
  await openEditor(page);
  await page.getByLabel(FIRST_PARAGRAPH, { exact: true }).press("Escape");
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeHidden();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("leaving the page with unsaved changes asks first", async ({ page }) => {
  await openRecording(page);
  await openEditor(page);
  await page.getByLabel(FIRST_PARAGRAPH, { exact: true }).fill("아직 저장 안 함");
  await page.getByRole("navigation", { name: "이동 경로" }).getByRole("link", { name: "라이브러리" }).click();
  const dialog = page.getByRole("alertdialog", { name: "저장하지 않은 수정이 있습니다" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/app\/recordings\/rec_os07/);
  await dialog.getByRole("button", { name: "나가기" }).click();
  await expect(page).toHaveURL(/\/app\/library/);
});

test("Ctrl+S while a Korean IME is composing does not save", async ({ page }) => {
  const version = await openRecording(page);
  await openEditor(page);
  const field = page.getByLabel(FIRST_PARAGRAPH, { exact: true });
  await field.fill("조합 중인 글");
  await field.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, isComposing: true, bubbles: true })));
  await page.waitForTimeout(300);
  await expect(page.getByText(/저장했습니다/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeVisible();
  await expect(page.getByText(`버전 ${version} 기준`)).toBeVisible();
});

test("an empty field is refused before any request", async ({ page }) => {
  const version = await openRecording(page);
  await openEditor(page);
  await page.getByLabel(FIRST_PARAGRAPH, { exact: true }).fill("   ");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("비어 있는 칸이 있습니다.");
  await expect(page.getByText(`버전 ${version} 기준`)).toBeVisible();
});

test("the editor has no axe violations, light and dark", async ({ page, axe }) => {
  await openRecording(page);
  await openEditor(page);
  await axe(page, "문서 편집");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "문서 편집 (다크)");
});
