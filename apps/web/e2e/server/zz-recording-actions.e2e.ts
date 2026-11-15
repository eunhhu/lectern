// Recording actions on the real server (D-P2-4): the reprocess estimate without ever
// sending the real request, 문서만 다시 만들기 refused for a note without a transcript, the
// Markdown download, deleting note 2's audio, and the server's suggested questions. It
// deletes audio, so it runs in `server-late`; it uses only note 2 for writes (note 1 is
// read for suggestions, and `zz-edit.e2e.ts` owns its content).

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

test.describe.configure({ mode: "serial" });

const NOTE_1 = E2E_LECTURES.find((l) => l.transcript)!;
const NOTE_2 = E2E_LECTURES.find((l) => l.title.startsWith("주간 제품 회의"))!;

async function signIn(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeHidden();
}

async function workspaceId(page: Page): Promise<string> {
  return ((await (await page.request.get("/api/v2/me")).json()) as { personal_workspace_id: string }).personal_workspace_id;
}

async function recordingId(page: Page, title: string): Promise<string> {
  const ws = await workspaceId(page);
  const list = (await (await page.request.get(`/api/v2/recordings?workspace_id=${ws}&limit=200`)).json()) as { items: { id: string; title: string }[] };
  return list.items.find((r) => r.title === title)!.id;
}

async function openNote(page: Page, title: string): Promise<string> {
  await signIn(page);
  const id = await recordingId(page, title);
  await page.goto(`/app/recordings/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "녹음 작업" })).toBeVisible();
  return id;
}

async function menuAction(page: Page, name: string) {
  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test("다시 처리 shows the server's estimate and sends no real request", async ({ page, axe }) => {
  const realRequests: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/reprocess") && !(req.postData() ?? "").includes('"dry_run":true')) realRequests.push(req.url());
  });
  await openNote(page, NOTE_2.title);
  await menuAction(page, "다시 처리…");
  const dialog = page.getByRole("dialog", { name: "다시 처리" });
  await expect(dialog.getByText("$0.01 미만")).toBeVisible();
  await expect(dialog.getByText("12초")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "다시 처리" })).toBeEnabled();
  await axe(page, "다시 처리 (서버)");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  expect(realRequests).toEqual([]);
});

test("문서만 다시 만들기 shows the server's 409 and stays disabled", async ({ page }) => {
  await openNote(page, NOTE_2.title);
  await menuAction(page, "문서만 다시 만들기");
  const dialog = page.getByRole("dialog", { name: "문서만 다시 만들기" });
  await expect(dialog.getByRole("alert")).toContainText("전사가 없는 녹음이라 문서만 다시 만들 수 없습니다.");
  await expect(dialog.getByRole("button", { name: "문서 다시 만들기" })).toBeDisabled();
  await dialog.getByRole("button", { name: "취소" }).click();
});

test("Markdown 내려받기 saves the note's Markdown", async ({ page }) => {
  await openNote(page, NOTE_2.title);
  const download = page.waitForEvent("download");
  await menuAction(page, "Markdown 내려받기");
  const file = await download;
  expect(file.suggestedFilename()).toContain("주간 제품 회의");
  expect(file.suggestedFilename().endsWith(".md")).toBe(true);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8")).toContain("출시일은 11월 3일로 확정했다");
});

test("오디오만 삭제 removes the audio and keeps the document", async ({ page, axe }) => {
  const id = await openNote(page, NOTE_2.title);
  await menuAction(page, "오디오만 삭제…");
  const confirm = page.getByRole("alertdialog", { name: "오디오만 삭제할까요?" });
  await expect(confirm).toBeVisible();
  await axe(page, "오디오 삭제 (서버)");
  await confirm.getByRole("button", { name: "오디오 삭제" }).click();
  await expect(page.getByText("오디오를 삭제했습니다.")).toBeVisible();

  const detail = (await (await page.request.get(`/api/v2/recordings/${id}`)).json()) as { assets: { kind: string }[]; documents: unknown[] };
  expect(detail.assets.filter((a) => a.kind.startsWith("audio"))).toEqual([]);
  expect(detail.documents.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "재생", exact: true })).toBeDisabled();
  await expect(page.getByText("출시일은 11월 3일로 확정했다").first()).toBeVisible();
});

test("the note panel shows the server's suggested questions", async ({ page }) => {
  const id = await openNote(page, NOTE_1.title);
  await page.getByRole("button", { name: "물어보기" }).click();
  const chips = page.getByRole("list", { name: "추천 질문" }).getByRole("button");
  await expect(chips.first()).toBeVisible();
  const ws = await workspaceId(page);
  const res = await page.request.get(`/api/v2/ask/suggestions?workspace_id=${ws}&scope_type=recording&scope_id=${id}`);
  expect(res.status()).toBe(200);
  const { suggestions } = (await res.json()) as { suggestions: string[] };
  expect(suggestions.length).toBeGreaterThan(0);
  await expect(chips).toHaveText(suggestions);
});
