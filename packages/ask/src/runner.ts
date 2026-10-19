// One ask turn end to end (docs/adr/0009-ask-rag.md, "실행 경로"):
//
//   prepareAskTurn (no model):  quota → turn row (409 while another turn runs, replay on Idempotency-Key)
//   runAskTurn (streams):       passages (full note | retrieval + follow-up carry-over)
//                               → no evidence?  answer 모름 without a model call
//                               → cached answer for the same passages?  replay it, cost 0
//                               → model round(s): stream, filter markers, optional tool loop (global scope)
//                               → verify citations → store the turn → turn.completed
//
// The model, embedder, prices and the cost ledger are injected: production wires the
// harness providers and recordAiCall; tests use scripted fakes. Nothing here calls a
// provider by itself.

import type { Database } from "bun:sqlite";
import type { AskCitation, AskOutcome, AskStreamEvent, AskThread, AskTurn, ErrorCode } from "@lectern/domain";
import { z } from "zod";
import { AnswerStreamFilter, NO_ANSWER_TEXT, toCitation, verifyAnswer } from "./citations.ts";
import {
  buildPrompt,
  CONTEXT_BUDGET,
  type ContextMode,
  fitBudget,
  type HistoryTurn,
  labelPassages,
  noteTokens,
  type Passage,
  PROMPT_VERSION,
  renderPassages,
} from "./context.ts";
import { hasEvidence, type QueryEmbeddingCache, retrieve } from "./hybrid.ts";
import type { AccessScope } from "./scope.ts";
import { type ChunkRow, chunksById, neighborChunk, recordingChunks } from "./store.ts";
import { estimateTokens, queryTerms } from "./text.ts";
import {
  answerCacheKey,
  ASK_LIMITS,
  checkQuota,
  completeTurn,
  evidenceHash,
  failTurn,
  findCachedAnswer,
  historyOf,
  listTurns,
  startTurn,
  TurnConflictError,
  type TurnUsage,
} from "./threads.ts";
import type { Embedder, VectorIndex } from "./vector.ts";

// ---------------------------------------------------------------------------
// Provider-facing interfaces
// ---------------------------------------------------------------------------

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** USD per 1M tokens, which is microUSD per token (as packages/harness pricing.json). */
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolExchange {
  calls: Array<{ id: string; name: string; args: unknown }>;
  results: Array<{ id: string; name: string; output: string }>;
  /**
   * The provider's own record of the model turn that made the calls, replayed unchanged
   * in the next request (Gemini attaches thought signatures to these parts and rejects a
   * follow-up without them). Opaque to the runner.
   */
  modelTurn?: unknown;
}

export interface AskModelRequest {
  system: string;
  /** Passages: the stable, cacheable part. */
  context: string;
  /** History and the question. */
  instruction: string;
  /** Earlier tool rounds of this turn, in order. */
  exchanges: readonly ToolExchange[];
  tools: readonly ToolSpec[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export type AskModelEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | {
      type: "done";
      usage: Usage;
      finish: "stop" | "length" | "tool_calls" | "refusal" | "error";
      requestId?: string | null;
      /** Provider-specific model turn, kept for ToolExchange.modelTurn. */
      turn?: unknown;
    };

/** A chat model that streams. Adapters (Gemini, Claude) live with the harness providers. */
export interface AskModel {
  readonly provider: string;
  /** Pinned model id. */
  readonly model: string;
  stream(req: AskModelRequest): AsyncIterable<AskModelEvent>;
}

export interface ModelCallRecord {
  purpose: "ask" | "ask_embed";
  workspaceId: string;
  provider: string;
  model: string;
  usage: Usage;
  latencyMs: number;
  status: "ok" | "error";
  requestId: string | null;
  costMicrousd: number;
}

/** Structured items for the `list_items` tool (event candidates, action items); P2/P4 implement it. */
export type ListItemsSource = (
  access: AccessScope,
  args: { kind: "events" | "action_items"; from?: string; to?: string },
) => Promise<string>;

export interface AskDeps {
  db: Database;
  model: AskModel;
  /** Price of a model, or null when unknown (then the call is refused: no unpriced spending). */
  price: (provider: string, model: string) => Price | null;
  embedder?: Embedder;
  vectorIndex?: VectorIndex;
  queryCache?: QueryEmbeddingCache;
  listItems?: ListItemsSource;
  /** Every model and embedding call, for the ai_call ledger (harness recordAiCall). */
  onModelCall?: (call: ModelCallRecord) => void;
  limits?: { perTurnCapMicrousd?: number; monthlyLimitMicrousd?: number | null; maxToolRounds?: number };
  now?: () => number;
}

export class AskRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_TOOL_ROUNDS = 2;
const TOOL_PASSAGES = 3;
const TOOL_TOKENS = 1_200;
/** In a round that offers tools, text is held back until this much arrives (a tool call discards it). */
const COMMIT_CHARS = 80;
/** Carry the previous turn's cited passages into a follow-up question (at most this many). */
const CARRY_OVER = 3;

/** User-facing message for a failed provider call; configuration problems say so. */
function providerErrorMessage(err: unknown): string {
  const text = String((err as { message?: unknown })?.message ?? err ?? "");
  if (/API key|GEMINI_API_KEY|not configured/i.test(text)) return "답변 모델이 설정되지 않았습니다(API 키 없음).";
  return "답변 모델 호출에 실패했습니다. 잠시 뒤 다시 시도해 주세요.";
}

export function costOf(usage: Usage, price: Price): number {
  return Math.round(usage.inputTokens * price.input + usage.cachedTokens * price.cachedInput + usage.outputTokens * price.output);
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

/** Checks that need no model and must answer as plain HTTP errors before the stream opens. */
export function prepareAskTurn(
  deps: Pick<AskDeps, "db" | "limits" | "now">,
  args: { thread: AskThread; userId: string; question: string; idempotencyKey?: string },
): { turn: AskTurn; replayed: boolean } {
  const now = deps.now?.() ?? Date.now();
  if (args.thread.user_id !== args.userId) throw new AskRequestError("not_found", 404, "대화를 찾을 수 없습니다.");
  const limit = deps.limits?.monthlyLimitMicrousd !== undefined ? deps.limits.monthlyLimitMicrousd : ASK_LIMITS.monthlyLimitMicrousd;
  const quota = checkQuota(deps.db, args.thread.workspace_id, limit, now);
  if (quota) throw new AskRequestError(quota.code, 429, quota.message);
  try {
    return startTurn(deps.db, { ...args, now });
  } catch (err) {
    if (err instanceof TurnConflictError) throw new AskRequestError("conflict", 409, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface Meter {
  usage: TurnUsage;
}

function emptyUsage(): TurnUsage {
  return { provider: null, model: null, llmCalls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicrousd: 0 };
}

/** The previous completed turn's cited chunks that still exist and are in scope. */
function carriedPassages(deps: AskDeps, access: AccessScope, threadId: string): ChunkRow[] {
  const prior = listTurns(deps.db, threadId).filter((t) => t.status === "completed").at(-1);
  if (!prior) return [];
  const ids = prior.citations.slice(0, CARRY_OVER).map((c: AskCitation) => c.chunk_id as string);
  return chunksById(deps.db, access.workspaceId, ids).filter((c) => access.recordings.has(c.recordingId));
}

async function selectPassages(
  deps: AskDeps,
  access: AccessScope,
  question: string,
  history: readonly HistoryTurn[],
  threadId: string,
  meter: Meter,
): Promise<{ mode: ContextMode; chunks: ChunkRow[]; grounded: boolean }> {
  if (access.scope.kind === "recording" && access.recordingIds.length === 1) {
    const all = recordingChunks(deps.db, access.workspaceId, access.recordingIds[0]!);
    if (all.length > 0 && noteTokens(all) <= CONTEXT_BUDGET.noteFullContextTokens) {
      return { mode: "full_note", chunks: all, grounded: true };
    }
  }
  // A short follow-up ("그건 언제야?") borrows the previous question's terms.
  const lastQuestion = history.at(-1)?.question;
  const query = lastQuestion && queryTerms(question).length < 2 ? `${lastQuestion} ${question}` : question;
  const result = await retrieve(
    { db: deps.db, embedder: deps.embedder, vectorIndex: deps.vectorIndex, queryCache: deps.queryCache },
    access,
    query,
  );
  if (result.embeddingTokens > 0 && deps.embedder) recordEmbedding(deps, access, result.embeddingTokens, meter);

  const carried = carriedPassages(deps, access, threadId);
  const seen = new Set(carried.map((c) => c.id));
  let ranked = [...carried, ...result.chunks.map((r) => r.chunk).filter((c) => !seen.has(c.id))];
  let grounded = hasEvidence(result) || carried.length > 0;
  if (!grounded && access.scope.kind === "recording" && access.recordingIds.length === 1) {
    // "요약해줘" on a long note matches nothing specific: give the note's document.
    ranked = recordingChunks(deps.db, access.workspaceId, access.recordingIds[0]!).filter((c) => c.kind === "document");
    grounded = ranked.length > 0;
  }
  const chosen = fitBudget(ranked, CONTEXT_BUDGET.retrievalTokens);
  // Group by note (best note first) and keep reading order inside a note.
  const firstRank = new Map<string, number>();
  chosen.forEach((c, i) => {
    if (!firstRank.has(c.recordingId)) firstRank.set(c.recordingId, i);
  });
  chosen.sort((a, b) => firstRank.get(a.recordingId)! - firstRank.get(b.recordingId)! || a.ordinal - b.ordinal);
  return { mode: "retrieval", chunks: chosen, grounded };
}

function recordEmbedding(deps: AskDeps, access: AccessScope, tokens: number, meter: Meter): void {
  const embedder = deps.embedder!;
  const price = deps.price(embedder.provider, embedder.model);
  const usage = { inputTokens: tokens, cachedTokens: 0, outputTokens: 0 };
  const cost = price ? costOf(usage, price) : 0;
  meter.usage.costMicrousd += cost;
  deps.onModelCall?.({
    purpose: "ask_embed",
    workspaceId: access.workspaceId,
    provider: embedder.provider,
    model: embedder.model,
    usage,
    latencyMs: 0,
    status: "ok",
    requestId: null,
    costMicrousd: cost,
  });
}

const SearchArgs = z.object({ query: z.string().min(1).max(200) });
const ReadMoreArgs = z.object({ label: z.string().regex(/^c\d+$/), direction: z.enum(["before", "after"]) });
const ListItemsArgs = z.object({
  kind: z.enum(["events", "action_items"]),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export function askTools(withListItems: boolean): ToolSpec[] {
  const tools: ToolSpec[] = [
    {
      name: "search_notes",
      description: "노트를 다시 검색해 조각을 더 가져온다. 주어진 조각으로 부족할 때만 쓴다.",
      parameters: z.toJSONSchema(SearchArgs) as Record<string, unknown>,
    },
    {
      name: "read_more",
      description: "조각 바로 앞이나 뒤의 내용을 더 읽는다.",
      parameters: z.toJSONSchema(ReadMoreArgs) as Record<string, unknown>,
    },
  ];
  if (withListItems) {
    tools.push({
      name: "list_items",
      description: "노트에서 뽑아 둔 일정이나 할 일을 기간으로 조회한다.",
      parameters: z.toJSONSchema(ListItemsArgs) as Record<string, unknown>,
    });
  }
  return tools;
}

/**
 * Streams one turn to `emit` and stores it. Never throws for model or retrieval
 * failures: the turn ends `failed` with an `error` event instead.
 */
export async function runAskTurn(
  deps: AskDeps,
  args: { access: AccessScope; thread: AskThread; turn: AskTurn; signal?: AbortSignal },
  emit: (event: AskStreamEvent) => void,
): Promise<AskTurn> {
  const { access, thread, turn } = args;
  const meter: Meter = { usage: emptyUsage() };
  emit({ type: "turn.started", thread_id: thread.id, turn_id: turn.id, idx: turn.idx, created_at: turn.created_at } as AskStreamEvent);
  try {
    const history = historyOf(deps.db, thread.id).slice(0, turn.idx);
    const { mode, chunks, grounded } = await selectPassages(deps, access, turn.question, history, thread.id, meter);
    let passages = labelPassages(access, chunks);
    emit({
      type: "retrieval",
      mode,
      passage_count: grounded ? passages.length : 0,
      recording_count: new Set(chunks.map((c) => c.recordingId)).size,
    });

    if (!grounded || passages.length === 0) {
      return finish(deps, emit, { turn, answer: NO_ANSWER_TEXT, citations: [], outcome: "no_answer", mode, passages: [], meter });
    }

    const evidence = evidenceHash(passages);
    const cacheKey = answerCacheKey({
      scope: thread.scope,
      question: turn.question,
      history,
      evidenceHash: evidence,
      provider: deps.model.provider,
      model: deps.model.model,
      promptVersion: PROMPT_VERSION,
    });
    const cached = findCachedAnswer(deps.db, access.workspaceId, cacheKey, deps.now?.() ?? Date.now());
    if (cached) {
      emit({ type: "answer.delta", text: cached.answer });
      for (const c of cached.citations) emit({ type: "citation", citation: { ...c, support: null } });
      return finish(deps, emit, { turn, ...cached, mode, passages, meter, evidence, cacheKey, cached: true });
    }

    const price = deps.price(deps.model.provider, deps.model.model);
    if (!price) throw new AskRequestError("unavailable", 503, "물어보기 모델의 단가가 설정되지 않았습니다.");
    meter.usage.provider = deps.model.provider;
    meter.usage.model = deps.model.model;
    const cap = deps.limits?.perTurnCapMicrousd ?? ASK_LIMITS.perTurnCapMicrousd;
    const maxRounds = access.scope.kind === "recording" ? 0 : (deps.limits?.maxToolRounds ?? MAX_TOOL_ROUNDS);
    const exchanges: ToolExchange[] = [];
    const filter = new AnswerStreamFilter(new Set(passages.map((p) => p.label)));
    const streamText = (text: string) => {
      const out = filter.push(text);
      if (out.text) emit({ type: "answer.delta", text: out.text });
      for (const label of out.newLabels) {
        const p = passages.find((x) => x.label === label)!;
        emit({ type: "citation", citation: toCitation(p, access, null) });
      }
    };

    for (let round = 0; ; round++) {
      const prompt = buildPrompt({ access, passages, history, question: turn.question, estimate: estimateTokens });
      const toolTokens = exchanges.reduce((n, x) => n + x.results.reduce((m, r) => m + estimateTokens(r.output), 0), 0);
      const callCost = (extraInput: number) =>
        costOf({ inputTokens: prompt.estimatedTokens + toolTokens + extraInput, cachedTokens: 0, outputTokens: CONTEXT_BUDGET.maxOutputTokens }, price);
      if (meter.usage.costMicrousd + callCost(0) > cap) {
        throw new AskRequestError("budget_exceeded", 429, "질문 한 번에 쓸 수 있는 비용을 넘었습니다.");
      }
      // Offer tools only if a follow-up round would still fit the cap.
      const offerTools =
        round < maxRounds && meter.usage.costMicrousd + callCost(0) + callCost(TOOL_TOKENS * 2) <= cap;
      const tools = offerTools ? askTools(Boolean(deps.listItems)) : [];

      let held = "";
      let committed = !offerTools;
      const calls: ToolExchange["calls"] = [];
      let done: Extract<AskModelEvent, { type: "done" }> | null = null;
      const started = performance.now();
      try {
        for await (const event of deps.model.stream({
          system: prompt.system,
          context: prompt.context,
          instruction: prompt.instruction,
          exchanges,
          tools,
          maxOutputTokens: CONTEXT_BUDGET.maxOutputTokens,
          signal: args.signal,
        })) {
          if (event.type === "text") {
            if (committed) streamText(event.text);
            else {
              held += event.text;
              if (held.length >= COMMIT_CHARS || held.includes("\n")) {
                committed = true;
                streamText(held);
                held = "";
              }
            }
          } else if (event.type === "tool_call") {
            if (!committed && offerTools) calls.push({ id: event.id, name: event.name, args: event.args });
          } else {
            done = event;
          }
        }
      } catch (err) {
        // Network, HTTP or parse failure inside the provider call: nothing is billed that
        // the provider did not report, and the turn ends as unavailable.
        meter.usage.llmCalls++;
        deps.onModelCall?.({
          purpose: "ask",
          workspaceId: access.workspaceId,
          provider: deps.model.provider,
          model: deps.model.model,
          usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
          latencyMs: Math.round(performance.now() - started),
          status: "error",
          requestId: null,
          costMicrousd: 0,
        });
        throw new AskRequestError("unavailable", 503, providerErrorMessage(err));
      }
      const usage = done?.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
      const cost = costOf(usage, price);
      meter.usage.llmCalls++;
      meter.usage.inputTokens += usage.inputTokens;
      meter.usage.cachedTokens += usage.cachedTokens;
      meter.usage.outputTokens += usage.outputTokens;
      meter.usage.costMicrousd += cost;
      deps.onModelCall?.({
        purpose: "ask",
        workspaceId: access.workspaceId,
        provider: deps.model.provider,
        model: deps.model.model,
        usage,
        latencyMs: Math.round(performance.now() - started),
        status: done && done.finish !== "error" ? "ok" : "error",
        requestId: done?.requestId ?? null,
        costMicrousd: cost,
      });
      if (!done || done.finish === "error") throw new AskRequestError("unavailable", 503, "답변 모델이 응답하지 않았습니다.");

      if (calls.length > 0) {
        const results: ToolExchange["results"] = [];
        for (const call of calls) {
          emit({ type: "tool", name: call.name, state: "started" });
          const { output, added } = await runTool(deps, access, passages, call, meter);
          passages = [...passages, ...added];
          results.push({ id: call.id, name: call.name, output });
          emit({ type: "tool", name: call.name, state: "finished" });
        }
        exchanges.push({ calls, results, modelTurn: done.turn });
        filter.addLabels(passages.map((p) => p.label));
        continue;
      }
      if (held) streamText(held);
      const tail = filter.end();
      if (tail.text) emit({ type: "answer.delta", text: tail.text });
      for (const label of tail.newLabels) {
        const p = passages.find((x) => x.label === label)!;
        emit({ type: "citation", citation: toCitation(p, access, null) });
      }
      break;
    }

    const verified = verifyAnswer({ answer: filter.text, noAnswer: filter.noAnswer, passages, access });
    return finish(deps, emit, { turn, ...verified, mode, passages, meter, evidence, cacheKey, cached: false });
  } catch (err) {
    const known = err instanceof AskRequestError;
    const failed = failTurn(deps.db, {
      turnId: turn.id,
      code: known ? err.code : "internal",
      message: known ? err.message : "답을 만들지 못했습니다.",
      usage: meter.usage,
      now: deps.now?.(),
    });
    emit({ type: "error", error: failed.error! });
    return failed;
  }
}

async function runTool(
  deps: AskDeps,
  access: AccessScope,
  passages: readonly Passage[],
  call: { id: string; name: string; args: unknown },
  meter: Meter,
): Promise<{ output: string; added: Passage[] }> {
  const next = passages.length + 1;
  const have = new Set(passages.map((p) => p.chunk.id));
  const asPassages = (chunks: ChunkRow[]) => {
    const fresh = fitBudget(
      chunks.filter((c) => !have.has(c.id)),
      TOOL_TOKENS,
    ).slice(0, TOOL_PASSAGES);
    const added = labelPassages(access, fresh, next);
    return { output: added.length ? renderPassages(added, access) : "결과 없음", added };
  };
  if (call.name === "search_notes") {
    const parsed = SearchArgs.safeParse(call.args);
    if (!parsed.success) return { output: "잘못된 인자", added: [] };
    const result = await retrieve(
      { db: deps.db, embedder: deps.embedder, vectorIndex: deps.vectorIndex, queryCache: deps.queryCache },
      access,
      parsed.data.query,
    );
    if (result.embeddingTokens > 0 && deps.embedder) recordEmbedding(deps, access, result.embeddingTokens, meter);
    return asPassages(result.chunks.map((r) => r.chunk));
  }
  if (call.name === "read_more") {
    const parsed = ReadMoreArgs.safeParse(call.args);
    const from = parsed.success ? passages.find((p) => p.label === parsed.data.label) : undefined;
    if (!parsed.success || !from) return { output: "잘못된 인자", added: [] };
    const neighbor = neighborChunk(deps.db, from.chunk, parsed.data.direction);
    return asPassages(neighbor && access.recordings.has(neighbor.recordingId) ? [neighbor] : []);
  }
  if (call.name === "list_items" && deps.listItems) {
    const parsed = ListItemsArgs.safeParse(call.args);
    if (!parsed.success) return { output: "잘못된 인자", added: [] };
    return { output: await deps.listItems(access, parsed.data), added: [] };
  }
  return { output: "알 수 없는 도구", added: [] };
}

function finish(
  deps: AskDeps,
  emit: (event: AskStreamEvent) => void,
  args: {
    turn: AskTurn;
    answer: string;
    citations: AskCitation[];
    outcome: AskOutcome;
    mode: ContextMode;
    passages: readonly Passage[];
    meter: Meter;
    evidence?: string;
    cacheKey?: string;
    cached?: boolean;
  },
): AskTurn {
  const completed = completeTurn(deps.db, {
    turnId: args.turn.id,
    answer: args.answer,
    citations: args.citations,
    outcome: args.outcome,
    mode: args.mode,
    passages: args.passages,
    evidenceHash: args.evidence ?? null,
    cacheKey: args.cacheKey ?? null,
    cached: args.cached ?? false,
    usage: args.meter.usage,
    now: deps.now?.(),
  });
  emit({ type: "turn.completed", turn: completed });
  return completed;
}
