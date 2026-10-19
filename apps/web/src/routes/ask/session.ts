// One 물어보기 conversation on screen (packages/domain/src/api/ask.ts): a thread with a
// fixed scope, created on the first question, and its turns. A turn streams
// `turn.started` → `retrieval` → (`tool`) → `answer.delta`/`citation` → `turn.completed`
// | `error`; the completed turn replaces what was streamed. Turns live here (not in the
// query cache) while they stream, so closing a panel does not lose them.
//
// The server finishes and stores a turn even when the reader stops or the stream breaks,
// so "stop" and a dropped connection both offer to load the stored answer from the
// thread instead of asking (and paying) again.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api/client.ts";
import { isNotReady } from "../../api/errors.ts";
import { askKeys, useApi } from "../../api/queries.ts";
import type { AskCitation, AskOutcome, AskScope, AskThreadDetail, AskTurn as AskTurnDto, WorkspaceId } from "../../api/types.ts";
import { announce } from "../../ui/toast.tsx";
import { sameScope } from "./citations.ts";

/**
 * searching → streaming → completed, or: stopped (the reader stopped it), failed (the
 * server reported an error for the turn), error (the request or the stream failed),
 * not_ready (the server has no 물어보기 yet), pending (stored turn still running).
 */
export type TurnPhase = "searching" | "streaming" | "completed" | "stopped" | "failed" | "error" | "not_ready" | "pending";

export interface AskTurnView {
  /** Local key (stable across retries). */
  key: string;
  /** Server turn id, once `turn.started` arrived. */
  turnId: string | null;
  question: string;
  scope: AskScope;
  phase: TurnPhase;
  text: string;
  citations: AskCitation[];
  outcome: AskOutcome | null;
  retrieval: { mode: string; passages: number; recordings: number } | null;
  /** An extra lookup the agent is running (`search_notes` …). */
  tool: string | null;
  error: { code: string; message: string } | null;
}

export interface AskSession {
  threadId: string | null;
  turns: AskTurnView[];
  busy: boolean;
  /** Asks in the current thread, or starts a new one when there is none or the scope differs. */
  send: (question: string, scope: AskScope) => void;
  stop: () => void;
  /** Asks a failed turn again (a new turn). */
  retry: (key: string) => void;
  /** Loads what the server stored for a stopped or disconnected turn. */
  recover: (key: string) => void;
  /** Start a new conversation. */
  reset: () => void;
  /** Show a saved conversation. */
  load: (detail: AskThreadDetail) => void;
}

let localSeq = 0;
const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";
const RECOVER_POLL_MS = 1500;
const RECOVER_TRIES = 20;

/** A stored turn as it shows on screen. */
export function turnView(turn: AskTurnDto, scope: AskScope, key: string = turn.id): AskTurnView {
  const phase: TurnPhase = turn.status === "completed" ? "completed" : turn.status === "failed" ? "failed" : "pending";
  return {
    key,
    turnId: turn.id,
    question: turn.question,
    scope,
    phase,
    text: turn.answer ?? "",
    citations: turn.citations,
    outcome: turn.outcome,
    retrieval: null,
    tool: null,
    error: turn.error,
  };
}

function announceCompleted(turn: AskTurnDto) {
  if (turn.outcome === "no_answer") announce("관련 내용을 찾지 못했습니다.");
  else if (turn.outcome === "unsupported") announce("답을 받았지만 출처를 확인하지 못했습니다.");
  else announce(`답변을 마쳤습니다. 출처 ${turn.citations.length}개.`);
}

export function useAskSession(workspaceId: WorkspaceId): AskSession {
  const api = useApi();
  const queryClient = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurnView[]>([]);
  const thread = useRef<{ id: string; scope: AskScope } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => () => controller.current?.abort(), []);

  const patch = (key: string, change: Partial<AskTurnView> | ((t: AskTurnView) => Partial<AskTurnView>)) =>
    setTurns((all) => all.map((t) => (t.key === key ? { ...t, ...(typeof change === "function" ? change(t) : change) } : t)));

  const refreshHistory = useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: askKeys.threads(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: askKeys.thread(id) });
    },
    [queryClient, workspaceId],
  );

  /** `byServer`: the stream's `error` event ended the turn (asking again makes a new turn). */
  const fail = (key: string, err: unknown, byServer = false) => {
    if (isNotReady(err)) {
      patch(key, { phase: "not_ready", error: { code: "not_implemented", message: "물어보기는 아직 이 서버에서 준비 중입니다." } });
      announce("물어보기는 아직 준비 중입니다.");
      return;
    }
    const error = err instanceof ApiClientError ? { code: err.code, message: err.message } : { code: "network", message: "잠시 후 다시 시도하세요." };
    patch(key, { phase: byServer ? "failed" : "error", error, tool: null });
    announce("답을 받지 못했습니다.");
  };

  const run = useCallback(
    async (turn: AskTurnView) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      let byServer = false;
      try {
        if (!thread.current) {
          const created = await api.createAskThread({ workspace_id: workspaceId, scope: turn.scope });
          thread.current = { id: created.id, scope: created.scope };
          setThreadId(created.id);
        }
        const id = thread.current.id;
        const done = await api.askQuestion(id, turn.question, {
          signal: ctrl.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "turn.started":
                patch(turn.key, { turnId: event.turn_id });
                break;
              case "retrieval":
                patch(turn.key, { phase: "streaming", retrieval: { mode: event.mode, passages: event.passage_count, recordings: event.recording_count } });
                announce(event.passage_count ? `노트 ${event.recording_count}개에서 관련 구간 ${event.passage_count}개를 찾았습니다.` : "관련 구간을 찾지 못했습니다.");
                break;
              case "tool":
                patch(turn.key, { tool: event.state === "started" ? event.name : null });
                break;
              case "answer.delta":
                patch(turn.key, (t) => ({ phase: "streaming", text: t.text + event.text }));
                break;
              case "citation":
                patch(turn.key, (t) => (t.citations.some((c) => c.label === event.citation.label) ? {} : { citations: [...t.citations, event.citation] }));
                break;
              case "error":
                byServer = true;
                break;
              default:
                break;
            }
          },
        });
        patch(turn.key, { ...turnView(done, turn.scope, turn.key), retrieval: turnsRef.current.find((t) => t.key === turn.key)?.retrieval ?? null });
        announceCompleted(done);
        refreshHistory(id);
      } catch (err) {
        if (isAbort(err)) {
          patch(turn.key, { phase: "stopped", tool: null });
          announce("답을 멈췄습니다.");
        } else {
          fail(turn.key, err, byServer);
        }
        if (thread.current) refreshHistory(thread.current.id);
      } finally {
        if (controller.current === ctrl) controller.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, workspaceId, refreshHistory],
  );

  const send = useCallback(
    (question: string, scope: AskScope) => {
      const text = question.trim();
      if (!text) return;
      const view: AskTurnView = {
        key: `turn_${++localSeq}`,
        turnId: null,
        question: text,
        scope,
        phase: "searching",
        text: "",
        citations: [],
        outcome: null,
        retrieval: null,
        tool: null,
        error: null,
      };
      // A thread's scope is fixed: another scope starts another conversation.
      if (thread.current && !sameScope(thread.current.scope, scope)) {
        controller.current?.abort();
        thread.current = null;
        setThreadId(null);
        setTurns([view]);
      } else {
        setTurns((all) => [...all, view]);
      }
      void run(view);
    },
    [run],
  );

  const retry = useCallback(
    (key: string) => {
      const turn = turnsRef.current.find((t) => t.key === key);
      if (!turn) return;
      const fresh: AskTurnView = { ...turn, turnId: null, phase: "searching", text: "", citations: [], outcome: null, retrieval: null, tool: null, error: null };
      patch(key, fresh);
      void run(fresh);
    },
    [run],
  );

  const recover = useCallback(
    async (key: string) => {
      const turn = turnsRef.current.find((t) => t.key === key);
      const id = thread.current?.id;
      if (!turn?.turnId || !id) return;
      patch(key, { phase: "pending", error: null });
      for (let i = 0; i < RECOVER_TRIES; i++) {
        try {
          const detail = await api.getAskThread(id);
          const stored = detail.turns.find((t) => t.id === turn.turnId);
          if (stored && stored.status !== "running") {
            patch(key, turnView(stored, turn.scope, key));
            if (stored.status === "completed") announceCompleted(stored);
            refreshHistory(id);
            return;
          }
        } catch (err) {
          fail(key, err);
          return;
        }
        await new Promise((r) => setTimeout(r, RECOVER_POLL_MS));
      }
      patch(key, { phase: "error", error: { code: "network", message: "답이 아직 저장되지 않았습니다. 잠시 뒤 대화 기록에서 확인하세요." } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, refreshHistory],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    thread.current = null;
    setThreadId(null);
    setTurns([]);
  }, []);

  const load = useCallback((detail: AskThreadDetail) => {
    controller.current?.abort();
    thread.current = { id: detail.thread.id, scope: detail.thread.scope };
    setThreadId(detail.thread.id);
    setTurns(detail.turns.map((t) => turnView(t, detail.thread.scope)));
  }, []);

  const busy = turns.some((t) => t.phase === "searching" || t.phase === "streaming" || t.phase === "pending");
  return { threadId, turns, busy, send, stop, retry, recover: (key) => void recover(key), reset, load };
}
