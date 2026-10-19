// ApiClient over the real /api/v2 (production builds). Same origin, cookie auth only: the
// HttpOnly `lectern_session` cookie rides along with every request, and no token is ever
// read, stored or sent from here (AGENTS.md 웹 보안).
//
// Every call is driven by packages/domain's route table: the method and path come from
// the RouteDef, and the response is parsed with that route's response schema, so a server
// that drifts from the contract fails loudly here instead of half-rendering. Errors are
// the domain's `{ error: { code, message } }` (the v1 auth endpoints answer
// `{ error: "…" }`; both become ApiClientError). Writes carry an Idempotency-Key, document
// saves an If-Match, and the two SSE streams are read from fetch() (./sse.ts).

import {
  API_BASE_PATH,
  ApiError,
  AskStreamEvent,
  HEADER,
  ROUTES_BY_OPERATION,
  ServerEvent,
  versionETag,
  type RouteDef,
} from "@lectern/domain";
import { z } from "zod";
import { ApiClientError, type ApiClient, type SessionUser } from "../client.ts";
import type { AskTurn, ServerEvent as ServerEventType } from "../types.ts";
import { readSse, SseParser } from "./sse.ts";

export interface HttpClientOptions {
  /** Defaults to the global fetch (tests pass a fake). */
  fetch?: typeof fetch;
  /** Origin-relative base of the v1 auth routes. */
  authBase?: string;
  /** Reconnect delays of the event stream in ms (tests shorten them). */
  eventRetry?: { min: number; max: number };
}

type Params = Record<string, string | number>;
type Query = Record<string, unknown>;

interface CallInput {
  params?: Params;
  query?: Query;
  body?: unknown;
  /** Raw bytes for application/octet-stream routes. */
  bytes?: Blob;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  413: "payload_too_large",
  415: "unsupported_media_type",
  428: "precondition_required",
  429: "rate_limited",
  501: "not_implemented",
  503: "unavailable",
};

const STATUS_MESSAGES: Record<string, string> = {
  unauthorized: "다시 로그인하세요.",
  forbidden: "권한이 없습니다.",
  not_found: "찾을 수 없습니다.",
  rate_limited: "요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.",
  not_implemented: "아직 준비 중인 기능입니다.",
  unavailable: "서버가 잠시 응답하지 않습니다. 잠시 뒤 다시 시도하세요.",
  internal: "서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도하세요.",
};

const NETWORK_MESSAGE = "서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.";
const INVALID_MESSAGE = "서버 응답 형식이 올바르지 않습니다.";

/** `{ user }` of GET /api/auth/me and POST /api/auth/login. Only these fields are kept (never `apiToken`). */
const V1UserBody = z.object({
  user: z.object({ id: z.string().min(1), email: z.string(), displayName: z.string().nullable().optional() }),
});
const V1ErrorBody = z.object({ error: z.string() });

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "internal" : "bad_request");
}

function newKey(): string {
  return crypto.randomUUID();
}

/** `/recordings/{recording_id}` + params + query -> `/api/v2/recordings/rec_1?limit=50`. */
export function routeUrl(route: Pick<RouteDef, "path">, params: Params = {}, query: Query = {}): string {
  const path = route.path.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path param ${name} for ${route.path}`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `${API_BASE_PATH}${path}${qs ? `?${qs}` : ""}`;
}

/** The ApiClientError for a non-2xx response (v2 or v1 error body, or just the status). */
export async function errorFrom(res: Response): Promise<ApiClientError> {
  const requestId = res.headers.get("X-Request-Id");
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON (a proxy page, an empty body): fall back to the status.
  }
  const v2 = ApiError.safeParse(json);
  if (v2.success) {
    const { code, message, details } = v2.data.error;
    return new ApiClientError(res.status, code, message, requestId, (details as Record<string, unknown> | undefined) ?? null);
  }
  const code = codeForStatus(res.status);
  const v1 = V1ErrorBody.safeParse(json);
  return new ApiClientError(res.status, code, v1.success ? v1.data.error : (STATUS_MESSAGES[code] ?? STATUS_MESSAGES.internal!), requestId);
}

export function createHttpClient(options: HttpClientOptions = {}): ApiClient {
  const doFetch = (input: string, init: RequestInit) => (options.fetch ?? fetch)(input, { credentials: "same-origin", ...init });
  const authBase = options.authBase ?? "/api/auth";
  const retry = options.eventRetry ?? { min: 1_000, max: 60_000 };
  const unauthorized = new Set<() => void>();
  const signalUnauthorized = () => unauthorized.forEach((listener) => listener());

  async function send(input: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(input, init);
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new ApiClientError(0, "network", NETWORK_MESSAGE);
    }
    return res;
  }

  async function call<T>(operationId: string, input: CallInput = {}): Promise<T> {
    const route = ROUTES_BY_OPERATION[operationId];
    if (!route) throw new Error(`unknown API v2 operation: ${operationId}`);
    const headers: Record<string, string> = { Accept: "application/json", ...input.headers };
    let body: BodyInit | undefined;
    if (input.bytes) {
      headers["Content-Type"] = "application/octet-stream";
      body = input.bytes;
    } else if (input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    // Every write carries a key, so a retried request is never applied twice.
    if (route.method !== "get" && !headers[HEADER.idempotencyKey]) headers[HEADER.idempotencyKey] = newKey();

    const res = await send(routeUrl(route, input.params, input.query), { method: route.method.toUpperCase(), headers, body, signal: input.signal });
    if (!res.ok) {
      const error = await errorFrom(res);
      if (res.status === 401) signalUnauthorized();
      throw error;
    }
    if (res.status === 204) return undefined as T;
    const schema = route.responses[res.status]?.schema;
    if (!schema) throw new ApiClientError(res.status, "invalid_response", INVALID_MESSAGE, res.headers.get("X-Request-Id"));
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiClientError(res.status, "invalid_response", INVALID_MESSAGE, res.headers.get("X-Request-Id"));
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      console.warn(`${operationId}: response does not match the schema`, parsed.error.issues.map((i) => i.path.join(".")));
      throw new ApiClientError(res.status, "invalid_response", INVALID_MESSAGE, res.headers.get("X-Request-Id"));
    }
    return parsed.data as T;
  }

  async function auth(path: string, init: RequestInit): Promise<Response> {
    return send(`${authBase}${path}`, { ...init, headers: { Accept: "application/json", ...(init.headers as Record<string, string>) } });
  }

  async function sessionFrom(res: Response): Promise<SessionUser> {
    const parsed = V1UserBody.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiClientError(res.status, "invalid_response", INVALID_MESSAGE);
    const { id, email, displayName } = parsed.data.user;
    return { id, email, displayName: displayName ?? null };
  }

  return {
    mode: "http",

    async getSession() {
      const res = await auth("/me", { method: "GET" });
      if (res.status === 401) return null;
      if (!res.ok) throw await errorFrom(res);
      return sessionFrom(res);
    },
    async login(email, password) {
      const res = await auth("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw await errorFrom(res);
      // The body also carries the session token for native clients; it is ignored here.
      return sessionFrom(res);
    },
    async logout() {
      const res = await auth("/logout", { method: "POST" });
      if (!res.ok) throw await errorFrom(res);
    },
    onUnauthorized(listener) {
      unauthorized.add(listener);
      return () => unauthorized.delete(listener);
    },

    getMe: () => call("getMe"),
    updateMe: (body) => call("updateMe", { body }),
    listDevices: () => call("listDevices"),
    revokeDevice: (deviceId) => call("revokeDevice", { params: { device_id: deviceId } }),
    listWorkspaces: () => call("listWorkspaces"),
    listMembers: (workspaceId) => call("listWorkspaceMembers", { params: { workspace_id: workspaceId } }),

    listFolders: (workspaceId) => call("listFolders", { query: { workspace_id: workspaceId, limit: 200 } }),
    createFolder: (body) => call("createFolder", { body }),
    updateFolder: (folderId, body) => call("updateFolder", { params: { folder_id: folderId }, body }),
    deleteFolder: (folderId) => call("deleteFolder", { params: { folder_id: folderId } }),

    listTags: (workspaceId) => call("listTags", { query: { workspace_id: workspaceId, limit: 200 } }),
    createTag: (body) => call("createTag", { body }),
    updateTag: (tagId, body) => call("updateTag", { params: { tag_id: tagId }, body }),
    deleteTag: (tagId) => call("deleteTag", { params: { tag_id: tagId } }),

    listRecordings: (query) => call("listRecordings", { query }),
    getRecording: (recordingId) => call("getRecording", { params: { recording_id: recordingId } }),
    updateRecording: (recordingId, body) => call("updateRecording", { params: { recording_id: recordingId }, body }),
    deleteRecording: (recordingId) => call("deleteRecording", { params: { recording_id: recordingId } }),
    batchRecordings: (body) => call("batchRecordings", { body }),
    getTranscript: (recordingId) => call("getTranscript", { params: { recording_id: recordingId } }),
    listQuestions: (recordingId) => call("listRecordingQuestions", { params: { recording_id: recordingId } }),
    listRecordingEvents: (recordingId) => call("listRecordingEvents", { params: { recording_id: recordingId } }),
    listActionItems: (recordingId) => call("listRecordingActionItems", { params: { recording_id: recordingId } }),
    listWorkspaceActionItems: (query) => call("listActionItems", { query }),
    updateActionItem: (actionItemId, body) => call("updateActionItem", { params: { action_item_id: actionItemId }, body }),
    getDocument: (documentId) => call("getDocument", { params: { document_id: documentId } }),
    createDocumentVersion: (documentId, body, baseVersion) =>
      call("createDocumentVersion", { params: { document_id: documentId }, body, headers: { [HEADER.ifMatch]: versionETag(baseVersion) } }),

    listCalendarSuggestions: (query) => call("listCalendarSuggestions", { query }),
    updateCalendarSuggestion: (id, body) => call("updateCalendarSuggestion", { params: { event_candidate_id: id }, body }),

    search: (query) => call("search", { query }),

    createAskThread: (body) => call("createAskThread", { body }),
    async askQuestion(threadId, question, { signal, onEvent }) {
      const route = ROUTES_BY_OPERATION.askQuestion!;
      const res = await send(routeUrl(route, { thread_id: threadId }), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", [HEADER.idempotencyKey]: newKey() },
        body: JSON.stringify({ question }),
        signal,
      });
      if (!res.ok) {
        const error = await errorFrom(res);
        if (res.status === 401) signalUnauthorized();
        throw error;
      }
      if (!res.body || !(res.headers.get("Content-Type") ?? "").startsWith("text/event-stream")) {
        throw new ApiClientError(res.status, "invalid_response", INVALID_MESSAGE, res.headers.get("X-Request-Id"));
      }
      let completed: AskTurn | null = null;
      try {
        for await (const message of readSse(res.body)) {
          if (!message.data) continue;
          let json: unknown;
          try {
            json = JSON.parse(message.data);
          } catch {
            continue;
          }
          const parsed = AskStreamEvent.safeParse(json);
          // Open union: event types this build does not know are skipped.
          if (!parsed.success) continue;
          const event = parsed.data;
          onEvent(event);
          if (event.type === "turn.completed") completed = event.turn;
          if (event.type === "error") throw new ApiClientError(res.status, event.error.code, event.error.message, res.headers.get("X-Request-Id"));
        }
      } catch (err) {
        if (err instanceof ApiClientError || isAbort(err)) throw err;
        if (signal?.aborted) throw new DOMException("답을 멈췄습니다.", "AbortError");
        throw new ApiClientError(0, "network", "답을 받는 중에 연결이 끊겼습니다.");
      }
      if (!completed) throw new ApiClientError(0, "network", "답을 받는 중에 연결이 끊겼습니다.");
      return completed;
    },
    listAskThreads: (query) => call("listAskThreads", { query }),
    getAskThread: (threadId) => call("getAskThread", { params: { thread_id: threadId } }),
    deleteAskThread: (threadId) => call("deleteAskThread", { params: { thread_id: threadId } }),
    getAskUsage: (workspaceId) => call("getAskUsage", { query: { workspace_id: workspaceId } }),

    createUpload: (body, idempotencyKey) => call("createUpload", { body, headers: { [HEADER.idempotencyKey]: idempotencyKey } }),
    uploadPart: (uploadId, part, bytes) => call("putUploadPart", { params: { upload_id: uploadId, part }, bytes }),
    completeUpload: (uploadId, idempotencyKey) =>
      call("completeUpload", { params: { upload_id: uploadId }, headers: { [HEADER.idempotencyKey]: idempotencyKey } }),

    assetContentUrl: (assetId) => routeUrl(ROUTES_BY_OPERATION.getAssetContent!, { asset_id: assetId }),

    subscribe(workspaceId, onEvent) {
      return subscribeEvents({ workspaceId, onEvent, send, retry, onUnauthorized: signalUnauthorized });
    },
  };
}

/** Responses after which reconnecting cannot help: no access, or the stream does not exist yet. */
const FINAL_STATUSES = new Set([403, 404, 501]);
const SEEN_LIMIT = 500;

/**
 * The workspace event stream with reconnects. After a dropped or closed connection it
 * waits for the server's `retry:` (bounded) and reconnects with `Last-Event-ID`, so the
 * server replays what was missed; ids already delivered are not delivered twice. 401
 * reports the lost session and stops; 403/404/501 stop quietly; anything else backs off.
 */
function subscribeEvents({
  workspaceId,
  onEvent,
  send,
  retry,
  onUnauthorized,
}: {
  workspaceId: string;
  onEvent: (event: ServerEventType) => void;
  send: (input: string, init: RequestInit) => Promise<Response>;
  retry: { min: number; max: number };
  onUnauthorized: () => void;
}): () => void {
  const stop = new AbortController();
  const route = ROUTES_BY_OPERATION.streamEvents!;
  const url = routeUrl(route, {}, { workspace_id: workspaceId });
  const seen: string[] = [];
  let lastId: string | null = null;
  let delay = retry.min;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      stop.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

  void (async () => {
    let failures = 0;
    while (!stop.signal.aborted) {
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        if (lastId) headers[HEADER.lastEventId] = lastId;
        const res = await send(url, { method: "GET", headers, signal: stop.signal, cache: "no-store" });
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        if (FINAL_STATUSES.has(res.status)) return;
        if (!res.ok || !res.body) {
          failures++;
        } else {
          failures = 0;
          const parser = new SseParser();
          for await (const message of readSse(res.body, parser)) {
            if (parser.retry !== null) delay = Math.min(Math.max(parser.retry, retry.min), retry.max);
            if (message.id) lastId = message.id;
            if (!message.data) continue;
            let json: unknown;
            try {
              json = JSON.parse(message.data);
            } catch {
              continue;
            }
            const parsed = ServerEvent.safeParse(json);
            if (!parsed.success) continue; // unknown event types are ignored (open union)
            const event = parsed.data as ServerEventType;
            if (seen.includes(event.id)) continue;
            seen.push(event.id);
            if (seen.length > SEEN_LIMIT) seen.shift();
            onEvent(event);
          }
        }
      } catch (err) {
        if (stop.signal.aborted) return;
        if (!isAbort(err)) failures++;
      }
      // The server closed the stream (or it failed): wait, then resume after lastId.
      await sleep(failures ? Math.min(retry.min * 2 ** failures, retry.max) : delay);
    }
  })();

  return () => stop.abort();
}
