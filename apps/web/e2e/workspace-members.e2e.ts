// 설정 › 멤버·초대·사용량 and the invitation page (P5-11) on the fixture build. The team
// workspace is chosen through the remembered workspace key; `?fixture-role=` sets my role
// in it. What a role cannot do must be switched off on screen, not left to a 403.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function openTeamSettings(page: Page, role?: "owner" | "admin" | "member" | "viewer", hash = "#members") {
  await page.addInitScript(() => localStorage.setItem("lectern.web.workspace", "ws_team"));
  await page.goto(`/app/settings${role ? `?fixture-role=${role}` : ""}${hash}`);
  const members = page.locator("#members");
  await expect(members.getByRole("row", { name: /한지민/ })).toBeVisible();
  return members;
}

const roleSelect = (scope: ReturnType<Page["locator"]>, name: string) => scope.getByRole("button", { name: new RegExp(`역할: ${name}`) });

test("owner changes a role", async ({ page }) => {
  const members = await openTeamSettings(page, "owner");
  await roleSelect(members, "윤서아").click();
  await expect(page.getByRole("option", { name: "소유자" })).toBeVisible();
  await page.getByRole("option", { name: "보기 전용" }).click();
  await expect(page.getByText("윤서아님의 역할을 보기 전용(으)로 바꿨습니다.")).toBeVisible();
  await expect(roleSelect(members, "윤서아")).toContainText("보기 전용");
});

test("admin cannot edit owners", async ({ page }) => {
  const members = await openTeamSettings(page, "admin");
  await expect(roleSelect(members, "한지민")).toBeDisabled();
  await expect(roleSelect(members, "오세훈")).toBeDisabled();
  await expect(members.getByRole("button", { name: "내보내기: 한지민" })).toBeDisabled();
  await roleSelect(members, "윤서아").click();
  await expect(page.getByRole("option", { name: "멤버" })).toBeVisible();
  await expect(page.getByRole("option", { name: "보기 전용" })).toBeVisible();
  await expect(page.getByRole("option", { name: "소유자" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "관리자" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // An admin may invite, but not as 관리자.
  const invites = page.locator("#invites");
  await invites.getByRole("button", { name: /역할/ }).click();
  await expect(page.getByRole("option", { name: "관리자" })).toHaveCount(0);
});

test("member sees no invite form", async ({ page }) => {
  const members = await openTeamSettings(page, "member");
  await expect(page.locator("#invites")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "초대" })).toHaveCount(0);
  // A select's name is its value and then its label: "멤버 역할: 윤서아".
  const selects = members.getByRole("button", { name: /역할: / });
  await expect(selects).toHaveCount(5);
  for (const select of await selects.all()) await expect(select).toBeDisabled();
  await expect(members.getByRole("button", { name: /^내보내기/ })).toHaveCount(0);
  await expect(members.getByRole("button", { name: "나가기" })).toBeEnabled();
});

test("last owner hint", async ({ page }) => {
  const members = await openTeamSettings(page, "owner");
  await expect(members.getByText("소유자가 한 명은 있어야 합니다.")).toHaveCount(0);
  // Two owners: make 한지민 an admin, and I am the only one left.
  await roleSelect(members, "한지민").click();
  await page.getByRole("option", { name: "관리자" }).click();
  await expect(roleSelect(members, "한지민")).toContainText("관리자");
  const mine = members.getByRole("row", { name: /미리보기 사용자/ });
  await expect(mine.getByText("소유자가 한 명은 있어야 합니다.")).toBeVisible();
  await expect(roleSelect(members, "미리보기 사용자")).toBeDisabled();
  await expect(mine.getByRole("button", { name: "나가기" })).toBeDisabled();
});

test("invite and cancel", async ({ page }) => {
  await openTeamSettings(page, "owner", "#invites");
  const invites = page.locator("#invites");
  await expect(invites.getByText("newcomer@example.com")).toBeVisible();
  await invites.getByLabel("이메일").fill("guest@example.com");
  await invites.getByRole("button", { name: /역할/ }).click();
  await page.getByRole("option", { name: "보기 전용" }).click();
  await invites.getByRole("button", { name: "초대 보내기" }).click();
  await expect(page.getByText("guest@example.com(으)로 초대를 보냈습니다.")).toBeVisible();
  const row = invites.getByRole("listitem").filter({ hasText: "guest@example.com" });
  await expect(row).toContainText("보기 전용");
  await row.getByRole("button", { name: "초대 취소: guest@example.com" }).click();
  await expect(page.getByText("초대를 취소했습니다.")).toBeVisible();
  await expect(invites.getByText("guest@example.com")).toHaveCount(0);
  await expect(invites.getByText("newcomer@example.com")).toBeVisible();
});

test("accept needs a click", async ({ page }) => {
  await page.goto("/app/invite?token=x");
  await expect(page.getByRole("heading", { level: 1, name: "워크스페이스 초대를 받았습니다." })).toBeVisible();
  await expect(page.getByText("preview@example.com(으)로 로그인되어 있습니다.")).toBeVisible();
  // Opening the link joins nothing: the workspace is not in the switcher yet.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^워크스페이스: .*바꾸기$/ }).click();
  await expect(page.getByRole("menuitemradio", { name: /제품팀/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /디자인 스터디/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "초대 수락" }).click();
  await expect(page.getByText('"디자인 스터디" 워크스페이스에 참여했습니다.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/$/);
  expect(page.url()).not.toContain("token");
  await expect(page.getByRole("button", { name: "워크스페이스: 디자인 스터디, 바꾸기" })).toBeVisible();
});

test("accept with the wrong account", async ({ page }) => {
  await page.goto("/app/invite?token=wrong-account");
  await page.getByRole("button", { name: "초대 수락" }).click();
  await expect(page.getByRole("alert")).toContainText("이 초대는 다른 이메일 주소로 보낸 것입니다. 초대받은 주소로 로그인해 주세요.");
  await expect(page.getByRole("button", { name: "초대 수락" })).toHaveCount(0);
  await page.getByRole("button", { name: "다른 계정으로 로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe("/invite?token=wrong-account");
});

test("an invitation link without a token", async ({ page }) => {
  await page.goto("/app/invite");
  await expect(page.getByRole("alert")).toContainText("초대 링크가 올바르지 않습니다.");
  await expect(page.getByRole("button", { name: "초대 수락" })).toHaveCount(0);
});

test("usage with a quota", async ({ page }) => {
  await openTeamSettings(page, undefined, "#usage");
  const usage = page.locator("#usage");
  const bars = usage.getByRole("progressbar");
  await expect(bars).toHaveCount(3);
  await expect(usage.getByRole("progressbar", { name: "이번 달 AI 처리 비용" })).toHaveAttribute("aria-valuenow", "100");
  await expect(usage.getByRole("progressbar", { name: "이번 달 녹음 시간" })).toHaveAttribute("aria-valuemax", "100");
  await expect(usage.getByText("한도를 모두 사용했습니다.")).toBeVisible();
  await expect(usage.getByText("한도에 가까워졌습니다.")).toBeVisible();
  await expect(usage.getByText("$10.00 / $10.00")).toBeVisible();
  await expect(usage.getByText(/^기간: \d{4}년 \d{1,2}월$/)).toBeVisible();
  await expect(usage.getByText("한도는 운영자가 설정합니다.")).toBeVisible();
});

test("personal workspace: no members to manage, usage without limits", async ({ page }) => {
  await page.goto("/app/settings#members");
  await expect(page.locator("#members").getByText("개인 워크스페이스에는 다른 멤버가 없습니다.")).toBeVisible();
  await expect(page.locator("#invites")).toHaveCount(0);
  const usage = page.locator("#usage");
  await expect(usage.getByText("3시간 20분")).toBeVisible();
  await expect(usage.getByText("$1.23")).toBeVisible();
  await expect(usage.getByText("1.2GB")).toBeVisible();
  await expect(usage.getByRole("progressbar")).toHaveCount(0);
});
