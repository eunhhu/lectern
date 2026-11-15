// 검색 (D-P3-5) on the fixture build: hits grouped by kind with highlights, a PDF hit that
// opens its page in the files panel, a transcript hit that opens at its time, the empty
// and short-query states, the kind filter, ⌘K's PDF hits and "모든 결과 보기", axe, and no
// search while Hangul is still being composed (Chromium's IME emulation over CDP).

import { makeSamplePdf } from "../scripts/sample-pdf.ts";
import { expect, tabTo, test } from "./fixtures.ts";

const section = (page: import("@playwright/test").Page, label: string) => page.locator(`section[aria-label="${label} 결과"]`);

test("search page groups by kind", async ({ page }) => {
  await page.goto("/app/search?q=퀀텀");
  await expect(page.getByRole("heading", { level: 1, name: "검색" })).toBeVisible();
  await expect(section(page, "전사")).toBeVisible();
  await expect(section(page, "PDF")).toBeVisible();
  await expect(section(page, "전사").getByRole("heading", { level: 2 })).toHaveText(/^전사 \d+$/);
  await expect(section(page, "PDF").getByRole("heading", { level: 2 })).toHaveText("PDF 2");
  await expect(section(page, "PDF").locator("mark", { hasText: "퀀텀" }).first()).toBeVisible();
});

test("pdf hit opens the page", async ({ page }) => {
  await page.route("**/api/v2/assets/*_pdf/content", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: makeSamplePdf(24) }),
  );
  await page.goto("/app/search?q=퀀텀");
  await section(page, "PDF").getByRole("link", { name: /p\.12/ }).click();
  await expect(page).toHaveURL(/\/app\/recordings\/rec_os07$/);
  await expect(page.getByRole("tab", { name: "파일" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[aria-live=polite]", { hasText: / \/ 24$/ })).toHaveText("12 / 24");
});

test("transcript hit opens at time", async ({ page }) => {
  await page.goto("/app/search?q=퀀텀");
  await section(page, "전사").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/recordings\/[^?]+\?t=\d+/);
});

test("zero results", async ({ page }) => {
  await page.goto("/app/search?q=zzqqxx");
  await expect(page.getByText("‘zzqqxx’에 맞는 결과가 없습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "물어보기" })).toBeVisible();
});

test("short query sends nothing", async ({ page }) => {
  await page.goto("/app/search?q=가");
  await expect(page.getByText("두 글자 이상 입력하면 전사, 문서, PDF에서 찾습니다.")).toBeVisible();
  await expect(page.locator("section[aria-label$=' 결과']")).toHaveCount(0);
});

test("IME composition does not search", async ({ page }) => {
  await page.goto("/app/search");
  const field = page.getByRole("textbox", { name: "내용 검색" });
  await field.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "퀀텀", selectionStart: 2, selectionEnd: 2 });
  await expect(field).toHaveValue("퀀텀");
  await page.waitForTimeout(400);
  await expect(page.locator("section[aria-label$=' 결과']")).toHaveCount(0);
  await expect(page.getByText("두 글자 이상 입력하면 전사, 문서, PDF에서 찾습니다.")).toBeVisible();
  await cdp.send("Input.insertText", { text: "퀀텀" });
  await expect(section(page, "전사")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/search\?q=/);
});

test("palette shows pdf hit", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "명령 팔레트" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("슬라이드");
  const hit = palette.getByRole("menuitem").filter({ hasText: "p.16" });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/app\/recordings\/rec_os07$/);
  await expect(page.getByRole("tab", { name: "파일" })).toHaveAttribute("aria-selected", "true");
});

test("palette see all results", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "명령 팔레트" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("퀀텀");
  await palette.getByRole("menuitem", { name: "‘퀀텀’ 모든 결과 보기" }).click();
  await expect(page).toHaveURL(/\/app\/search\?q=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("퀀텀");
  await expect(section(page, "PDF")).toBeVisible();
});

test("filter chip", async ({ page }) => {
  await page.goto("/app/search?q=퀀텀");
  await expect(section(page, "전사")).toBeVisible();
  const pdf = page.getByRole("group", { name: "찾을 곳" }).getByRole("button", { name: "PDF" });
  await pdf.click();
  await expect(pdf).toHaveAttribute("aria-pressed", "true");
  await expect(section(page, "전사")).toHaveCount(0);
  await expect(section(page, "PDF")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("kind")).toBe("pdf_page");
});

test("axe", async ({ page, axe }) => {
  await page.goto("/app/search?q=퀀텀");
  await expect(section(page, "PDF")).toBeVisible();
  await axe(page, "검색");
  await tabTo(page, "p.12");
  await expect(page.locator(":focus")).toHaveAttribute("href", /\/app\/recordings\/rec_os07\?pdf=rec_os07_pdf%3A12$/);
});
