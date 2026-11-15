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

  test("listAssetPages calls the route", async () => {
    const body = {
      page_count: 2,
      scanned: false,
      pages: [
        { page_no: 1, has_text_layer: true, char_count: 30 },
        { page_no: 2, has_text_layer: true, char_count: 40 },
      ],
    };
    const { fn, seen } = fakeFetch(() => json(200, body));
    expect(await createHttpClient({ fetch: fn }).listAssetPages("ast_1")).toEqual(body);
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /api/v2/assets/ast_1/pages"]);
  });

  test("ocrAsset dry run", async () => {
    const { fn, seen } = fakeFetch(() => json(200, { pages_to_ocr: 3, estimated_cost_microusd: 8_454, job_id: null }));
    expect(await createHttpClient({ fetch: fn }).ocrAsset("ast_1", { dry_run: true })).toEqual({ pages_to_ocr: 3, estimated_cost_microusd: 8_454, job_id: null });
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/v2/assets/ast_1/ocr"]);
    expect(seen[0]!.body).toBe('{"dry_run":true}');
    expect(seen[0]!.headers.get("Idempotency-Key")).toBeTruthy();
  });

  test("ocrAsset 501", async () => {
    const { fn } = fakeFetch(() => json(501, { error: { code: "not_implemented", message: "PDF 기능이 꺼져 있습니다." } }));
    const err = await createHttpClient({ fetch: fn })
      .ocrAsset("ast_1", { dry_run: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 501, code: "not_implemented" });
  });
});

describe("fixture PDF pages and OCR", () => {
  test("pages, scans and an OCR that only runs when asked", async () => {
    const api = createFixtureClient({ now: new Date("2026-10-19T03:00:00.000Z"), latencyMs: 0 });
    expect(api.assetContentUrl("rec_os07_pdf")).toBe("/api/v2/assets/rec_os07_pdf/content");
    const text = await api.listAssetPages("rec_os07_pdf");
    expect(text).toMatchObject({ page_count: 24, scanned: false });
    expect(text.pages).toHaveLength(24);
    expect(await api.ocrAsset("rec_os07_pdf", { dry_run: true })).toEqual({ pages_to_ocr: 0, estimated_cost_microusd: 0, job_id: null });

    expect(await api.listAssetPages("rec_os06_pdf")).toMatchObject({ page_count: 18, scanned: true });
    expect(await api.ocrAsset("rec_os06_pdf", { dry_run: true })).toEqual({ pages_to_ocr: 18, estimated_cost_microusd: 18 * 2_818, job_id: null });
    expect(await api.ocrAsset("rec_os06_pdf", { dry_run: true })).toMatchObject({ pages_to_ocr: 18 }); // a dry run changes nothing
    expect(await api.ocrAsset("rec_os06_pdf", { dry_run: false })).toMatchObject({ pages_to_ocr: 18, job_id: "job_fixture_ocr" });
    expect(await api.ocrAsset("rec_os06_pdf", { dry_run: true })).toMatchObject({ pages_to_ocr: 0 });
    await expect(api.listAssetPages("rec_nope_pdf")).rejects.toMatchObject({ status: 404 });
  });
});

describe("calendar connections (P4-07)", () => {
  test("calendar feed and integration calls", async () => {
    const ws = asId<D.WorkspaceId>(PERSONAL_WS);
    const workspace = fixture.data.workspaces.find((w) => w.workspace.id === ws)!.workspace;
    const { fn, seen } = fakeFetch((req) => {
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      if (req.url.startsWith("/api/v2/calendar/feed") && req.method === "POST") {
        return json(200, { url: "https://lectern.example/cal/abc.ics", created_at: "2026-10-19T03:00:00.000Z" });
      }
      if (req.url.startsWith("/api/v2/calendar/feed")) return json(200, { exists: true, url: null, created_at: "2026-10-19T03:00:00.000Z" });
      if (req.url.startsWith("/api/v2/integrations/google")) return json(200, { authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
      if (req.url.startsWith("/api/v2/integrations")) return json(200, { items: [], next_cursor: null });
      return json(200, { ...workspace, settings: { reminders: { email: true, lead_minutes: [60] } } });
    });
    const api = createHttpClient({ fetch: fn });
    expect(await api.createCalendarFeed(ws)).toEqual({ url: "https://lectern.example/cal/abc.ics", created_at: "2026-10-19T03:00:00.000Z" } as never);
    expect((await api.getCalendarFeed(ws)).exists).toBe(true);
    await api.deleteCalendarFeed(ws);
    expect((await api.listIntegrations(ws)).items).toEqual([]);
    expect((await api.startGoogleIntegration(ws, "/app/settings#integrations")).authorization_url).toStartWith("https://accounts.google.com/");
    await api.disconnectIntegration("int_1");
    const saved = await api.updateWorkspaceSettings(ws, { reminders: { email: true, lead_minutes: [60] } });
    expect(saved.settings.reminders).toEqual({ email: true, lead_minutes: [60] });

    const [create, info, del, list, start, disconnect, patch] = seen;
    expect([create!.method, create!.url]).toEqual(["POST", "/api/v2/calendar/feed"]);
    expect(JSON.parse(create!.body!)).toEqual({ workspace_id: ws });
    expect(info!.url).toBe(`/api/v2/calendar/feed?workspace_id=${ws}`);
    expect([del!.method, del!.url]).toEqual(["DELETE", `/api/v2/calendar/feed?workspace_id=${ws}`]);
    expect(list!.url).toStartWith(`/api/v2/integrations?workspace_id=${ws}`);
    expect(JSON.parse(start!.body!)).toEqual({ workspace_id: ws, return_to: "/app/settings#integrations" });
    expect([disconnect!.method, disconnect!.url]).toEqual(["DELETE", "/api/v2/integrations/int_1"]);
    expect([patch!.method, patch!.url]).toEqual(["PATCH", `/api/v2/workspaces/${ws}`]);
    expect(JSON.parse(patch!.body!)).toEqual({ settings: { reminders: { email: true, lead_minutes: [60] } } });
  });

  test("the fixture connects, disconnects, keeps a feed without its URL and merges settings", async () => {
    const api = createFixtureClient({ now: new Date("2026-10-19T03:00:00.000Z"), latencyMs: 0 });
    const ws = asId<D.WorkspaceId>(PERSONAL_WS);
    expect((await api.listIntegrations(ws)).items).toEqual([]);
    expect(await api.startGoogleIntegration(ws, "/app/settings#integrations")).toEqual({ authorization_url: "/app/settings?google=connected#integrations" });
    const [google] = (await api.listIntegrations(ws)).items;
    expect(google).toMatchObject({ provider: "google", status: "active" });
    await api.disconnectIntegration(google!.id);
    expect((await api.listIntegrations(ws)).items).toEqual([]);

    expect(await api.getCalendarFeed(ws)).toEqual({ exists: false, url: null, created_at: null } as never);
    const created = await api.createCalendarFeed(ws);
    expect(created.url).toContain("/cal/");
    expect(await api.getCalendarFeed(ws)).toEqual({ exists: true, url: null, created_at: created.created_at } as never);
    await api.deleteCalendarFeed(ws);
    expect((await api.getCalendarFeed(ws)).exists).toBe(false);

    await api.updateWorkspaceSettings(ws, { calendar_auto_add: { enabled: true, min_confidence: 0.8 } });
    const saved = await api.updateWorkspaceSettings(ws, { reminders: { email: true, lead_minutes: [1440, 60] } });
    expect(saved.settings).toMatchObject({ calendar_auto_add: { enabled: true, min_confidence: 0.8 }, reminders: { email: true, lead_minutes: [1440, 60] } });
  });
});

describe("account (P5-10)", () => {
  const ws = asId<D.WorkspaceId>(PERSONAL_WS);
  const at = "2026-10-19T03:00:00.000Z";
  const token = {
    id: "pat_1",
    workspace_id: ws,
    user_id: "usr_1",
    name: "스크립트",
    prefix: "lct_pat_ab12",
    scopes: ["recordings:read"],
    expires_at: null,
    last_used_at: null,
    created_at: at,
    revoked_at: null,
  };
  const exported = { id: "exp_1", workspace_id: ws, include_audio: false, state: "queued", bytes: null, requested_at: at, ready_at: null, expires_at: null, error: null };
  const scheduled = { state: "scheduled", requested_at: at, execute_after: "2026-10-26T03:00:00.000Z" };

  test("account calls", async () => {
    const { fn, seen } = fakeFetch((req) => {
      if (req.method === "DELETE" && !req.url.endsWith("/me/deletion")) return new Response(null, { status: 204 });
      if (req.url === "/api/v2/me/tokens" && req.method === "POST") return json(201, { token, secret: "lct_pat_ab12cdef34567890" });
      if (req.url.startsWith("/api/v2/me/tokens")) return json(200, { items: [token], next_cursor: null });
      if (req.url === "/api/v2/me/identities") return json(200, { items: [{ id: "idn_1", provider: "google", email: "a@example.com", created_at: at }], next_cursor: null });
      if (req.url === "/api/v2/me/exports" && req.method === "POST") return json(202, exported);
      if (req.url === "/api/v2/me/exports") return json(200, { items: [exported], next_cursor: null });
      if (req.url === "/api/v2/me/deletion" && req.method === "DELETE") return json(200, { state: "none", requested_at: null, execute_after: null });
      return json(200, scheduled);
    });
    const api = createHttpClient({ fetch: fn });
    const made = await api.createAccessToken({ workspace_id: ws, name: "스크립트", scopes: ["recordings:read"], expires_at: null });
    expect(made.secret).toStartWith("lct_pat_");
    expect((await api.listAccessTokens()).items).toHaveLength(1);
    await api.revokeAccessToken("pat_1");
    expect((await api.listIdentities()).items[0]!.provider).toBe("google");
    await api.unlinkIdentity("idn_1");
    expect((await api.createExport({ workspace_id: ws, include_audio: true })).state).toBe("queued");
    expect((await api.listExports()).items).toHaveLength(1);
    expect(api.exportContentUrl("exp_1")).toBe("/api/v2/me/exports/exp_1/content");
    expect((await api.requestAccountDeletion("hunter22")).state).toBe("scheduled");
    await api.requestAccountDeletion();
    expect((await api.getAccountDeletion()).execute_after).toBe(scheduled.execute_after);
    expect((await api.cancelAccountDeletion()).state).toBe("none");

    const [create, list, revoke, identities, unlink, exportCreate, exportList, del, delNoPassword, info, cancel] = seen;
    expect([create!.method, create!.url]).toEqual(["POST", "/api/v2/me/tokens"]);
    expect(JSON.parse(create!.body!)).toEqual({ workspace_id: ws, name: "스크립트", scopes: ["recordings:read"], expires_at: null });
    expect(create!.headers.get("Idempotency-Key")).toBeTruthy();
    expect(list!.url).toStartWith("/api/v2/me/tokens");
    expect([revoke!.method, revoke!.url]).toEqual(["DELETE", "/api/v2/me/tokens/pat_1"]);
    expect(identities!.url).toBe("/api/v2/me/identities");
    expect([unlink!.method, unlink!.url]).toEqual(["DELETE", "/api/v2/me/identities/idn_1"]);
    expect([exportCreate!.method, exportCreate!.url]).toEqual(["POST", "/api/v2/me/exports"]);
    expect(JSON.parse(exportCreate!.body!)).toEqual({ workspace_id: ws, include_audio: true });
    expect(exportList!.url).toBe("/api/v2/me/exports");
    expect([del!.method, del!.url]).toEqual(["POST", "/api/v2/me/deletion"]);
    expect(JSON.parse(del!.body!)).toEqual({ password: "hunter22" });
    expect(JSON.parse(delNoPassword!.body!)).toEqual({});
    expect([info!.method, info!.url]).toEqual(["GET", "/api/v2/me/deletion"]);
    expect([cancel!.method, cancel!.url]).toEqual(["DELETE", "/api/v2/me/deletion"]);
  });

  test("oauthProviders", async () => {
    // A browser's `redirect: "manual"` answer is an opaque redirect: status 0, no body.
    const opaque = { type: "opaqueredirect", status: 0, ok: false } as unknown as Response;
    const answers: Record<string, () => Response> = {
      google: () => opaque,
      apple: () => new Response(null, { status: 302, headers: { Location: "https://appleid.apple.com/auth/authorize" } }),
    };
    const { fn, seen } = fakeFetch((req) => answers[req.url.split("/")[4]!]!());
    const api = createHttpClient({ fetch: fn });
    expect(await api.oauthProviders()).toEqual({ google: true, apple: true });
    expect(seen.map((r) => [r.method, r.url])).toEqual([
      ["GET", "/api/v2/auth/google/start"],
      ["GET", "/api/v2/auth/apple/start"],
    ]);
    // Remembered for the session: no second probe.
    await api.oauthProviders();
    expect(seen).toHaveLength(2);

    const off = fakeFetch((req) => (req.url.includes("/google/") ? json(404, { error: { code: "not_found", message: "x" } }) : json(501, { error: { code: "not_implemented", message: "x" } })));
    expect(await createHttpClient({ fetch: off.fn }).oauthProviders()).toEqual({ google: false, apple: false });

    // No answer (network down, 503) reads as off but is asked again, not remembered.
    let up = false;
    const flaky = fakeFetch((req) => {
      if (!up) throw new TypeError("Failed to fetch");
      return req.url.includes("/google/") ? opaque : json(503, { error: { code: "unavailable", message: "x" } });
    });
    const client = createHttpClient({ fetch: flaky.fn });
    expect(await client.oauthProviders()).toEqual({ google: false, apple: false });
    up = true;
    expect(await client.oauthProviders()).toEqual({ google: true, apple: false });
    expect(await client.oauthProviders()).toEqual({ google: true, apple: false });
    expect(flaky.seen).toHaveLength(6);
  });

  test("the fixture keeps a token's secret out of its list and exports become ready", async () => {
    const api = createFixtureClient({ latencyMs: 0 });
    const made = await api.createAccessToken({ workspace_id: ws, name: "새 스크립트", scopes: ["recordings:read", "recordings:write"], expires_at: null });
    expect(made.secret).toStartWith("lct_pat_");
    const listed = (await api.listAccessTokens()).items;
    expect(listed.map((t) => t.name)).toEqual(["API 토큰", "새 스크립트", "노트 동기화 스크립트"]);
    expect(JSON.stringify(listed)).not.toContain(made.secret);
    await expect(api.revokeAccessToken(listed[0]!.id)).rejects.toMatchObject({ status: 409 });
    await api.revokeAccessToken(made.token.id);
    expect((await api.listAccessTokens()).items).toHaveLength(2);

    const row = await api.createExport({ workspace_id: ws, include_audio: false });
    await expect(api.createExport({ workspace_id: ws, include_audio: false })).rejects.toMatchObject({ status: 409 });
    expect((await api.listExports()).items[0]!.state).toBe("queued");
    row.requested_at = "2000-01-01T00:00:00.000Z"; // a copy: the fixture's own row is not changed
    expect((await api.listExports()).items[0]!.state).not.toBe("ready");

    expect((await api.requestAccountDeletion()).state).toBe("scheduled");
    expect((await api.getAccountDeletion()).state).toBe("scheduled");
    expect((await api.cancelAccountDeletion()).state).toBe("none");
    expect(await api.oauthProviders()).toEqual({ google: true, apple: true });
  });
});

describe("team workspaces (P5-11)", () => {
  test("member, invitation and usage calls", async () => {
    const ws = asId<D.WorkspaceId>("ws_team");
    const at = "2026-10-19T03:00:00.000Z";
    const member = { workspace_id: ws, user_id: "usr_2", role: "viewer", created_at: at, updated_at: at, display_name: "윤서아", email: "seoa@example.com" };
    const invite = { id: "inv_1", workspace_id: ws, email: "guest@example.com", role: "member", invited_by: "usr_1", created_at: at, expires_at: at, accepted_at: null, revoked_at: null };
    const workspace = fixture.data.workspaces.find((w) => w.workspace.kind === "team")!.workspace;
    const { fn, seen } = fakeFetch((req) => {
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      if (req.method === "PATCH") return json(200, member);
      if (req.url.endsWith("/invites") && req.method === "POST") return json(201, invite);
      if (req.url.endsWith("/invites")) return json(200, { items: [invite], next_cursor: null });
      if (req.url === "/api/v2/invites/accept") return json(200, { workspace, role: "member" });
      return json(200, { period: "2026-11", audio_ms: 0, ai_cost_microusd: 0, storage_bytes: 0, quota: null });
    });
    const api = createHttpClient({ fetch: fn });
    expect((await api.updateMember(ws, "usr_2", "viewer")).role).toBe("viewer");
    await api.removeMember(ws, "usr_2");
    expect((await api.listInvites(ws)).items).toHaveLength(1);
    expect(String((await api.createInvite(ws, { email: "guest@example.com", role: "member" })).id)).toBe("inv_1");
    await api.revokeInvite(ws, "inv_1");
    expect((await api.acceptInvite("tok-abcdefghijklmnop")).role).toBe("member");
    expect((await api.getWorkspaceUsage(ws)).quota).toBeNull();

    const [patch, del, list, create, revoke, accept, usage] = seen;
    expect([patch!.method, patch!.url]).toEqual(["PATCH", `/api/v2/workspaces/${ws}/members/usr_2`]);
    expect(JSON.parse(patch!.body!)).toEqual({ role: "viewer" });
    expect([del!.method, del!.url]).toEqual(["DELETE", `/api/v2/workspaces/${ws}/members/usr_2`]);
    expect(list!.url).toBe(`/api/v2/workspaces/${ws}/invites`);
    expect([create!.method, create!.url]).toEqual(["POST", `/api/v2/workspaces/${ws}/invites`]);
    expect(JSON.parse(create!.body!)).toEqual({ email: "guest@example.com", role: "member" });
    expect([revoke!.method, revoke!.url]).toEqual(["DELETE", `/api/v2/workspaces/${ws}/invites/inv_1`]);
    expect([accept!.method, accept!.url]).toEqual(["POST", "/api/v2/invites/accept"]);
    expect(JSON.parse(accept!.body!)).toEqual({ token: "tok-abcdefghijklmnop" });
    expect(usage!.url).toBe(`/api/v2/workspaces/${ws}/usage`);
  });

  test("the fixture keeps roles in line with the server", async () => {
    const api = createFixtureClient({ latencyMs: 0 });
    const team = asId<D.WorkspaceId>("ws_team");
    // I am a member of the team: no managing, but I may leave.
    await expect(api.updateMember(team, "usr_fixture_seoa", "viewer")).rejects.toMatchObject({ status: 403 });
    await expect(api.listInvites(team)).rejects.toMatchObject({ status: 403 });
    // Alone in the personal workspace, I am its last owner.
    await expect(api.removeMember(asId<D.WorkspaceId>(PERSONAL_WS), "usr_fixture_me")).rejects.toMatchObject({ status: 409 });
    expect((await api.getWorkspaceUsage(team)).quota).not.toBeNull();
    await expect(api.acceptInvite("wrong-account")).rejects.toMatchObject({ status: 403 });
    const joined = await api.acceptInvite("any-token");
    expect(joined.workspace.name).toBe("디자인 스터디");
    expect((await api.listWorkspaces()).items.map((w) => w.workspace.name)).toContain("디자인 스터디");
    await expect(api.acceptInvite("any-token")).rejects.toMatchObject({ status: 404 });
    await api.removeMember(team, "usr_fixture_me");
    expect((await api.listWorkspaces()).items.map((w) => w.workspace.id)).not.toContain(team);
  });
});

describe("admin console (P5-12)", () => {
  test("admin calls: v1 users as the old console sends them, v2 jobs and usage from the route table", async () => {
    // The fixture's own answers are the server's here, so they must pass the domain schemas.
    const source = createFixtureClient({ latencyMs: 0 }).admin;
    const overview = await source.overview();
    const jobs = await source.jobs({ state: "failed" });
    const detail = await source.job("job_fx_01");
    const usage = await source.usage();
    const quota = { audio_ms_month: 36_000_000, ai_microusd_month: null, storage_bytes: 10 * 1024 ** 3 };
    const { fn, seen } = fakeFetch((req) => {
      if (req.url === "/api/admin/overview") return json(200, { ok: true, metrics: overview.metrics, settings: {}, users: overview.users, recentLectures: [], auditLogs: [] });
      if (req.url.startsWith("/api/admin/users/") && req.method === "PATCH") return json(200, { ok: true, user: null });
      if (req.url.startsWith("/api/admin/users/") && req.method === "DELETE") return json(200, { ok: true, deletedId: "usr_fixture_sehun" });
      if (req.url.endsWith("/retry")) return json(200, { ...detail.job, state: "queued" });
      if (req.url.startsWith("/api/v2/admin/jobs/")) return json(200, detail);
      if (req.url.startsWith("/api/v2/admin/jobs")) return json(200, jobs);
      if (req.url.startsWith("/api/v2/admin/usage")) return json(200, usage);
      return json(200, quota);
    });
    const api = createHttpClient({ fetch: fn }).admin;
    expect((await api.overview()).metrics.totalUsers).toBe(5);
    expect(await api.users()).toHaveLength(5);
    await api.updateUser("usr_fixture_seoa", { status: "active" });
    await api.updateUser("usr_fixture_sehun", { role: "viewer" });
    await api.deleteUser("usr_fixture_sehun");
    expect((await api.jobs({ state: "failed", kind: "process", cursor: "c_2", limit: 50 })).items).toHaveLength(2);
    expect((await api.job("job_fx_01")).stage_runs).toHaveLength(6);
    await api.retryJob("job_fx_01");
    expect((await api.usage("2026-10")).items).toHaveLength(3);
    expect(await api.setQuota("ws_team", quota)).toEqual(quota);

    const [ov, ov2, approve, role, del, list, one, retry, ledger, put] = seen;
    expect([ov!.method, ov!.url, ov2!.url]).toEqual(["GET", "/api/admin/overview", "/api/admin/overview"]);
    // Partial bodies, camelCase, no CSRF header (the server keeps every field not sent).
    expect([approve!.method, approve!.url]).toEqual(["PATCH", "/api/admin/users/usr_fixture_seoa"]);
    expect(JSON.parse(approve!.body!)).toEqual({ status: "active" });
    expect(approve!.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(role!.body!)).toEqual({ role: "viewer" });
    expect([del!.method, del!.url, del!.body]).toEqual(["DELETE", "/api/admin/users/usr_fixture_sehun", null]);
    expect(list!.method).toBe("GET");
    const listUrl = new URL(list!.url, "http://x");
    expect(listUrl.pathname).toBe("/api/v2/admin/jobs");
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ state: "failed", kind: "process", cursor: "c_2", limit: "50" });
    expect([one!.method, one!.url]).toEqual(["GET", "/api/v2/admin/jobs/job_fx_01"]);
    expect([retry!.method, retry!.url]).toEqual(["POST", "/api/v2/admin/jobs/job_fx_01/retry"]);
    expect(ledger!.url).toBe("/api/v2/admin/usage?period=2026-10");
    expect([put!.method, put!.url]).toEqual(["PUT", "/api/v2/admin/workspaces/ws_team/quota"]);
    expect(JSON.parse(put!.body!)).toEqual(quota);
  });

  test("admin errors: v1 bodies carry the server's message; a job list drifting from the schema is rejected", async () => {
    const { fn } = fakeFetch((req) => {
      if (req.url.startsWith("/api/admin/users/")) return json(400, { error: "본인 계정은 삭제할 수 없습니다." });
      if (req.url === "/api/admin/overview") return json(403, { error: "관리자만 접근할 수 있습니다." });
      return json(200, { items: [{ id: "job_1", kind: "teleport" }], next_cursor: null });
    });
    const api = createHttpClient({ fetch: fn }).admin;
    await expect(api.deleteUser("usr_me")).rejects.toMatchObject({ status: 400, message: "본인 계정은 삭제할 수 없습니다." });
    await expect(api.overview()).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.overview()).rejects.toMatchObject({ status: 403 });
    await expect(api.jobs({})).rejects.toBeInstanceOf(ApiClientError);
  });

  test("admin members and lectures calls (P5-16): the old console's v1 routes and bodies", async () => {
    const source = createFixtureClient({ latencyMs: 0 }).admin;
    const page = await source.lectures({ status: "error" });
    const detail = await source.lecture("lec_fx_06");
    const { fn, seen } = fakeFetch((req) => {
      if (req.url === "/api/admin/users" && req.method === "POST") return json(201, { ok: true, user: { id: "usr_new" } });
      if (req.url.startsWith("/api/admin/users/")) return json(200, { ok: true, user: null });
      if (req.url.startsWith("/api/admin/lectures/")) return json(200, { ok: true, lecture: detail });
      // The real server sends the queue's own kind (a v2 "index" job), not only distill/compact.
      if (req.url.startsWith("/api/admin/lectures")) return json(200, { ok: true, ...page, lectures: [{ ...page.lectures[0]!, job_state: "queued", job_kind: "index" }] });
      if (req.url === "/api/admin/storage/compact") return json(200, { ok: true, queued: 1, estimatedSavedBytes: 7_000_000 });
      if (req.url.endsWith("/audio")) return json(200, { ok: true, reclaimedBytes: 12_345 });
      return json(200, { ok: true });
    });
    const api = createHttpClient({ fetch: fn }).admin;
    const newUser = {
      email: "new@example.com",
      displayName: "새 사람",
      password: "secret-1",
      role: "member" as const,
      status: "active" as const,
      canIngest: true,
      canShare: false,
      canUseServerKey: true,
      quotaMb: 2048,
      memo: "",
    };
    expect(await api.createUser(newUser)).toBe("usr_new");
    const patch = { displayName: "오세훈", role: "member" as const, status: "active" as const, canIngest: true, canShare: true, canUseServerKey: false, quotaMb: 0, memo: "메모", revokeSessions: true };
    await api.updateUser("usr_fixture_sehun", patch);
    const got = await api.lectures({ status: "error", q: "자료구조", owner: "usr_fixture_sehun", limit: 50, offset: 50 });
    expect(got.counts.error).toBe(3);
    expect([got.lectures[0]!.job_state, got.lectures[0]!.job_kind]).toEqual(["queued", "index"]);
    await api.lectures({ q: "" });
    expect((await api.lecture("lec_fx_06")).error_message).toContain("Gemini");
    await api.retryLecture("lec_fx_06");
    expect(await api.compactLectures(["lec_fx_05"])).toEqual({ queued: 1, estimatedSavedBytes: 7_000_000 });
    expect(await api.deleteLectureAudio("lec_fx_05")).toEqual({ reclaimedBytes: 12_345 });
    await api.deleteLecture("lec_fx_05");

    const [create, update, list, bare, one, retry, compact, dropAudio, drop] = seen;
    expect([create!.method, create!.url]).toEqual(["POST", "/api/admin/users"]);
    expect(JSON.parse(create!.body!)).toEqual(newUser);
    expect([update!.method, update!.url]).toEqual(["PATCH", "/api/admin/users/usr_fixture_sehun"]);
    // The whole form, camelCase; no new password when none was typed.
    expect(JSON.parse(update!.body!)).toEqual(patch);
    expect(JSON.parse(update!.body!)).not.toHaveProperty("newPassword");
    const listUrl = new URL(list!.url, "http://x");
    expect([list!.method, listUrl.pathname]).toEqual(["GET", "/api/admin/lectures"]);
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ status: "error", q: "자료구조", owner: "usr_fixture_sehun", limit: "50", offset: "50" });
    expect(bare!.url).toBe("/api/admin/lectures");
    expect([one!.method, one!.url]).toEqual(["GET", "/api/admin/lectures/lec_fx_06"]);
    expect([retry!.method, retry!.url]).toEqual(["POST", "/api/lectures/lec_fx_06/retry"]);
    expect([compact!.method, compact!.url]).toEqual(["POST", "/api/admin/storage/compact"]);
    expect(JSON.parse(compact!.body!)).toEqual({ ids: ["lec_fx_05"] });
    expect([dropAudio!.method, dropAudio!.url, dropAudio!.body]).toEqual(["DELETE", "/api/lectures/lec_fx_05/audio", null]);
    expect([drop!.method, drop!.url, drop!.body]).toEqual(["DELETE", "/api/lectures/lec_fx_05", null]);
  });

  test("admin lectures: a page or a new user drifting from the shape read is rejected", async () => {
    const { fn } = fakeFetch((req) => {
      if (req.url === "/api/admin/users") return json(201, { ok: true });
      if (req.url.startsWith("/api/lectures/")) return json(409, { error: "이미 처리 중입니다." });
      return json(200, { ok: true, total: 1, lectures: [{ id: "lec_1", status: "teleporting" }] });
    });
    const api = createHttpClient({ fetch: fn }).admin;
    await expect(api.lectures({})).rejects.toMatchObject({ status: 200, code: "invalid_response" });
    await expect(api.createUser({ email: "a", displayName: "", password: "secret", role: "member", status: "active", canIngest: true, canShare: true, canUseServerKey: true, quotaMb: 0, memo: "" })).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api.retryLecture("lec_1")).rejects.toMatchObject({ status: 409, message: "이미 처리 중입니다." });
  });

  test("admin storage and ops calls (P5-13): previews, runs, settings and the audit query", async () => {
    const source = createFixtureClient({ latencyMs: 0 }).admin;
    const storage = await source.storage();
    const ops = await source.ops();
    const settings = await source.settings();
    const audit = await source.audit({});
    const maintenance = await source.runMaintenance();
    const index = { ...ops.jobs.running[0]!, id: "job_index", kind: "index", stage: "index" };
    const { fn, seen } = fakeFetch((req) => {
      if (req.url === "/api/admin/storage") return json(200, { ok: true, ...storage });
      if (req.url === "/api/admin/storage/compact") return json(200, { ok: true, dryRun: true, candidates: 35, queued: 0, candidateBytes: 900, estimatedSavedBytes: 600 });
      if (req.url === "/api/admin/storage/gc") return json(200, { ok: true, dryRun: false, orphans: { count: 4, bytes: 38 }, movedToTrash: 4 });
      if (req.url === "/api/admin/storage/retention") return json(200, { ok: true, dryRun: true, retention: { days: 14, count: 17, bytes: 5 }, failedRetention: { days: 14, count: 1, bytes: 2 } });
      // A v2 "index" job comes through the v1 queue too; a row of another shape is left out.
      if (req.url === "/api/admin/ops") return json(200, { ok: true, ...ops, jobs: { ...ops.jobs, running: [...ops.jobs.running, index, { id: "job_broken" }] } });
      if (req.url === "/api/admin/maintenance/run") return json(200, { ok: true, result: maintenance });
      if (req.url === "/api/admin/overview") return json(200, { ok: true, settings });
      if (req.url === "/api/admin/settings") return json(200, { ok: true, settings: { ...settings, audit_retention_days: 400 } });
      return json(200, { ok: true, ...audit, logs: [...audit.logs.slice(0, 2), { id: 5 }] });
    });
    const api = createHttpClient({ fetch: fn }).admin;
    expect((await api.storage()).compaction.candidates).toBe(storage.compaction.candidates);
    expect(await api.compactAll(true)).toEqual({ dryRun: true, candidates: 35, queued: 0, candidateBytes: 900, estimatedSavedBytes: 600 });
    expect((await api.gcStorage(false)).orphans).toEqual({ count: 4, bytes: 38, files: [] });
    expect((await api.applyRetention(true)).failedRetention.count).toBe(1);
    const got = await api.ops();
    expect(got.jobs.running.map((j) => j.id)).toEqual([...ops.jobs.running.map((j) => j.id), "job_index"]);
    expect(await api.runMaintenance()).toEqual(maintenance);
    expect(await api.settings()).toEqual(settings);
    expect((await api.saveSettings({ audit_retention_days: 400 })).audit_retention_days).toBe(400);
    const page = await api.audit({ action: "storage", q: "휴지통", cursor: "2026-11-01T00:00:00.000Z|audlog_x", limit: 50 });
    expect(page.logs.map((l) => l.id)).toEqual(audit.logs.slice(0, 2).map((l) => l.id));
    await api.audit({ q: "" });

    const [readStorage, compact, gc, retention, readOps, run, readSettings, save, list, bare] = seen;
    expect([readStorage!.method, readStorage!.url]).toEqual(["GET", "/api/admin/storage"]);
    expect([compact!.method, compact!.url]).toEqual(["POST", "/api/admin/storage/compact"]);
    expect(JSON.parse(compact!.body!)).toEqual({ all: true, dryRun: true });
    expect([gc!.method, gc!.url]).toEqual(["POST", "/api/admin/storage/gc"]);
    expect(JSON.parse(gc!.body!)).toEqual({ dryRun: false });
    expect([retention!.method, retention!.url]).toEqual(["POST", "/api/admin/storage/retention"]);
    expect(JSON.parse(retention!.body!)).toEqual({ dryRun: true });
    expect([readOps!.method, readOps!.url]).toEqual(["GET", "/api/admin/ops"]);
    expect([run!.method, run!.url]).toEqual(["POST", "/api/admin/maintenance/run"]);
    // The settings are read from the overview's answer; a save sends the patch it is given
    // (the settings page gives all ten).
    expect([readSettings!.method, readSettings!.url]).toEqual(["GET", "/api/admin/overview"]);
    expect([save!.method, save!.url]).toEqual(["PATCH", "/api/admin/settings"]);
    expect(JSON.parse(save!.body!)).toEqual({ audit_retention_days: 400 });
    const listUrl = new URL(list!.url, "http://x");
    expect([list!.method, listUrl.pathname]).toEqual(["GET", "/api/admin/audit"]);
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ action: "storage", q: "휴지통", cursor: "2026-11-01T00:00:00.000Z|audlog_x", limit: "50" });
    expect(bare!.url).toBe("/api/admin/audit");
  });

  test("admin settings: an answer that drifts from the ten settings is rejected, never half-read", async () => {
    const settings = await createFixtureClient({ latencyMs: 0 }).admin.settings();
    const storage = await createFixtureClient({ latencyMs: 0 }).admin.storage();
    const { settings: _dropped, ...withoutSettings } = storage;
    let answer: unknown = {};
    const { fn } = fakeFetch((req) => (req.url === "/api/admin/storage" ? json(200, { ok: true, ...withoutSettings }) : json(200, answer)));
    const api = createHttpClient({ fetch: fn }).admin;
    const { audit_retention_days: _gone, ...missing } = settings;
    for (const bad of [missing, { ...settings, default_user_role: "owner" }, { ...settings, storage_compact_bitrate_kbps: "40" }]) {
      answer = { ok: true, settings: bad };
      await expect(api.settings()).rejects.toMatchObject({ status: 200, code: "invalid_response" });
      await expect(api.saveSettings({})).rejects.toMatchObject({ status: 200, code: "invalid_response" });
    }
    // The storage card needs only the failed-lecture retention; without it, 0 (off).
    expect((await api.storage()).settings).toEqual({ failed_audio_retention_days: 0 });
  });

  test("the fixture admin follows the server's rules", async () => {
    const api = createFixtureClient({ latencyMs: 0 }).admin;
    await expect(api.updateUser("usr_fixture_me", { role: "member" })).rejects.toMatchObject({ status: 400 });
    await expect(api.deleteUser("usr_fixture_me")).rejects.toMatchObject({ status: 400 });
    await expect(api.retryJob("job_fx_09")).rejects.toMatchObject({ status: 409 });
    await expect(api.retryJob("job_fx_11")).rejects.toMatchObject({ status: 409 });
    await api.retryJob("job_fx_01");
    expect((await api.job("job_fx_01")).job.state).toBe("queued");
    await expect(api.retryJob("job_fx_01")).rejects.toMatchObject({ status: 409 });
    await expect(api.setQuota("ws_nowhere", { audio_ms_month: 1, ai_microusd_month: null, storage_bytes: null })).rejects.toMatchObject({ status: 404 });
  });
});
