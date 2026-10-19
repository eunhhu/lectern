// The production build against the real server (e2e/server/start.ts): sign in with the
// existing cookie auth, see the workspace's recordings as /api/v2 returns them, open one,
// ask the notes (LECTERN_ASK=1, fake Gemini), and sign out. Endpoints that are still
// stubs (501) must show 준비 중, not errors. What the API returns is read through the same
// session (page.request), so the suite holds before and after the v2 backend lands.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

// Playwright runs specs under Node from apps/web (it empties test-results/ before each run).
const SHOTS = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), "test-results/screens");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });

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

interface Page_<T> {
  items: T[];
}
interface RecordingItem {
  id: string;
  title: string;
  status: string;
}

test("login: a visitor without a session lands on 로그인 and returns to the page they asked for", async ({ page, axe }) => {
  await page.goto("/app/library");
  await expect(page).toHaveURL(/\/app\/login\?next=/);
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  await axe(page, "로그인 (서버)");
  await shot(page, "01-login");

  await page.getByRole("textbox", { name: "이메일" }).fill(E2E_OWNER_EMAIL);
  await page.getByLabel("비밀번호").fill("not-the-password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("alert")).toContainText("올바르지 않습니다");
  await expect(page.getByLabel("비밀번호")).toHaveValue("");

  await page.getByLabel("비밀번호").fill(E2E_OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/app\/library$/);
  await expect(page.getByRole("grid", { name: "녹음 목록" })).toBeVisible();

  // Cookie-only auth: the session is HttpOnly and nothing token-like is kept by the page.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "lectern_session");
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("lectern_session");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/ses_|lct_|token/i);
});

test("library, recording, 물어보기 and sign-out over the real API", async ({ page, axe }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();

  // The library lists what /api/v2/recordings returns for the personal workspace.
  const me = await api<{ personal_workspace_id: string }>(page, "/api/v2/me");
  expect(me.status).toBe(200);
  const list = await api<Page_<RecordingItem>>(page, `/api/v2/recordings?workspace_id=${me.body.personal_workspace_id}&limit=200`);
  expect(list.status).toBe(200);
  expect(list.body.items.length).toBeGreaterThan(0);
  await page.getByRole("link", { name: "라이브러리" }).first().click();
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid).toBeVisible();
  for (const rec of list.body.items.slice(0, 5)) await expect(grid.getByText(rec.title, { exact: true }).first()).toBeVisible();
  await axe(page, "라이브러리 (서버)");
  await shot(page, "02-library");

  // A processed recording: document, transcript, and the player on the real audio clock.
  const ready = list.body.items.find((r) => r.status === "ready")!;
  await grid.getByText(ready.title, { exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: ready.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전사", level: 2 })).toBeVisible();
  const detail = await api<{ assets: { id: string; kind: string }[] }>(page, `/api/v2/recordings/${ready.id}`);
  const audio = detail.body.assets.find((a) => a.kind.startsWith("audio"));
  if (audio) {
    const probe = await page.request.get(`/api/v2/assets/${audio.id}/content`, { headers: { Range: "bytes=0-1" } });
    if (probe.status() === 206) {
      // The asset endpoint serves Range requests: playback moves the transcript.
      const play = page.getByRole("button", { name: "재생", exact: true });
      await expect(play).toBeEnabled();
      await play.click();
      await expect(page.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();
      await expect.poll(() => page.locator('input[aria-label="재생 위치"]').inputValue(), { timeout: 10_000 }).not.toBe("0");
      await page.getByRole("button", { name: "일시정지", exact: true }).click();
    } else {
      // Not served yet (501 while the blob store is missing): say so, keep the transcript usable.
      expect([501, 404]).toContain(probe.status());
      await expect(page.getByText("오디오 준비 중")).toBeVisible();
      await expect(page.getByRole("button", { name: "재생", exact: true })).toBeDisabled();
    }
  }
  await axe(page, "녹음 상세 (서버)");
  await shot(page, "03-recording");

  // 물어보기 over the notes the ask service indexed (the seeded v1 lectures).
  await page.goto("/app/ask");
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "질문" });
  await input.fill("기말시험 범위가 어디까지야?");
  await input.press("Enter");
  const conversation = page.getByRole("list", { name: "대화" });
  await expect(conversation.getByText("CBC 복호화 그림이 꼭 나온다", { exact: false }).first()).toBeVisible();
  const source = page.getByRole("link", { name: /^출처 1: 정보보호 7주차/ });
  await expect(source).toBeVisible();
  await expect(conversation.getByRole("button", { name: /^출처 1, 정보보호 7주차/ })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/ask\?thread=/);
  await expect(page.getByRole("navigation", { name: "대화 기록" }).getByRole("button", { name: /기말시험 범위가 어디까지야/ })).toHaveAttribute("aria-current", "true");
  await axe(page, "물어보기 (서버)");
  await shot(page, "04-ask");

  // Nothing in the notes: 근거 없음, not a guess.
  await input.fill("양자역학 중간고사는 언제야?");
  await input.press("Enter");
  await expect(page.getByText("관련 내용을 찾지 못했습니다", { exact: true })).toBeVisible();

  // The source opens its recording at the cited moment (a 404 page while the v2
  // recordings are still fixtures with other ids).
  const href = await source.getAttribute("href");
  const recordingId = /\/recordings\/([^?]+)/.exec(href ?? "")?.[1];
  expect(href).toMatch(/\?t=\d+/);
  await source.click();
  const target = await api(page, `/api/v2/recordings/${recordingId}`);
  if (target.status === 200) await expect(page.getByRole("heading", { level: 1, name: /정보보호 7주차/ })).toBeVisible();
  else await expect(page.getByText("녹음을 찾을 수 없습니다.")).toBeVisible();

  // A write the server does not offer yet answers 501: a calm 준비 중, not an error.
  await page.goto("/app/settings#account");
  await page.getByRole("textbox", { name: "이름" }).fill("E2E 새 이름");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText(/프로필을 저장했습니다\.|아직 준비 중인 기능입니다/).first()).toBeVisible();

  // Sign out: back to 로그인, and the app is closed until signing in again.
  await page.getByRole("button", { name: /데모 사용자|E2E/ }).last().click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await page.goto("/app/ask");
  await expect(page).toHaveURL(/\/app\/login\?next=/);
});

test("물어보기 is 준비 중 rather than broken when a request is refused", async ({ page }) => {
  await signIn(page, "/app/ask");
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
  // The same screen with the ask routes answering 501, as with LECTERN_ASK=0.
  await page.route("**/api/v2/ask/**", (route) =>
    route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ error: { code: "not_implemented", message: "아직 제공하지 않는 API입니다." } }) }),
  );
  await page.reload();
  await expect(page.getByText("물어보기는 아직 준비 중입니다").first()).toBeVisible();
  const input = page.getByRole("textbox", { name: "질문" });
  await input.fill("기말시험 범위가 어디까지야?");
  await input.press("Enter");
  await expect(page.getByRole("list", { name: "대화" }).getByText("물어보기는 아직 준비 중입니다")).toBeVisible();
  await shot(page, "05-ask-not-ready");
});
