// The PDF viewer of the files panel (D-P3-7) on the fixture build: one canvas per view,
// page moves by keyboard, field and source chip, zoom, selectable text, the open error,
// a 300-page document, axe, and OCR of a scanned PDF only after its cost was shown and
// confirmed (D-P3-3). The fixture serves no PDF bytes, so every test answers the content
// route with a generated PDF. The `problems` fixture fails any test with a CSP violation.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { makeSamplePdf } from "../scripts/sample-pdf.ts";

const PDF_24 = makeSamplePdf(24);
const VIEWER = "운영체제_07_CPU스케줄링.pdf 뷰어";

async function servePdf(page: Page, body: Buffer | null) {
  await page.route("**/api/v2/assets/*_pdf/content", (route) =>
    body ? route.fulfill({ status: 200, contentType: "application/pdf", body }) : route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
}

/** Opens a recording with the files panel shown and returns its PDF page area. */
async function openFiles(page: Page, recordingId: string, viewer = VIEWER) {
  await page.goto(`/app/recordings/${recordingId}`);
  await page.getByRole("group", { name: "옆 패널" }).getByRole("button", { name: "자료" }).click();
  await expect(page.getByRole("tab", { name: "파일" })).toHaveAttribute("aria-selected", "true");
  return page.getByRole("group", { name: viewer });
}

const position = (page: Page) => page.locator("[aria-live=polite]", { hasText: / \/ \d+$/ });

test.describe("PDF viewer", () => {
  test.beforeEach(async ({ page }) => servePdf(page, PDF_24));

  test("viewer shows page 1", async ({ page }) => {
    const viewer = await openFiles(page, "rec_os07");
    await expect(viewer.locator("canvas")).toBeVisible();
    await expect(position(page)).toHaveText("1 / 24");
  });

  test("only visible page is drawn", async ({ page }) => {
    const viewer = await openFiles(page, "rec_os07");
    await expect(position(page)).toHaveText("1 / 24");
    await expect(viewer.locator("canvas")).toHaveCount(1);
    await page.getByRole("button", { name: "다음 쪽" }).click();
    await expect(position(page)).toHaveText("2 / 24");
    await expect(viewer.locator("canvas")).toHaveCount(1);
  });

  test("keyboard page navigation", async ({ page }) => {
    const viewer = await openFiles(page, "rec_os07");
    await expect(position(page)).toHaveText("1 / 24");
    await viewer.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(position(page)).toHaveText("2 / 24");
    await page.keyboard.press("End");
    await expect(position(page)).toHaveText("24 / 24");
    await page.keyboard.press("Home");
    await expect(position(page)).toHaveText("1 / 24");
    await expect(viewer).toBeFocused();
  });

  test("jump by page input", async ({ page }) => {
    await openFiles(page, "rec_os07");
    const field = page.getByRole("textbox", { name: "쪽 번호" });
    await field.fill("7");
    await field.press("Enter");
    await expect(position(page)).toHaveText("7 / 24");
    await field.fill("999");
    await field.press("Enter");
    await expect(position(page)).toHaveText("24 / 24");
    await expect(field).toHaveValue("24");
  });

  test("zoom", async ({ page }) => {
    const viewer = await openFiles(page, "rec_os07");
    const canvas = viewer.locator("canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeGreaterThan(0);
    const before = Number(await canvas.getAttribute("width"));
    await page.getByRole("button", { name: "확대" }).click();
    await expect(page.getByText("125%")).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeGreaterThan(before);
    await page.getByRole("button", { name: "축소" }).click();
    await page.getByRole("button", { name: "축소" }).click();
    await expect(page.getByText("75%")).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeLessThan(before);
  });

  test("text layer is selectable text", async ({ page }) => {
    const viewer = await openFiles(page, "rec_os07");
    await expect(viewer.locator('[class*="textLayer"]')).toContainText("Sample page 1 body text for the viewer");
    await page.getByRole("button", { name: "다음 쪽" }).click();
    await expect(viewer.locator('[class*="textLayer"]')).toContainText("Sample page 2 body text for the viewer");
    await expect(viewer.locator('[class*="textLayer"]')).not.toContainText("Sample page 1 ");
  });

  test("citation chip opens page", async ({ page }) => {
    await openFiles(page, "rec_os07");
    await expect(position(page)).toHaveText("1 / 24");
    await page.getByRole("button", { name: /^출처 p\.12\b/ }).first().click();
    await expect(position(page)).toHaveText("12 / 24");
    await expect(page.getByRole("group", { name: VIEWER }).locator('[class*="textLayer"]')).toContainText("Sample page 12 ");
  });

  test("axe on viewer", async ({ page, axe }) => {
    const viewer = await openFiles(page, "rec_os07");
    await expect(viewer.locator('[class*="textLayer"]')).toContainText("Sample page 1");
    await axe(page, "PDF 뷰어");
  });
});

test("open failure", async ({ page }) => {
  await servePdf(page, null);
  await page.goto("/app/recordings/rec_os07");
  await page.getByRole("group", { name: "옆 패널" }).getByRole("button", { name: "자료" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PDF를 열지 못했습니다" })).toBeVisible();
});

test("big pdf stays light", async ({ page }) => {
  await servePdf(page, makeSamplePdf(300));
  const viewer = await openFiles(page, "rec_os07");
  await expect(position(page)).toHaveText("1 / 300");
  await viewer.focus();
  await page.keyboard.press("End");
  await expect(position(page)).toHaveText("300 / 300");
  await expect(viewer.locator('[class*="textLayer"]')).toContainText("Sample page 300 ");
  await expect(viewer.locator("canvas")).toHaveCount(1);
});

test.describe("OCR of a scanned PDF", () => {
  const SCANNED = "운영체제_06_프로세스와스레드.pdf 뷰어";
  test.beforeEach(async ({ page }) => servePdf(page, makeSamplePdf(18)));

  test("scanned shows ocr dialog", async ({ page, axe }) => {
    await openFiles(page, "rec_os06", SCANNED);
    await expect(page.getByText("스캔본")).toBeVisible();
    await page.getByRole("button", { name: "글자 인식(OCR)…" }).click();
    const dialog = page.getByRole("dialog", { name: "글자 인식(OCR)" });
    // 18 pages × 2,818 µUSD (the fixture's rate) = 50,724 µUSD.
    await expect(dialog).toContainText("18쪽을 AI로 읽습니다. 예상 비용 약 $0.0507");
    await expect(dialog.getByRole("button", { name: "OCR 시작" })).toBeEnabled();
    await axe(page, "OCR 확인");
  });

  test("ocr needs explicit confirm", async ({ page }) => {
    await openFiles(page, "rec_os06", SCANNED);
    const offer = page.getByRole("button", { name: "글자 인식(OCR)…" });
    const dialog = page.getByRole("dialog", { name: "글자 인식(OCR)" });

    // Cancelling runs nothing: the next estimate still has every page to read.
    await offer.click();
    await expect(dialog).toContainText("18쪽");
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).toBeHidden();
    await offer.click();
    await expect(dialog).toContainText("18쪽을 AI로 읽습니다.");

    // Only "OCR 시작" queues it; afterwards nothing is left to read.
    await dialog.getByRole("button", { name: "OCR 시작" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("글자 인식을 시작했습니다.")).toBeVisible();
    await offer.click();
    await expect(dialog).toContainText("이미 모든 쪽의 글자를 읽었습니다.");
    await expect(dialog.getByRole("button", { name: "OCR 시작" })).toHaveCount(0);
  });
});
