// Folder and tag editing, select all, calendar and the user menu.

import { expect, tabTo, test } from "./fixtures.ts";

test.describe("folders", () => {
  test("create a folder, name it in place, rename with F2, nest it, delete it", async ({ page }) => {
    await page.goto("/app/library");
    const tree = page.getByRole("treegrid", { name: "폴더" });

    await page.getByRole("button", { name: "새 폴더" }).click();
    const input = page.getByRole("textbox", { name: "폴더 이름" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("새 폴더");
    await input.fill("졸업 프로젝트");
    await input.press("Enter");
    await expect(tree.getByRole("row", { name: "졸업 프로젝트" })).toBeVisible();

    // F2 on the focused row renames it; Esc cancels, Enter saves.
    await tree.getByRole("row", { name: "졸업 프로젝트" }).focus();
    await page.keyboard.press("F2");
    await expect(page.getByRole("textbox", { name: "폴더 이름" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tree.getByRole("row", { name: "졸업 프로젝트" })).toBeVisible();
    await tree.getByRole("row", { name: "졸업 프로젝트" }).focus();
    await page.keyboard.press("F2");
    // Type only once the field has focus (and its name selected), or the keys go elsewhere.
    await expect(page.getByRole("textbox", { name: "폴더 이름" })).toBeFocused();
    await page.keyboard.type("캡스톤 디자인");
    await page.keyboard.press("Enter");
    await expect(tree.getByRole("row", { name: "캡스톤 디자인" })).toBeVisible();

    // Nest it under 연구실 through the menu (the keyboard alternative to dragging).
    await page.getByRole("button", { name: "캡스톤 디자인 폴더 작업" }).click();
    await page.getByRole("menuitem", { name: /다른 폴더로 옮기기/ }).click();
    const dialog = page.getByRole("dialog", { name: "다른 폴더로 옮기기" });
    await dialog.getByRole("button", { name: /옮길 위치/ }).click();
    await page.getByRole("option", { name: "연구실", exact: true }).click();
    await dialog.getByRole("button", { name: "옮기기" }).click();
    await expect(page.getByText("‘캡스톤 디자인’ 폴더를 ‘연구실’ 안으로 옮겼습니다.")).toBeVisible();

    // Delete with the Delete key: it asks first, and keeps recordings.
    await tree.getByRole("row", { name: "캡스톤 디자인" }).focus();
    await page.keyboard.press("Delete");
    const confirm = page.getByRole("alertdialog", { name: "폴더 삭제" });
    await expect(confirm).toContainText("녹음은 지워지지 않습니다.");
    await expect(confirm.getByRole("button", { name: "취소" })).toBeFocused();
    await confirm.getByRole("button", { name: "폴더 삭제" }).click();
    await expect(page.getByText("‘캡스톤 디자인’ 폴더를 삭제했습니다.")).toBeVisible();
    await expect(tree.getByRole("row", { name: "캡스톤 디자인" })).toHaveCount(0);
  });

  test("deleting a folder with recordings moves them to its parent", async ({ page }) => {
    await page.goto("/app/library?folder=fld_os");
    await expect(page.getByRole("heading", { level: 1, name: "운영체제" })).toBeVisible();
    await page.getByRole("button", { name: "운영체제 폴더 작업" }).first().click();
    await page.getByRole("menuitem", { name: /삭제/ }).click();
    const confirm = page.getByRole("alertdialog", { name: "폴더 삭제" });
    await expect(confirm).toContainText("안의 녹음 3개는 ‘2026년 2학기’ 폴더로 옮겨집니다.");
    await confirm.getByRole("button", { name: "폴더 삭제" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "2026년 2학기" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "녹음 목록" }).getByRole("row", { name: /운영체제 7주차/ })).toBeVisible();
  });

  test("dragging a folder onto another folder nests it", async ({ page }) => {
    await page.goto("/app/library");
    const tree = page.getByRole("treegrid", { name: "폴더" });
    await tree.getByRole("row", { name: "개인" }).dragTo(tree.getByRole("row", { name: "연구실" }));
    await expect(page.getByText("‘개인’ 폴더를 ‘연구실’ 안으로 옮겼습니다.")).toBeVisible();
  });
});

test.describe("tags", () => {
  test("create a tag, rename it in place, recolour it, attach it, delete it", async ({ page }) => {
    await page.goto("/app/library");
    await page.getByRole("button", { name: "새 태그" }).click();
    const input = page.getByRole("textbox", { name: "태그 이름" });
    await expect(input).toBeFocused();
    await input.fill("기말 범위");
    await input.press("Enter");
    const tagLink = page.getByRole("navigation", { name: "태그" }).getByRole("link", { name: /기말 범위/ });
    await expect(tagLink).toBeVisible();

    await page.getByRole("button", { name: "기말 범위 태그 작업" }).click();
    await page.getByRole("menuitemradio", { name: /남색/ }).click();
    await expect(page.getByRole("status").or(page.locator("[aria-live=polite]")).first()).toContainText(/남색/);

    // Attach it from the tag dialog of one recording.
    await page.getByRole("button", { name: "운영체제 7주차 — CPU 스케줄링 작업" }).click();
    await page.getByRole("menuitem", { name: /태그/ }).click();
    const dialog = page.getByRole("dialog", { name: "태그" });
    await dialog.locator("label", { hasText: "기말 범위" }).click();
    await dialog.getByRole("button", { name: "적용" }).click();
    await expect(page.getByText("녹음 1개의 태그를 바꿨습니다.")).toBeVisible();
    await tagLink.click();
    await expect(page.getByRole("grid", { name: "녹음 목록" }).getByRole("row", { name: /운영체제 7주차/ })).toBeVisible();

    // Delete from the header menu; the recording stays.
    await page.getByRole("button", { name: "기말 범위 태그 작업" }).first().click();
    await page.getByRole("menuitem", { name: /삭제/ }).click();
    const confirm = page.getByRole("alertdialog", { name: "태그 삭제" });
    await expect(confirm).toContainText("녹음 1개에서 이 태그가 떨어집니다.");
    await confirm.getByRole("button", { name: "태그 삭제" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "모든 녹음" })).toBeVisible();
    await expect(tagLink).toHaveCount(0);
  });

  test("a new tag can be created while tagging", async ({ page }) => {
    await page.goto("/app/library");
    await page.getByRole("button", { name: "녹음 테스트 작업" }).click();
    await page.getByRole("menuitem", { name: /태그/ }).click();
    const dialog = page.getByRole("dialog", { name: "태그" });
    await dialog.getByRole("textbox", { name: "새 태그" }).fill("다시 녹음");
    await dialog.getByRole("textbox", { name: "새 태그" }).press("Enter");
    await expect(dialog.getByRole("checkbox", { name: "다시 녹음" })).toBeChecked();
  });
});

test("select all, partial selection and clearing from the list header", async ({ page }) => {
  await page.goto("/app/library");
  await expect(page.getByRole("grid", { name: "녹음 목록" }).getByRole("row")).toHaveCount(13);
  const selectAll = page.getByRole("checkbox", { name: "모두 선택" });
  await selectAll.focus();
  await page.keyboard.press("Space");
  const toolbar = page.getByRole("toolbar", { name: "선택한 녹음 작업" });
  await expect(toolbar).toContainText("13개 선택됨");
  await page.getByRole("grid", { name: "녹음 목록" }).getByRole("row").first().focus();
  await page.keyboard.press("Space");
  await expect(toolbar).toContainText("12개 선택됨");
  expect(await selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
  await toolbar.getByRole("button", { name: "선택 해제" }).click();
  await expect(toolbar).toHaveCount(0);
  await expect(page.getByText("녹음 13개")).toBeVisible();
});

test("calendar: confirmed events show, a suggestion can be added, days are reachable by keyboard", async ({ page }) => {
  await page.goto("/app/calendar");
  const grid = page.getByRole("grid", { name: /일정 달력/ });
  await expect(grid).toBeVisible();
  const suggestions = page.getByRole("region", { name: /일정 제안/ }).or(page.locator("section", { has: page.getByRole("heading", { name: /일정 제안/ }) }));
  await suggestions.getByRole("button", { name: "일정에 추가: 운영체제 과제 3 제출" }).click();
  await expect(page.getByText("‘운영체제 과제 3 제출’ 일정을 추가했습니다.")).toBeVisible();
  await expect(suggestions.getByRole("button", { name: "일정에 추가: 운영체제 과제 3 제출" })).toHaveCount(0);

  // Arrow keys move between days; Enter selects and the agenda follows.
  await grid.getByRole("button", { name: /오늘/ }).or(grid.locator('[aria-selected="true"]')).first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator("#cal-day")).not.toHaveText("");

  // A to-do can be completed from the rail (done items move to the end of the list).
  const tasks = page.locator("section", { has: page.getByRole("heading", { name: /^할 일/ }) });
  const task = tasks.getByRole("checkbox", { name: "교재 연습문제 3–7번 풀기" });
  await task.focus();
  await page.keyboard.press("Space");
  await expect(task).toBeChecked();
});

test("user menu: profile and account settings", async ({ page, axe }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "프로필과 계정" }).click();
  await expect(page).toHaveURL(/\/app\/settings#account$/);
  const name = page.getByRole("textbox", { name: "이름" });
  await name.fill("김지우");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("프로필을 저장했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: /김지우/ })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃시키기: Lectern for Mac" }).click();
  await expect(page.getByText("Lectern for Mac에서 로그아웃했습니다.")).toBeVisible();

  // Signing out shows the login screen; signing in returns to the app.
  await page.getByRole("button", { name: /김지우/ }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/login$/);
  await axe(page, "로그인");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "로그인 (다크)");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("textbox", { name: "이메일" }).fill("someone@example.com");
  await page.getByLabel("비밀번호").fill("wrong");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("alert")).toContainText("올바르지 않습니다");
  await axe(page, "로그인 (오류)");
  await page.getByRole("textbox", { name: "이메일" }).fill("preview@example.com");
  await page.getByLabel("비밀번호").fill("any");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
});

test("a deep link without a session goes to login and comes back after it", async ({ page }) => {
  await page.goto("/app/settings");
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  // The fixture session is in memory, so stay in the page: navigate inside the app.
  await page.evaluate(() => {
    history.pushState({}, "", "/app/library?view=recent");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/app\/login\?next=/);
  await page.getByRole("textbox", { name: "이메일" }).fill("preview@example.com");
  await page.getByLabel("비밀번호").fill("any");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/library\?view=recent$/);
});
