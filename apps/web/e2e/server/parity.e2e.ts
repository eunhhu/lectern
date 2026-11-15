// v1 screen parity on the real server (docs/v2/pipeline/PARITY.md): the rows no other
// server spec covers. The library search keeps only the matching note, and a failed
// upload goes up again with the next 올리기; that temporary recording is then deleted.
// The two seeded notes are only read here.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";
import { wav } from "./wav.ts";

test.describe.configure({ mode: "serial" });

const NOTE_1 = E2E_LECTURES.find((l) => l.transcript)!;
const NOTE_2 = E2E_LECTURES.find((l) => l.title.startsWith("주간 제품 회의"))!;
const TEMP_TITLE = "E2E 재시도 녹음";

async function signIn(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

async function recordingTitles(page: Page): Promise<{ id: string; title: string }[]> {
  const me = (await (await page.request.get("/api/v2/me")).json()) as { personal_workspace_id: string };
  const list = (await (await page.request.get(`/api/v2/recordings?workspace_id=${me.personal_workspace_id}&limit=200`)).json()) as {
    items: { id: string; title: string }[];
  };
  return list.items;
}

test("search: the library search keeps only the notes whose title matches", async ({ page, axe }) => {
  await signIn(page);
  await page.goto("/app/library");
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid.getByText(NOTE_1.title)).toBeVisible();
  await expect(grid.getByText(NOTE_2.title)).toBeVisible();
  const search = page.getByRole("searchbox", { name: "제목으로 찾기" });
  await search.fill("블록 암호");
  await search.press("Enter");
  await expect(grid.getByText(NOTE_1.title)).toBeVisible();
  await expect(grid.getByText(NOTE_2.title)).toHaveCount(0);
  await axe(page, "라이브러리 검색");
});

test("upload retry: a failed upload goes up with the next 올리기, and the recording can be deleted", async ({ page, axe }) => {
  await signIn(page);
  await page.locator("body").press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles([{ name: `${TEMP_TITLE}.wav`, mimeType: "audio/wav", buffer: Buffer.from(wav(4)) }]);

  // The first try loses every part to a server error; the dialog stays open with the file.
  const fail = (route: { fulfill: (r: { status: number; contentType: string; body: string }) => Promise<void> }) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "unavailable", message: "잠시 뒤 다시 시도하세요.", request_id: "req_e2e" } }),
    });
  await page.route("**/api/v2/uploads/*/parts/*", fail);
  await dialog.getByRole("button", { name: "녹음 1개 올리기" }).click();
  await expect(page.getByText("0개를 올렸고 1개는 올리지 못했습니다.")).toBeVisible();
  await expect(dialog).toBeVisible();
  await axe(page, "올리기 실패");
  await page.unroute("**/api/v2/uploads/*/parts/*", fail);

  await dialog.getByRole("button", { name: "녹음 1개 올리기" }).click();
  await expect(page.getByText("녹음 1개를 올렸습니다.")).toBeVisible();
  await expect(dialog).toBeHidden();
  const uploaded = (await recordingTitles(page)).filter((r) => r.title === TEMP_TITLE);
  expect(uploaded).toHaveLength(1);

  // Delete the temporary recording from its page, as v1's 노트 삭제 did.
  await page.goto(`/app/recordings/${uploaded[0]!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: TEMP_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "녹음 작업" }).click();
  await page.getByRole("menuitem", { name: "삭제…", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "녹음 삭제" });
  await confirm.getByRole("textbox").fill("1");
  await confirm.getByRole("button", { name: "영구 삭제" }).click();
  await expect(page.getByText("녹음 1개를 삭제했습니다.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/library/);
  expect((await recordingTitles(page)).filter((r) => r.title === TEMP_TITLE)).toEqual([]);
  expect((await recordingTitles(page)).map((r) => r.title)).toEqual(expect.arrayContaining([NOTE_1.title, NOTE_2.title]));
});
