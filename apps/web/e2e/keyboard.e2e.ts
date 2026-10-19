// ROADMAP P2 exit criterion: keyboard only, from upload to reading the document.

import { expect, tabTo, test } from "./fixtures.ts";

test("keyboard only: upload audio and a PDF, wait for processing, open the document, follow a source", async ({ page, axe }) => {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();

  // U opens the upload dialog; "파일 선택" opens the system file picker from the keyboard.
  await page.locator("body").press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  await expect(dialog).toBeVisible();
  await tabTo(page, "파일 선택");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([
    { name: "운영체제 9주차 — 교착 상태.m4a", mimeType: "audio/mp4", buffer: Buffer.alloc(6000) },
    { name: "운영체제_09_교착상태.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(1200) },
    { name: "자료구조 7주차.m4a", mimeType: "audio/mp4", buffer: Buffer.alloc(3000) },
  ]);

  // The PDF was paired with the matching recording by name and number.
  const first = dialog.getByRole("listitem").filter({ hasText: "녹음 1" });
  await expect(first.getByText("운영체제_09_교착상태.pdf")).toBeVisible();
  await expect(first.getByText(/번호가 같음/)).toBeVisible();

  await tabTo(page, "녹음 2개 올리기");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("녹음 2개를 올렸습니다.")).toBeVisible();

  // G then H: home lists it while processing, then under 최근 문서 once ready.
  await page.locator("body").press("g");
  await page.locator("body").press("h");
  const recent = page.getByRole("region", { name: "최근 문서" }).or(page.locator("section", { has: page.getByRole("heading", { name: "최근 문서" }) }));
  await expect(recent.getByRole("link", { name: /운영체제 9주차 — 교착 상태/ })).toBeVisible({ timeout: 20_000 });

  await tabTo(page, /운영체제 9주차 — 교착 상태/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "운영체제 9주차 — 교착 상태" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "핵심 요약" })).toBeVisible();

  // A source chip moves playback and highlights the cited transcript segment.
  await tabTo(page, /^출처 \d/);
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator("[data-highlight]").first()).toBeVisible();

  // The attached PDF is listed with the recording.
  await expect(page.getByText("운영체제_09_교착상태.pdf")).toBeVisible();
  await axe(page, "올린 녹음 상세");
});

test("single-key shortcuts stay off in text fields and while composing Korean", async ({ page }) => {
  await page.goto("/app/library");
  const search = page.getByRole("searchbox", { name: "제목으로 찾기" });
  await search.focus();
  await page.keyboard.type("u");
  await expect(page.getByRole("dialog", { name: "녹음 올리기" })).toBeHidden();
  await expect(search).toHaveValue("u");

  // keyCode 229 = IME composition in progress.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "u", keyCode: 229, bubbles: true }));
  });
  await expect(page.getByRole("dialog", { name: "녹음 올리기" })).toBeHidden();

  // Turning them off in the shortcut sheet disables them.
  await page.locator("body").press("?");
  await page.getByRole("switch", { name: "한 글자 단축키 사용" }).press("Space");
  await page.keyboard.press("Escape");
  await page.locator("body").press("u");
  await expect(page.getByRole("dialog", { name: "녹음 올리기" })).toBeHidden();
  // ⌘K / Ctrl+K still works.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "명령 팔레트" })).toBeVisible();
});

test("library: select rows with the keyboard and move them to a folder without dragging", async ({ page }) => {
  await page.goto("/app/library?folder=none");
  await expect(page.getByRole("heading", { level: 1, name: "폴더 없음" })).toBeVisible();
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid.getByRole("row")).toHaveCount(2);

  await grid.getByRole("row").first().focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByRole("toolbar", { name: "선택한 녹음 작업" }).getByText("2개 선택됨")).toBeVisible();

  await tabTo(page, "폴더로 이동…");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "녹음 2개를 폴더로 이동" });
  await expect(dialog).toBeVisible();
  await tabTo(page, /폴더/);
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "개인", exact: true }).press("Enter");
  await tabTo(page, "이동");
  await page.keyboard.press("Enter");

  await expect(page.getByText("녹음 2개를 ‘개인’ 폴더로 옮겼습니다.")).toBeVisible();
  // React Aria renders the empty state inside one placeholder row.
  await expect(grid.getByText("조건에 맞는 녹음이 없습니다.")).toBeVisible();
  await expect(grid.getByRole("row", { name: /녹음 테스트|산책하며/ })).toHaveCount(0);

  // 실행 취소 puts them back.
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect(grid.getByRole("row", { name: /녹음 테스트|산책하며/ })).toHaveCount(2);
});

test("library: dragging a row onto a folder moves it", async ({ page }) => {
  await page.goto("/app/library?folder=none");
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  const row = grid.getByRole("row", { name: /녹음 테스트/ });
  // React Aria's Tree is a treegrid of rows.
  const folder = page.getByRole("treegrid", { name: "폴더" }).getByRole("row", { name: "개인" });
  await row.dragTo(folder);
  await expect(page.getByText("녹음 1개를 ‘개인’ 폴더로 옮겼습니다.")).toBeVisible();
  await expect(grid.getByRole("row", { name: /녹음 테스트/ })).toHaveCount(0);
});

test("transcript: thousands of segments are virtualized and keyboard navigable; playback follows", async ({ page }) => {
  await page.goto("/app/recordings/rec_os07");
  const list = page.getByRole("list", { name: /전사/ });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const setsize = Number(await list.getByRole("listitem").first().getAttribute("aria-setsize"));
  expect(setsize).toBeGreaterThanOrEqual(3000);
  expect(await list.getByRole("listitem").count()).toBeLessThan(80);

  // Enter on a segment seeks there and marks it as current.
  await list.getByRole("button").first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  const seekedTo = await current.locator("span").first().textContent();
  await expect(page.getByRole("slider", { name: "재생 위치" })).toHaveAttribute("aria-valuetext", new RegExp(`^${seekedTo!.split(":").map(Number)[1]}초`));

  // End jumps to the last segment even though it was never rendered before.
  await page.keyboard.press("End");
  await expect(page.locator(`[aria-posinset="${setsize}"] button`)).toBeFocused();

  // Playing moves aria-current; scrolling by hand stops following and offers 현재 위치로.
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await list.hover();
  await page.mouse.wheel(0, -4000);
  await expect(page.getByRole("button", { name: "현재 위치로" })).toBeVisible();
  await page.getByRole("button", { name: "현재 위치로" }).click();
  await expect(page.getByRole("button", { name: "현재 위치로" })).toBeHidden();
});
