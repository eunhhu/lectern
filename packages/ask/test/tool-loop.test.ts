// The 물어보기 tool loop (P3-07, D-P3-6): which scopes offer search_notes and read_more,
// what each tool returns, the two-round cap, the provider's model turn replayed with every
// later round, the per-turn cap across rounds, the cost of each round, and scope on tool
// results. Scripted model, no network.

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { type AskScope, AskStreamEvent, AskTurn } from "@lectern/domain";
import {
  type AskDeps,
  type AskModel,
  type AskModelEvent,
  type AskModelRequest,
  CONTEXT_BUDGET,
  costOf,
  createThread,
  estimateTokens,
  MAX_TOOL_ROUNDS,
  type ModelCallRecord,
  prepareAskTurn,
  runAskTurn,
} from "../src/index.ts";
import { type AccessScope, resolveAccessScope } from "../src/scope.ts";
import { FOLDERS, ME, REC, RECORDINGS, scopeOf, seededDb, WS } from "./fixtures.ts";

const PRICE = { input: 0.3, cachedInput: 0.03, output: 2.5 };

/**
 * Plays scripted rounds (from runner.test.ts). Each request is kept with a copy of its
 * exchanges: the runner passes one array that grows round by round.
 */
class ScriptedModel implements AskModel {
  readonly provider = "gemini";
  readonly model = "gemini-3.5-flash-lite";
  requests: AskModelRequest[] = [];
  constructor(private rounds: Array<(req: AskModelRequest) => AskModelEvent[]>) {}
  async *stream(req: AskModelRequest): AsyncIterable<AskModelEvent> {
    this.requests.push({ ...req, exchanges: [...req.exchanges] });
    const round = this.rounds[this.requests.length - 1];
    if (!round) throw new Error("no scripted round left");
    for (const e of round(req)) yield e;
  }
}

const done = (inputTokens = 4_000, outputTokens = 200): Extract<AskModelEvent, { type: "done" }> => ({
  type: "done",
  usage: { inputTokens, cachedTokens: 0, outputTokens },
  finish: "stop",
  requestId: "req_1",
});

const toolDone = (turn?: unknown, inputTokens = 3_000, outputTokens = 20): AskModelEvent => ({
  ...done(inputTokens, outputTokens),
  finish: "tool_calls",
  ...(turn === undefined ? {} : { turn }),
});

const call = (id: string, name: string, args: unknown): AskModelEvent => ({ type: "tool_call", id, name, args });

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
    price: (provider, m) => (provider === "gemini" && m === "gemini-3.5-flash-lite" ? PRICE : null),
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

async function ask(deps: AskDeps, db: Database, scope: AskScope, question: string) {
  const thread = createThread(db, { workspaceId: WS, userId: ME, scope });
  const { turn } = prepareAskTurn(deps, { thread, userId: ME, question });
  const events: AskStreamEvent[] = [];
  const final = await runAskTurn(deps, { access: scopeFor(scope), thread, turn }, (e) => events.push(e));
  for (const e of events) expect(AskStreamEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
  expect(AskTurn.safeParse(final).success).toBe(true);
  return { thread, turn: final, events };
}

const toolStates = (events: AskStreamEvent[]) => events.filter((e) => e.type === "tool").map((e) => (e.type === "tool" ? `${e.name}:${e.state}` : ""));
const toolNames = (req: AskModelRequest) => req.tools.map((t) => t.name);

const noteScope = scopeOf({ kind: "recording", recording_id: REC.crypto });
const longNoteScope = scopeOf({ kind: "recording", recording_id: REC.long });
const workspaceScope = scopeOf({ kind: "workspace" });
const folderScope = scopeOf({ kind: "folder", folder_id: "fld_school", include_subfolders: true });

const ECB_QUESTION = "ECB가 위험한 이유는 패턴 때문이야?";
const answerEcb = (req: AskModelRequest): AskModelEvent[] => [{ type: "text", text: `패턴이 드러나서 위험합니다 [${labelOf(req, "패턴이 암호문에")}].` }, done()];
const answerQa = (req: AskModelRequest): AskModelEvent[] => [{ type: "text", text: `QA를 일주일 당겼습니다 [${labelOf(req, "QA를")}].` }, done()];

describe("tools on offer", () => {
  test("folder scope offers both tools", async () => {
    const model = new ScriptedModel([answerEcb]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, folderScope, "ECB가 왜 위험해?");
    expect(toolNames(model.requests[0]!)).toEqual(["search_notes", "read_more"]);
    expect(turn.outcome).toBe("answered");
  });

  test("workspace scope offers both tools", async () => {
    const model = new ScriptedModel([answerEcb]);
    const { db, deps } = setup(model);
    await ask(deps, db, workspaceScope, "ECB가 왜 위험해?");
    expect(toolNames(model.requests[0]!)).toEqual(["search_notes", "read_more"]);
  });

  test("note scope offers no tools", async () => {
    const full = new ScriptedModel([answerEcb]);
    const a = setup(full);
    const short = await ask(a.deps, a.db, noteScope, "ECB가 왜 위험해?");
    expect(short.events[1]).toMatchObject({ type: "retrieval", mode: "full_note" });
    expect(full.requests[0]!.tools).toEqual([]);

    const retrieval = new ScriptedModel([(req) => [{ type: "text", text: `10~100밀리초입니다 [${labelOf(req, "타임 퀀텀")}].` }, done()]]);
    const b = setup(retrieval);
    const long = await ask(b.deps, b.db, longNoteScope, "라운드 로빈 타임 퀀텀은 얼마로 잡아?");
    expect(long.events[1]).toMatchObject({ type: "retrieval", mode: "retrieval" });
    expect(retrieval.requests[0]!.tools).toEqual([]);
  });

  test("list_items not offered yet", async () => {
    const model = new ScriptedModel([answerEcb]);
    const { db, deps } = setup(model);
    expect(deps.listItems).toBeUndefined();
    await ask(deps, db, workspaceScope, "ECB가 왜 위험해?");
    expect(toolNames(model.requests[0]!)).not.toContain("list_items");
  });

  test("MAX_TOOL_ROUNDS is 2", () => {
    expect(MAX_TOOL_ROUNDS).toBe(2);
  });

  test("tools skipped when follow-up would not fit", async () => {
    // Measure the first prompt, then cap the turn at exactly one such call.
    const probe = new ScriptedModel([answerEcb]);
    const p = setup(probe);
    await ask(p.deps, p.db, workspaceScope, ECB_QUESTION);
    const first = probe.requests[0]!;
    const estimated = estimateTokens(first.system) + estimateTokens(first.context) + estimateTokens(first.instruction);
    const oneCall = costOf({ inputTokens: estimated, cachedTokens: 0, outputTokens: CONTEXT_BUDGET.maxOutputTokens }, PRICE);

    const model = new ScriptedModel([answerEcb]);
    const { db, deps } = setup(model, { limits: { perTurnCapMicrousd: oneCall } });
    const { turn } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests[0]!.tools).toEqual([]);
    expect(turn.outcome).toBe("answered");

    // Room for the first call and a follow-up with tool results: tools are offered again.
    const followUp = costOf({ inputTokens: estimated + 2_400, cachedTokens: 0, outputTokens: CONTEXT_BUDGET.maxOutputTokens }, PRICE);
    const roomy = new ScriptedModel([answerEcb]);
    const r = setup(roomy, { limits: { perTurnCapMicrousd: oneCall + followUp } });
    await ask(r.deps, r.db, workspaceScope, ECB_QUESTION);
    expect(toolNames(roomy.requests[0]!)).toEqual(["search_notes", "read_more"]);
  });
});

describe("tool rounds", () => {
  test("tool round then answer with citations", async () => {
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone()], answerQa]);
    const { db, deps } = setup(model);
    const { turn, events } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(turn.outcome).toBe("answered");
    expect(turn.citations.some((c) => c.recording_id === REC.meeting)).toBe(true);
    expect(model.requests.length).toBe(2);
    expect(events.filter((e) => e.type === "tool").map((e) => e.type === "tool" && e.state)).toEqual(["started", "finished"]);
  });

  test("read_more adds the neighbor passage", async () => {
    const model = new ScriptedModel([
      (req) => [call("t1", "read_more", { label: labelOf(req, "타임 퀀텀"), direction: "after" }), toolDone()],
      (req) => [{ type: "text", text: `10~100밀리초입니다 [${labelOf(req, "타임 퀀텀")}].` }, done()],
    ]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, workspaceScope, "라운드 로빈 타임 퀀텀은 얼마야?");
    const output = model.requests[1]!.exchanges[0]!.results[0]!.output;
    expect(output.startsWith("[c")).toBe(true);
    expect(output).not.toBe("결과 없음");
    expect(output).not.toContain("타임 퀀텀");
    expect(turn.outcome).toBe("answered");
  });

  test("read_more bad label", async () => {
    const model = new ScriptedModel([() => [call("t1", "read_more", { label: "c99", direction: "after" }), toolDone()], answerEcb]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests[1]!.exchanges[0]!.results[0]!.output).toBe("잘못된 인자");
    expect(turn.outcome).toBe("answered");
  });

  test("unknown tool", async () => {
    const model = new ScriptedModel([() => [call("t1", "delete_everything", {}), toolDone()], answerEcb]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests[1]!.exchanges[0]!.results[0]!.output).toBe("알 수 없는 도구");
    expect(turn.outcome).toBe("answered");
  });

  test("round cap: third call is ignored", async () => {
    const model = new ScriptedModel([
      () => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone()],
      (req) => [call("t2", "read_more", { label: labelOf(req, "QA를"), direction: "before" }), toolDone()],
      (req) => [call("t3", "search_notes", { query: "출시일" }), { type: "text", text: `QA를 일주일 당겼습니다 [${labelOf(req, "QA를")}].` }, done()],
    ]);
    const { db, deps } = setup(model);
    const { turn, events } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests.length).toBe(3);
    expect(model.requests[2]!.tools).toEqual([]);
    expect(model.requests[2]!.exchanges.length).toBe(2);
    expect(toolStates(events)).toEqual(["search_notes:started", "search_notes:finished", "read_more:started", "read_more:finished"]);
    expect(turn.outcome).toBe("answered");
  });

  test("model turn replay", async () => {
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone([{ opaque: "sig" }])], answerQa]);
    const { db, deps } = setup(model);
    await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests[1]!.exchanges[0]!.modelTurn).toEqual([{ opaque: "sig" }]);
  });

  test("second exchange keeps first", async () => {
    const model = new ScriptedModel([
      () => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone([{ opaque: "one" }])],
      (req) => [call("t2", "read_more", { label: labelOf(req, "QA를"), direction: "before" }), toolDone([{ opaque: "two" }])],
      answerQa,
    ]);
    const { db, deps } = setup(model);
    await ask(deps, db, workspaceScope, ECB_QUESTION);
    const exchanges = model.requests[2]!.exchanges;
    expect(exchanges.length).toBe(2);
    expect(exchanges.map((x) => x.calls.map((c) => c.id))).toEqual([["t1"], ["t2"]]);
    expect(exchanges.map((x) => x.results.map((r) => r.name))).toEqual([["search_notes"], ["read_more"]]);
    expect(exchanges.map((x) => x.modelTurn)).toEqual([[{ opaque: "one" }], [{ opaque: "two" }]]);
    // Each request saw only the rounds before it.
    expect(model.requests.map((r) => r.exchanges.length)).toEqual([0, 1, 2]);
  });

  test("scope is enforced for tool results", async () => {
    // Only the teammate's private note says this; the owner's workspace scope excludes it.
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "연봉 협상 전략" }), toolDone()], answerEcb]);
    const { db, deps } = setup(model);
    const { turn } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests[1]!.exchanges[0]!.results[0]!.output).toBe("결과 없음");
    expect(turn.citations.some((c) => c.recording_id === REC.privateTeammate)).toBe(false);
    expect(JSON.stringify(model.requests.map((r) => [r.context, r.exchanges.map((x) => x.results)]))).not.toContain("연봉");
  });

  test("cached answer skips model", async () => {
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone()], answerQa]);
    const { db, deps } = setup(model);
    const first = await ask(deps, db, workspaceScope, ECB_QUESTION);
    const second = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(model.requests.length).toBe(2);
    expect(second.turn).toMatchObject({ cached: true, cost_microusd: 0, answer: first.turn.answer, outcome: "answered" });
    expect(toolStates(second.events)).toEqual([]);
  });
});

describe("cost across rounds", () => {
  test("budget exceeded in the second round", async () => {
    // 3,333,000 input tokens × $0.30/M = 999,900 µ$: the next round cannot fit under 1,000,000.
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone(undefined, 3_333_000, 0)]]);
    const { db, deps } = setup(model, { limits: { perTurnCapMicrousd: 1_000_000 } });
    const { turn, events } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(turn).toMatchObject({ status: "failed", error: { code: "budget_exceeded" }, cost_microusd: 999_900 });
    expect(model.requests.length).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "budget_exceeded" } });
  });

  test("cost and ledger per round", async () => {
    const model = new ScriptedModel([() => [call("t1", "search_notes", { query: "QA 일정 결정" }), toolDone(undefined, 3_000, 20)], answerQa]);
    const { db, deps, calls } = setup(model);
    const { turn } = await ask(deps, db, workspaceScope, ECB_QUESTION);
    expect(calls.map((c) => c.purpose)).toEqual(["ask", "ask"]);
    expect(calls.map((c) => c.costMicrousd)).toEqual([costOf({ inputTokens: 3_000, cachedTokens: 0, outputTokens: 20 }, PRICE), 1_700]);
    expect(turn.cost_microusd).toBe(calls[0]!.costMicrousd + calls[1]!.costMicrousd);
  });
});
