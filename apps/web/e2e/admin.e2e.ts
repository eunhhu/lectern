// 관리 (P5-12) on the fixture build: the fixture's me is the service owner (an operator);
// `?fixture-operator=off` makes me an ordinary member. The fixture's admin data is fixed:
// five accounts, twelve jobs (two failed, two queued, one running) and three ledger rows.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The overview's two lists of cards (확인 필요 below them has items of its own).
const card = (page: Page, label: string) => page.getByRole("list", { name: /^(사용자와 녹음|작업)$/ }).getByRole("listitem").filter({ hasText: label });
const bodyRows = (page: Page, caption: string | RegExp) => page.getByRole("table", { name: caption }).locator("tbody tr");

test("non-admin sees not found", async ({ page }) => {
  await page.goto("/app/admin?fixture-operator=off");
  await expect(page.getByText("페이지를 찾을 수 없습니다.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "관리 메뉴" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "관리", exact: true })).toHaveCount(0);
});

test("overview cards", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("link", { name: "관리", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "개요" })).toBeVisible();
  const expected: [string, string][] = [
    ["전체 사용자", "5"],
    ["활성 사용자", "3"],
    ["승인 대기", "1"],
    ["정지된 사용자", "1"],
    ["공개 녹음", "4"],
    ["오류 난 녹음", "3"],
    ["오디오 저장 용량", "1.6 GB"],
    ["대기 중인 작업", "2"],
    ["실행 중인 작업", "1"],
    ["실패한 작업", "2"],
  ];
  for (const [label, value] of expected) await expect(card(page, label)).toContainText(value);
  await expect(page.getByRole("list", { name: "사용자와 녹음" }).getByRole("listitem").filter({ hasText: /^녹음/ })).toContainText("55");
});

test("sort by keyboard", async ({ page }) => {
  await page.goto("/app/admin/users");
  const rows = bodyRows(page, "사용자");
  await expect(rows).toHaveCount(5);
  const header = page.getByRole("columnheader", { name: "가입일" });
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  // Oldest first: the owner signed up 120 days ago.
  const firstAscending = await rows.first().locator("td").first().textContent();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(rows.first()).toContainText("seoa@example.com");
  expect(await rows.first().locator("td").first().textContent()).not.toBe(firstAscending);
});

test("failed jobs filter from the overview", async ({ page }) => {
  await page.goto("/app/admin");
  await page.getByRole("link", { name: /실패한 작업 보기/ }).click();
  await expect(page).toHaveURL(/\/app\/admin\/jobs\?state=failed$/);
  const stateSelect = page.getByRole("button", { name: /^\S+ 상태$/ });
  await expect(stateSelect).toContainText("실패");
  const rows = bodyRows(page, "작업");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) await expect(row.getByText("실패", { exact: true })).toBeVisible();
  // Back to every state: the address loses the filter.
  await stateSelect.click();
  await page.getByRole("option", { name: "전체" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/jobs$/);
  await expect(rows).toHaveCount(12);
});

test("job timeline", async ({ page }) => {
  await page.goto("/app/admin/jobs");
  await page.getByRole("link", { name: "녹음 처리" }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/jobs\/job_fx_01$/);
  await expect(page.getByRole("heading", { level: 1, name: "녹음 처리 작업" })).toBeVisible();
  const stages = page.getByRole("list", { name: "단계 타임라인" }).getByRole("listitem");
  await expect(stages).toHaveCount(6);
  for (const stage of await stages.all()) {
    await expect(stage).toContainText(/걸린 시간 \d/);
    await expect(stage).toContainText(/비용 \$\d/);
  }
  await expect(stages.nth(4)).toContainText("verify_failed");
  await expect(stages.nth(5)).toContainText("시작 전");
  await expect(bodyRows(page, "AI 호출")).toHaveCount(4);
});

test("retry asks first", async ({ page }) => {
  await page.goto("/app/admin/jobs/job_fx_01");
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header.getByText("실패", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "다시 시도" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("이 작업을 다시 시도할까요?");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(header.getByText("실패", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "다시 시도" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("작업을 다시 대기열에 넣었습니다.")).toBeVisible();
  await expect(header.getByText("대기", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
  // One request only: a second would have been refused (the job is no longer failed).
  await expect(page.getByText("다시 시도할 수 없는 작업입니다.")).toHaveCount(0);
});

test("set a quota", async ({ page }) => {
  await page.goto("/app/admin/usage");
  await expect(bodyRows(page, /사용량$/)).toHaveCount(3);
  await page.getByRole("button", { name: "한도 설정: 제품팀" }).click();
  const dialog = page.getByRole("dialog", { name: "한도 설정: 제품팀" });
  const hours = dialog.getByRole("textbox", { name: "월 녹음 시간(시간)" });
  await expect(hours).toHaveValue("20");
  await expect(dialog.getByRole("textbox", { name: "월 AI 비용(달러)" })).toHaveValue("10");
  await expect(dialog.getByRole("textbox", { name: "저장 공간(GB)" })).toHaveValue("10");
  await hours.fill("10");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("한도를 저장했습니다.")).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // 10 hours went out as 36,000,000 ms: reading it back gives 10.
  await page.getByRole("button", { name: "한도 설정: 제품팀" }).click();
  await expect(dialog.getByRole("textbox", { name: "월 녹음 시간(시간)" })).toHaveValue("10");
  await dialog.getByRole("button", { name: "취소" }).click();

  // A workspace I am not in: its limits cannot be read, and the dialog says so.
  // (The page behind an open dialog is inert, but Playwright still finds it: scope to the dialog.)
  await page.getByRole("button", { name: "한도 설정: ws_lab" }).click();
  const lab = page.getByRole("dialog", { name: "한도 설정: ws_lab" });
  await expect(lab).toContainText("지금 한도를 읽을 수 없어");
  await lab.getByRole("textbox", { name: "월 녹음 시간(시간)" }).fill("-1");
  await lab.getByRole("button", { name: "저장", exact: true }).click();
  await expect(lab.getByRole("alert")).toContainText("0 이상의 숫자");
});

test("delete user needs the e-mail", async ({ page }) => {
  await page.goto("/app/admin/users");
  const rows = bodyRows(page, "사용자");
  await expect(rows).toHaveCount(5);
  // Not myself, not an owner.
  await expect(rows.first().getByRole("button", { name: /^삭제:/ })).toBeDisabled();

  await page.getByRole("button", { name: "삭제: sehun@example.com" }).click();
  const dialog = page.getByRole("alertdialog", { name: "사용자 삭제" });
  const confirm = dialog.getByRole("button", { name: "영구 삭제" });
  await expect(confirm).toBeDisabled();
  const field = dialog.getByRole("textbox", { name: "확인을 위해 이메일을 입력하세요" });
  await field.fill("sehun@example.co");
  await expect(confirm).toBeDisabled();
  await field.fill("sehun@example.com");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText("sehun@example.com 계정을 삭제했습니다.")).toBeVisible();
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "sehun@example.com" })).toHaveCount(0);
});

test("approve and suspend", async ({ page }) => {
  await page.goto("/app/admin/users");
  await page.getByRole("button", { name: "승인: seoa@example.com" }).click();
  await expect(page.getByText("seoa@example.com 가입을 승인했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "정지: seoa@example.com" })).toBeVisible();
  await page.getByRole("button", { name: "정지 해제: dohyun@example.com" }).click();
  await expect(page.getByRole("button", { name: "정지: dohyun@example.com" })).toBeVisible();
  // My own role cannot be changed here.
  const rows = bodyRows(page, "사용자");
  await expect(rows.first().getByRole("button", { name: /역할: / })).toBeDisabled();
});
