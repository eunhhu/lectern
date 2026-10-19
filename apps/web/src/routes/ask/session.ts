// One 물어보기 conversation on screen: the turns asked so far, each with its streaming
// answer. Turns live here (not in the query cache) while they stream; once an answer is
// done the thread is saved by the API and the history list is refreshed. Lives in the
// screen that owns the conversation, so closing a panel does not lose it.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../api/client.ts";
import { useApi } from "../../api/queries.ts";
import type { AskCitation, AskScope, AskThreadDetail } from "../../api/types.ts";
import { announce } from "../../ui/toast.tsx";

export type TurnStatus = "searching" | "streaming" | "complete" | "no_evidence" | "stopped" | "error";

export interface AskTurn {
  id: string;
  question: string;
  scope: AskScope;
  status: TurnStatus;
  text: string;
  citations: AskCitation[];
  searched: number;
  error: string | null;
}

export interface AskSession {
  threadId: string | null;
  turns: AskTurn[];
  busy: boolean;
  send: (question: string, scope: AskScope) => void;
  stop: () => void;
  retry: (turnId: string) => void;
  /** Start a new conversation. */
  reset: () => void;
  /** Show a saved conversation. */
  load: (detail: AskThreadDetail) => void;
}

let localSeq = 0;
const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export function useAskSession(workspaceId: string): AskSession {
  const api = useApi();
  const queryClient = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const threadRef = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const patch = (id: string, change: Partial<AskTurn> | ((t: AskTurn) => Partial<AskTurn>)) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof change === "function" ? change(t) : change) } : t)));

  const run = useCallback(
    async (turn: AskTurn) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      try {
        await api.ask(
          { workspace_id: workspaceId, thread_id: threadRef.current, question: turn.question, scope: turn.scope },
          {
            signal: ctrl.signal,
            onEvent: (event) => {
              if (event.type === "retrieval") {
                patch(turn.id, { status: "streaming", citations: event.citations, searched: event.searched });
                announce(event.citations.length ? `노트 ${event.searched}개에서 관련 구간 ${event.citations.length}개를 찾았습니다.` : "관련 구간을 찾는 중입니다.");
              } else if (event.type === "delta") {
                patch(turn.id, (t) => ({ text: t.text + event.text }));
              } else {
                threadRef.current = event.thread.id;
                setThreadId(event.thread.id);
                patch(turn.id, { status: event.answer.status, text: event.answer.text, citations: event.answer.citations, searched: event.answer.searched });
                announce(event.answer.status === "no_evidence" ? "관련 내용을 찾지 못했습니다." : `답변을 마쳤습니다. 출처 ${event.answer.citations.length}개.`);
                void queryClient.invalidateQueries({ queryKey: ["ask-threads", workspaceId] });
                void queryClient.invalidateQueries({ queryKey: ["ask-thread", event.thread.id] });
              }
            },
          },
        );
      } catch (err) {
        if (isAbort(err)) {
          patch(turn.id, { status: "stopped" });
          announce("답을 멈췄습니다.");
        } else {
          const message = err instanceof ApiClientError ? err.message : "잠시 후 다시 시도하세요.";
          patch(turn.id, { status: "error", error: message });
          announce("답을 받지 못했습니다.");
        }
      } finally {
        if (controller.current === ctrl) controller.current = null;
      }
    },
    [api, queryClient, workspaceId],
  );

  const send = useCallback(
    (question: string, scope: AskScope) => {
      const text = question.trim();
      if (!text) return;
      const turn: AskTurn = { id: `turn_${++localSeq}`, question: text, scope, status: "searching", text: "", citations: [], searched: 0, error: null };
      setTurns((all) => [...all, turn]);
      void run(turn);
    },
    [run],
  );

  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const retry = useCallback(
    (turnId: string) => {
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn) return;
      const fresh: AskTurn = { ...turn, status: "searching", text: "", citations: [], error: null };
      patch(turnId, fresh);
      void run(fresh);
    },
    [run],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    threadRef.current = null;
    setThreadId(null);
    setTurns([]);
  }, []);

  const load = useCallback((detail: AskThreadDetail) => {
    controller.current?.abort();
    threadRef.current = detail.thread.id;
    setThreadId(detail.thread.id);
    const out: AskTurn[] = [];
    for (const m of detail.messages) {
      if (m.role === "user") {
        out.push({ id: m.id, question: m.text, scope: detail.thread.scope, status: "searching", text: "", citations: [], searched: 0, error: null });
      } else {
        const turn = out.at(-1);
        if (turn) Object.assign(turn, { status: m.status, text: m.text, citations: m.citations, searched: m.searched });
      }
    }
    setTurns(out);
  }, []);

  const busy = turns.some((t) => t.status === "searching" || t.status === "streaming");
  return { threadId, turns, busy, send, stop, retry, reset, load };
}
