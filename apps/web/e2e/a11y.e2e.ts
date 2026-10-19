// axe (WCAG 2.2 AA) on the core screens, in both themes, with overlays open.

import { expect, test } from "./fixtures.ts";

const SCREENS: { path: string; label: string; ready: string | RegExp }[] = [
  { path: "/app/", label: "홈", ready: "확인할 일정 제안" },
  { path: "/app/library", label: "라이브러리", ready: "모든 녹음" },
  { path: "/app/library?folder=fld_os", label: "라이브러리 폴더", ready: "2026년 2학기 / 운영체제" },
  { path: "/app/library?view=attention", label: "라이브러리 스마트 보기", ready: "확인 필요" },
  { path: "/app/recordings/rec_os07", label: "녹음 상세(긴 강의)", ready: "핵심 요약" },
  { path: "/app/recordings/rec_ds04", label: "녹음 상세(일부 완료)", ready: "일부 구간을 전사하지 못했습니다." },
  { path: "/app/recordings/rec_os08", label: "녹음 상세(처리 중)", ready: /전사 중/ },
  { path: "/app/recordings/rec_test", label: "녹음 상세(실패)", ready: "이 녹음을 처리하지 못했습니다." },
  { path: "/app/review", label: "복습", ready: "복습할 카드가 아직 없습니다." },
  { path: "/app/calendar", label: "일정", ready: "확정한 일정이 아직 없습니다." },
  { path: "/app/settings", label: "설정", ready: "한 글자 단축키 사용" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const screen of SCREENS) {
      test(`${screen.label} has no axe violations`, async ({ page, axe }) => {
        await page.goto(screen.path);
        await expect(page.getByText(screen.ready).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", "ko");
        await axe(page, `${screen.label} (${scheme})`);
      });
    }
  });
}

test("the team workspace meeting view has no axe violations", async ({ page, axe }) => {
  await page.addInitScript(() => localStorage.setItem("lectern.web.workspace", "ws_team"));
  await page.goto("/app/recordings/rec_tw42");
  await expect(page.getByRole("heading", { name: "결정 사항" })).toBeVisible();
  await page.getByRole("tab", { name: "일정·할 일" }).click();
  await expect(page.getByRole("tabpanel").getByText("QA 체크리스트 정리")).toBeVisible();
  await axe(page, "회의 상세");
});

test("overlays have no axe violations", async ({ page, axe }) => {
  await page.goto("/app/library");
  await expect(page.getByText("모든 녹음").first()).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "명령 팔레트" })).toBeVisible();
  await page.keyboard.type("ㅇㅇㅊㅈ");
  await expect(page.getByRole("menuitem", { name: /운영체제 7주차/ })).toBeVisible();
  await axe(page, "명령 팔레트");
  await page.keyboard.press("Escape");

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "단축키" })).toBeVisible();
  await axe(page, "단축키");
  await page.keyboard.press("Escape");

  await page.keyboard.press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "파일 선택" }).click();
  await (await chooser).setFiles([
    { name: "운영체제 9주차.m4a", mimeType: "audio/mp4", buffer: Buffer.alloc(4000) },
    { name: "자료구조 7주차.m4a", mimeType: "audio/mp4", buffer: Buffer.alloc(3000) },
    { name: "운영체제_9주차_교안.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(900) },
    { name: "참고문헌.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(500) },
    { name: "메모.docx", mimeType: "application/octet-stream", buffer: Buffer.alloc(100) },
  ]);
  await expect(dialog.getByText("녹음 2개", { exact: true })).toBeVisible();
  await axe(page, "업로드 대화상자");
});

test("library bulk delete confirmation has no axe violations", async ({ page, axe }) => {
  await page.goto("/app/library");
  await page.getByRole("row", { name: "녹음 테스트" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("toolbar").getByRole("button", { name: "삭제…" }).click();
  await expect(page.getByRole("alertdialog", { name: "녹음 삭제" })).toBeVisible();
  await axe(page, "삭제 확인");
});
