// The HTTP ApiClient against a fake fetch: URLs from the domain route table, both error
// body shapes (v2 and the v1 auth routes), Idempotency-Key on writes, If-Match on document
// saves, 401 reported once per request, responses that drift from the schema rejected,
// the ask stream, and the event stream resuming with Last-Event-ID.

import { describe, expect, test } from "bun:test";
import * as D from "@lectern/domain";
import { ApiClientError } from "../src/api/client.ts";
import { createFixtureClient } from "../src/api/fixture/client.ts";
import { createHttpClient, routeUrl } from "../src/api/http/client.ts";
import { SseParser } from "../src/api/http/sse.ts";
import { asId, type AskStreamEvent, type ServerEvent } from "../src/api/types.ts";
import { PERSONAL_WS } from "../src/fixtures/index.ts";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function fakeFetch(respond: (req: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const req = {
      url: input,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : null,
    };
    seen.push(req);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return respond(req);
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function sse(chunks: string[], init: { status?: number } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: init.status ?? 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

const fixture = createFixtureClient({ now: new Date("2026-10-19T03:00:00.000Z"), latencyMs: 0 });

describe("SSE parser", () => {
  test("handles split lines, CRLF, comments, multi-line data, ids that carry over and retry", () => {
    const p = new SseParser();
    const out = [
      ...p.push("retry: 2500\r\n: heartbeat\r\nid: 7\r\nevent: job.progress\r\nda"),
      ...p.push("ta: {\"a\":1}\r\n\r\nevent: x\ndata: one\ndata: two\n\n"),
      ...p.push("data: no id field\r"),
      ...p.push("\n\r\n"),
    ];
    expect(p.retry).toBe(2500);
    expect(out).toEqual([
      { id: "7", event: "job.progress", data: '{"a":1}' },
      { id: "7", event: "x", data: "one\ntwo" },
      { id: "7", event: "message", data: "no id field" },
    ]);
  });
});

describe("HTTP ApiClient", () => {
  test("builds URLs from the route table", () => {
    expect(routeUrl(D.ROUTES_BY_OPERATION.getRecording!, { recording_id: "lec_00a5" })).toBe("/api/v2/recordings/lec_00a5");
    expect(routeUrl(D.ROUTES_BY_OPERATION.listRecordings!, {}, { workspace_id: "w 1", cursor: undefined, limit: 50 })).toBe(
      "/api/v2/recordings?workspace_id=w+1&limit=50",
    );
  });

  test("parses responses with the domain schemas and rejects drift", async () => {
    const me = await fixture.getMe();
    const { fn, seen } = fakeFetch((req) => (req.url === "/api/v2/me" ? json(200, me) : json(200, { ...me, email: 42 })));
    const api = createHttpClient({ fetch: fn });
    expect(await api.getMe()).toEqual(me);
    expect(seen[0]!.headers.get("Accept")).toBe("application/json");
    expect(seen[0]!.headers.get("Idempotency-Key")).toBeNull();
    await expect(api.listWorkspaces()).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("maps v2 and v1 error bodies, and a bare status, to ApiClientError", async () => {
    const { fn } = fakeFetch((req) => {
      if (req.url.startsWith("/api/v2/recordings/")) {
        return json(404, { error: { code: "not_found", message: "녹음을 찾을 수 없습니다." } }, { "X-Request-Id": "req-123456" });
      }
      if (req.url === "/api/auth/login") return json(401, { error: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." });
      return new Response("<html>bad gateway</html>", { status: 502 });
    });
    const api = createHttpClient({ fetch: fn });
    const err = await api.getRecording("lec_1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "녹음을 찾을 수 없습니다.", requestId: "req-123456" });
    await expect(api.login("a@example.com", "x")).rejects.toMatchObject({ status: 401, code: "unauthorized", message: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." });
    await expect(api.listTags(PERSONAL_WS)).rejects.toMatchObject({ status: 502, code: "internal" });
  });

  test("a network failure is `network`; 501 is `not_implemented`", async () => {
    const offline = createHttpClient({ fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch });
    await expect(offline.getMe()).rejects.toMatchObject({ status: 0, code: "network" });
    const stub = createHttpClient({
      fetch: fakeFetch(() => json(501, { error: { code: "not_implemented", message: "아직 제공하지 않는 API입니다.", details: { operation_id: "updateMe" } } })).fn,
    });
    await expect(stub.updateMe({ display_name: "새 이름" })).rejects.toMatchObject({ status: 501, code: "not_implemented", details: { operation_id: "updateMe" } });
  });

  test("writes send JSON with an Idempotency-Key; document saves send If-Match", async () => {
    const doc = await fixture.getDocument(fixture.data.documents[0]!.id);
    const { fn, seen } = fakeFetch((req) => {
      if (req.method === "PATCH") return json(200, fixture.data.folders[0]);
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      return json(201, { ...doc.version, version: doc.version.version + 1, base_version: doc.version.version });
    });
    const api = createHttpClient({ fetch: fn });
    await api.updateFolder("fld_os", { name: "새 이름" });
    await api.deleteTag("tag_x");
    await api.createDocumentVersion(doc.document.id, { body: doc.version.body! }, 3);
    const [patch, del, save] = seen;
    expect(patch!.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(patch!.body!)).toEqual({ name: "새 이름" });
    const keys = seen.map((s) => s.headers.get("Idempotency-Key"));
    expect(keys.every((k) => k && k.length >= 16)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    expect(del!.url).toBe("/api/v2/tags/tag_x");
    expect(save!.headers.get("If-Match")).toBe('"3"');
  });

  test("401 tells the listeners (the session ended); getSession answers null instead", async () => {
    const { fn } = fakeFetch(() => json(401, { error: { code: "unauthorized", message: "로그인이 필요합니다." } }));
    const api = createHttpClient({ fetch: fn });
    let lost = 0;
    const off = api.onUnauthorized(() => lost++);
    await expect(api.listWorkspaces()).rejects.toMatchObject({ status: 401 });
    expect(await api.getSession()).toBeNull();
    expect(lost).toBe(1);
    off();
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(lost).toBe(1);
  });

  test("login keeps only id, email and name of the v1 user (never the token)", async () => {
    const { fn, seen } = fakeFetch(() =>
      json(200, { ok: true, token: "ses_secret", user: { id: "usr_1", email: "e2e@example.com", displayName: "테스트", apiToken: "lct_secret" } }),
    );
    const api = createHttpClient({ fetch: fn });
    const user = await api.login("e2e@example.com", "pw");
    expect(user).toEqual({ id: "usr_1", email: "e2e@example.com", displayName: "테스트" });
    expect(JSON.stringify(user)).not.toContain("secret");
    expect(seen[0]!.headers.get("X-Lectern-Token")).toBeNull();
  });

  test("askQuestion reads the SSE stream, skips unknown events and resolves with the completed turn", async () => {
    // Real events from the fixture, framed like the server does.
    const { id } = await fixture.createAskThread({ workspace_id: PERSONAL_WS, scope: { kind: "workspace" } });
    const events: AskStreamEvent[] = [];
    await fixture.askQuestion(id, "에이징이 뭐야?", { onEvent: (e) => events.push(e) });
    const frames = [": heartbeat\n\n", "event: future.kind\ndata: {\"type\":\"future.kind\"}\n\n", ...events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)];
    // Split the frames at awkward places.
    const body = frames.join("");
    const chunks = [body.slice(0, 37), body.slice(37, 400), body.slice(400)];
    const { fn, seen } = fakeFetch(() => sse(chunks));
    const api = createHttpClient({ fetch: fn });
    const got: AskStreamEvent[] = [];
    const turn = await api.askQuestion("thr_1", "에이징이 뭐야?", { onEvent: (e) => got.push(e) });
    expect(got.map((e) => e.type)).toEqual(events.map((e) => e.type));
    expect(turn.answer).toBe(events.flatMap((e) => (e.type === "turn.completed" ? [e.turn.answer] : []))[0]!);
    expect(seen[0]!.url).toBe("/api/v2/ask/threads/thr_1/turns");
    expect(seen[0]!.headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(seen[0]!.body!)).toEqual({ question: "에이징이 뭐야?" });
  });

  test("askQuestion: an error event rejects with its code; a stream that ends early is `network`", async () => {
    const started = { type: "turn.started", thread_id: "thr_1", turn_id: "turn_1", idx: 0, created_at: "2026-10-19T03:00:00.000Z" };
    const failing = createHttpClient({
      fetch: fakeFetch(() =>
        sse([`data: ${JSON.stringify(started)}\n\n`, `event: error\ndata: ${JSON.stringify({ type: "error", error: { code: "budget_exceeded", message: "이번 달 한도를 넘었습니다." } })}\n\n`]),
      ).fn,
    });
    await expect(failing.askQuestion("thr_1", "q", { onEvent: () => {} })).rejects.toMatchObject({ code: "budget_exceeded" });
    const cut = createHttpClient({ fetch: fakeFetch(() => sse([`data: ${JSON.stringify(started)}\n\n`])).fn });
    await expect(cut.askQuestion("thr_1", "q", { onEvent: () => {} })).rejects.toMatchObject({ code: "network" });
    const busy = createHttpClient({ fetch: fakeFetch(() => json(409, { error: { code: "conflict", message: "같은 질문을 아직 처리하고 있습니다." } })).fn });
    await expect(busy.askQuestion("thr_1", "q", { onEvent: () => {} })).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  test("the event stream reconnects with Last-Event-ID and does not deliver an event twice", async () => {
    const event = (id: string): ServerEvent =>
      D.ServerEvent.parse({
        id,
        workspace_id: PERSONAL_WS,
        recording_id: null,
        created_at: "2026-10-19T03:00:00.000Z",
        type: "calendar.suggested",
        payload: { event_candidate_ids: [asId("evt_cand_1")] },
      }) as ServerEvent;
    const frame = (e: ServerEvent) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
    let connections = 0;
    const { fn, seen } = fakeFetch(() => {
      connections++;
      // The stub closes after replaying; the second connection replays an old id as well.
      if (connections === 1) return sse(["retry: 1\n\n", frame(event("1001")), frame(event("1002"))]);
      if (connections === 2) return sse([frame(event("1002")), frame(event("1003"))]);
      return json(501, { error: { code: "not_implemented", message: "준비 중" } });
    });
    const api = createHttpClient({ fetch: fn, eventRetry: { min: 1, max: 5 } });
    const got: string[] = [];
    const off = api.subscribe(PERSONAL_WS, (e) => got.push(e.id));
    for (let i = 0; i < 50 && connections < 3; i++) await new Promise((r) => setTimeout(r, 5));
    off();
    expect(got).toEqual(["1001", "1002", "1003"]);
    expect(seen[0]!.url).toBe(`/api/v2/events?workspace_id=${PERSONAL_WS}`);
    expect(seen[0]!.headers.get("Last-Event-ID")).toBeNull();
    expect(seen[1]!.headers.get("Last-Event-ID")).toBe("1002");
    expect(seen[2]!.headers.get("Last-Event-ID")).toBe("1003");
    // 501 is final: no fourth connection.
    await new Promise((r) => setTimeout(r, 20));
    expect(connections).toBe(3);
  });

  test("asset bytes come from /assets/{id}/content", () => {
    expect(createHttpClient().assetContentUrl("as_1")).toBe("/api/v2/assets/as_1/content");
  });
});
