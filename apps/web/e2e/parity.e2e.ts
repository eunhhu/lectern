// v1 screen parity on the fixture build (docs/v2/pipeline/PARITY.md): the rows a
// server is not needed for. Theme switching that survives a reload, the narrow-screen
// recording tabs by keyboard (the microphone is in parity-mic.e2e.ts).

import { expect, test } from "./fixtures.ts";

test("theme: 테마 전환 flips the page theme and a reload keeps it", async ({ page, axe }) => {
  await page.goto("/app/library");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "테마 전환" }).click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after === "light" || after === "dark").toBe(true);
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(after);
  await axe(page, `라이브러리 (${after})`);
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("narrow screen: the recording shows 녹음 보기 tabs that switch by keyboard", async ({ page, axe }) => {
    await page.goto("/app/recordings/rec_os07");
    const tabs = page.getByRole("tablist", { name: "녹음 보기" });
    await expect(tabs).toBeVisible();
    for (const name of ["문서", "전사", "자료", "물어보기"]) await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "문서", exact: true }).focus();
    await expect(tabs.getByRole("tab", { name: "문서", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "전사", exact: true })).toBeFocused();
    await expect(tabs.getByRole("tab", { name: "전사", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "자료", exact: true })).toHaveAttribute("aria-selected", "true");
    await axe(page, "녹음 상세 (좁은 화면)");
  });
});
