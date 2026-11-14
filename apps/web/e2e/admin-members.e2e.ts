// 관리 › 사용자와 녹음 (P5-16) on the fixture build. The fixture's me is the service owner.
// Five accounts (오세훈: 7 lectures, 2 failed, one session), 55 lectures: lec_fx_05 is mine,
// done and not compacted; lec_fx_06 is mine and failed; lec_fx_04 is compacted. The fixture
// starts over on a reload, so "다시 열어도" means going back through the links.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const bodyRows = (page: Page, caption: string) => page.getByRole("table", { name: caption }).locator("tbody tr");
// A select's name is its value, then its label: "전체 (55) 상태".
const select = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(` ${label}$`) });
const pageHeader = (page: Page) => page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });

test("create a user", async ({ page }) => {
  await page.goto("/app/admin/users");
  await expect(bodyRows(page, "사용자")).toHaveCount(5);
  await page.getByRole("button", { name: "새 사용자" }).click();
  const dialog = page.getByRole("dialog", { name: "새 사용자" });
  await expect(dialog.getByRole("textbox", { name: "오디오 저장 한도(MB)" })).toHaveValue("2048");
  await dialog.getByRole("textbox", { name: "아이디 또는 이메일" }).fill("newbie@example.com");
  await dialog.getByLabel("초기 비밀번호").fill("abc");
  await dialog.getByRole("button", { name: "사용자 만들기" }).click();
  await expect(dialog.getByRole("alert")).toContainText("초기 비밀번호는 6자 이상이어야 합니다.");
  await dialog.getByLabel("초기 비밀번호").fill("abcdef");
  await dialog.getByRole("button", { name: "사용자 만들기" }).click();
  await expect(page.getByText("새 사용자를 만들었습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "newbie" })).toBeVisible();
  await page.getByRole("link", { name: "← 사용자 목록" }).click();
  await expect(bodyRows(page, "사용자")).toHaveCount(6);
  await expect(bodyRows(page, "사용자").filter({ hasText: "newbie@example.com" })).toHaveCount(1);
});

test("user detail shows the account", async ({ page }) => {
  await page.goto("/app/admin/users");
  await page.getByRole("link", { name: "오세훈" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/users\/usr_fixture_sehun$/);
  await expect(page.getByRole("heading", { level: 1, name: "오세훈" })).toBeVisible();
  const facts = page.locator("dl");
  await expect(facts).toContainText("sehun@example.com");
  await expect(facts).toContainText("7개 · 공개 0 · 오류 2");
  await expect(facts).toContainText("1개 기기");
  await expect(page.getByRole("progressbar", { name: "오디오 사용량" })).toBeVisible();
  // The edit form starts from the account as it is.
  await expect(page.getByRole("switch", { name: "공개 공유 링크 허용" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "녹음·업로드 허용" })).toBeChecked();
});

test("edit a user", async ({ page }) => {
  await page.goto("/app/admin/users/usr_fixture_sehun");
  await expect(page.getByRole("heading", { level: 1, name: "오세훈" })).toBeVisible();
  await page.getByRole("textbox", { name: "표시 이름" }).fill("오세훈2");
  await page.getByRole("switch", { name: "녹음·업로드 허용" }).press("Space");
  await page.getByRole("switch", { name: "공개 공유 링크 허용" }).press("Space");
  await page.getByRole("switch", { name: "서버 AI 키로 노트 만들기" }).press("Space");
  await page.getByRole("textbox", { name: "오디오 저장 한도(MB)" }).fill("4096");
  await page.getByRole("textbox", { name: "메모" }).fill("졸업반");
  await select(page, "역할").click();
  await page.getByRole("option", { name: "보기 전용" }).click();
  await page.getByRole("switch", { name: "저장할 때 모든 세션 로그아웃" }).press("Space");
  await page.getByLabel("새 비밀번호").fill("new-pass-1");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("사용자 정보를 저장했습니다.")).toBeVisible();
  // The password is sent once; the field empties after the save.
  await expect(page.getByLabel("새 비밀번호")).toHaveValue("");

  await expect(page.getByRole("heading", { level: 1, name: "오세훈2" })).toBeVisible();

  await page.getByRole("link", { name: "← 사용자 목록" }).click();
  await page.getByRole("link", { name: "오세훈2" }).click();
  await expect(page.getByRole("textbox", { name: "표시 이름" })).toHaveValue("오세훈2");
  await expect(page.getByRole("switch", { name: "녹음·업로드 허용" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "공개 공유 링크 허용" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "서버 AI 키로 노트 만들기" })).not.toBeChecked();
  await expect(page.getByRole("textbox", { name: "오디오 저장 한도(MB)" })).toHaveValue("4096");
  await expect(page.getByRole("textbox", { name: "메모" })).toHaveValue("졸업반");
  await expect(select(page, "역할")).toContainText("보기 전용");
  await expect(page.locator("dl")).toContainText("0개 기기");
  await expect(page.getByRole("switch", { name: "저장할 때 모든 세션 로그아웃" })).not.toBeChecked();
});

test("short password is refused", async ({ page }) => {
  await page.goto("/app/admin/users/usr_fixture_sehun");
  await page.getByLabel("새 비밀번호").fill("abc");
  await page.getByRole("textbox", { name: "메모" }).fill("바뀌면 안 됨");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("새 비밀번호는 6자 이상이어야 합니다.");
  await expect(page.getByText("사용자 정보를 저장했습니다.")).toHaveCount(0);
  // Nothing was sent: the memo is unchanged when the page is opened again.
  await page.getByRole("link", { name: "← 사용자 목록" }).click();
  await page.getByRole("link", { name: "오세훈" }).click();
  await expect(page.getByRole("textbox", { name: "메모" })).toHaveValue("");
});

test("user filters stay in the address", async ({ page }) => {
  await page.goto("/app/admin/users");
  const rows = bodyRows(page, "사용자");
  await expect(rows).toHaveCount(5);
  await select(page, "역할").click();
  await page.getByRole("option", { name: /^멤버/ }).click();
  await expect(page).toHaveURL(/role=member/);
  await expect(rows).toHaveCount(2);
  await page.getByRole("searchbox", { name: "검색" }).fill("신입");
  await expect(page).toHaveURL(/q=/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("seoa@example.com");
  // Into the user and back: the filters are still there.
  await page.getByRole("link", { name: "윤서아" }).click();
  await page.goBack();
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("searchbox", { name: "검색" })).toHaveValue("신입");
  await select(page, "상태").click();
  await page.getByRole("option", { name: /^정지/ }).click();
  await expect(page).toHaveURL(/status=suspended/);
  await expect(page.getByText("조건에 맞는 사용자가 없습니다.")).toBeVisible();
});

test("recordings filter, search and more", async ({ page }) => {
  await page.goto("/app/admin/recordings");
  const rows = bodyRows(page, "녹음");
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "더 보기 (5개 남음)" }).click();
  await expect(rows).toHaveCount(55);
  await expect(page.getByRole("button", { name: /더 보기/ })).toHaveCount(0);

  await select(page, "상태").click();
  await expect(page.getByRole("option", { name: "오류 (3)" })).toBeVisible();
  await page.getByRole("option", { name: "오류 (3)" }).click();
  await expect(page).toHaveURL(/status=error/);
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toContainText("오류");

  await select(page, "상태").click();
  await page.getByRole("option", { name: /^전체/ }).click();
  await page.getByRole("searchbox", { name: "검색" }).fill("알고리즘");
  await expect(page).toHaveURL(/q=/);
  await expect(rows.first()).toContainText("알고리즘");
  for (const row of await rows.all()) await expect(row).toContainText("알고리즘");
  // A lecture being processed shows its progress.
  await page.getByRole("searchbox", { name: "검색" }).fill("");
  await select(page, "상태").click();
  await page.getByRole("option", { name: /^처리 중/ }).click();
  await expect(rows.filter({ hasText: "처리 중 40%" })).toHaveCount(1);
});

test("recordings table sorts", async ({ page }) => {
  await page.goto("/app/admin/recordings");
  await expect(bodyRows(page, "녹음")).toHaveCount(50);
  const header = page.getByRole("columnheader", { name: "길이" });
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  // The shortest lecture is 31 minutes (lec_fx_47).
  await expect(bodyRows(page, "녹음").first().locator("td").nth(3)).toHaveText("31분");
});

test("recording detail shows the lecture", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_04");
  await expect(page.getByRole("heading", { level: 1, name: "데이터베이스 5주차" })).toBeVisible();
  const facts = page.locator("dl");
  await expect(facts).toContainText("압축됨");
  await expect(facts).toContainText("압축 전");
  await expect(facts).toContainText("압축 시각");
  await expect(facts).toContainText("gemini-3.8-flash");
  await expect(page.getByRole("heading", { name: "요약" })).toBeVisible();
  // Already compacted: no 지금 압축. The owner's name goes to their page.
  await expect(page.getByRole("button", { name: "지금 압축" })).toHaveCount(0);
  await facts.getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/admin\/users\//);
});

test("recording actions ask first", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_05");
  await expect(page.locator("dl")).toContainText("MB");
  await page.getByRole("button", { name: "오디오 삭제" }).click();
  const dialog = page.getByRole("alertdialog", { name: "오디오 삭제" });
  await expect(dialog).toContainText("영구 삭제");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("dl")).not.toContainText("삭제됨");

  await page.getByRole("button", { name: "오디오 삭제" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "오디오 삭제" }).click();
  await expect(page.getByText(/오디오를 삭제했습니다\. .+ 확보\./)).toBeVisible();
  await expect(page.locator("dl")).toContainText("삭제됨");
  await expect(page.getByRole("button", { name: "오디오 삭제" })).toHaveCount(0);
});

test("retry an errored recording", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_06");
  await expect(page.getByRole("note", { name: "오류 메시지" })).toBeVisible();
  await page.getByRole("button", { name: "재시도" }).click();
  await expect(page.getByText("재시도를 시작했습니다.")).toBeVisible();
  await expect(pageHeader(page).getByText("처리 중")).toBeVisible();
  await expect(page.getByRole("button", { name: "재시도" })).toHaveCount(0);
});

test("compact a recording", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_05");
  await page.getByRole("button", { name: "지금 압축" }).click();
  await expect(page.getByText(/압축 대기열에 넣었습니다\./)).toBeVisible();
  await expect(pageHeader(page).getByText("압축 대기")).toBeVisible();
  await expect(page.getByRole("button", { name: "지금 압축" })).toHaveCount(0);
});

test("recording refreshes while it is being worked on", async ({ page }) => {
  // The fixture finishes a compaction three seconds after it is queued; nothing on the page
  // is pressed again, so only the five-second refresh can show it.
  await page.goto("/app/admin/recordings/lec_fx_05");
  await page.getByRole("button", { name: "지금 압축" }).click();
  await expect(pageHeader(page).getByText("압축 대기")).toBeVisible();
  await expect(page.locator("dl").getByText("압축됨")).toBeVisible({ timeout: 15_000 });
  await expect(pageHeader(page).getByText("압축 대기")).toHaveCount(0);
  await expect(page.locator("dl")).toContainText("압축 전");
});

test("delete a recording", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_05");
  await page.getByRole("button", { name: "녹음 삭제" }).click();
  const dialog = page.getByRole("alertdialog", { name: "녹음 삭제" });
  await expect(dialog).toContainText("되돌릴 수 없습니다.");
  await dialog.getByRole("button", { name: "녹음 삭제" }).click();
  await expect(page.getByText("녹음을 삭제했습니다.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/admin\/recordings$/);
  await expect(page.getByText("54개")).toBeVisible();
});

test("owner link", async ({ page }) => {
  await page.goto("/app/admin/users/usr_fixture_sehun");
  await page.getByRole("link", { name: "이 사용자의 녹음" }).click();
  await expect(page).toHaveURL(/owner=usr_fixture_sehun/);
  const rows = bodyRows(page, "녹음");
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) await expect(row).toContainText("sehun@example.com");
  await page.getByRole("button", { name: "소유자 필터 해제: 오세훈" }).click();
  await expect(page).not.toHaveURL(/owner=/);
  await expect(rows).toHaveCount(50);
});
