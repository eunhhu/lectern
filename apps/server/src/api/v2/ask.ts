// /api/v2/ask (docs/adr/0009-ask-rag.md): threads, the streamed question, usage.
//
// Real, not a fixture: until P2 the notes are the caller's v1 lectures (ask/legacy.ts) in
// their personal workspace `wsp_<user id>`. The fixture personal workspace id that the
// stubbed GET /me returns is accepted as an alias for it, so the web shell can call these
// routes with the id it already has; any other workspace id is 403. While LECTERN_ASK is
// off every route answers 501, like the other unimplemented v2 routes.

import {
  type AskScope,
  type AskStreamEvent,
  type AskThread,
  type AskTurn,
  HEADER,
} from "@lectern/domain";
import {
  ASK_LIMITS,
  AskRequestError,
  createThread,
  deleteThread,
  getOwnThread,
  isScopeError,
  listThreads,
  listTurns,
  monthUsage,
  prepareAskTurn,
  resolveAccessScope,
  runAskTurn,
  type AccessScope,
  type ScopeError,
} from "@lectern/ask";
import { folderRows, personalWorkspaceId, recordingRows } from "../../ask/legacy.ts";
import type { AskService } from "../../ask/service.ts";
import { db } from "../../db.ts";
import { logger } from "../../log.ts";
import { apiError, defineRouter, notImplemented, ok, okPage, type V2Request } from "./common.ts";
import { ID } from "./fixtures.ts";

const HEARTBEAT_MS = 15_000;

/** The caller's personal workspace for `requested`, or the 403 response. */
function workspaceFor(req: V2Request, requested: unknown): string | Response {
  const own = personalWorkspaceId(req.user!.id);
  if (requested === own || requested === ID.wsPersonal) return own;
  return apiError(req.c, 403, "forbidden", "이 워크스페이스에 접근할 권한이 없습니다.");
}

function accessFor(userId: string, scope: AskScope): AccessScope | ScopeError {
  return resolveAccessScope({
    workspaceId: personalWorkspaceId(userId),
    // A v1 user owns their personal workspace.
    caller: { userId, role: "owner" },
    scope,
    recordings: recordingRows(userId),
    folders: folderRows(userId),
  });
}

function scopeError(req: V2Request, err: ScopeError): Response {
  return apiError(req.c, err.code === "forbidden" ? 403 : 404, err.code, err.message);
}

/**
 * Cookie-authenticated browsers only send these from our own pages. A cross-site request
 * carrying the session cookie is refused (AGENTS.md: CSRF defense via Sec-Fetch-Site).
 */
function crossSiteCookie(req: V2Request): boolean {
  const site = req.c.req.header("sec-fetch-site");
  const cookie = req.c.req.header("cookie") ?? "";
  return site === "cross-site" && /(?:^|;\s*)lectern_session=/.test(cookie);
}

/** Hides citations of notes that were deleted (or became invisible) since the answer. */
function withAvailability(turns: AskTurn[], userId: string): AskTurn[] {
  const visible = new Set(recordingRows(userId).filter((r) => r.status === "ready").map((r) => r.id));
  return turns.map((t) => ({
    ...t,
    citations: t.citations.map((c) => (visible.has(c.recording_id) ? c : { ...c, available: false, snippet: "" })),
  }));
}

/**
 * An SSE response fed by `run`. The run continues if the client disconnects: the turn is
 * finished and stored either way (the tokens are already being paid for).
 */
function sseResponse(run: (emit: (event: AskStreamEvent) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  let open = true;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stop = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (open && controller) {
      try {
        controller.close();
      } catch {
        // already closed
      }
    }
    open = false;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      heartbeat = setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);
      run((event) => write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        .catch((err) => logger.error("ask turn crashed", { err }))
        .finally(() => stop(controller));
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function createAskRouter(getService: () => AskService | null) {
  return defineRouter({
    createAskThread: (req) => {
      if (!getService()) return notImplemented(req);
      if (crossSiteCookie(req)) return apiError(req.c, 403, "forbidden", "다른 사이트에서 보낸 요청은 받지 않습니다.");
      const body = req.body as { workspace_id: string; scope: AskScope };
      const workspace = workspaceFor(req, body.workspace_id);
      if (workspace instanceof Response) return workspace;
      const access = accessFor(req.user!.id, body.scope);
      if (isScopeError(access)) return scopeError(req, access);
      const thread = createThread(db, { workspaceId: workspace, userId: req.user!.id, scope: body.scope });
      return ok(req, thread, { status: 201 });
    },

    listAskThreads: (req) => {
      if (!getService()) return notImplemented(req);
      const query = req.query as { workspace_id: string; recording_id?: string };
      const workspace = workspaceFor(req, query.workspace_id);
      if (workspace instanceof Response) return workspace;
      const threads: AskThread[] = listThreads(db, {
        workspaceId: workspace,
        userId: req.user!.id,
        recordingId: query.recording_id,
        limit: 1_000,
      });
      return okPage(req, threads);
    },

    getAskThread: (req) => {
      if (!getService()) return notImplemented(req);
      const thread = getOwnThread(db, String(req.params.thread_id), req.user!.id);
      if (!thread) return apiError(req.c, 404, "not_found", "대화를 찾을 수 없습니다.");
      return ok(req, { thread, turns: withAvailability(listTurns(db, thread.id), req.user!.id) });
    },

    deleteAskThread: (req) => {
      if (!getService()) return notImplemented(req);
      if (crossSiteCookie(req)) return apiError(req.c, 403, "forbidden", "다른 사이트에서 보낸 요청은 받지 않습니다.");
      const thread = getOwnThread(db, String(req.params.thread_id), req.user!.id);
      if (!thread) return apiError(req.c, 404, "not_found", "대화를 찾을 수 없습니다.");
      deleteThread(db, thread.id);
      return req.c.body(null, 204);
    },

    askQuestion: (req) => {
      const service = getService();
      if (!service) return notImplemented(req);
      if (crossSiteCookie(req)) return apiError(req.c, 403, "forbidden", "다른 사이트에서 보낸 요청은 받지 않습니다.");
      const user = req.user!;
      const thread = getOwnThread(db, String(req.params.thread_id), user.id);
      if (!thread) return apiError(req.c, 404, "not_found", "대화를 찾을 수 없습니다.");
      const access = accessFor(user.id, thread.scope);
      if (isScopeError(access)) return scopeError(req, access);
      if (!service.allow(user.id)) {
        return apiError(req.c, 429, "rate_limited", "질문이 너무 잦습니다. 잠시 뒤 다시 물어보세요.");
      }
      const { question } = req.body as { question: string };
      const idempotencyKey = req.headers[HEADER.idempotencyKey] as string | undefined;
      let prepared: { turn: AskTurn; replayed: boolean };
      try {
        prepared = prepareAskTurn(service.deps, { thread, userId: user.id, question, idempotencyKey });
      } catch (err) {
        if (err instanceof AskRequestError) return apiError(req.c, err.status, err.code, err.message);
        throw err;
      }
      const { turn, replayed } = prepared;
      if (replayed) {
        // Same Idempotency-Key: send the stored result instead of asking (and paying) again.
        if (turn.status === "running") return apiError(req.c, 409, "conflict", "같은 질문을 아직 처리하고 있습니다.");
        return sseResponse(async (emit) => {
          emit({ type: "turn.started", thread_id: thread.id, turn_id: turn.id, idx: turn.idx, created_at: turn.created_at });
          emit({ type: "turn.completed", turn: withAvailability([turn], user.id)[0]! });
        });
      }
      return sseResponse((emit) => runAskTurn(service.deps, { access, thread, turn }, emit));
    },

    getAskUsage: (req) => {
      const service = getService();
      if (!service) return notImplemented(req);
      const workspace = workspaceFor(req, (req.query as { workspace_id: string }).workspace_id);
      if (workspace instanceof Response) return workspace;
      const usage = monthUsage(db, workspace);
      return ok(req, {
        workspace_id: workspace,
        period: new Date().toISOString().slice(0, 7),
        turn_count: usage.turns,
        spent_microusd: usage.spent,
        limit_microusd: service.deps.limits?.monthlyLimitMicrousd ?? null,
        per_turn_cap_microusd: service.deps.limits?.perTurnCapMicrousd ?? ASK_LIMITS.perTurnCapMicrousd,
      });
    },
  });
}
