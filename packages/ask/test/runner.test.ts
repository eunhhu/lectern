import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { type AskScope, AskStreamEvent, AskTurn } from "@lectern/domain";
import {
  type AskDeps,
  type AskModel,
  type AskModelEvent,
  type AskModelRequest,
  AskRequestError,
  createThread,
  FakeEmbedder,
  getThread,
  type ModelCallRecord,
  monthUsage,
  prepareAskTurn,
  QueryEmbeddingCache,
  runAskTurn,
  runIndexStage,
  SqliteVectorIndex,
} from "../src/index.ts";
import { type AccessScope, resolveAccessScope } from "../src/scope.ts";
import { cryptoSources, FOLDERS, longSources, ME, meetingSources, REC, RECORDINGS, scopeOf, seededDb, WS } from "./fixtures.ts";

/** Plays scripted rounds; each round sees the request and returns its events. */
class ScriptedModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  requests: AskModelRequest[] = [];
  constructor(private rounds: Array<(req: AskModelRequest) => AskModelEvent[]>) {}
  async *stream(req: AskModelRequest): AsyncIterable<AskModelEvent> {
    this.requests.push(req);
    const round = this.rounds[this.requests.length - 1];
    if (!round) throw new Error("no scripted round left");
    for (const e of round(req)) yield e;
  }
}

const done = (inputTokens = 4_000, outputTokens = 200): AskModelEvent => ({
  type: "done",
  usage: { inputTokens, cachedTokens: 0, outputTokens },
  finish: "stop",
  requestId: "req_1",
});

/** Finds the label the prompt (passages and tool results) gave to a passage containing `needle`. */
function labelOf(req: AskModelRequest, needle: string): string {
  const text = [req.context, ...req.exchanges.flatMap((x) => x.results.map((r) => r.output))].join("\n\n");
  const blocks = text.split("\n\n").filter((b) => b.startsWith("[c"));
  const hit = blocks.find((b) => b.includes(needle));
  if (!hit) throw new Error(`no passage with ${needle}`);
  return /^\[(c\d+)\]/.exec(hit)![1]!;
}

function setup(model: AskModel, extra: Partial<AskDeps> = {}) {
  const db = seededDb();
  const calls: ModelCallRecord[] = [];
  const deps: AskDeps = {
    db,
    model,
    price: (provider, m) => (provider === "gemini" && m === "gemini-3.5-flash-lite" ? { input: 0.3, cachedInput: 0.03, output: 2.5 } : provider === "fake" ? { input: 0.2, cachedInput: 0, output: 0 } : null),
    onModelCall: (c) => calls.push(c),
    ...extra,
  };
  return { db, deps, calls };
}

function scopeFor(scope: AskScope): AccessScope {
  const r = resolveAccessScope({ workspaceId: WS, caller: { userId: ME, role: "owner" }, scope, recordings: RECORDINGS, folders: FOLDERS });
  if ("code" in r) throw new Error(r.message);
  return r;
}

async function ask(deps: AskDeps, db: Database, scope: AskScope, question: string, threadId?: string) {
  const thread = threadId ? getThread(db, threadId)! : createThread(db, { workspaceId: WS, userId: ME, scope });
  const { turn } = prepareAskTurn(deps, { thread, userId: ME, question });
  const events: AskStreamEvent[] = [];
  const final = await runAskTurn(deps, { access: scopeFor(scope), thread, turn }, (e) => events.push(e));
  for (const e of events) expect(AskStreamEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
  expect(AskTurn.safeParse(final).success).toBe(true);
  return { thread, turn: final, events };
}

const noteScope = scopeOf({ kind: "recording", recording_id: REC.crypto });
const workspaceScope = scopeOf({ kind: "workspace" });

describe("ask turn", () => {
  test("note scope sends the whole short note and streams verified citations", async () => {
    const model = new ScriptedModel([
      (req) => {
        const label = labelOf(req, "패턴이 암호문에 그대로");
        return [
          { type: "text", text: "평문의 패턴이 암호문에 그대로 드러나서 " },
          { type: "text", text: `위험합니다 [${label}][c99].` },
          done(),
        ];
      },
    ]);
    const { db, deps, calls } = setup(model);
    const { turn, events } = await ask(deps, db, noteScope, "ECB가 왜 위험해?");
    expect(events.map((e) => e.type)).toEqual(["turn.started", "retrieval", "answer.delta", "answer.delta", "citation", "turn.completed"]);
    expect(events[1]).toMatchObject({ mode: "full_note", recording_count: 1 });
    expect(model.requests[0]!.tools).toEqual([]); // no agent loop for one note
    expect(model.requests[0]!.context).toContain("S2: 질문 있는데요");
    expect(turn.outcome).toBe("answered");
    expect(turn.answer).not.toContain("c99");
    expect(turn.citations[0]).toMatchObject({ kind: "transcript", support: "supported", start_idx: 3, end_idx: 3 });
    // 4,000 in × $0.30/M + 200 out × $2.50/M = 1,200 + 500 µ$
    expect(turn.cost_microusd).toBe(1_700);
    expect(calls).toMatchObject([{ purpose: "ask", provider: "gemini", costMicrousd: 1_700, status: "ok" }]);
  });

  test("a long note is searched instead of sent whole", async () => {
    const model = new ScriptedModel([(req) => [{ type: "text", text: `10~100밀리초입니다 [${labelOf(req, "타임 퀀텀")}].` }, done()]]);
    const { db, deps } = setup(model);
    const { events, turn } = await ask(deps, db, scopeOf({ kind: "recording", recording_id: REC.long }), "라운드 로빈 타임 퀀텀은 얼마로 잡아?");
    expect(events[1]).toMatchObject({ type: "retrieval", mode: "retrieval" });
    expect(model.requests[0]!.context.length).toBeLessThan(longSources().transcript!.segments.length * 60);
    expect(turn.outcome).toBe("answered");
  });

  test("no evidence: 모름 without calling the model", async () => {
    const model = new ScriptedModel([]);
    const { db, deps, calls } = setup(model);
    const { turn, events } = await ask(deps, db, workspaceScope, "양자역학의 불확정성 원리는?");
    expect(model.requests).toEqual([]);
    expect(calls).toEqual([]);
    expect(events[1]).toMatchObject({ type: "retrieval", passage_count: 0 });
    expect(turn).toMatchObject({ outcome: "no_answer", cost_microusd: 0 });
  });

  test("the same question over the same passages is answered from cache", async () => {
    const answer = (req: AskModelRequest): AskModelEvent[] => [{ type: "text", text: `11월 3일입니다 [${labelOf(req, "11월 3일")}].` }, done()];
    const model = new ScriptedModel([answer]);
    const { db, deps } = setup(model);
    const first = await ask(deps, db, workspaceScope, "출시일이 언제로 확정됐어?");
    const second = await ask(deps, db, workspaceScope, "출시일이  언제로 확정됐어?");
    expect(model.requests.length).toBe(1);
    expect(second.turn).toMatchObject({ cached: true, cost_microusd: 0, answer: first.turn.answer, outcome: "answered" });
    expect(second.events.filter((e) => e.type === "citation").length).toBe(first.turn.citations.length);
  });

  test("the monthly quota is checked before anything runs", async () => {
    const model = new ScriptedModel([(req) => [{ type: "text", text: `네 [${labelOf(req, "11월 3일")}].` }, done()]]);
    const { db, deps } = setup(model, { limits: { monthlyLimitMicrousd: 1_000 } });
    await ask(deps, db, workspaceScope, "출시일이 언제야?");
    expect(monthUsage(db, WS).spent).toBeGreaterThanOrEqual(1_000);
    const thread = createThread(db, { workspaceId: WS, userId: ME, scope: workspaceScope });
    const err = (() => {
      try {
        prepareAskTurn(deps, { thread, userId: ME, question: "또 물어봐도 돼?" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AskRequestError);
    expect(err).toMatchObject({ code: "quota_exceeded", status: 429 });
  });

  test("one running turn per thread; Idempotency-Key replays; other users get 404", () => {
    const { db, deps } = setup(new ScriptedModel([]));
    const thread = createThread(db, { workspaceId: WS, userId: ME, scope: noteScope });
    const a = prepareAskTurn(deps, { thread, userId: ME, question: "첫 질문", idempotencyKey: "k1" });
    expect(prepareAskTurn(deps, { thread, userId: ME, question: "첫 질문", idempotencyKey: "k1" })).toEqual({ turn: a.turn, replayed: true });
    expect(() => prepareAskTurn(deps, { thread, userId: ME, question: "둘째" })).toThrow(AskRequestError);
    expect(() => prepareAskTurn(deps, { thread, userId: "usr_someone", question: "엿보기" })).toThrow("대화를 찾을 수 없습니다.");
    expect(getThread(db, thread.id)!.title).toBe("첫 질문");
  });

  test("workspace scope: the model may search again, and new passages become citable", async () => {
    const model = new ScriptedModel([
      (req) => {
        expect(req.context).not.toContain("QA를"); // the first retrieval only found the lecture
        return [{ type: "tool_call", id: "t1", name: "search_notes", args: { query: "QA 일정 결정" } }, { ...done(3_000, 20), finish: "tool_calls" }];
      },
      (req) => [
        { type: "text", text: `ECB는 패턴이 드러나 위험합니다 [${labelOf(req, "패턴이 암호문에")}]. ` },
        { type: "text", text: `회의에서는 QA를 일주일 당기기로 결정했습니다 [${labelOf(req, "QA를")}].` },
        done(4_500, 60),
      ],
    ]);
    const { db, deps, calls } = setup(model);
    const { turn, events } = await ask(deps, db, workspaceScope, "ECB가 위험한 이유는 패턴 때문이야?");
    expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(["search_notes", "read_more"]);
    expect(model.requests[1]!.exchanges[0]!.calls[0]!.name).toBe("search_notes");
    expect(events.filter((e) => e.type === "tool").map((e) => e.type === "tool" && e.state)).toEqual(["started", "finished"]);
    expect(turn.outcome).toBe("answered");
    expect(turn.citations.some((c) => c.recording_id === REC.meeting)).toBe(true);
    expect(calls.length).toBe(2);
  });

  test("the per-turn cap stops the turn with budget_exceeded", async () => {
    const model = new ScriptedModel([]);
    const { db, deps } = setup(model, { limits: { perTurnCapMicrousd: 10 } });
    const { turn, events } = await ask(deps, db, noteScope, "ECB가 왜 위험해?");
    expect(model.requests).toEqual([]);
    expect(turn).toMatchObject({ status: "failed", error: { code: "budget_exceeded" } });
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "budget_exceeded" } });
  });

  test("a provider failure ends the turn as failed, with what it cost", async () => {
    const model = new ScriptedModel([() => [{ type: "text", text: "평문의" }, { ...done(4_000, 0), finish: "error" }]]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, noteScope, "ECB가 왜 위험해?");
    expect(turn).toMatchObject({ status: "failed", error: { code: "unavailable" }, cost_microusd: 1_200 });
  });

  test("an unpriced model is refused rather than run", async () => {
    const model = new ScriptedModel([]);
    const { db, deps } = setup(model, { price: () => null });
    const { turn } = await ask(deps, db, noteScope, "ECB가 왜 위험해?");
    expect(model.requests).toEqual([]);
    expect(turn.error?.code).toBe("unavailable");
  });

  test("a follow-up keeps the passages the previous answer cited", async () => {
    const model = new ScriptedModel([
      (req) => [{ type: "text", text: `11월 3일입니다 [${labelOf(req, "11월 3일")}].` }, done()],
      (req) => {
        expect(req.instruction).toContain("이전 질문: 출시일이 언제야?");
        return [{ type: "text", text: `마감 전에 회의록을 공유해야 합니다 [${labelOf(req, "회의록을 공유")}].` }, done()];
      },
    ]);
    const { db, deps } = setup(model);
    const first = await ask(deps, db, workspaceScope, "출시일이 언제야?");
    const second = await ask(deps, db, workspaceScope, "그 전에 할 일은?", first.thread.id);
    expect(second.turn.idx).toBe(1);
    expect(second.turn.outcome).toBe("answered");
  });

  test("with embeddings the query embedding is metered and charged to the turn", async () => {
    const embedder = new FakeEmbedder(64);
    const model = new ScriptedModel([(req) => [{ type: "text", text: `IV가 필요합니다 [${labelOf(req, "IV")}].` }, done()]]);
    const { db, deps, calls } = setup(model);
    for (const src of [cryptoSources(), meetingSources()]) await runIndexStage({ db, embedder }, src);
    deps.embedder = embedder;
    deps.vectorIndex = new SqliteVectorIndex(db, embedder.model, embedder.dim);
    deps.queryCache = new QueryEmbeddingCache();
    const { turn } = await ask(deps, db, workspaceScope, "CBC에 필요한 초기화 벡터");
    expect(calls.map((c) => c.purpose)).toEqual(["ask_embed", "ask"]);
    expect(turn.cost_microusd).toBe(1_700 + calls[0]!.costMicrousd);
  });
});
