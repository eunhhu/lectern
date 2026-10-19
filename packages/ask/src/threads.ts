// ask_thread / ask_turn persistence, the monthly quota and the answer cache
// (docs/adr/0009-ask-rag.md, "비용 통제").

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { AskCitation, AskOutcome, AskScope, AskThread, AskTurn, ErrorCode } from "@lectern/domain";
import type { ContextMode, HistoryTurn, Passage } from "./context.ts";

export const ASK_LIMITS = {
  /** No single question may cost more than this (model calls + query embedding). $0.02. */
  perTurnCapMicrousd: 20_000,
  /** Default monthly ask budget per workspace when none is configured. $2. Null = unlimited. */
  monthlyLimitMicrousd: 2_000_000 as number | null,
  /** Answers are reused for identical question + passages for this long. */
  cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** Turns per thread; a longer conversation starts a new thread. */
  maxTurnsPerThread: 100,
  /** Questions per user per 10 minutes (enforced by the HTTP layer). */
  ratePerUserPer10Min: 30,
} as const;

interface ThreadRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  scope_json: string;
  title: string;
  turn_count: number;
  created_at: number;
  updated_at: number;
}

interface TurnRecord {
  id: string;
  workspace_id: string;
  thread_id: string;
  idx: number;
  question: string;
  answer: string | null;
  citations_json: string;
  status: AskTurn["status"];
  outcome: AskOutcome | null;
  mode: ContextMode | null;
  cached: number;
  cost_microusd: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

function toThread(r: ThreadRecord): AskThread {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    user_id: r.user_id,
    scope: JSON.parse(r.scope_json) as AskScope,
    title: r.title,
    turn_count: r.turn_count,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  } as AskThread;
}

function toTurn(r: TurnRecord): AskTurn {
  return {
    id: r.id,
    thread_id: r.thread_id,
    workspace_id: r.workspace_id,
    idx: r.idx,
    question: r.question,
    answer: r.answer,
    citations: JSON.parse(r.citations_json) as AskCitation[],
    status: r.status,
    outcome: r.outcome,
    mode: r.mode,
    cached: Boolean(r.cached),
    cost_microusd: r.cost_microusd,
    error: r.error_code ? { code: r.error_code as ErrorCode, message: r.error_message ?? "" } : null,
    created_at: iso(r.created_at),
    completed_at: r.completed_at === null ? null : iso(r.completed_at),
  } as AskTurn;
}

export function threadTitle(question: string): string {
  const flat = question.replace(/\s+/gu, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

export function createThread(
  db: Database,
  args: { workspaceId: string; userId: string; scope: AskScope; title?: string; now?: number },
): AskThread {
  const now = args.now ?? Date.now();
  const id = Bun.randomUUIDv7();
  db.query(
    `INSERT INTO ask_thread (id, workspace_id, user_id, scope_kind, scope_json, recording_id, folder_id, title,
       turn_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    args.workspaceId,
    args.userId,
    args.scope.kind,
    JSON.stringify(args.scope),
    args.scope.kind === "recording" ? args.scope.recording_id : null,
    args.scope.kind === "folder" ? args.scope.folder_id : null,
    args.title ?? "새 대화",
    now,
    now,
  );
  return getThread(db, id)!;
}

export function getThread(db: Database, id: string): AskThread | null {
  const r = db.query(`SELECT * FROM ask_thread WHERE id = ?`).get(id) as ThreadRecord | null;
  return r ? toThread(r) : null;
}

/** A thread only its owner may see; anyone else gets null (answer 404). */
export function getOwnThread(db: Database, id: string, userId: string): AskThread | null {
  const thread = getThread(db, id);
  return thread && thread.user_id === userId ? thread : null;
}

export function listTurns(db: Database, threadId: string): AskTurn[] {
  return (db.query(`SELECT * FROM ask_turn WHERE thread_id = ? ORDER BY idx`).all(threadId) as TurnRecord[]).map(toTurn);
}

export function historyOf(db: Database, threadId: string): HistoryTurn[] {
  return (
    db
      .query(`SELECT question, answer FROM ask_turn WHERE thread_id = ? AND status = 'completed' ORDER BY idx`)
      .all(threadId) as HistoryTurn[]
  ).map((t) => ({ question: t.question, answer: t.answer }));
}

export function listThreads(
  db: Database,
  args: { workspaceId: string; userId: string; recordingId?: string; limit: number; before?: number },
): AskThread[] {
  const rows = db
    .query(
      `SELECT * FROM ask_thread WHERE workspace_id = ?1 AND user_id = ?2 AND (?3 IS NULL OR recording_id = ?3)
         AND (?4 IS NULL OR updated_at < ?4)
       ORDER BY updated_at DESC, id DESC LIMIT ?5`,
    )
    .all(args.workspaceId, args.userId, args.recordingId ?? null, args.before ?? null, args.limit) as ThreadRecord[];
  return rows.map(toThread);
}

export function deleteThread(db: Database, id: string): void {
  db.transaction(() => {
    db.query(`DELETE FROM ask_turn WHERE thread_id = ?`).run(id);
    db.query(`DELETE FROM ask_thread WHERE id = ?`).run(id);
  })();
}

/** Called when a recording is deleted: its note-scoped threads go with it. */
export function deleteRecordingThreads(db: Database, workspaceId: string, recordingId: string): number {
  return db.transaction(() => {
    const ids = (
      db.query(`SELECT id FROM ask_thread WHERE workspace_id = ? AND recording_id = ?`).all(workspaceId, recordingId) as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    for (const id of ids) deleteThread(db, id);
    return ids.length;
  })();
}

export class TurnConflictError extends Error {}

/**
 * Starts a turn in `running` state. Refuses (TurnConflictError, HTTP 409) while another
 * turn of the thread is running. A repeated Idempotency-Key returns the existing turn.
 */
export function startTurn(
  db: Database,
  args: { thread: AskThread; userId: string; question: string; idempotencyKey?: string; now?: number },
): { turn: AskTurn; replayed: boolean } {
  const now = args.now ?? Date.now();
  return db.transaction(() => {
    if (args.idempotencyKey) {
      const prior = db
        .query(`SELECT * FROM ask_turn WHERE thread_id = ? AND idempotency_key = ?`)
        .get(args.thread.id, args.idempotencyKey) as TurnRecord | null;
      if (prior) return { turn: toTurn(prior), replayed: true };
    }
    if (db.query(`SELECT 1 FROM ask_turn WHERE thread_id = ? AND status = 'running'`).get(args.thread.id)) {
      throw new TurnConflictError("이 대화에서 이미 답을 만들고 있습니다.");
    }
    const { n } = db.query(`SELECT COUNT(*) AS n FROM ask_turn WHERE thread_id = ?`).get(args.thread.id) as { n: number };
    if (n >= ASK_LIMITS.maxTurnsPerThread) throw new TurnConflictError("대화가 너무 길어졌습니다. 새 대화를 시작하세요.");
    const id = Bun.randomUUIDv7();
    db.query(
      `INSERT INTO ask_turn (id, workspace_id, thread_id, user_id, idx, question, status, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    ).run(id, args.thread.workspace_id, args.thread.id, args.userId, n, args.question, args.idempotencyKey ?? null, now);
    db.query(
      `UPDATE ask_thread SET turn_count = ?, updated_at = ?, title = CASE WHEN ? = 0 THEN ? ELSE title END WHERE id = ?`,
    ).run(n + 1, now, n, threadTitle(args.question), args.thread.id);
    return { turn: toTurn(db.query(`SELECT * FROM ask_turn WHERE id = ?`).get(id) as TurnRecord), replayed: false };
  })();
}

export interface TurnUsage {
  provider: string | null;
  model: string | null;
  llmCalls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costMicrousd: number;
}

export function completeTurn(
  db: Database,
  args: {
    turnId: string;
    answer: string;
    citations: readonly AskCitation[];
    outcome: AskOutcome;
    mode: ContextMode | null;
    passages: readonly Passage[];
    evidenceHash: string | null;
    cacheKey: string | null;
    cached: boolean;
    usage: TurnUsage;
    now?: number;
  },
): AskTurn {
  const now = args.now ?? Date.now();
  const evidence = args.passages.map((p) => ({ label: p.label, chunk_id: p.chunk.id, sha: p.chunk.contentSha256 }));
  db.query(
    `UPDATE ask_turn SET status = 'completed', answer = ?, citations_json = ?, outcome = ?, mode = ?, evidence_json = ?,
       evidence_hash = ?, cache_key = ?, cached = ?, provider = ?, model = ?, llm_calls = ?, input_tokens = ?,
       cached_tokens = ?, output_tokens = ?, cost_microusd = ?, completed_at = ? WHERE id = ?`,
  ).run(
    args.answer,
    JSON.stringify(args.citations),
    args.outcome,
    args.mode,
    JSON.stringify(evidence),
    args.evidenceHash,
    args.cacheKey,
    args.cached ? 1 : 0,
    args.usage.provider,
    args.usage.model,
    args.usage.llmCalls,
    args.usage.inputTokens,
    args.usage.cachedTokens,
    args.usage.outputTokens,
    args.usage.costMicrousd,
    now,
    args.turnId,
  );
  return toTurn(db.query(`SELECT * FROM ask_turn WHERE id = ?`).get(args.turnId) as TurnRecord);
}

export function failTurn(
  db: Database,
  args: { turnId: string; code: ErrorCode; message: string; usage?: TurnUsage; now?: number },
): AskTurn {
  const now = args.now ?? Date.now();
  db.query(
    `UPDATE ask_turn SET status = 'failed', error_code = ?, error_message = ?, provider = ?, model = ?, llm_calls = ?,
       input_tokens = ?, cached_tokens = ?, output_tokens = ?, cost_microusd = ?, completed_at = ? WHERE id = ?`,
  ).run(
    args.code,
    args.message,
    args.usage?.provider ?? null,
    args.usage?.model ?? null,
    args.usage?.llmCalls ?? 0,
    args.usage?.inputTokens ?? 0,
    args.usage?.cachedTokens ?? 0,
    args.usage?.outputTokens ?? 0,
    args.usage?.costMicrousd ?? 0,
    now,
    args.turnId,
  );
  return toTurn(db.query(`SELECT * FROM ask_turn WHERE id = ?`).get(args.turnId) as TurnRecord);
}

/** Turns stuck in `running` (process died mid-answer) become failed; run at boot and by maintenance. */
export function failStaleTurns(db: Database, olderThanMs: number, now = Date.now()): number {
  return db
    .query(
      `UPDATE ask_turn SET status = 'failed', error_code = 'unavailable', error_message = '답을 만드는 중에 서버가 다시 시작됐습니다.',
         completed_at = ? WHERE status = 'running' AND created_at < ?`,
    )
    .run(now, now - olderThanMs).changes;
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export function monthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function monthUsage(db: Database, workspaceId: string, now = Date.now()): { turns: number; spent: number } {
  const r = db
    .query(`SELECT COUNT(*) AS turns, COALESCE(SUM(cost_microusd), 0) AS spent FROM ask_turn WHERE workspace_id = ? AND created_at >= ?`)
    .get(workspaceId, monthStart(now)) as { turns: number; spent: number };
  return r;
}

/** Null when the workspace may ask; the error otherwise. */
export function checkQuota(
  db: Database,
  workspaceId: string,
  limitMicrousd: number | null,
  now = Date.now(),
): { code: "quota_exceeded"; message: string } | null {
  if (limitMicrousd === null) return null;
  const { spent } = monthUsage(db, workspaceId, now);
  return spent >= limitMicrousd
    ? { code: "quota_exceeded", message: "이번 달 물어보기 한도를 다 썼습니다. 다음 달 1일에 다시 열립니다." }
    : null;
}

// ---------------------------------------------------------------------------
// Answer cache
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Hash of exactly what the model would read: labels, chunk ids and their contents. */
export function evidenceHash(passages: readonly Passage[]): string {
  return sha256(passages.map((p) => `${p.label}:${p.chunk.id}:${p.chunk.contentSha256}`).join("\n"));
}

/**
 * Cache key: same scope, same normalized question, same history, same passages, same
 * model and prompt → same answer. Retrieval is re-run on every question (it is cheap),
 * so an unrelated note added to the workspace does not invalidate the entry; a changed
 * passage does.
 */
export function answerCacheKey(args: {
  scope: AskScope;
  question: string;
  history: readonly HistoryTurn[];
  evidenceHash: string;
  provider: string;
  model: string;
  promptVersion: number;
}): string {
  return sha256(
    JSON.stringify({
      v: 1,
      scope: args.scope,
      q: args.question.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase(),
      h: args.history.map((t) => [t.question, t.answer]),
      e: args.evidenceHash,
      p: [args.provider, args.model, args.promptVersion],
    }),
  );
}

export function findCachedAnswer(
  db: Database,
  workspaceId: string,
  cacheKey: string,
  now = Date.now(),
): { answer: string; citations: AskCitation[]; outcome: AskOutcome } | null {
  const r = db
    .query(
      `SELECT answer, citations_json, outcome FROM ask_turn
       WHERE workspace_id = ? AND cache_key = ? AND status = 'completed' AND outcome IN ('answered', 'no_answer')
         AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(workspaceId, cacheKey, now - ASK_LIMITS.cacheTtlMs) as {
    answer: string;
    citations_json: string;
    outcome: AskOutcome;
  } | null;
  return r ? { answer: r.answer, citations: JSON.parse(r.citations_json) as AskCitation[], outcome: r.outcome } : null;
}
