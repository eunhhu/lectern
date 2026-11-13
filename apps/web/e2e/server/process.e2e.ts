// The v2 pipeline end to end on the real server (e2e/server/start.ts): with
// LECTERN_PIPELINE=v2 and a job worker turned on through the e2e-only control route, an
// uploaded recording is transcribed and turned into a structured document by the fake
// Gemini, and a source chip in that document jumps the player to the cited transcript.
// It runs after the rest of the server suite (playwright.config.ts `server-late`), so the
// pipeline switch never touches the other tests.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";
import { wav } from "./wav.ts";

test.describe.configure({ mode: "serial" });

const AI_TITLE = "블록 암호 운영 모드 강의";
const FILE_TITLE = "E2E 처리 녹음";

async function signIn(page: Page, path = "/app/") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
}

async function api<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  const res = await page.request.get(path);
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

interface RecordingItem {
  id: string;
  title: string;
  status: string;
}

test.afterAll(async ({ request }) => {
  await request.post("/__e2e/pipeline", { data: { mode: "v1" } });
});

test("v2 pipeline: upload → transcript → document → source jump", async ({ page, request, axe }) => {
  const info = (await (await request.get("/__e2e/info")).json()) as { ffmpeg: boolean };
  test.skip(!info.ffmpeg, "ffmpeg가 없어 처리 파이프라인을 돌릴 수 없습니다.");
  test.setTimeout(150_000);
  expect((await request.post("/__e2e/pipeline", { data: { mode: "v2" } })).status()).toBe(200);

  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await page.locator("body").press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles([{ name: `${FILE_TITLE}.wav`, mimeType: "audio/wav", buffer: Buffer.from(wav(20)) }]);
  await dialog.getByRole("button", { name: "녹음 1개 올리기" }).click();
  await expect(page.getByText("녹음 1개를 올렸습니다.")).toBeVisible();

  // process: transcript → notes → index, on the worker the control route started.
  const me = await api<{ personal_workspace_id: string }>(page, "/api/v2/me");
  const listPath = `/api/v2/recordings?workspace_id=${me.body.personal_workspace_id}&limit=200`;
  let recording: RecordingItem | undefined;
  await expect
    .poll(
      async () => {
        const list = await api<{ items: RecordingItem[] }>(page, listPath);
        recording = list.body.items.find((r) => r.title === AI_TITLE || r.title === FILE_TITLE);
        return recording?.status;
      },
      { timeout: 90_000, intervals: [500, 1000] },
    )
    .toBe("ready");

  await page.goto(`/app/recordings/${recording!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: recording!.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "핵심 요약" })).toBeVisible();
  await expect(page.getByText("ECB 모드는 같은 평문 블록을 같은 암호문으로 바꿉니다.").first()).toBeVisible();
  const source = page.getByRole("button", { name: /^출처 1, / }).first();
  await expect(source).toBeVisible();

  // A source chip moves playback and highlights the cited transcript segment.
  await source.click();
  await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator("[data-highlight]").first()).toBeVisible();
  await axe(page, "v2 처리 녹음 상세 (서버)");
});
