// The production build against the real server (e2e/server/start.ts): sign in with the
// existing cookie auth, see the workspace's recordings as /api/v2 returns them, open one,
// ask the notes (LECTERN_ASK=1, fake Gemini), and sign out. Endpoints that are still
// stubs (501) must show 준비 중, not errors. What the API returns is read through the same
// session (page.request), so the suite holds before and after the v2 backend lands.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, tabTo, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

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

test("library, recordings, 물어보기 and sign-out over the real API", async ({ page, axe }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();

  // /me is the account that signed in; the library lists what /api/v2/recordings returns.
  const me = await api<{ email: string; display_name: string; personal_workspace_id: string }>(page, "/api/v2/me");
  expect(me.status).toBe(200);
  expect(me.body.email).toBe(E2E_OWNER_EMAIL);
  await expect(page.getByRole("button", { name: new RegExp(me.body.display_name) }).last()).toBeVisible();
  const list = await api<Page_<RecordingItem>>(page, `/api/v2/recordings?workspace_id=${me.body.personal_workspace_id}&limit=200`);
  expect(list.status).toBe(200);
  expect(list.body.items.map((r) => r.title).sort()).toEqual(E2E_LECTURES.map((l) => l.title).sort());
  await page.getByRole("link", { name: "라이브러리" }).first().click();
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid).toBeVisible();
  for (const rec of list.body.items) await expect(grid.getByText(rec.title, { exact: true }).first()).toBeVisible();
  await axe(page, "라이브러리 (서버)");
  await shot(page, "02-library");

  // A carried-over lecture with a transcript: the Markdown note, real audio over Range,
  // and the transcript following the audio element's clock.
  const withTranscript = E2E_LECTURES.find((l) => l.transcript)!;
  const lecture = list.body.items.find((r) => r.title === withTranscript.title)!;
  const ranges: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v2/assets/") && req.headers().range) ranges.push(req.headers().range!);
  });
  await grid.getByText(lecture.title, { exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: lecture.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "운영 모드" })).toBeVisible();
  await expect(page.getByText("## 운영 모드")).toHaveCount(0);
  const segments = page.getByRole("list", { name: "전사" });
  await expect(segments.getByText(withTranscript.transcript![0]!.text)).toBeVisible();
  const play = page.getByRole("button", { name: "재생", exact: true });
  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();
  const position = page.getByRole("slider", { name: "재생 위치" });
  await expect.poll(async () => Number(await position.inputValue()), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect(segments.locator('[aria-current="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  expect(ranges.length, "the browser fetched the audio with Range requests").toBeGreaterThan(0);
  // A [MM:SS] mark of the note moves the player and the transcript there.
  await page.getByRole("button", { name: /^00:17로 이동/ }).click();
  await expect(position).toHaveValue("17");
  await expect(segments.locator('[aria-current="true"]')).toContainText("기말시험 범위는");
  await axe(page, "녹음 상세 (서버, 전사 있음)");
  await shot(page, "03-recording");

  // A carried-over lecture without a transcript (every v1 lecture): the panel says so.
  const plain = list.body.items.find((r) => r.id !== lecture.id)!;
  await page.goto(`/app/recordings/${plain.id}`);
  await expect(page.getByRole("heading", { level: 1, name: plain.title })).toBeVisible();
  await expect(page.getByText("이 노트에는 전사가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: /^00:06로 이동/ }).click();
  await expect(page.getByRole("slider", { name: "재생 위치" })).toHaveValue("6");
  await axe(page, "녹음 상세 (서버, 이전 노트)");
  await shot(page, "06-legacy-note");

  // 물어보기 over the same notes (indexed by the ask service).
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

  // The source opens the cited recording (its id is the v2 recording id) at that moment.
  expect(await source.getAttribute("href")).toBe(`/app/recordings/${lecture.id}?t=17000`);
  await source.click();
  await expect(page.getByRole("heading", { level: 1, name: lecture.title })).toBeVisible();
  await expect(page.getByRole("slider", { name: "재생 위치" })).toHaveValue("17");

  // Profile edits are real now.
  await page.goto("/app/settings#account");
  await page.getByRole("textbox", { name: "이름" }).fill("E2E 새 이름");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("프로필을 저장했습니다.")).toBeVisible();
  expect((await api<{ display_name: string }>(page, "/api/v2/me")).body.display_name).toBe("E2E 새 이름");

  // Sign out: back to 로그인, and the app is closed until signing in again.
  await page.getByRole("button", { name: /E2E 새 이름/ }).last().click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인" })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await page.goto("/app/ask");
  await expect(page).toHaveURL(/\/app\/login\?next=/);
});

test("folders and moves go through the real API", async ({ page }) => {
  await signIn(page, "/app/library");
  const grid = page.getByRole("grid", { name: "녹음 목록" });
  await expect(grid).toBeVisible();
  const me = await api<{ personal_workspace_id: string }>(page, "/api/v2/me");
  const ws = me.body.personal_workspace_id;

  // New folder, named in place (POST /folders, then PATCH /folders/{id}).
  const tree = page.getByRole("treegrid", { name: "폴더" });
  await page.getByRole("button", { name: "새 폴더" }).click();
  const name = page.getByRole("textbox", { name: "폴더 이름" });
  await expect(name).toBeFocused();
  await name.fill("E2E 보관함");
  await name.press("Enter");
  await expect(tree.getByRole("row", { name: "E2E 보관함" })).toBeVisible();
  const folders = await api<Page_<{ id: string; name: string }>>(page, `/api/v2/folders?workspace_id=${ws}`);
  const folder = folders.body.items.find((f) => f.name === "E2E 보관함")!;
  expect(folder).toBeTruthy();

  // Select a recording with the keyboard and move it there (PATCH /recordings/{id}).
  const target = (await api<Page_<RecordingItem>>(page, `/api/v2/recordings?workspace_id=${ws}&limit=200`)).body.items[0]!;
  await grid.getByRole("row", { name: new RegExp(target.title) }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("toolbar", { name: "선택한 녹음 작업" }).getByText("1개 선택됨")).toBeVisible();
  await tabTo(page, "폴더로 이동…");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /폴더로 이동/ })).toBeVisible();
  await tabTo(page, /폴더/);
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "E2E 보관함", exact: true }).press("Enter");
  await tabTo(page, "이동");
  await page.keyboard.press("Enter");
  await expect(page.getByText("녹음 1개를 ‘E2E 보관함’ 폴더로 옮겼습니다.")).toBeVisible();
  await expect
    .poll(async () => (await api<{ recording: { folder_id: string | null } }>(page, `/api/v2/recordings/${target.id}`)).body.recording.folder_id)
    .toBe(folder.id);
});

test("the player says 오디오 준비 중 when the asset bytes are not served", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  await page.route("**/api/v2/assets/*/content", (route) =>
    route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ error: { code: "not_implemented", message: "아직 제공하지 않는 API입니다." } }) }),
  );
  const me = await api<{ personal_workspace_id: string }>(page, "/api/v2/me");
  const list = await api<Page_<RecordingItem>>(page, `/api/v2/recordings?workspace_id=${me.body.personal_workspace_id}&limit=200`);
  const ready = list.body.items.find((r) => r.status === "ready")!;
  await page.goto(`/app/recordings/${ready.id}`);
  await expect(page.getByText("오디오 준비 중")).toBeVisible();
  await expect(page.getByRole("button", { name: "재생", exact: true })).toBeDisabled();
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
