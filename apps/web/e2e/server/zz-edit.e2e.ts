// Editing a carried-over (legacy-markdown) note on the real server (D-P2-2): the Markdown
// editor saves a new version that v1 clients see too, and a save over a newer version
// opens the conflict dialog. It changes note 1, so it runs in `server-late` after the
// tests that read that note (playwright.config.ts).

import type { Page } from "@playwright/test";
import { versionETag } from "@lectern/domain";
import { expect, test } from "../fixtures.ts";
import { E2E_LECTURES, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./accounts.ts";

test.describe.configure({ mode: "serial" });

const NOTE = E2E_LECTURES.find((l) => l.transcript)!;

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

interface DocumentWithVersion {
  document: { id: string };
  version: { version: number; rendered_md: string };
}

/** The note's recording id and its document, as the API reports them. */
async function noteDocument(page: Page): Promise<{ recordingId: string; doc: DocumentWithVersion }> {
  const me = await api<{ personal_workspace_id: string }>(page, "/api/v2/me");
  const list = await api<{ items: { id: string; title: string }[] }>(page, `/api/v2/recordings?workspace_id=${me.body.personal_workspace_id}&limit=200`);
  const recordingId = list.body.items.find((r) => r.title === NOTE.title)!.id;
  const detail = await api<{ documents: { id: string }[] }>(page, `/api/v2/recordings/${recordingId}`);
  const doc = await api<DocumentWithVersion>(page, `/api/v2/documents/${detail.body.documents[0]!.id}`);
  return { recordingId, doc: doc.body };
}

async function openEditor(page: Page, recordingId: string) {
  await page.goto(`/app/recordings/${recordingId}`);
  await expect(page.getByRole("heading", { level: 1, name: NOTE.title })).toBeVisible();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeVisible();
}

test("legacy note: a Markdown edit is a new version, for v1 clients too", async ({ page, axe }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  const { recordingId, doc } = await noteDocument(page);
  await openEditor(page, recordingId);
  const markdown = page.getByRole("textbox", { name: "Markdown 본문" });
  await expect(markdown).toHaveValue(doc.version.rendered_md);
  await expect(page.getByRole("region", { name: "미리보기" })).toBeVisible();
  await axe(page, "Markdown 편집 (서버)");

  const line = "- E2E 편집으로 덧붙인 줄";
  await markdown.fill(`${doc.version.rendered_md.trimEnd()}\n${line}\n`);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(`저장했습니다. 버전 ${doc.version.version + 1}`)).toBeVisible();
  await expect(page.getByText("직접 수정")).toBeVisible();

  const after = await api<DocumentWithVersion>(page, `/api/v2/documents/${doc.document.id}`);
  expect(after.body.version.version).toBe(doc.version.version + 1);
  expect(after.body.version.rendered_md).toContain(line);
  const lectures = await api<{ lectures: { id: string; title: string }[] }>(page, "/api/lectures");
  const lectureId = lectures.body.lectures.find((l) => l.title === NOTE.title)!.id;
  const lecture = await api<{ lecture: { markdown: string } }>(page, `/api/lectures/${lectureId}`);
  expect(lecture.body.lecture.markdown).toContain(line);
});

test("a save over a newer version opens the conflict dialog", async ({ page, context, axe }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  const { recordingId, doc } = await noteDocument(page);
  await openEditor(page, recordingId);
  const mine = `${doc.version.rendered_md.trimEnd()}\n- 내가 쓴 줄\n`;
  await page.getByRole("textbox", { name: "Markdown 본문" }).fill(mine);

  // Someone else saves first.
  const other = await page.request.post(`/api/v2/documents/${doc.document.id}/versions`, {
    headers: { "If-Match": versionETag(doc.version.version) },
    data: { markdown: "# 다른 곳\n\n다른 곳에서 먼저 저장한 글\n" },
  });
  expect(other.status()).toBe(201);

  await page.getByRole("button", { name: "저장", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "다른 곳에서 바뀌었습니다" });
  await expect(dialog).toBeVisible();
  await axe(page, "저장 충돌 (서버)");

  await dialog.getByRole("button", { name: "내 글 복사" }).click();
  await expect(page.getByText("내 글을 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mine);

  await dialog.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByText("최신 버전을 불러왔습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "문서 편집" })).toBeHidden();
  await expect(page.getByText("다른 곳에서 먼저 저장한 글")).toBeVisible();
});
