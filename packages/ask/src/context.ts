// What the model reads: passages chosen within a token budget, labelled `c1`, `c2`, …
// (docs/adr/0009-ask-rag.md, "답변 생성").
//
// Note scope: if the whole note (document blocks, then transcript) fits
// NOTE_FULL_CONTEXT_TOKENS, the model gets all of it in reading order and retrieval
// cannot miss. Otherwise, and for folder/workspace scope, it gets the best retrieved
// passages. The prompt order is fixed (system → passages → history → question) so a
// stable prefix can hit the provider's prompt cache on follow-up questions.

import type { AccessScope } from "./scope.ts";
import { assertInScope } from "./scope.ts";
import type { ChunkRow } from "./store.ts";

export const CONTEXT_BUDGET = {
  /** A note at or under this many tokens is sent whole (full_note mode). */
  noteFullContextTokens: 6_000,
  /** Passage budget in retrieval mode. */
  retrievalTokens: 3_500,
  /** Previous turns kept for follow-up questions. */
  historyTurns: 3,
  historyTokens: 800,
  /** Answer length cap (also the per-call output budget). */
  maxOutputTokens: 700,
} as const;

export type ContextMode = "full_note" | "retrieval";

export interface Passage {
  label: string;
  chunk: ChunkRow;
}

export interface HistoryTurn {
  question: string;
  answer: string | null;
}

/** Labels passages `c1…cN` in the given order, after checking each is inside the scope. */
export function labelPassages(access: AccessScope, chunks: readonly ChunkRow[], startAt = 1): Passage[] {
  return chunks.map((chunk, i) => {
    assertInScope(access, chunk);
    return { label: `c${startAt + i}`, chunk };
  });
}

/** Keeps chunks in order until the token budget is spent (the first always fits). */
export function fitBudget(chunks: readonly ChunkRow[], budgetTokens: number): ChunkRow[] {
  const out: ChunkRow[] = [];
  let used = 0;
  for (const c of chunks) {
    if (out.length > 0 && used + c.tokens > budgetTokens) continue;
    out.push(c);
    used += c.tokens;
  }
  return out;
}

export function noteTokens(chunks: readonly ChunkRow[]): number {
  return chunks.reduce((n, c) => n + c.tokens, 0);
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Passage header: label, note title and date, and where in the note it is. */
export function passageHeader(p: Passage, access: AccessScope): string {
  const rec = access.recordings.get(p.chunk.recordingId);
  const title = rec ? `「${rec.title}」 ${rec.recordedAt.slice(0, 10)}` : "";
  const c = p.chunk;
  const where =
    c.kind === "transcript"
      ? `전사 ${clock(c.startMs ?? 0)}–${clock(c.endMs ?? 0)}`
      : c.kind === "pdf_page"
        ? `PDF ${c.page}쪽`
        : `문서${c.heading ? ` › ${c.heading}` : ""}`;
  return `[${p.label}] ${title} · ${where}`.replace("  ", " ");
}

export function renderPassages(passages: readonly Passage[], access: AccessScope): string {
  // Document headings are in the header, so the body is the chunk text alone.
  return passages.map((p) => `${passageHeader(p, access)}\n${p.chunk.text}`).join("\n\n");
}

/** Bump with any change to ASK_SYSTEM_PROMPT or the layout below (part of the answer cache key). */
export const PROMPT_VERSION = 1;

export const NO_ANSWER_SENTINEL = "[[모름]]";

export const ASK_SYSTEM_PROMPT = `너는 사용자의 노트(녹음 전사, 정리 문서, PDF)에서만 근거를 찾아 답한다.
규칙:
- 아래 [c번호] 조각에 있는 내용만 쓴다. 조각에 없는 사실, 일반 상식, 추측을 보태지 않는다.
- 사실을 말하는 문장마다 끝에 근거 조각을 [c3]처럼 붙인다. 여러 개면 [c3][c7]. 주어진 번호만 쓴다.
- 조각으로 답할 수 없으면 ${NO_ANSWER_SENTINEL}로 시작하고, 노트에서 무엇을 찾지 못했는지 한 문장으로 말한다.
- 짧게 답한다: 보통 2~5문장. 나열이 필요하면 "- " 목록을 쓴다. 시간은 쓰지 않는다(조각 번호로 충분하다).
- 질문과 같은 언어로 답한다.`;

export interface AskPrompt {
  system: string;
  /** The stable part: passages (cacheable across follow-ups in full_note mode). */
  context: string;
  /** History and the question. */
  instruction: string;
  /** Estimated input tokens of the whole prompt. */
  estimatedTokens: number;
}

export function buildPrompt(args: {
  access: AccessScope;
  passages: readonly Passage[];
  history: readonly HistoryTurn[];
  question: string;
  estimate: (text: string) => number;
}): AskPrompt {
  const context = `노트 조각:\n\n${renderPassages(args.passages, args.access)}`;
  const history = trimHistory(args.history, args.estimate)
    .map((t) => `이전 질문: ${t.question}\n이전 답: ${t.answer ?? "(답 없음)"}`)
    .join("\n\n");
  const instruction = `${history ? `${history}\n\n` : ""}질문: ${args.question}`;
  return {
    system: ASK_SYSTEM_PROMPT,
    context,
    instruction,
    estimatedTokens: args.estimate(ASK_SYSTEM_PROMPT) + args.estimate(context) + args.estimate(instruction),
  };
}

/** Last turns within the history budget, answers stripped of markers and shortened. */
export function trimHistory(history: readonly HistoryTurn[], estimate: (text: string) => number): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  let used = 0;
  for (const turn of history.slice(-CONTEXT_BUDGET.historyTurns).reverse()) {
    const answer = turn.answer?.replace(/\[c\d+\]/g, "").slice(0, 600) ?? null;
    const cost = estimate(turn.question) + estimate(answer ?? "");
    if (used + cost > CONTEXT_BUDGET.historyTokens) break;
    out.unshift({ question: turn.question, answer });
    used += cost;
  }
  return out;
}
