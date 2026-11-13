// Share links on the real server (D-P2-3): make a link from the recording menu, open the
// public page in a signed-out browser, revoke it and see the address stop working, and a
// password link's form. It only adds links to note 1 and never changes its content, so it
// runs in the `server` project with the readers of that note.

import type { Browser, Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD, E2E_PORT } from "./accounts.ts";

test.describe.configure({ mode: "serial" });

const NOTE = E2E_LECTURES.find((l) => l.transcript)!;
const BODY_SENTENCE = "ECB 모드는";
const LINK_PASSWORD = "e2e-pass-1234";

async function signIn(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeHidden();
}

async function recordingId(page: Page): Promise<string> {
  const me = (await (await page.request.get("/api/v2/me")).json()) as { personal_workspace_id: string };
  const list = (await (await page.request.get(`/api/v2/recordings?workspace_id=${me.personal_workspace_id}&limit=200`)).json()) as {
    items: { id: string; title: string }[];
  };
  return list.items.find((r) => r.title === NOTE.title)!.id;
}

async function openShare(page: Page) {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/app/recordings/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: NOTE.title })).toBeVisible();
  await expect(page.getByText(BODY_SENTENCE).first()).toBeVisible();
  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name: "공유…" }).click();
  const dialog = page.getByRole("dialog", { name: "공유" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens `url` in a fresh signed-out browser context. */
async function signedOut(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("make a link, open it signed out, revoke it, and it is gone", async ({ page, browser }) => {
  const dialog = await openShare(page);
  await expect(dialog.getByRole("checkbox", { name: "전사 포함" })).not.toBeChecked();
  const before = await dialog.getByRole("button", { name: /^공유 링크 회수/ }).count();
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  await expect(dialog.getByRole("status")).toContainText("이 링크는 지금만 볼 수 있습니다.");
  const url = await dialog.getByLabel("공유 링크", { exact: true }).inputValue();
  expect(url.startsWith(`http://127.0.0.1:${E2E_PORT}/s/`)).toBe(true);
  await expect(dialog.getByRole("button", { name: /^공유 링크 회수/ })).toHaveCount(before + 1);

  const outside = await signedOut(browser);
  const res = await outside.page.goto(url);
  expect(res?.status()).toBe(200);
  await expect(outside.page.getByRole("heading", { level: 1, name: NOTE.title })).toBeVisible();
  await expect(outside.page.getByText(BODY_SENTENCE).first()).toBeVisible();
  expect((await outside.context.request.get(`${url}/audio`)).status()).toBe(404);

  // The newest link is listed first.
  await dialog.getByRole("button", { name: /^공유 링크 회수/ }).first().click();
  const confirm = page.getByRole("alertdialog", { name: "공유 링크를 회수할까요?" });
  await confirm.getByRole("button", { name: "회수", exact: true }).click();
  await expect(page.getByText("공유 링크를 회수했습니다.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^공유 링크 회수/ })).toHaveCount(before);
  expect((await outside.context.request.get(url)).status()).toBe(404);
  await outside.context.close();
});

test("a password link asks for the password and opens with the right one", async ({ page, browser }) => {
  const dialog = await openShare(page);
  await dialog.getByLabel("비밀번호 (선택)").fill(LINK_PASSWORD);
  await dialog.getByRole("button", { name: "링크 만들기" }).click();
  const url = await dialog.getByLabel("공유 링크", { exact: true }).inputValue();
  await expect(dialog.getByText("비밀번호 있음").first()).toBeVisible();

  const outside = await signedOut(browser);
  await outside.page.goto(url);
  await expect(outside.page.getByRole("heading", { level: 1, name: "비밀번호가 필요한 공유 문서" })).toBeVisible();
  await outside.page.getByLabel("비밀번호").fill("wrong-password");
  await outside.page.getByRole("button", { name: "확인" }).click();
  await expect(outside.page.getByText("비밀번호가 올바르지 않습니다.")).toBeVisible();
  await outside.page.getByLabel("비밀번호").fill(LINK_PASSWORD);
  await outside.page.getByRole("button", { name: "확인" }).click();
  await expect(outside.page.getByText(BODY_SENTENCE).first()).toBeVisible();
  await outside.context.close();
});

test("the share dialog has no axe violations on the server build", async ({ page, axe }) => {
  const dialog = await openShare(page);
  await axe(page, "공유 (서버)");
  await expect(dialog.getByRole("button", { name: "링크 만들기" })).toBeVisible();
});
