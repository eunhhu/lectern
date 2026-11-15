// Settings › 연동 and 알림 on the fixture build (P4-07): connecting Google Calendar (the
// fixture skips the consent screen and comes back with ?google=connected), disconnecting
// behind a confirmation that says Google keeps its events, the expired-connection banner,
// the ICS address shown once, reminder settings that survive a reload, the keyboard path,
// and the calendar page's connection line. The fixture keeps this state in sessionStorage.

import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "./fixtures.ts";

async function openIntegrations(page: Page, query = "") {
  await page.goto(`/app/settings${query}#integrations`);
  const section = page.locator("#integrations");
  await expect(section.getByRole("heading", { name: "연동" })).toBeVisible();
  return section;
}

test("connects Google Calendar", async ({ page }) => {
  const section = await openIntegrations(page);
  await expect(section.getByText('수락한 일정을 Google 캘린더의 "Lectern" 캘린더에 넣습니다.', { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "Google 캘린더 연결" }).click();
  await expect(page.getByText("Google 캘린더를 연결했습니다.")).toBeVisible();
  await expect(section.getByText("연결됨", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "연결 해제" })).toBeVisible();
  // The callback's query is removed once read.
  await expect(page).toHaveURL(/\/app\/settings#integrations$/);
});

test("disconnect explains that Google events stay", async ({ page }) => {
  const section = await openIntegrations(page, "?fixture-integration=active");
  await section.getByRole("button", { name: "연결 해제" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Google 캘린더 연결을 해제할까요?" });
  await expect(dialog.getByText("이미 Google 캘린더에 들어간 일정은 지워지지 않습니다.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByText("연결을 해제했습니다.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Google 캘린더 연결" })).toBeVisible();
});

test("needs_reauth banner", async ({ page }) => {
  const section = await openIntegrations(page, "?fixture-integration=needs_reauth");
  await expect(section.getByText("Google 연결이 만료되었습니다. 다시 연결해야 일정이 동기화됩니다.")).toBeVisible();
  await expect(section.getByRole("button", { name: "다시 연결" })).toBeVisible();

  await page.goto("/app/calendar?fixture-integration=needs_reauth");
  await expect(page.getByText("Google 연결이 만료되었습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "다시 연결" })).toHaveAttribute("href", /\/app\/settings#integrations$/);
});

test("creates and copies the ICS url once", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const section = await openIntegrations(page);
  await expect(section.getByText("Apple 캘린더, Outlook 같은 앱에서 이 주소를 구독하면 수락한 일정이 보입니다.")).toBeVisible();
  await section.getByRole("button", { name: "구독 주소 만들기" }).click();
  const field = section.getByLabel("구독 주소", { exact: true });
  await expect(field).toBeFocused();
  const url = await field.inputValue();
  expect(url).toContain("/cal/");
  await expect(section.getByText("이 주소는 지금만 볼 수 있습니다.", { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "복사" }).click();
  await expect(page.getByText("주소를 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  await page.reload();
  await expect(section.getByText("구독 주소가 있습니다.", { exact: false })).toBeVisible();
  await expect(section.getByLabel("구독 주소", { exact: true })).toHaveCount(0);
  await expect(page.getByText(url)).toHaveCount(0);

  // 다시 만들기 warns that the old address stops working, then shows a new one.
  await section.getByRole("button", { name: "다시 만들기" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("새 주소를 만들면 예전 주소는 더 이상 동작하지 않습니다.")).toBeVisible();
  await confirm.getByRole("button", { name: "다시 만들기" }).click();
  await expect(section.getByLabel("구독 주소", { exact: true })).not.toHaveValue(url);

  await page.reload();
  await section.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("alertdialog").getByText("구독 주소를 삭제할까요?", { exact: false })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).click();
  await expect(section.getByRole("button", { name: "구독 주소 만들기" })).toBeVisible();
});

test("reminder settings persist", async ({ page }) => {
  await page.goto("/app/settings#reminders");
  const section = page.locator("#reminders");
  await expect(section.getByRole("heading", { name: "알림" })).toBeVisible();
  const email = section.getByRole("checkbox", { name: "일정과 할 일 마감을 이메일로 알려 주기" });
  await expect(email).not.toBeChecked();
  await section.locator("label", { hasText: "일정과 할 일 마감을 이메일로 알려 주기" }).click();
  await expect(page.getByText("알림 설정을 저장했습니다.").first()).toBeVisible();
  await expect(email).toBeChecked();
  await section.getByRole("button", { name: /알림 시각/ }).click();
  await page.getByRole("option", { name: "1시간 전", exact: true }).click();
  await expect(section.getByRole("button", { name: /알림 시각/ })).toContainText("1시간 전");
  // Each change saves at once; the controls are disabled until the save answers.
  await expect(email).toBeEnabled();

  const autoAdd = section.getByRole("checkbox", { name: "날짜가 분명한 일정은 자동으로 수락하기" });
  await section.locator("label", { hasText: "날짜가 분명한 일정은 자동으로 수락하기" }).click();
  await expect(autoAdd).toBeChecked();
  await expect(autoAdd).toBeEnabled();

  await page.reload();
  await expect(email).toBeChecked();
  await expect(section.getByRole("button", { name: /알림 시각/ })).toContainText("1시간 전");
  await expect(autoAdd).toBeChecked();
});

test("keyboard only", async ({ page }) => {
  await page.goto("/app/settings#reminders");
  await expect(page.locator("#reminders").getByRole("heading", { name: "알림" })).toBeVisible();
  await tabTo(page, "일정과 할 일 마감을 이메일로 알려 주기");
  await page.keyboard.press("Space");
  await expect(page.getByText("알림 설정을 저장했습니다.").first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "일정과 할 일 마감을 이메일로 알려 주기" })).toBeChecked();
  // The lead time by keyboard too: Tab to the select, Enter opens it, arrows pick, Enter chooses.
  await tabTo(page, /알림 시각/, 10);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#reminders").getByRole("button", { name: /알림 시각/ })).toContainText("3시간 전");
});

test("the calendar page says how it is connected", async ({ page }) => {
  await page.goto("/app/calendar");
  await expect(page.getByText("캘린더 앱과 연결하면 수락한 일정이 자동으로 들어갑니다.")).toBeVisible();
  await page.getByRole("link", { name: "연결 설정" }).click();
  await expect(page).toHaveURL(/\/app\/settings#integrations$/);
  await page.locator("#integrations").getByRole("button", { name: "Google 캘린더 연결" }).click();
  await expect(page.getByText("Google 캘린더를 연결했습니다.")).toBeVisible();
  await page.goto("/app/calendar");
  await expect(page.getByText("Google 캘린더와 연결됨")).toBeVisible();
});
