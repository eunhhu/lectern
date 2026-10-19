// 물어보기: the note panel (suggestion → streamed answer → citation into the transcript and
// back), the 물어보기 screen (multi-note answer, sources, history, copy), 근거 없음 with
// "전체 노트에서 다시 묻기", the offline error and retry, stopping an answer, and ⌘K.

import { expect, test } from "./fixtures.ts";

test("note panel: a suggested question streams an answer whose citation opens the transcript there", async ({ page, axe }) => {
  await page.goto("/app/recordings/rec_os07");
  await page.getByRole("button", { name: "물어보기" }).click();
  const panel = page.getByRole("region", { name: "물어보기" }).or(page.locator("section", { has: page.getByRole("heading", { name: "물어보기", level: 2 }) }));
  await expect(panel.getByRole("list", { name: "추천 질문" })).toBeVisible();
  await axe(page, "이 노트에 물어보기 (빈 상태)");

  await panel.getByRole("button", { name: "SJF가 최적이면서도 그대로 쓰기 어려운 이유는?" }).click();
  await expect(panel.getByText("다음 CPU 버스트 길이를 미리 알 수 없기 때문이다.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "답 복사" })).toBeVisible();
  await axe(page, "이 노트에 물어보기 (답)");

  // The source opens the transcript at the cited moment; the conversation is kept.
  await panel.getByRole("button", { name: /^출처 1:/ }).click();
  await expect(page.getByRole("heading", { name: "전사", level: 2 })).toBeVisible();
  await expect(page.locator("[data-highlight]").first()).toBeVisible();
  await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "물어보기로" }).click();
  await expect(page.getByText("다음 CPU 버스트 길이를 미리 알 수 없기 때문이다.", { exact: false })).toBeVisible();
});

test("note panel: nothing in this note, so it offers to ask all notes", async ({ page }) => {
  await page.goto("/app/recordings/rec_os07");
  await page.getByRole("button", { name: "물어보기" }).click();
  const input = page.getByRole("textbox", { name: "이 노트에 질문" });
  await input.fill("힙 정렬의 최악 시간 복잡도는?");
  await input.press("Enter");
  await expect(page.getByText("관련 내용을 찾지 못했습니다", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "전체 노트에서 다시 묻기" }).click();
  await expect(page.getByRole("list", { name: "대화" }).locator("p", { hasText: /^O\(n log n\)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^출처 1: 자료구조 5주차/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "전체" })).toBeChecked();
});

test("물어보기 screen: an answer from several notes with sources, saved to the history, copied", async ({ page, context, axe }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app/ask");
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
  await axe(page, "물어보기 (빈 상태)");

  const input = page.getByRole("textbox", { name: "질문" });
  await input.fill("해야 할 일을 모아 줘");
  await input.press("Enter");
  await expect(page.getByText(/노트 \d+개에서 나온 할 일입니다/)).toBeVisible();
  const sources = page.getByRole("link", { name: /^출처 \d+:/ });
  await expect(sources.first()).toBeVisible();
  expect(await sources.count()).toBeGreaterThanOrEqual(3);
  await expect(page).toHaveURL(/\/app\/ask\?thread=/);
  const history = page.getByRole("navigation", { name: "대화 기록" });
  await expect(history.getByRole("button", { name: /해야 할 일을 모아 줘/ })).toHaveAttribute("aria-current", "true");
  await axe(page, "물어보기 (여러 노트 답)");

  await page.getByRole("button", { name: "답 복사" }).click();
  await expect(page.getByText("답을 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("출처\n[1]");

  // A source opens the recording at that moment.
  await sources.first().click();
  await expect(page).toHaveURL(/\/app\/recordings\/rec_[a-z0-9]+\?t=\d+/);

  // History: a saved conversation opens again.
  await page.goto("/app/ask");
  await page.getByRole("navigation", { name: "대화 기록" }).getByRole("button", { name: /다가오는 마감과 시험/ }).click();
  await expect(page.getByText("다가오는 일정과 마감입니다.")).toBeVisible();
});

test("물어보기 screen: no evidence, the offline error with retry, and stopping an answer", async ({ page, context, axe }) => {
  await page.goto("/app/ask");
  const input = page.getByRole("textbox", { name: "질문" });
  await input.fill("양자역학 중간고사 범위가 어떻게 돼?");
  await input.press("Enter");
  await expect(page.getByText("관련 내용을 찾지 못했습니다", { exact: true })).toBeVisible();
  await axe(page, "물어보기 (근거 없음)");

  await context.setOffline(true);
  await input.fill("에이징이 뭐야?");
  await input.press("Enter");
  await expect(page.getByRole("list", { name: "대화" }).getByText("답을 받지 못했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("네트워크에 연결되어 있지 않아", { exact: false })).toBeVisible();
  await axe(page, "물어보기 (오류)");
  await context.setOffline(false);
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("에이징(aging)", { exact: false })).toBeVisible();
  // The text shows while the answer still streams; a question sent before it ends is
  // ignored (the composer is busy). Wait until it is done.
  await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();

  await input.fill("이 폴더 노트들의 핵심을 요약해 줘");
  await input.press("Enter");
  await page.getByRole("button", { name: "답 멈추기" }).click();
  await expect(page.getByText(/^답을 멈췄습니다\. 서버는 이 답을/)).toBeVisible();
  await expect(page.getByRole("button", { name: "끝까지 만든 답 보기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();
});

test("⌘K: typing a question offers 물어보기 first and answers on the 물어보기 screen", async ({ page }) => {
  await page.goto("/app/library");
  await expect(page.getByRole("grid", { name: "녹음 목록" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "명령 팔레트" });
  await page.keyboard.type("에이징이 뭐야?");
  await expect(palette.getByRole("menuitem").first()).toContainText("전체 노트에 물어보기: 에이징이 뭐야?");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
  await expect(page.getByText("에이징(aging)", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/thread=/);
});

test("⌘K on a recording asks that note in its panel", async ({ page }) => {
  await page.goto("/app/recordings/rec_tw42");
  await expect(page.getByRole("heading", { name: "결정 사항" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("누가 무엇을 맡았어?");
  const item = page.getByRole("menuitem", { name: /이 노트에 물어보기: 누가 무엇을 맡았어\?/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole("button", { name: "물어보기", pressed: true })).toBeVisible();
  await expect(page.getByText("QA 체크리스트 정리 (윤서아", { exact: false })).toBeVisible();
});
