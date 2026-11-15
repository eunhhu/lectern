// Recording actions on the fixture build (D-P2-4): the reprocess cost check before any
// request, starting it, 문서만 다시 만들기, deleting only the audio, the Markdown download,
// the whole flow by keyboard, and axe. The fixture client keeps its data in memory, so
// each test starts from the seeded recording.

import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "./fixtures.ts";

const TITLE = "운영체제 7주차 — CPU 스케줄링";
const DOC_TEXT = "CPU 스케줄링은 준비 큐의 여러 프로세스 중";

async function openRecording(page: Page) {
  await page.goto("/app/recordings/rec_os07");
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  // The document's arrival re-lays the page and would close an open menu.
  await expect(page.getByRole("heading", { name: "핵심 요약" }).first()).toBeVisible();
}

async function menuAction(page: Page, name: string) {
  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test("reprocess shows the estimate first; 취소 leaves the recording alone", async ({ page }) => {
  await openRecording(page);
  await menuAction(page, "다시 처리…");
  const dialog = page.getByRole("dialog", { name: "다시 처리" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("예상 비용", { exact: true })).toBeVisible();
  await expect(dialog.getByText("처리할 오디오", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "다시 처리" })).toBeEnabled();
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("완료", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("대기 중", { exact: true })).toHaveCount(0);
});

test("confirming starts the reprocess and the status shows 대기 중", async ({ page }) => {
  await openRecording(page);
  await menuAction(page, "다시 처리…");
  const dialog = page.getByRole("dialog", { name: "다시 처리" });
  await dialog.getByRole("button", { name: "다시 처리" }).click();
  await expect(page.getByText("다시 처리를 시작했습니다.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("대기 중", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(DOC_TEXT).first()).toBeVisible();
});

test("문서만 다시 만들기 has no audio line", async ({ page }) => {
  await openRecording(page);
  await menuAction(page, "문서만 다시 만들기");
  const dialog = page.getByRole("dialog", { name: "문서만 다시 만들기" });
  await expect(dialog.getByText("예상 비용", { exact: true })).toBeVisible();
  await expect(dialog.getByText("처리할 오디오")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "문서 다시 만들기" })).toBeEnabled();
});

test("오디오만 삭제 asks first, then removes only the audio", async ({ page }) => {
  await openRecording(page);
  await menuAction(page, "오디오만 삭제…");
  const confirm = page.getByRole("alertdialog", { name: "오디오만 삭제할까요?" });
  await expect(confirm).toContainText("되돌릴 수 없습니다.");
  await confirm.getByRole("button", { name: "취소" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("button", { name: "녹음 작업" })).toBeFocused();

  await page.getByRole("button", { name: "녹음 작업" }).click();
  await expect(page.getByRole("menuitem", { name: "오디오만 삭제…" })).not.toHaveAttribute("aria-disabled", "true");
  await page.getByRole("menuitem", { name: "오디오만 삭제…" }).click();
  await confirm.getByRole("button", { name: "오디오 삭제" }).click();
  await expect(page.getByText("오디오를 삭제했습니다.")).toBeVisible();

  await page.getByRole("button", { name: "녹음 작업" }).click();
  await expect(page.getByRole("menuitem", { name: "오디오만 삭제…" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("menuitem", { name: "다시 처리…" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByText(DOC_TEXT).first()).toBeVisible();
});

test("closing a dialog from the 녹음 작업 menu returns focus to the menu button; 태그 붙이기 keeps its own", async ({ page }) => {
  await openRecording(page);
  const menuButton = page.getByRole("button", { name: "녹음 작업" });
  for (const [item, dialog] of [
    ["폴더로 이동…", "폴더로 이동"],
    ["태그…", "태그"],
    ["공유…", "공유"],
  ] as const) {
    await menuAction(page, item);
    await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: dialog })).toBeHidden();
    await expect(menuButton).toBeFocused();
  }
  // A dialog opened by a button that is still on the page goes back to that button.
  const tagButton = page.getByRole("button", { name: /^태그 (붙이기|편집)$/ });
  await tagButton.click();
  await expect(page.getByRole("dialog", { name: "태그" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "태그" })).toBeHidden();
  await expect(tagButton).toBeFocused();
});

test("Markdown 내려받기 saves the document as <title>.md", async ({ page }) => {
  await openRecording(page);
  const download = page.waitForEvent("download");
  await menuAction(page, "Markdown 내려받기");
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${TITLE}.md`);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8").startsWith("# ")).toBe(true);
});

test("keyboard only: menu, 다시 처리, confirm; Esc returns focus to 녹음 작업", async ({ page }) => {
  await openRecording(page);
  await tabTo(page, "녹음 작업");
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "다시 처리…" });
  await expect(page.getByRole("menu")).toBeVisible();
  for (let i = 0; i < 8 && !(await item.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "다시 처리" });
  await expect(dialog.getByRole("button", { name: "다시 처리" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "녹음 작업" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  for (let i = 0; i < 8 && !(await item.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "다시 처리" })).toBeEnabled();
  await tabTo(page, /^다시 처리$/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("다시 처리를 시작했습니다.")).toBeVisible();
});

test("reprocess and audio dialogs have no axe violations, light and dark", async ({ page, axe }) => {
  await openRecording(page);
  await menuAction(page, "다시 처리…");
  const dialog = page.getByRole("dialog", { name: "다시 처리" });
  await expect(dialog.getByText("예상 비용", { exact: true })).toBeVisible();
  await axe(page, "다시 처리");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "다시 처리 (다크)");
  await dialog.getByRole("button", { name: "취소" }).click();
  await menuAction(page, "오디오만 삭제…");
  await expect(page.getByRole("alertdialog", { name: "오디오만 삭제할까요?" })).toBeVisible();
  await axe(page, "오디오 삭제 (다크)");
  await page.emulateMedia({ colorScheme: "light" });
  await axe(page, "오디오 삭제");
});
