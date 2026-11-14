// 물어보기 over lecture PDF pages (P3-06, D-P3-5): a question only the slides answer is
// answered with a page citation, out-of-scope PDFs never reach the model, and a scope
// without the PDF ends as no_answer without a model call. Scripted model, no network.

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { type AskScope, AskCitation, AskStreamEvent, AskTurn } from "@lectern/domain";
import {
  type AskDeps,
  type AskModel,
  type AskModelEvent,
  type AskModelRequest,
  createThread,
  type ModelCallRecord,
  prepareAskTurn,
  runAskTurn,
  runIndexStage,
} from "../src/index.ts";
import { type AccessScope, resolveAccessScope } from "../src/scope.ts";
import { FOLDERS, ME, pdfSources, RECORDINGS, scopeOf, seededDb, WS } from "./fixtures.ts";

// From runner.test.ts.
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

function labelOf(req: AskModelRequest, needle: string): string {
  const text = [req.context, ...req.exchanges.flatMap((x) => x.results.map((r) => r.output))].join("\n\n");
  const blocks = text.split("\n\n").filter((b) => b.startsWith("[c"));
  const hit = blocks.find((b) => b.includes(needle));
  if (!hit) throw new Error(`no passage with ${needle}`);
  return /^\[(c\d+)\]/.exec(hit)![1]!;
}

async function setup(model: AskModel) {
  const db = seededDb();
  for (const src of pdfSources()) await runIndexStage({ db }, src);
  const calls: ModelCallRecord[] = [];
  const deps: AskDeps = {
    db,
    model,
    price: (provider, m) => (provider === "gemini" && m === "gemini-3.5-flash-lite" ? { input: 0.3, cachedInput: 0.03, output: 2.5 } : null),
    onModelCall: (c) => calls.push(c),
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
  return { turn: final, events };
}

const workspaceScope = scopeOf({ kind: "workspace" });

describe("ask over PDF pages", () => {
  test("asking for pdf-only content cites the page", async () => {
    const model = new ScriptedModel([(req) => [{ type: "text", text: `14라운드를 쓰고 서브키 스케줄로 키를 확장합니다 [${labelOf(req, "서브키")}].` }, done()]]);
    const { db, deps } = await setup(model);
    const { turn, events } = await ask(deps, db, workspaceScope, "AES-256은 몇 라운드를 쓰고 키 확장은 어떻게 해?");
    expect(turn.outcome).toBe("answered");
    const pdf = turn.citations.find((c) => c.kind === "pdf_page");
    expect(pdf).toMatchObject({ kind: "pdf_page", asset_id: "ast_slides", page: 2 });
    expect(events.some((e) => e.type === "citation")).toBe(true);
  });

  test("pdf citation passes domain schema", async () => {
    const model = new ScriptedModel([(req) => [{ type: "text", text: `서브키 스케줄입니다 [${labelOf(req, "서브키")}].` }, done()]]);
    const { db, deps } = await setup(model);
    const { turn } = await ask(deps, db, workspaceScope, "AES-256 키 확장 서브키 스케줄은?");
    expect(turn.citations.length).toBeGreaterThan(0);
    for (const c of turn.citations) expect(AskCitation.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });

  test("out-of-scope pdf never reaches the model", async () => {
    const model = new ScriptedModel([() => [{ type: "text", text: "자료에서 찾지 못했습니다." }, done()]]);
    const { db, deps } = await setup(model);
    await ask(deps, db, workspaceScope, "연봉 협상 자료 알려줘");
    for (const req of model.requests) expect(JSON.stringify(req)).not.toContain("연봉");
  });

  test("folder scope table has a pdf row", async () => {
    const model = new ScriptedModel([]);
    const { db, deps, calls } = await setup(model);
    const { turn } = await ask(deps, db, scopeOf({ kind: "folder", folder_id: "fld_work", include_subfolders: false }), "서브키 스케줄");
    expect(turn.outcome).toBe("no_answer");
    expect(model.requests).toEqual([]);
    expect(calls).toEqual([]);
  });
});
