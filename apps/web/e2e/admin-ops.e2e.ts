// 관리 › 저장소·운영·설정·감사 로그, 개요의 확인 필요와 콘솔 껍데기 (P5-13) on the fixture
// build. The fixture's me is the service owner. Storage: 35 recordings can be compacted, 17
// done lectures are past the 14-day audio retention and one failed lecture past the 14-day
// failed retention, four orphan files, two files in the trash. Ops: three backups (the
// newest two days old), one v1 job running (정보보호 4주차, 40%), one queued, eight
// finished (one failed). 64 audit log rows. `?fixture-admin=trouble` adds a low disk, no
// ffmpeg, a maintenance error and a failed deploy; `?fixture-admin=unavailable` fails the
// first two reads of each screen. The fixture starts over on a reload.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const bodyRows = (page: Page, caption: string) => page.getByRole("table", { name: caption }).locator("tbody tr");
const stat = (page: Page, table: string, row: string) => page.getByRole("table", { name: table }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: row, exact: true }) });
// A select's name is its value, then its label.
const select = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(` ${label}$`) });

test("storage: compaction asks first", async ({ page }) => {
  await page.goto("/app/admin/storage");
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 0");
  await page.getByRole("button", { name: "전체 압축" }).click();
  const dialog = page.getByRole("dialog", { name: "전체 압축" });
  await expect(dialog.getByRole("table", { name: "압축 대상" })).toContainText("35개");
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  // Only the preview went out: nothing was queued.
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 0");

  await page.getByRole("button", { name: "전체 압축" }).click();
  await page.getByRole("dialog", { name: "전체 압축" }).getByRole("button", { name: "압축 시작" }).click();
  await expect(page.getByText("35개 녹음을 압축 대기열에 추가했습니다.")).toBeVisible();
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 35");
  // One real request: one audit row for it.
  await page.getByRole("link", { name: "감사 로그", exact: true }).click();
  await page.getByRole("searchbox", { name: "검색" }).fill("오디오 압축 35건");
  await expect(page).toHaveURL(/q=/);
  await expect(bodyRows(page, "감사 로그")).toHaveCount(1);
});

test("storage: retention runs after a preview", async ({ page }) => {
  await page.goto("/app/admin/storage");
  await expect(page.getByText("17개 · 524 MB · 14일 경과, 노트는 유지")).toBeVisible();
  await page.getByRole("button", { name: "정리: 보존 기간이 지난 오디오" }).click();
  const dialog = page.getByRole("alertdialog", { name: "보존 정책 적용" });
  const targets = dialog.getByRole("table", { name: "보존 정책 대상" });
  await expect(targets).toContainText("17개");
  await expect(targets.getByRole("row").filter({ hasText: "실패한 강의" })).toContainText("1개");
  await dialog.getByRole("button", { name: "영구 삭제" }).click();
  await expect(page.getByText(/보존 정책을 적용했습니다\. 18개 정리, .+ 확보\./)).toBeVisible();
  await expect(page.getByText(/^0개 · 0 B · 14일 경과/)).toBeVisible();
  await expect(page.getByRole("button", { name: "정리: 보존 기간이 지난 오디오" })).toBeDisabled();
});

test("storage: orphans go to the trash", async ({ page }) => {
  await page.goto("/app/admin/storage");
  await expect(page.getByText(/^2개 · 9 MB · 7일 후 자동 삭제/)).toBeVisible();
  await page.getByRole("button", { name: "휴지통으로 이동" }).click();
  const dialog = page.getByRole("dialog", { name: "고아 파일을 휴지통으로 이동" });
  await expect(dialog.getByRole("list", { name: "파일 이름" })).toContainText("a1f3c9e2-orphan.webm");
  await dialog.getByRole("button", { name: "휴지통으로 이동" }).click();
  await expect(page.getByText("고아 파일 4개를 휴지통으로 옮겼습니다.")).toBeVisible();
  await expect(page.getByText(/^6개 · 47 MB · 7일 후 자동 삭제/)).toBeVisible();
  await expect(page.getByRole("button", { name: "휴지통으로 이동" })).toBeDisabled();
});

test("storage: breakdowns and the largest recordings", async ({ page }) => {
  await page.goto("/app/admin/storage");
  const cards = page.getByRole("list", { name: "저장소 수치" });
  await expect(cards.getByRole("listitem").filter({ hasText: "디스크" })).toContainText("41 GB 여유");
  await expect(cards.getByRole("listitem").filter({ hasText: "압축으로 절약" })).toContainText("12개 녹음 압축됨");
  await expect(stat(page, "압축", "비트레이트")).toContainText("40 kbps · 녹음 1시간당 약 18 MB");
  const formats = page.getByRole("list", { name: "형식별 용량" });
  for (const f of ["WEBM", "MP3", "M4A"]) await expect(formats).toContainText(f);
  await expect(page.getByRole("list", { name: "상태별 용량" }).getByRole("listitem").filter({ hasText: "오류" })).toContainText("3개");
  await expect(page.getByRole("list", { name: "사용자별 용량" }).getByRole("listitem").first()).toContainText("31개 · 948 MB · 22%");

  const largest = bodyRows(page, "가장 큰 녹음");
  await expect(largest).toHaveCount(20);
  const first = (await largest.first().getByRole("link").first().textContent()) ?? "";
  await largest.first().getByRole("button", { name: /^오디오 삭제:/ }).click();
  const ask = page.getByRole("alertdialog", { name: "오디오 삭제" });
  await expect(ask).toContainText("영구 삭제");
  await ask.getByRole("button", { name: "오디오 삭제" }).click();
  await expect(page.getByText(/오디오를 삭제했습니다\. .+ 확보\./)).toBeVisible();
  await expect(largest.first()).not.toContainText(first);

  await page.getByRole("list", { name: "사용자별 용량" }).getByRole("link", { name: "한지민" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "한지민" })).toBeVisible();
});

test("ops: run maintenance", async ({ page }) => {
  await page.goto("/app/admin/ops");
  await expect(stat(page, "유지보수", "요약")).toContainText("세션 2 · 고아 파일 0 · 보존 0");
  await expect(stat(page, "유지보수", "마지막 실행")).toContainText("50분 전");
  await page.getByRole("button", { name: "유지보수 지금 실행" }).click();
  const ask = page.getByRole("dialog", { name: "유지보수 실행" });
  await expect(ask.getByRole("listitem")).toHaveCount(4);
  await ask.getByRole("button", { name: "실행" }).click();
  const done = page.getByRole("dialog", { name: "유지보수 완료" });
  const result = done.getByRole("table", { name: "유지보수 결과" });
  await expect(result.getByRole("row").filter({ hasText: "고아 파일 → 휴지통" })).toContainText("4개");
  await expect(result.getByRole("row").filter({ hasText: "백업" })).toContainText("lectern-");
  await done.getByRole("button", { name: "닫기" }).first().click();
  await expect(done).toHaveCount(0);
  await expect(stat(page, "유지보수", "마지막 실행")).toContainText("방금 전");
  await expect(stat(page, "유지보수", "요약")).toContainText("세션 1 · 고아 파일 4 · 보존 0");
  await expect(stat(page, "백업", "보관")).toContainText("4개 보관 중 (최대 7개)");
});

test("ops: backups", async ({ page }) => {
  await page.goto("/app/admin/ops");
  await expect(stat(page, "백업", "최신 백업")).toContainText(/lectern-\d{4}-\d{2}-\d{2}\.sqlite/);
  await expect(stat(page, "백업", "크기")).toContainText("44 MB");
  await expect(stat(page, "백업", "만든 시각")).toContainText("2일 전");
  await expect(stat(page, "백업", "보관")).toContainText("3개 보관 중 (최대 7개)");
});

test("ops: server, database, deploy and the v1 queue", async ({ page }) => {
  await page.goto("/app/admin/ops");
  await expect(stat(page, "배포", "결과")).toContainText("성공");
  await expect(stat(page, "배포", "커밋")).toHaveText(/커밋\s*f00dfee/);
  await expect(stat(page, "서버", "ffmpeg")).toContainText("사용 가능");
  await expect(stat(page, "서버", "요청")).toContainText("18,204 (5xx 3)");
  await expect(stat(page, "서버", "가동 시간")).toContainText("72시간");
  await expect(stat(page, "데이터베이스", "사용자")).toContainText("5");
  await expect(stat(page, "데이터베이스", "크기")).toContainText("48 MB (WAL 3.2 MB)");

  const numbers = page.getByRole("list", { name: "v1 작업 수치" });
  await expect(numbers.getByRole("listitem").filter({ hasText: "실행 중" })).toContainText("노트 2 · 압축 1");
  await expect(numbers.getByRole("listitem").filter({ hasText: "24시간 완료" })).toContainText("7실패 1");
  await expect(bodyRows(page, "실행 중인 v1 작업")).toHaveCount(1);
  await expect(bodyRows(page, "실행 중인 v1 작업").first()).toContainText("정보보호 4주차");
  await expect(bodyRows(page, "실행 중인 v1 작업").first()).toContainText("40%");
  await expect(bodyRows(page, "대기 중인 v1 작업")).toHaveCount(1);
  const recent = bodyRows(page, "최근 완료된 v1 작업");
  await expect(recent).toHaveCount(8);
  await expect(recent.filter({ hasText: "실패" })).toContainText("Gemini 응답이 비어 있습니다.");
  await bodyRows(page, "실행 중인 v1 작업").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/admin\/recordings\/lec_fx_03$/);
});

test("ops refreshes by itself", async ({ page }) => {
  // The fixture finishes a compaction three seconds after it is queued. Nothing is pressed
  // on 운영, so only its five-second refresh can show the queue drain.
  await page.goto("/app/admin/storage");
  await page.getByRole("button", { name: "전체 압축" }).click();
  await page.getByRole("dialog", { name: "전체 압축" }).getByRole("button", { name: "압축 시작" }).click();
  await expect(page.getByText("35개 녹음을 압축 대기열에 추가했습니다.")).toBeVisible();
  await page.getByRole("link", { name: "운영", exact: true }).click();
  await expect(bodyRows(page, "대기 중인 v1 작업")).toHaveCount(36);
  await expect(bodyRows(page, "대기 중인 v1 작업")).toHaveCount(1, { timeout: 15_000 });
  await expect(bodyRows(page, "최근 완료된 v1 작업").filter({ hasText: "압축" }).first()).toBeVisible();
});

test("새로고침 reads the admin answers again", async ({ page }) => {
  // 저장소 does not refresh by itself: the finished compactions show only after 새로고침.
  await page.goto("/app/admin/storage");
  await page.getByRole("button", { name: "전체 압축" }).click();
  await page.getByRole("dialog", { name: "전체 압축" }).getByRole("button", { name: "압축 시작" }).click();
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 35");
  await page.waitForTimeout(3_500);
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 35");
  await page.getByRole("navigation", { name: "관리 메뉴" }).getByRole("button", { name: "새로고침" }).click();
  await expect(page.getByText("새로고침했습니다.")).toBeVisible();
  await expect(stat(page, "압축", "진행 상황")).toContainText("대기 0");
  await expect(page.getByRole("list", { name: "저장소 수치" }).getByRole("listitem").filter({ hasText: "압축으로 절약" })).toContainText("47개 녹음 압축됨");
});

test("recording job box", async ({ page }) => {
  await page.goto("/app/admin/recordings/lec_fx_03");
  const box = page.getByRole("region", { name: "진행 중 작업" });
  await expect(box).toContainText("노트 생성 · 실행 중");
  await expect(box).toContainText("40%");
  await page.goto("/app/admin/recordings/lec_fx_05");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "진행 중 작업" })).toHaveCount(0);
});

test("settings: saving sends only the form", async ({ page }) => {
  await page.goto("/app/admin/settings");
  const save = page.getByRole("button", { name: "저장", exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: "되돌리기" })).toHaveCount(0);

  // All ten settings.
  await page.getByRole("switch", { name: "공개 회원가입 허용" }).press("Space");
  await page.getByRole("switch", { name: "가입 시 관리자 승인 필요" }).press("Space");
  await select(page, "기본 역할").click();
  await page.getByRole("option", { name: "보기 전용" }).click();
  await page.getByRole("switch", { name: "서버 AI 키로 노트 만들기 기본 허용" }).press("Space");
  await page.getByRole("textbox", { name: "기본 오디오 한도(MB)" }).fill("1024");
  await page.getByRole("switch", { name: "자동 압축" }).press("Space");
  await select(page, "압축 비트레이트").click();
  await page.getByRole("option", { name: "64 kbps" }).click();
  await expect(page.getByText("녹음 1시간당 약 28.8 MB", { exact: false })).toBeVisible();
  await page.getByRole("switch", { name: /^완료된 강의의 오디오/ }).press("Space");
  await expect(page.getByRole("textbox", { name: "완료된 강의의 오디오 보존 일수" })).toBeDisabled();
  await page.getByRole("textbox", { name: "실패한 강의 보존 일수" }).fill("7");
  await page.getByRole("textbox", { name: "감사 로그 보존 일수" }).fill("400");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();
  await expect(save).toBeDisabled();

  // The server has them: new users start from the saved defaults, and the change is logged.
  await page.getByRole("link", { name: "사용자", exact: true }).click();
  await page.getByRole("button", { name: "새 사용자" }).click();
  const dialog = page.getByRole("dialog", { name: "새 사용자" });
  await expect(dialog.getByRole("textbox", { name: "오디오 저장 한도(MB)" })).toHaveValue("1024");
  await expect(dialog.getByRole("button", { name: / 역할$/ })).toContainText("보기 전용");
  await dialog.getByRole("button", { name: "취소" }).click();
  await page.getByRole("link", { name: "감사 로그", exact: true }).click();
  await expect(bodyRows(page, "감사 로그").first()).toContainText("감사로그보존=400일");

  await page.getByRole("link", { name: "설정", exact: true }).last().click();
  await expect(page.getByRole("switch", { name: "공개 회원가입 허용" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "가입 시 관리자 승인 필요" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "자동 압축" })).not.toBeChecked();
  await expect(select(page, "압축 비트레이트")).toContainText("64 kbps");
  await expect(page.getByRole("switch", { name: /^완료된 강의의 오디오/ })).not.toBeChecked();
  await expect(page.getByRole("textbox", { name: "실패한 강의 보존 일수" })).toHaveValue("7");
  await expect(page.getByRole("textbox", { name: "감사 로그 보존 일수" })).toHaveValue("400");
});

test("settings: revert and ⌘Enter", async ({ page }) => {
  await page.goto("/app/admin/settings");
  const quota = page.getByRole("textbox", { name: "기본 오디오 한도(MB)" });
  await quota.fill("512");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(quota).toHaveValue("2048");
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await quota.fill("3000");
  await quota.press("ControlOrMeta+Enter");
  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();
  await expect(quota).toHaveValue("3000");
});

test("settings: leaving with changes asks", async ({ page }) => {
  await page.goto("/app/admin/settings");
  const days = page.getByRole("textbox", { name: "감사 로그 보존 일수" });
  await days.fill("90");
  await page.getByRole("link", { name: "감사 로그", exact: true }).click();
  const ask = page.getByRole("alertdialog", { name: "저장하지 않은 변경" });
  await ask.getByRole("button", { name: "계속 수정" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/admin\/settings$/);
  await expect(days).toHaveValue("90");
  await page.getByRole("link", { name: "감사 로그", exact: true }).click();
  await page.getByRole("alertdialog", { name: "저장하지 않은 변경" }).getByRole("button", { name: "버리고 떠나기" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/audit$/);
});

test("audit: filter and more", async ({ page }) => {
  await page.goto("/app/admin/audit");
  const rows = bodyRows(page, "감사 로그");
  await expect(page.getByText("64건")).toBeVisible();
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "더 보기 (14건 남음)" }).click();
  await expect(rows).toHaveCount(64);
  await expect(page.getByText("모든 기록을 표시했습니다.")).toBeVisible();

  await select(page, "분류").click();
  await page.getByRole("option", { name: /^저장소/ }).click();
  await expect(page).toHaveURL(/action=storage/);
  await expect(rows.first()).toContainText("storage.");
  for (const row of await rows.all()) await expect(row).toContainText("storage.");
  await page.getByRole("searchbox", { name: "검색" }).fill("휴지통");
  await expect(page).toHaveURL(/q=/);
  for (const row of await rows.all()) await expect(row).toContainText("storage.gc");
  await page.reload();
  await expect(select(page, "분류")).toContainText("저장소");
  await expect(page.getByRole("searchbox", { name: "검색" })).toHaveValue("휴지통");
});

test("audit: a row opens its details", async ({ page }) => {
  await page.goto("/app/admin/audit?action=admin");
  await page.getByRole("button", { name: /^자세히: admin\.user_update/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "감사 로그" });
  const facts = dialog.getByRole("table", { name: "감사 로그 항목" });
  await expect(facts).toContainText("admin.user_update");
  await expect(facts).toContainText(/audlog_fx_\d+/);
  await expect(dialog).toContainText("역할 member → viewer");
  await facts.getByRole("link", { name: "dohyun@example.com" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "최도현" })).toBeVisible();
});

test("overview: attention items", async ({ page }) => {
  await page.goto("/app/admin");
  const items = page.getByRole("list", { name: /^확인 필요/ });
  await expect(items.getByRole("listitem").filter({ hasText: "가입 승인 대기" })).toContainText("윤서아");
  await expect(items.getByRole("button", { name: /^재시도:/ })).toHaveCount(2);
  await expect(items.getByRole("listitem").filter({ hasText: "백업이 오래되었습니다" })).toContainText("2일 전");
  await expect(items.getByRole("listitem").filter({ hasText: "압축 가능한 녹음 35개" })).toContainText("40 kbps");
  await expect(items.getByText("디스크 여유 공간 부족")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "사용자와 녹음" }).getByRole("listitem").filter({ hasText: "오디오 저장 용량" })).toContainText("디스크 여유 41 GB / 128 GB");

  await items.getByRole("button", { name: "승인: seoa@example.com" }).click();
  await expect(page.getByText("seoa@example.com 가입을 승인했습니다.")).toBeVisible();
  await expect(items.getByText("가입 승인 대기")).toHaveCount(0);

  await items.getByRole("button", { name: /^재시도:/ }).first().click();
  await expect(page.getByText("재시도를 시작했습니다.")).toBeVisible();
  await expect(items.getByRole("button", { name: /^재시도:/ })).toHaveCount(1);

  await items.getByRole("button", { name: "압축 미리보기" }).click();
  await expect(page.getByRole("dialog", { name: "전체 압축" })).toContainText("35개");
  await page.getByRole("dialog", { name: "전체 압축" }).getByRole("button", { name: "취소" }).click();

  await items.getByRole("button", { name: "유지보수 실행" }).click();
  await page.getByRole("dialog", { name: "유지보수 실행" }).getByRole("button", { name: "실행" }).click();
  await page.getByRole("dialog", { name: "유지보수 완료" }).getByRole("button", { name: "닫기" }).first().click();
  await expect(items.getByText("백업이 오래되었습니다")).toHaveCount(0);

  // One of the three is being retried now.
  await items.getByRole("link", { name: "오류 녹음 2개 모두 보기" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/recordings\?status=error$/);
});

test("overview: recent activity", async ({ page }) => {
  await page.goto("/app/admin");
  const activity = page.getByRole("list", { name: "최근 활동" });
  await expect(activity.getByRole("listitem")).toHaveCount(10);
  await activity.getByRole("button", { name: /^자세히:/ }).first().click();
  await expect(page.getByRole("dialog", { name: "감사 로그" }).getByRole("table", { name: "감사 로그 항목" })).toContainText("audlog_fx_01");
  await page.getByRole("dialog", { name: "감사 로그" }).getByRole("button", { name: "닫기" }).first().click();
  await page.getByRole("link", { name: "감사 로그 전체 보기" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/audit$/);
});

test("overview: trouble items", async ({ page }) => {
  await page.goto("/app/admin?fixture-admin=trouble");
  const items = page.getByRole("list", { name: /^확인 필요/ });
  await expect(items.getByRole("listitem").filter({ hasText: "디스크 여유 공간 부족" })).toContainText("99% 사용");
  await expect(items.getByText("ffmpeg를 사용할 수 없습니다")).toBeVisible();
  await expect(items.getByRole("listitem").filter({ hasText: "유지보수 오류 1건" })).toContainText("백업 실패");
  await expect(items.getByRole("listitem").filter({ hasText: "최근 배포 실패" })).toContainText("health check failed");
  // No compaction offer while ffmpeg is missing.
  await expect(items.getByText(/압축 가능한 녹음/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "저장소", exact: true })).toHaveAccessibleDescription("디스크 여유 공간 부족");

  await page.getByRole("link", { name: "저장소", exact: true }).click();
  await expect(page.getByText("ffmpeg 없음")).toBeVisible();
  await expect(page.getByRole("button", { name: "전체 압축" })).toBeDisabled();
  await page.getByRole("link", { name: "운영", exact: true }).click();
  await expect(stat(page, "배포", "결과")).toContainText("실패");
  await expect(page.getByRole("note", { name: "마지막 유지보수 오류" })).toContainText("백업 실패");
  await expect(stat(page, "서버", "ffmpeg")).toContainText("없음");
});

test("admin tabs show counts", async ({ page }) => {
  await page.goto("/app/admin/audit");
  const nav = page.getByRole("navigation", { name: "관리 메뉴" });
  await expect(nav.getByRole("link")).toHaveCount(9);
  await expect(nav.getByRole("link", { name: "사용자", exact: true })).toHaveAccessibleDescription("5명, 승인 대기 1명");
  await expect(nav.getByRole("link", { name: "녹음", exact: true })).toHaveAccessibleDescription("55개, 오류 3개");
  await expect(nav.getByRole("link", { name: "운영", exact: true })).toHaveAccessibleDescription("v1 작업 2개 진행 중");
  await expect(nav.getByRole("link", { name: "저장소", exact: true })).not.toHaveAttribute("aria-describedby");
});

test("palette: admin screens and commands", async ({ page }) => {
  await page.goto("/app/admin");
  await expect(page.getByRole("heading", { level: 1, name: "개요" })).toBeVisible();
  const palette = page.getByRole("dialog", { name: "명령 팔레트" });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("유지보수");
  await palette.getByRole("menuitem", { name: /^유지보수 실행/ }).click();
  await expect(page).toHaveURL(/\/app\/admin\/ops$/);
  await page.getByRole("dialog", { name: "유지보수 실행" }).getByRole("button", { name: "취소" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("고아");
  await palette.getByRole("menuitem", { name: /^고아 파일 정리/ }).click();
  await expect(page).toHaveURL(/\/app\/admin\/storage$/);
  await page.getByRole("dialog", { name: "고아 파일을 휴지통으로 이동" }).getByRole("button", { name: "취소" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("보존 정책");
  await palette.getByRole("menuitem", { name: /^보존 정책 적용/ }).click();
  await expect(page.getByRole("alertdialog", { name: "보존 정책 적용" })).toBeVisible();
  await page.getByRole("alertdialog", { name: "보존 정책 적용" }).getByRole("button", { name: "취소" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("전체 압축");
  await palette.getByRole("menuitem", { name: /^전체 압축/ }).click();
  await expect(page.getByRole("dialog", { name: "전체 압축" })).toBeVisible();
  await page.getByRole("dialog", { name: "전체 압축" }).getByRole("button", { name: "취소" }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("새 사용자");
  await palette.getByRole("menuitem", { name: /^새 사용자/ }).click();
  await expect(page.getByRole("dialog", { name: "새 사용자" })).toBeVisible();
  await page.getByRole("dialog", { name: "새 사용자" }).getByRole("button", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/users$/);

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("감사");
  await palette.getByRole("menuitem", { name: /^관리 › 감사 로그/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "감사 로그" })).toBeVisible();

  // Every account's recordings by title.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("데이터베이스 5주차");
  await palette.getByRole("menuitem", { name: /^데이터베이스 5주차/ }).first().click();
  await expect(page).toHaveURL(/\/app\/admin\/recordings\/lec_fx_\d+$/);
});

test("palette: nothing of the console for others", async ({ page }) => {
  await page.goto("/app/?fixture-operator=off");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("유지보수");
  await expect(page.getByRole("dialog", { name: "명령 팔레트" }).getByRole("menuitem", { name: /유지보수 실행/ })).toHaveCount(0);
});

test("admin shortcuts", async ({ page }) => {
  await page.goto("/app/admin/storage");
  await expect(page.getByRole("heading", { level: 1, name: "저장소" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("m");
  await expect(page).toHaveURL(/\/app\/admin\/users$/);
  // C waits for the users (the new-user form starts from the overview's settings).
  await expect(bodyRows(page, "사용자")).toHaveCount(5);
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "새 사용자" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "새 사용자" })).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/app\/admin\/jobs$/);
  await page.keyboard.press("g");
  await page.keyboard.press(",");
  await expect(page).toHaveURL(/\/app\/admin\/settings$/);
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect(page).toHaveURL(/\/app\/admin$/);
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "단축키" });
  await expect(sheet.getByRole("heading", { name: "관리" })).toBeVisible();
  await expect(sheet).toContainText("관리 설정으로 이동");
});

test("unavailable screens offer a retry", async ({ page }) => {
  await page.goto("/app/admin/storage?fixture-admin=unavailable");
  await expect(page.getByText("서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.")).toBeVisible();
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "회수 가능 공간" })).toBeVisible();

  await page.goto("/app/admin?fixture-admin=unavailable");
  await expect(page.getByText("운영·저장소 정보를 불러오지 못해 디스크·백업·압축 점검은 건너뛰었습니다.")).toBeVisible();
  await expect(page.getByText("디스크 정보 없음")).toBeVisible();
});

test("admin on a phone: every screen fits", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, heading] of [
    ["/app/admin", "개요"],
    ["/app/admin/storage", "저장소"],
    ["/app/admin/ops", "운영"],
    ["/app/admin/settings", "설정"],
    ["/app/admin/audit", "감사 로그"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "관리 메뉴" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
