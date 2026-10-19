// 물어보기 through the fixture ApiClient, against the domain contract
// (packages/domain/src/api/ask.ts): a thread is created first, a question streams
// turn.started → retrieval → citation/answer.delta → turn.completed, every `[cN]` marker
// has a citation that really says what it claims, answers stay inside the thread's scope,
// "근거 없음" is `no_answer` instead of a guess, and a stopped turn is still stored.

import { describe, expect, test } from "bun:test";
import * as D from "@lectern/domain";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { streamChunks } from "../src/api/fixture/ask.ts";
import { asId, type AskCitation, type AskScope, type AskStreamEvent, type WorkspaceId } from "../src/api/types.ts";
import { PERSONAL_WS, TEAM_WS } from "../src/fixtures/index.ts";
import { askSuggestions } from "../src/lib/ask-suggestions.ts";
import { looksLikeQuestion } from "../src/lib/hangul.ts";
import { findByIdx } from "../src/lib/segments.ts";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const client = () => createFixtureClient({ now: NOW, latencyMs: 0, processingMs: 50 });
type Api = ReturnType<typeof client>;

const folder = (id: string, include_subfolders = true): AskScope => ({ kind: "folder", folder_id: asId(id), include_subfolders });
const note = (id: string): AskScope => ({ kind: "recording", recording_id: asId(id) });

function expectResolves(api: Api, c: AskCitation) {
  if (c.kind !== "transcript") throw new Error(`fixture citations are transcript ranges, got ${c.kind}`);
  const segments = api.data.transcripts.get(c.recording_id)!.segments;
  const first = findByIdx(segments, c.start_idx);
  const last = findByIdx(segments, c.end_idx);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(last).toBeGreaterThanOrEqual(first);
  expect(c.start_ms).toBe(segments[first]!.start_ms);
  expect(c.end_ms).toBe(segments[last]!.end_ms);
  const said = segments
    .slice(first, last + 1)
    .map((s) => s.text)
    .join(" ");
  expect(said.startsWith(c.snippet.replace(/…$/, ""))).toBe(true);
  expect(c.recording_title).toBe(api.data.recordings.find((r) => r.id === c.recording_id)!.title);
  expect(c.available).toBe(true);
}

async function ask(api: Api, question: string, scope: AskScope = { kind: "workspace" }, ws: WorkspaceId = PERSONAL_WS, threadId?: string) {
  const thread = threadId ?? (await api.createAskThread({ workspace_id: ws, scope })).id;
  const events: AskStreamEvent[] = [];
  const turn = await api.askQuestion(thread, question, { onEvent: (e) => events.push(D.AskStreamEvent.parse(e)) });
  D.AskTurn.parse(turn);
  return { turn, events, thread };
}

describe("ask", () => {
  test("streams the domain events in order; deltas add up to the answer; the thread is saved", async () => {
    const api = client();
    const { turn, events, thread } = await ask(api, "에이징이 뭐야?");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("turn.started");
    expect(types[1]).toBe("retrieval");
    expect(types.at(-1)).toBe("turn.completed");
    const text = events.flatMap((e) => (e.type === "answer.delta" ? [e.text] : [])).join("");
    expect(text).toBe(turn.answer!);
    expect(turn.status).toBe("completed");
    expect(turn.outcome).toBe("answered");
    expect(turn.citations.length).toBeGreaterThan(0);

    // Every marker has a citation, every citation is used, and each citation event comes
    // before the first delta that uses its marker, with support still null.
    const used = [...new Set([...turn.answer!.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]))];
    expect(used.sort()).toEqual(turn.citations.map((c) => c.label).sort());
    let streamed = "";
    const announced = new Set<string>();
    for (const e of events) {
      if (e.type === "citation") {
        expect(e.citation.support).toBeNull();
        announced.add(e.citation.label);
      }
      if (e.type === "answer.delta") {
        streamed += e.text;
        for (const [, label] of streamed.matchAll(/\[(c\d+)\]/g)) expect(announced.has(label!)).toBe(true);
      }
    }
    for (const c of turn.citations) {
      expect(c.support).toBe("supported");
      expectResolves(api, c);
    }

    const threads = (await api.listAskThreads({ workspace_id: PERSONAL_WS })).items;
    D.AskThreadPage.parse({ items: threads, next_cursor: null });
    expect(String(threads[0]!.id)).toBe(thread);
    expect(threads[0]!.title).toBe("에이징이 뭐야?");

    // A follow-up continues the same thread.
    await ask(api, "라운드 로빈 타임 퀀텀은 어떻게 정해?", { kind: "workspace" }, PERSONAL_WS, thread);
    const detail = D.AskThreadDetail.parse(await api.getAskThread(thread));
    expect(detail.turns.map((t) => t.idx)).toEqual([0, 1]);
    expect(detail.thread.turn_count).toBe(2);
    expect(detail.thread.title).toBe("에이징이 뭐야?");
  });

  test("answers stay inside the scope; a folder includes its subfolders only when asked", async () => {
    const api = client();
    const inTree = new Set(["rec_os07", "rec_os06", "rec_ds05", "rec_ds06", "rec_ds04", "rec_econ04"]);
    const processed = api.data.recordings.filter((r) => inTree.has(r.id) && (r.status === "ready" || r.status === "partial"));
    const { turn, events } = await ask(api, "이 폴더 노트들의 핵심을 요약해 줘", folder("fld_semester"));
    const retrieval = events.find((e) => e.type === "retrieval")!;
    expect(retrieval).toMatchObject({ type: "retrieval", recording_count: processed.length });
    expect(new Set(turn.citations.map((c) => c.recording_id)).size).toBeGreaterThan(1);
    for (const c of turn.citations) expect(inTree.has(c.recording_id)).toBe(true);

    // Without subfolders, the parent folder alone has no notes of its own.
    const top = await ask(api, "이 폴더 노트들의 핵심을 요약해 줘", folder("fld_semester", false));
    expect(top.turn.outcome).toBe("no_answer");

    const one = await ask(api, "핵심 내용을 요약해 줘", note("rec_tw42"), TEAM_WS);
    expect(one.events.find((e) => e.type === "retrieval")).toMatchObject({ recording_count: 1 });
    for (const c of one.turn.citations) expect(String(c.recording_id)).toBe("rec_tw42");
  });

  test("says it found nothing instead of guessing", async () => {
    const api = client();
    const { turn } = await ask(api, "양자역학 중간고사 범위가 어떻게 돼?");
    expect(turn.outcome).toBe("no_answer");
    expect(turn.citations).toEqual([]);
    expect(turn.answer).toContain("찾지 못했습니다");
    expect(turn.cost_microusd).toBe(0);
  });

  test("intents pick the matching parts of the notes", async () => {
    const api = client();
    const deadlines = await ask(api, "다가오는 마감과 시험을 정리해 줘");
    expect(deadlines.turn.answer).toContain("다가오는 일정과 마감");
    expect(deadlines.turn.answer).not.toContain("10월 9일"); // past ones are left out
    const tasks = await ask(api, "누가 무엇을 맡았어?", folder("fld_weekly"), TEAM_WS);
    expect(tasks.turn.answer).toContain("QA 체크리스트 정리 (윤서아");
    const decided = await ask(api, "최근 회의에서 결정된 사항은?", { kind: "workspace" }, TEAM_WS);
    expect(decided.turn.answer).toContain("가입 직후 바로 올리기 화면으로 보낸다");
    // A question close to an extracted one gets its answer.
    const sjf = await ask(api, "SJF가 최적이면서도 그대로 쓰기 어려운 이유는?", note("rec_os07"));
    expect(sjf.turn.answer).toContain("다음 CPU 버스트 길이를 미리 알 수 없기 때문이다.");
  });

  test("every suggested question has an answer with sources", async () => {
    const api = client();
    const scopes: [WorkspaceId, AskScope][] = [
      [PERSONAL_WS, { kind: "workspace" }],
      [PERSONAL_WS, folder("fld_os")],
      [PERSONAL_WS, note("rec_os07")],
      [TEAM_WS, { kind: "workspace" }],
      [TEAM_WS, note("rec_tw42")],
    ];
    for (const [ws, scope] of scopes) {
      const recordings = (await api.listRecordings({ workspace_id: ws, limit: 200 })).items.filter((r) => r.status === "ready" || r.status === "partial");
      const questions = scope.kind === "recording" ? (await api.listQuestions(scope.recording_id)).items : [];
      const suggestions = askSuggestions({ scope, recordings, questions });
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      for (const q of suggestions) {
        const { turn } = await ask(api, q, scope, ws);
        expect({ q, outcome: turn.outcome }).toEqual({ q, outcome: "answered" });
        for (const c of turn.citations) expectResolves(api, c);
      }
    }
  });

  test("the seeded history has valid, cited answers in both workspaces", async () => {
    const api = client();
    for (const ws of [PERSONAL_WS, TEAM_WS]) {
      const threads = (await api.listAskThreads({ workspace_id: ws })).items;
      expect(threads.length).toBeGreaterThanOrEqual(2);
      for (const t of threads) {
        const detail = D.AskThreadDetail.parse(await api.getAskThread(t.id));
        expect(detail.turns.length).toBe(t.turn_count);
        for (const turn of detail.turns) {
          expect(turn.outcome).toBe("answered");
          expect(turn.citations.length).toBeGreaterThan(0);
          for (const c of turn.citations) expectResolves(api, c);
        }
      }
    }
    // The note panel's history: threads scoped to one recording.
    const scoped = (await api.listAskThreads({ workspace_id: PERSONAL_WS, recording_id: asId("rec_os07") })).items;
    expect(scoped.map((t) => String(t.id))).toEqual(["ask_seed_os07"]);
  });

  test("stopping rejects with an AbortError, and the server-side turn is still stored", async () => {
    const api = client();
    const { id } = await api.createAskThread({ workspace_id: PERSONAL_WS, scope: { kind: "workspace" } });
    const ctrl = new AbortController();
    let turnId = "";
    const run = api.askQuestion(id, "에이징이 뭐야?", {
      signal: ctrl.signal,
      onEvent: (e) => {
        if (e.type === "turn.started") turnId = e.turn_id;
        if (e.type === "answer.delta") ctrl.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    const detail = await api.getAskThread(id);
    expect(detail.turns.map((t) => [String(t.id), t.status])).toEqual([[turnId, "completed"]]);
  });

  test("validates the question, the scope and the thread", async () => {
    const api = client();
    const noop = { onEvent: () => {} };
    const { id } = await api.createAskThread({ workspace_id: PERSONAL_WS, scope: { kind: "workspace" } });
    await expect(api.askQuestion(id, "  ", noop)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(api.createAskThread({ workspace_id: PERSONAL_WS, scope: note("rec_missing") })).rejects.toMatchObject({ code: "not_found" });
    await expect(api.createAskThread({ workspace_id: PERSONAL_WS, scope: note("rec_tw42") })).rejects.toMatchObject({ code: "not_found" });
    await expect(api.createAskThread({ workspace_id: PERSONAL_WS, scope: folder("fld_weekly") })).rejects.toMatchObject({ code: "not_found" });
    await expect(api.createAskThread({ workspace_id: asId("ws_other"), scope: { kind: "workspace" } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(api.askQuestion("ask_missing", "요약", noop)).rejects.toMatchObject({ code: "not_found" });
    await expect(api.getAskThread("ask_missing")).rejects.toMatchObject({ code: "not_found" });
    await api.deleteAskThread(id);
    await expect(api.getAskThread(id)).rejects.toMatchObject({ code: "not_found" });
    D.AskUsage.parse(await api.getAskUsage(PERSONAL_WS));
  });

  test("helpers: stream chunks keep citation marks whole; question detection", () => {
    const chunks = streamChunks("요약입니다. [c12] **굵게** 끝 [c3]", 3);
    expect(chunks.join("")).toBe("요약입니다. [c12] **굵게** 끝 [c3]");
    expect(chunks.some((c) => c.includes("[c12]"))).toBe(true);
    expect(chunks.some((c) => c.includes("[c1") && !c.includes("[c12]") && !c.includes("[c3]"))).toBe(false);
    expect(looksLikeQuestion("에이징이 뭐야?")).toBe(true);
    expect(looksLikeQuestion("이번 주 마감 정리")).toBe(true);
    expect(looksLikeQuestion("운영체제")).toBe(false);
  });
});

describe("session and documents (fixture)", () => {
  test("starts signed in; signing out and in again uses the fixture user's email", async () => {
    const api = client();
    expect((await api.getSession())?.email).toBe(api.data.me.email);
    await api.logout();
    expect(await api.getSession()).toBeNull();
    await expect(api.login("someone@example.com", "x")).rejects.toMatchObject({ status: 401 });
    expect((await api.login(api.data.me.email, "any")).id).toBe(api.data.me.id);
    expect(await api.getSession()).not.toBeNull();
  });

  test("a document save names the version it started from; a stale one is 412", async () => {
    const api = client();
    const { document, version } = await api.getDocument(api.data.documents[0]!.id);
    const saved = D.DocumentVersion.parse(await api.createDocumentVersion(document.id, { body: version.body! }, document.current_version));
    expect(saved.version).toBe(document.current_version + 1);
    expect(saved.base_version).toBe(document.current_version);
    await expect(api.createDocumentVersion(document.id, { body: version.body! }, document.current_version)).rejects.toMatchObject({
      status: 412,
      code: "precondition_failed",
    });
  });
});
