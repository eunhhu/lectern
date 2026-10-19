// 물어보기 through the fixture ApiClient: answers stream in order, cite transcript ranges
// that really say what they claim, stay inside the chosen scope, say "근거 없음" instead
// of guessing, and can be stopped.

import { describe, expect, test } from "bun:test";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { streamChunks } from "../src/api/fixture/ask.ts";
import type { AskCitation, AskScope, AskStreamEvent } from "../src/api/types.ts";
import { PERSONAL_WS, TEAM_WS } from "../src/fixtures/index.ts";
import { looksLikeQuestion } from "../src/lib/hangul.ts";
import { findByIdx } from "../src/lib/segments.ts";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const client = () => createFixtureClient({ now: NOW, latencyMs: 0, processingMs: 50 });
type Api = ReturnType<typeof client>;

function expectResolves(api: Api, c: AskCitation) {
  const segments = api.data.transcripts.get(c.recording_id as never)!.segments;
  const first = findByIdx(segments, c.start_idx);
  const last = findByIdx(segments, c.end_idx);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(last).toBeGreaterThanOrEqual(first);
  expect(c.start_ms).toBe(segments[first]!.start_ms);
  const said = segments
    .slice(first, last + 1)
    .map((s) => s.text)
    .join(" ");
  expect(said.startsWith(c.quote.replace(/…$/, ""))).toBe(true);
  expect(c.recording_title).toBe(api.data.recordings.find((r) => r.id === c.recording_id)!.title);
}

async function ask(api: Api, question: string, scope: AskScope = { kind: "workspace" }, ws: string = PERSONAL_WS, thread_id?: string) {
  const events: AskStreamEvent[] = [];
  const answer = await api.ask({ workspace_id: ws, question, scope, thread_id }, { onEvent: (e) => events.push(e) });
  return { answer, events };
}

describe("ask", () => {
  test("streams retrieval, then deltas that add up to the answer, then done; the thread is saved", async () => {
    const api = client();
    const { answer, events } = await ask(api, "에이징이 뭐야?");
    expect(events[0]!.type).toBe("retrieval");
    expect(events.at(-1)!.type).toBe("done");
    const text = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
    expect(text).toBe(answer.text);
    expect(answer.status).toBe("complete");
    expect(answer.citations.length).toBeGreaterThan(0);
    // Every [n] in the text has a citation and every citation is used.
    const used = new Set([...answer.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    expect([...used].sort()).toEqual(answer.citations.map((c) => c.n).sort());
    for (const c of answer.citations) expectResolves(api, c);

    const done = events.at(-1) as Extract<AskStreamEvent, { type: "done" }>;
    const threads = (await api.listAskThreads(PERSONAL_WS)).items;
    expect(threads[0]!.id).toBe(done.thread.id);
    expect(threads[0]!.title).toBe("에이징이 뭐야?");

    // A follow-up continues the same thread.
    await ask(api, "라운드 로빈 타임 퀀텀은 어떻게 정해?", { kind: "workspace" }, PERSONAL_WS, done.thread.id);
    const detail = await api.getAskThread(done.thread.id);
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(detail.thread.message_count).toBe(4);
  });

  test("answers stay inside the scope; a folder includes its subfolders", async () => {
    const api = client();
    const inFolder = new Set(["rec_os07", "rec_os06", "rec_ds05", "rec_ds06", "rec_ds04", "rec_econ04"]);
    const processed = api.data.recordings.filter((r) => inFolder.has(r.id) && (r.status === "ready" || r.status === "partial"));
    const { answer } = await ask(api, "이 폴더 노트들의 핵심을 요약해 줘", { kind: "folder", folder_id: "fld_semester" });
    expect(answer.searched).toBe(processed.length);
    expect(answer.citations.length).toBeGreaterThan(1);
    expect(new Set(answer.citations.map((c) => c.recording_id)).size).toBeGreaterThan(1);
    for (const c of answer.citations) expect(inFolder.has(c.recording_id)).toBe(true);

    const note = await ask(api, "핵심 내용을 요약해 줘", { kind: "recording", recording_id: "rec_tw42" }, TEAM_WS);
    expect(note.answer.searched).toBe(1);
    for (const c of note.answer.citations) expect(c.recording_id).toBe("rec_tw42");
  });

  test("says it found nothing instead of guessing", async () => {
    const api = client();
    const { answer } = await ask(api, "양자역학 중간고사 범위가 어떻게 돼?");
    expect(answer.status).toBe("no_evidence");
    expect(answer.citations).toEqual([]);
    expect(answer.text).toContain("찾지 못했습니다");
  });

  test("intents pick the matching parts of the notes", async () => {
    const api = client();
    const deadlines = await ask(api, "다가오는 마감과 시험을 정리해 줘");
    expect(deadlines.answer.text).toContain("다가오는 일정과 마감");
    expect(deadlines.answer.text).not.toContain("10월 9일"); // past ones are left out
    const tasks = await ask(api, "누가 무엇을 맡았어?", { kind: "folder", folder_id: "fld_weekly" }, TEAM_WS);
    expect(tasks.answer.text).toContain("QA 체크리스트 정리 (윤서아");
    const decided = await ask(api, "최근 회의에서 결정된 사항은?", { kind: "workspace" }, TEAM_WS);
    expect(decided.answer.text).toContain("가입 직후 바로 올리기 화면으로 보낸다");
    // A question close to an extracted one gets its answer.
    const sjf = await ask(api, "SJF가 최적이면서도 그대로 쓰기 어려운 이유는?", { kind: "recording", recording_id: "rec_os07" });
    expect(sjf.answer.text).toContain("다음 CPU 버스트 길이를 미리 알 수 없기 때문이다.");
  });

  test("every suggested question has an answer with sources", async () => {
    const api = client();
    const scopes: [string, AskScope][] = [
      [PERSONAL_WS, { kind: "workspace" }],
      [PERSONAL_WS, { kind: "folder", folder_id: "fld_os" }],
      [PERSONAL_WS, { kind: "recording", recording_id: "rec_os07" }],
      [TEAM_WS, { kind: "workspace" }],
      [TEAM_WS, { kind: "recording", recording_id: "rec_tw42" }],
    ];
    for (const [ws, scope] of scopes) {
      const suggestions = await api.listAskSuggestions(ws, scope);
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      for (const q of suggestions) {
        const { answer } = await ask(api, q, scope, ws);
        expect({ q, status: answer.status }).toEqual({ q, status: "complete" });
        for (const c of answer.citations) expectResolves(api, c);
      }
    }
  });

  test("the seeded history has valid, cited answers in both workspaces", async () => {
    const api = client();
    for (const ws of [PERSONAL_WS, TEAM_WS]) {
      const threads = (await api.listAskThreads(ws)).items;
      expect(threads.length).toBeGreaterThanOrEqual(2);
      for (const t of threads) {
        const { messages } = await api.getAskThread(t.id);
        for (const m of messages.filter((x) => x.role === "assistant")) {
          expect(m.status).toBe("complete");
          expect(m.citations.length).toBeGreaterThan(0);
          for (const c of m.citations) expectResolves(api, c);
        }
      }
    }
  });

  test("stopping rejects with an AbortError and saves nothing", async () => {
    const api = client();
    const before = api.data.askThreads.length;
    const ctrl = new AbortController();
    const run = api.ask(
      { workspace_id: PERSONAL_WS, question: "에이징이 뭐야?", scope: { kind: "workspace" } },
      { signal: ctrl.signal, onEvent: (e) => e.type === "delta" && ctrl.abort() },
    );
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(api.data.askThreads.length).toBe(before);
  });

  test("validates the question, the scope and the thread", async () => {
    const api = client();
    const noop = { onEvent: () => {} };
    await expect(api.ask({ workspace_id: PERSONAL_WS, question: "  ", scope: { kind: "workspace" } }, noop)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(api.ask({ workspace_id: PERSONAL_WS, question: "요약", scope: { kind: "recording", recording_id: "rec_missing" } }, noop)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.ask({ workspace_id: PERSONAL_WS, question: "요약", scope: { kind: "recording", recording_id: "rec_tw42" } }, noop)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.ask({ workspace_id: PERSONAL_WS, question: "요약", scope: { kind: "folder", folder_id: "fld_weekly" } }, noop)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.ask({ workspace_id: TEAM_WS, question: "요약", scope: { kind: "workspace" }, thread_id: "ask_seed_os07" }, noop)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.getAskThread("ask_missing")).rejects.toMatchObject({ code: "not_found" });
  });

  test("helpers: stream chunks keep citation marks whole; question detection", () => {
    const chunks = streamChunks("요약입니다. [12] **굵게** 끝 [3]", 3);
    expect(chunks.join("")).toBe("요약입니다. [12] **굵게** 끝 [3]");
    expect(chunks.some((c) => c.includes("[12]"))).toBe(true);
    expect(chunks.some((c) => c.includes("[1") && !c.includes("[12]") && !c.includes("[3]"))).toBe(false);
    expect(looksLikeQuestion("에이징이 뭐야?")).toBe(true);
    expect(looksLikeQuestion("이번 주 마감 정리")).toBe(true);
    expect(looksLikeQuestion("운영체제")).toBe(false);
  });
});
