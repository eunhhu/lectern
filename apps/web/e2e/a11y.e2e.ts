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
  { path: "/app/search?q=퀀텀", label: "검색", ready: /^PDF \d+$/ },
  { path: "/app/ask", label: "물어보기", ready: "노트에 물어보세요" },
  { path: "/app/ask?thread=ask_seed_os07", label: "물어보기 대화", ready: "다음 CPU 버스트 길이를 미리 알 수 없기 때문이다." },
  { path: "/app/calendar", label: "일정", ready: "연결 설정" },
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
  // 원문 transcript, then the files panel with its events and to-dos.
  await page.getByRole("radio", { name: "원문" }).click();
  await axe(page, "회의 상세 (원문 전사)");
  await page.getByRole("button", { name: "자료" }).click();
  await page.getByRole("tab", { name: "일정·할 일" }).click();
  await expect(page.getByRole("tabpanel").getByText("QA 체크리스트 정리")).toBeVisible();
  await axe(page, "회의 상세");
});

test("settings integrations and reminders have no axe violations", async ({ page, axe }) => {
  await page.goto("/app/settings?fixture-integration=needs_reauth#integrations");
  await expect(page.getByText("Google 연결이 만료되었습니다.", { exact: false })).toBeVisible();
  await page.locator("#reminders").locator("label", { hasText: "일정과 할 일 마감을 이메일로 알려 주기" }).click();
  await expect(page.locator("#reminders").getByRole("button", { name: /알림 시각/ })).toBeVisible();
  await page.locator("#integrations").getByRole("button", { name: "구독 주소 만들기" }).click();
  await expect(page.getByLabel("구독 주소", { exact: true })).toBeVisible();
  await axe(page, "설정 연동·알림");
  await page.goto("/app/settings?fixture-integration=active#integrations");
  await page.locator("#integrations").getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await axe(page, "연결 해제 확인");
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

test("new screens and states have no axe violations", async ({ page, axe }) => {
  // Calendar: month, then week.
  await page.goto("/app/calendar");
  await expect(page.getByRole("grid", { name: /일정 달력/ })).toBeVisible();
  await axe(page, "일정 (월)");
  await page.getByRole("tab", { name: "주" }).click();
  await expect(page.getByRole("button", { name: "다음 주" })).toBeVisible();
  await axe(page, "일정 (주)");

  // Library: folder menu open, then a folder being renamed, then the tag menu.
  await page.goto("/app/library");
  await page.getByRole("button", { name: "운영체제 폴더 작업" }).click();
  await expect(page.getByRole("menuitem", { name: /이름 바꾸기/ })).toBeVisible();
  await axe(page, "폴더 메뉴");
  await page.getByRole("menuitem", { name: /이름 바꾸기/ }).click();
  await expect(page.getByRole("textbox", { name: "폴더 이름" })).toBeFocused();
  await axe(page, "폴더 이름 바꾸기");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "과제 태그 작업" }).click();
  await expect(page.getByRole("menuitemradio", { name: /주황/ })).toBeVisible();
  await axe(page, "태그 메뉴");
  await page.keyboard.press("Escape");

  // User menu.
  await page.getByRole("button", { name: /미리보기 사용자/ }).click();
  await expect(page.getByRole("menuitem", { name: "프로필과 계정" })).toBeVisible();
  await axe(page, "사용자 메뉴");
});

test("a carried-over v1 note: Markdown drawn as a document, [MM:SS] marks move the player", async ({ page, axe }) => {
  await page.goto("/app/recordings/rec_legacy_sec07");
  await expect(page.getByRole("heading", { level: 1, name: "정보보호 7주차 — 블록 암호 운영 모드" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "운영 모드 비교" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "오류 전파" })).toBeVisible();
  await expect(page.getByText("이 노트에는 전사가 없습니다.")).toBeVisible();
  // No raw Markdown on screen.
  await expect(page.getByText("## 시험")).toHaveCount(0);
  await page.getByRole("button", { name: /^1:02:40로 이동/ }).click();
  await expect(page.getByRole("slider", { name: "재생 위치" })).toHaveValue("3760");
  await axe(page, "이전 노트 (legacy-markdown)");
  await page.screenshot({ path: "test-results/screens/fixture-legacy-note.png" });
});

test("settings account has no axe violations", async ({ page, axe }) => {
  await page.goto("/app/settings#tokens");
  await expect(page.locator("#tokens").getByText("API 토큰")).toBeVisible();
  await expect(page.locator("#identities").getByRole("button", { name: "연결 해제: Google" })).toBeVisible();
  await axe(page, "설정 계정");
  await page.locator("#tokens").getByRole("button", { name: "새 토큰" }).click();
  const tokenDialog = page.getByRole("dialog", { name: "새 토큰" });
  await axe(page, "새 토큰");
  await tokenDialog.getByLabel("이름").fill("axe");
  await tokenDialog.getByRole("button", { name: "만들기" }).click();
  await expect(tokenDialog.getByLabel("토큰", { exact: true })).toBeVisible();
  await axe(page, "새 토큰 원문");
  await tokenDialog.getByRole("button", { name: "완료" }).click();
  await page.locator("#delete-account").getByRole("button", { name: "계정 삭제 요청" }).click();
  await expect(page.getByRole("alertdialog", { name: "계정 삭제 요청" })).toBeVisible();
  await axe(page, "계정 삭제 요청");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "계정 삭제 요청 (다크)");
});

test("login with oauth buttons has no axe violations", async ({ page, axe }) => {
  await page.goto("/app/login?fixture-session=none&error=oauth");
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
  await axe(page, "로그인(Google·Apple)");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "로그인(Google·Apple) (다크)");
  await page.getByRole("link", { name: "회원가입" }).click();
  await expect(page.getByRole("button", { name: "Apple로 계속하기" })).toBeVisible();
  await axe(page, "회원가입(Google·Apple) (다크)");
});

test("workspace settings have no axe violations", async ({ page, axe }) => {
  await page.addInitScript(() => localStorage.setItem("lectern.web.workspace", "ws_team"));
  await page.goto("/app/settings?fixture-role=owner#members");
  await expect(page.locator("#members").getByRole("row", { name: /한지민/ })).toBeVisible();
  await expect(page.locator("#invites").getByText("newcomer@example.com")).toBeVisible();
  await expect(page.locator("#usage").getByRole("progressbar")).toHaveCount(3);
  await axe(page, "워크스페이스 설정");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "워크스페이스 설정 (다크)");
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator("#members").getByRole("button", { name: "내보내기: 윤서아" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await axe(page, "멤버 내보내기 확인");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "멤버 내보내기 확인 (다크)");
});

test("invite page has no axe violations", async ({ page, axe }) => {
  await page.goto("/app/invite?token=wrong-account");
  await expect(page.getByRole("heading", { level: 1, name: "워크스페이스 초대를 받았습니다." })).toBeVisible();
  await axe(page, "초대 수락");
  await page.getByRole("button", { name: "초대 수락" }).click();
  await expect(page.getByRole("button", { name: "다른 계정으로 로그인" })).toBeVisible();
  await axe(page, "초대 수락 오류");
  await page.emulateMedia({ colorScheme: "dark" });
  await axe(page, "초대 수락 오류 (다크)");
});

test("admin overview/users/jobs/job detail/usage have no axe violations", async ({ page, axe }) => {
  const screens: { path: string; label: string; ready: string }[] = [
    { path: "/app/admin", label: "관리 개요", ready: "전체 사용자" },
    { path: "/app/admin/users", label: "관리 사용자", ready: "seoa@example.com" },
    { path: "/app/admin/jobs", label: "관리 작업", ready: "시스템" },
    { path: "/app/admin/jobs/job_fx_01", label: "관리 작업 상세", ready: "verify_failed" },
    { path: "/app/admin/usage", label: "관리 사용량", ready: "ws_lab" },
  ];
  for (const screen of screens) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(screen.path);
    await expect(page.getByText(screen.ready).first()).toBeVisible();
    await axe(page, screen.label);
    await page.emulateMedia({ colorScheme: "dark" });
    await axe(page, `${screen.label} (다크)`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "한도 설정: 제품팀" }).click();
  await expect(page.getByRole("textbox", { name: "월 녹음 시간(시간)" })).toHaveValue("20");
  await axe(page, "한도 설정");
  await page.goto("/app/admin/users");
  await page.getByRole("button", { name: "삭제: sehun@example.com" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await axe(page, "사용자 삭제 확인");
});
