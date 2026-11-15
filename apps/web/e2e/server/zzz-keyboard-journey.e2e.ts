// Keyboard-only journeys against the real server (P7-04, DESIGN.md §5): the whole service
// without a mouse. A new user signs up, uploads, changes a setting and signs out; the owner
// reads a seeded note, follows a time mark, makes a share link and walks every admin page.
//
// Only page.goto, page.keyboard.*, page.waitForEvent("filechooser") and fileChooser.setFiles
// act on the page here (the OS file picker cannot be driven from the keyboard; it is opened
// with Enter). Reading is free. test/keyboard-only.test.ts checks this file's source for
// mouse and fill-style calls. Named zzz- so it runs after the rest of the server project; it
// only adds its own account and one share link on the owner's first note. The admin pages
// are read, never changed.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { expectFocusVisible, focusedName, pressUntil, tabInto, tabThrough, tabTo, typeInto } from "../keyboard-only.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";
import { wav } from "./wav.ts";

test.describe.configure({ mode: "serial" });

/** This test's own account only (the e2e database is thrown away). */
const JOURNEY_PASSWORD = "journey-keyboard-only-1";
const JOURNEY_NAME = "키보드 여정";
/** The uploaded file's name, so the recording's title (unlike the display name, which the user menu button carries). */
const RECORDING = "여정 녹음";
/** 관리 tabs that list rows the e2e database always has (the owner, the seeded lectures, jobs, audit entries). */
const TABLE_TABS = ["사용자", "녹음", "작업", "감사 로그"];

/**
 * Opens the user menu at the foot of the sidebar (its button carries the display name) and
 * picks `item`. Shift+Tab: the sidebar comes before <main>, which has focus after a navigation.
 */
async function userMenu(page: Page, displayName: string, item: string) {
  await pressUntil(page, "Shift+Tab", displayName, 150);
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await pressUntil(page, "ArrowDown", item);
  await page.keyboard.press("Enter");
}

/**
 * The 관리 menu links' labels: each link's own text, without the count and description it
 * carries (read in the page; the app's CSP allows no eval, so the code is written out twice).
 */
function adminTabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="관리 메뉴"] a')].map((a) =>
      [...a.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim(),
    ),
  );
}

/** Presses Tab until the focus is on the 관리 menu link labelled `label` (round the page if need be). */
async function tabToAdminTab(page: Page, label: string, max = 250) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el.tagName !== "A" || !el.closest('nav[aria-label="관리 메뉴"]')) return null;
      return [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
    });
    if (at === label) return;
  }
  throw new Error(`could not reach the 관리 menu link "${label}" with Tab`);
}

test("keyboard journey: a new user signs up, uploads and changes a setting", async ({ page, axe }) => {
  const email = `journey-${Date.now()}@example.com`;

  // 1. 로그인 → 회원가입.
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await axe(page, "키보드 여정: 로그인");
  await tabTo(page, "회원가입");
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/signup$/);
  await expect(page.getByRole("heading", { level: 1, name: "회원가입" })).toBeVisible();

  // 2. The e-mail field has focus on arrival; the server has no mail key, so no code is needed.
  await expect.poll(() => focusedName(page)).toBe("이메일");
  await typeInto(page, email);
  await tabTo(page, "이름");
  await typeInto(page, JOURNEY_NAME);
  await tabTo(page, /^비밀번호$/);
  await typeInto(page, JOURNEY_PASSWORD);
  await tabTo(page, "비밀번호 확인");
  await expectFocusVisible(page);
  await typeInto(page, JOURNEY_PASSWORD);
  await axe(page, "키보드 여정: 회원가입");
  await tabTo(page, "가입하기");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/?$/);
  await axe(page, "키보드 여정: 홈");

  // 3. U opens the upload dialog (focus is on <main> after the navigation); 파일 선택 opens the picker.
  await page.keyboard.press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  await expect(dialog).toBeVisible();
  await tabTo(page, "파일 선택");
  await expectFocusVisible(page);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([{ name: `${RECORDING}.wav`, mimeType: "audio/wav", buffer: Buffer.from(wav(8)) }]);
  await axe(page, "키보드 여정: 올리기 대화상자");
  await tabTo(page, "녹음 1개 올리기");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("녹음 1개를 올렸습니다.")).toBeVisible();

  // 4. Home lists it; it waits for a worker the e2e server does not run.
  await expect(page.getByRole("link", { name: new RegExp(RECORDING) }).first()).toBeVisible();
  await tabTo(page, new RegExp(RECORDING));
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: RECORDING })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /처리 대기 중|받아쓰는 중|처리 중/ })).toBeVisible();
  await axe(page, "키보드 여정: 처리 중인 녹음");

  // 5. 설정 from the user menu: change the display name and save.
  await userMenu(page, JOURNEY_NAME, "설정");
  await expect(page).toHaveURL(/\/app\/settings/);
  await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
  await tabTo(page, /^이름$/);
  await expectFocusVisible(page);
  await typeInto(page, "여정 사용자");
  await tabTo(page, /^저장$/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("프로필을 저장했습니다.")).toBeVisible();
  await axe(page, "키보드 여정: 설정");

  // 6. 로그아웃.
  await userMenu(page, "여정 사용자", "로그아웃");
  await expect(page).toHaveURL(/\/app\/login/);
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
});

test("keyboard journey: the owner reads a document, shares it and walks the admin console", async ({ page, axe }) => {
  const note = E2E_LECTURES[0]!;

  // 1. 로그인: e-mail (focused on arrival), Tab, password, Enter submits.
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await expect.poll(() => focusedName(page)).toBe("이메일");
  await typeInto(page, E2E_OWNER_EMAIL);
  await page.keyboard.press("Tab");
  await expect.poll(() => focusedName(page)).toBe("비밀번호");
  await expectFocusVisible(page);
  await typeInto(page, E2E_OWNER_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await axe(page, "키보드 여정: 홈 (운영자)");
  const ownerName =(await page.evaluate(() => fetch("/api/v2/me").then((r) => r.json()))) as { display_name: string };

  // 2. 라이브러리 (the sidebar is before <main>: Shift+Tab) → the first seeded note (arrow keys
  // in the grid, Enter opens it).
  await pressUntil(page, "Shift+Tab", /^라이브러리/);
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid).toBeVisible();
  await axe(page, "키보드 여정: 라이브러리");
  await tabInto(page, '[role="grid"]');
  await pressUntil(page, "ArrowDown", note.title);
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: note.title })).toBeVisible();

  // 3. The note's [MM:SS] mark moves the player.
  await expect(page.getByRole("heading", { level: 2, name: "운영 모드" })).toBeVisible();
  const position = page.getByRole("slider", { name: "재생 위치" });
  const before = await position.getAttribute("aria-valuetext");
  await tabTo(page, /^00:09로 이동/);
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(position).toHaveValue("9");
  expect(await position.getAttribute("aria-valuetext")).not.toBe(before);
  await axe(page, "키보드 여정: 녹음 상세");

  // 4. 공유: the 녹음 작업 menu, 공유…, 링크 만들기; Esc returns focus to the menu button.
  await tabTo(page, "녹음 작업");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await pressUntil(page, "ArrowDown", "공유…");
  await page.keyboard.press("Enter");
  const share = page.getByRole("dialog", { name: "공유" });
  await expect(share).toBeVisible();
  await tabTo(page, "링크 만들기");
  await expectFocusVisible(page);
  await page.keyboard.press("Enter");
  await expect(share.getByRole("textbox", { name: "공유 링크" })).toHaveValue(/\/s\//);
  await axe(page, "키보드 여정: 공유 대화상자");
  await page.keyboard.press("Escape");
  await expect(share).toBeHidden();
  await expect.poll(() => focusedName(page)).toBe("녹음 작업");

  // 5. 설정: Tab reaches every section that has a control, and on past the last one.
  await userMenu(page, ownerName.display_name, "설정");
  await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("main section[id]")]
      .filter((sec) => sec.querySelector("a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex='0']"))
      .map((sec) => sec.id),
  );
  expect(sections.length).toBeGreaterThan(5);
  const reached = new Set<string>();
  for (let i = 0; i < 400 && reached.size < sections.length; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.closest("main section[id]")?.id ?? "");
    if (id) reached.add(id);
  }
  expect([...reached].sort()).toEqual([...sections].sort());
  await expectFocusVisible(page);
  await axe(page, "키보드 여정: 설정 (운영자)");

  // 6. 관리: every tab of the console, each with its <h1>; tables do not trap the focus.
  await tabTo(page, /^관리$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/admin$/);
  const tabs = await adminTabLabels(page);
  expect(tabs.length).toBeGreaterThanOrEqual(9);
  const traversed: string[] = [];
  for (const label of tabs) {
    await tabToAdminTab(page, label);
    await expectFocusVisible(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("navigation", { name: "관리 메뉴" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Loaded, so axe and the table check see the page and not its loading state: the pages
    // that list seeded rows show their table, no table still says 불러오는 중…, and no
    // overview count is still "…". (The console keeps a connection open: no networkidle.)
    if (TABLE_TABS.includes(label)) await expect(page.locator("main table").first()).toBeVisible();
    await expect(page.getByText("불러오는 중…")).toHaveCount(0);
    await expect(page.locator("main").getByText("…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await axe(page, `키보드 여정: 관리 ${label}`);
    if ((await page.locator("main table").count()) > 0) {
      await tabThrough(page, "main table");
      traversed.push(label);
    }
  }
  expect(traversed).toEqual(expect.arrayContaining(TABLE_TABS));

  // 7. 로그아웃.
  await userMenu(page, ownerName.display_name, "로그아웃");
  await expect(page).toHaveURL(/\/app\/login/);
});
