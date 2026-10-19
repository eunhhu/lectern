import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API_BASE_PATH,
  ApiError,
  HEADER,
  ROUTES,
  ServerEvent,
  toHonoPath,
  versionETag,
  type RouteDef,
} from "@lectern/domain";
import { createApiV2App } from "../src/api/v2/index.ts";
import { ID } from "../src/api/v2/fixtures.ts";
import { createSession, createUser, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// Contract tests for the /api/v2 P0 stubs: every route in packages/domain's openapi.json is
// mounted, needs a session or token, and answers either a fixture that passes its response
// schema or 501 `not_implemented`.

const OPENAPI_FILE = fileURLToPath(import.meta.resolve("@lectern/domain/openapi.json"));
const openapi = JSON.parse(readFileSync(OPENAPI_FILE, "utf8")) as { paths: Record<string, Record<string, unknown>> };

/** Reads that have no fixture yet: no upload session can exist, asset bytes have no schema. */
const READ_STUBS = new Set(["getUpload", "getAssetContent"]);
const isFixtureRoute = (route: RouteDef) => route.method === "get" && !READ_STUBS.has(route.operationId);

/** A fixture id (or other valid value) for every path parameter in the route table. */
const PATH_PARAMS: Record<string, string> = {
  workspace_id: ID.wsPersonal,
  device_id: ID.deviceIphone,
  token_id: ID.tokenShortcut,
  folder_id: ID.folderOs,
  tag_id: ID.tagExam,
  upload_id: "0199f0a0-f000-7000-8000-000000000001",
  part: "1",
  recording_id: ID.recOs5,
  speaker_id: ID.spkOs5Lecturer,
  asset_id: ID.assetOs5Audio,
  document_id: ID.docOs5,
  version: "2",
  action_item_id: ID.actionMockups,
  job_id: ID.jobOs5,
  event_candidate_id: ID.eventAssignment,
  integration_id: ID.integrationGoogle,
  share_link_id: ID.shareOs5Doc,
};

/** Per-operation path parameter overrides, where another fixture has the interesting data. */
const PATH_PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  listRecordingActionItems: { recording_id: ID.recSync },
};

/** Required query values, per operation. */
const QUERIES: Record<string, Record<string, string>> = {
  search: { workspace_id: ID.wsPersonal, q: "FCFS" },
  streamEvents: { workspace_id: ID.wsPersonal },
};
for (const op of ["listFolders", "listTags", "listRecordings", "listCalendarSuggestions", "listIntegrations", "listShareLinks"]) {
  QUERIES[op] = { workspace_id: ID.wsPersonal };
}

/** A valid body for every JSON-body route, so a write reaches its handler (501). */
const BODIES: Record<string, unknown> = {
  updateMe: { display_name: "새 이름" },
  createAccessToken: { workspace_id: ID.wsPersonal, name: "스크립트", scopes: ["recordings:read"] },
  createWorkspace: { name: "새 팀" },
  updateWorkspace: { name: "이름 변경" },
  createFolder: { workspace_id: ID.wsPersonal, name: "새 폴더" },
  updateFolder: { name: "이름 변경" },
  createTag: { workspace_id: ID.wsPersonal, name: "새 태그", color: "blue" },
  updateTag: { color: "green" },
  createUpload: {
    workspace_id: ID.wsPersonal,
    files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 1024 }],
  },
  updateRecording: { title: "새 제목" },
  updateSpeaker: { display_name: null },
  reprocessRecording: { mode: "document", dry_run: true },
  createDocumentVersion: { body: { sections: [] } },
  updateActionItem: { status: "done" },
  updateCalendarSuggestion: { status: "accepted" },
  batchCalendarSuggestions: { event_candidate_ids: [ID.eventAssignment], action: "dismiss" },
  startGoogleIntegration: { workspace_id: ID.wsPersonal },
  createShareLink: { target_type: "document", target_id: ID.docOs5, scope: { transcript: false, audio: false } },
  updateShareLink: { password: null },
};

function urlFor(route: RouteDef, query: Record<string, string> = QUERIES[route.operationId] ?? {}): string {
  const path = route.path.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const value = PATH_PARAM_OVERRIDES[route.operationId]?.[name] ?? PATH_PARAMS[name];
    if (value === undefined) throw new Error(`no sample for path param ${name}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams(query).toString();
  return `http://localhost${API_BASE_PATH}${path}${search ? `?${search}` : ""}`;
}

function requestFor(route: RouteDef, auth: Record<string, string>, extraHeaders: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...auth, ...extraHeaders };
  let body: BodyInit | undefined;
  if (route.body && "schema" in route.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(BODIES[route.operationId]);
  } else if (route.body) {
    headers["Content-Type"] = "application/octet-stream";
    body = new Uint8Array([1, 2, 3]);
  }
  if (route.headers?.shape[HEADER.ifMatch]) headers[HEADER.ifMatch] = versionETag(2);
  return new Request(urlFor(route), { method: route.method.toUpperCase(), headers, body });
}

const call = (req: Request) => handleRequest(req);

async function getJson(path: string, auth: Record<string, string>): Promise<{ status: number; body: any; res: Response }> {
  const res = await call(new Request(`http://localhost${API_BASE_PATH}${path}`, { headers: auth }));
  return { status: res.status, body: await res.json(), res };
}

/** The ServerEvents in an SSE body, checking the id/event/data framing of each message. */
function parseSse(text: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  for (const block of text.split("\n\n").filter((b) => b.trim())) {
    const fields = Object.fromEntries(
      block.split("\n").map((line) => {
        const at = line.indexOf(": ");
        return [line.slice(0, at), line.slice(at + 2)];
      })
    );
    if ("retry" in fields) continue;
    const event = ServerEvent.parse(JSON.parse(fields.data));
    expect(fields.id).toBe(event.id);
    expect(fields.event).toBe(event.type);
    events.push(event);
  }
  return events;
}

let owner: UserRecord; // an operator
let member: UserRecord;
let ownerAuth: Record<string, string>;
let memberAuth: Record<string, string>;

beforeAll(() => {
  // Own users, so other test files changing the bootstrap owner cannot affect these tests.
  const user = (role: "admin" | "member") =>
    createUser({ email: `${generateId("v2")}@test.local`, displayName: `v2 ${role}`, password: "correct_password_1", role });
  owner = user("admin");
  member = user("member");
  ownerAuth = { "X-Lectern-Token": owner.api_token };
  memberAuth = { "X-Lectern-Token": member.api_token };
});

describe("API v2 route table", () => {
  test("openapi.json and ROUTES describe the same operations", () => {
    const fromOpenApi = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`)
    );
    const fromRoutes = ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(fromOpenApi.sort()).toEqual(fromRoutes.sort());
  });

  test("every openapi.json operation is mounted exactly once, and nothing else is", () => {
    const expected = Object.entries(openapi.paths)
      .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${toHonoPath(path)}`))
      .sort();
    const mounted = createApiV2App()
      .routes.filter((r) => r.method !== "ALL" && r.path !== "/openapi.json")
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(mounted).toEqual(expected);
  });

  test("the samples cover every path parameter and JSON body", () => {
    for (const route of ROUTES) {
      expect(() => urlFor(route)).not.toThrow();
      if (route.body && "schema" in route.body) {
        expect(route.body.schema.safeParse(BODIES[route.operationId]).success, route.operationId).toBe(true);
      }
    }
  });
});

describe("API v2 authentication", () => {
  test("every route answers 401 in the ApiError shape without credentials", async () => {
    for (const route of ROUTES) {
      const attempts: Record<string, string>[] = [{}, { "X-Lectern-Token": "lct_not_a_real_token" }, { Cookie: "lectern_session=ses_nope" }];
      for (const auth of attempts) {
        const res = await call(requestFor(route, auth));
        expect(res.status, `${route.operationId} ${JSON.stringify(auth)}`).toBe(401);
        expect(ApiError.parse(await res.json()).error.code).toBe("unauthorized");
      }
    }
  });

  test("the session cookie and the API token both authenticate, like v1", async () => {
    const session = createSession(owner.id);
    const credentials: Record<string, string>[] = [
      { Cookie: `lectern_session=${encodeURIComponent(session)}` },
      { "X-Lectern-Token": owner.api_token },
      { Authorization: `Bearer ${owner.api_token}` },
    ];
    for (const auth of credentials) {
      expect((await getJson("/me", auth)).status).toBe(200);
    }
  });

  test("admin routes need an operator; /me reports the caller's operator role", async () => {
    const adminRoutes = ROUTES.filter((r) => r.tag === "admin");
    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const route of adminRoutes) {
      const res = await call(requestFor(route, memberAuth));
      expect(res.status, route.operationId).toBe(403);
      expect(ApiError.parse(await res.json()).error.code).toBe("forbidden");
    }
    expect((await getJson("/me", memberAuth)).body.system_role).toBe("member");
    expect((await getJson("/me", ownerAuth)).body.system_role).toBe("admin");
  });
});

describe("API v2 stub responses", () => {
  test("reads answer fixtures that pass the response schema; writes and uploads answer 501", async () => {
    for (const route of ROUTES) {
      const res = await call(requestFor(route, ownerAuth));
      const declared = Object.keys(route.responses).map(Number);
      if (!isFixtureRoute(route)) {
        expect(res.status, route.operationId).toBe(501);
        const body = ApiError.parse(await res.json());
        expect(body.error.code).toBe("not_implemented");
        expect(body.error.details).toEqual({ operation_id: route.operationId });
        continue;
      }
      expect(declared, route.operationId).toContain(res.status);
      const response = route.responses[res.status]!;
      if (response.contentType === "text/event-stream") {
        expect(res.headers.get("content-type")).toStartWith("text/event-stream");
        expect(parseSse(await res.text()).length).toBeGreaterThan(0);
        continue;
      }
      expect(res.headers.get("content-type")).toStartWith("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const parsed = response.schema!.safeParse(await res.json());
      expect(parsed.success, `${route.operationId}: ${parsed.error?.message}`).toBe(true);
    }
  });

  test("every list fixture has at least one item, so clients see real shapes", async () => {
    for (const route of ROUTES.filter(isFixtureRoute)) {
      const res = await call(requestFor(route, ownerAuth));
      if (route.responses[200]?.contentType === "text/event-stream") continue;
      const body: any = await res.json();
      if ("items" in body) expect(body.items.length, route.operationId).toBeGreaterThan(0);
    }
  });

  test("the fixtures form one graph a client can walk", async () => {
    const me = (await getJson("/me", ownerAuth)).body;
    const workspaces = (await getJson("/workspaces", ownerAuth)).body.items;
    expect(workspaces.map((w: any) => w.workspace.id)).toContain(me.personal_workspace_id);

    let documentCount = 0;
    for (const { workspace } of workspaces) {
      const folderIds = (await getJson(`/folders?workspace_id=${workspace.id}`, ownerAuth)).body.items.map((f: any) => f.id);
      const tagIds = (await getJson(`/tags?workspace_id=${workspace.id}`, ownerAuth)).body.items.map((t: any) => t.id);
      const recordings = (await getJson(`/recordings?workspace_id=${workspace.id}`, ownerAuth)).body.items;
      expect(recordings.length).toBeGreaterThan(0);
      for (const item of recordings) {
        expect(item.workspace_id).toBe(workspace.id);
        if (item.folder_id) expect(folderIds).toContain(item.folder_id);
        for (const tagId of item.tag_ids) expect(tagIds).toContain(tagId);

        const detail = await getJson(`/recordings/${item.id}`, ownerAuth);
        expect(detail.status).toBe(200);
        expect(detail.body.recording).toEqual(Object.fromEntries(Object.entries(item).filter(([k]) => k !== "tag_ids")));

        const transcript = (await getJson(`/recordings/${item.id}/transcript`, ownerAuth)).body;
        const speakerIds = transcript.speakers.map((s: any) => s.id);
        transcript.segments.forEach((segment: any, i: number) => {
          expect(segment.idx).toBe(i);
          if (segment.speaker_id) expect(speakerIds).toContain(segment.speaker_id);
        });

        for (const document of detail.body.documents) {
          documentCount += 1;
          const doc = await getJson(`/documents/${document.id}`, ownerAuth);
          expect(doc.status).toBe(200);
          expect(doc.res.headers.get("etag")).toBe(versionETag(document.current_version));
          expect(doc.body.version.version).toBe(document.current_version);
          // Every transcript source points at a segment that exists.
          for (const block of doc.body.version.body.sections.flatMap((s: any) => s.blocks)) {
            const sources = [...block.sources, ...(block.items ?? []).flatMap((it: any) => it.sources)];
            for (const source of sources.filter((s: any) => s.kind === "transcript")) {
              expect(source.end_idx).toBeLessThan(transcript.segments.length);
            }
          }
          const versions = (await getJson(`/documents/${document.id}/versions`, ownerAuth)).body.items;
          expect(versions[0].version).toBe(document.current_version);
          expect(versions[0].body).toBeUndefined();
        }
        if (detail.body.active_job) {
          expect((await getJson(`/jobs/${detail.body.active_job.id}`, ownerAuth)).status).toBe(200);
        }
      }
    }
    expect(documentCount).toBeGreaterThan(0);
  });

  test("unknown ids answer 404, other workspaces 403, malformed input 400", async () => {
    const unknown = "0199f0a0-ffff-7000-8000-000000000000";
    for (const path of [`/recordings/${unknown}`, `/documents/${unknown}`, `/documents/${ID.docOs5}/versions/99`, `/workspaces/${unknown}`, `/jobs/${unknown}`]) {
      const res = await getJson(path, ownerAuth);
      expect(res.status, path).toBe(404);
      expect(ApiError.parse(res.body).error.code).toBe("not_found");
    }
    // System jobs only show up under /admin.
    expect((await getJson(`/jobs/${ID.jobMaintenance}`, ownerAuth)).status).toBe(404);
    expect((await getJson(`/admin/jobs/${ID.jobMaintenance}`, ownerAuth)).status).toBe(200);

    const foreign = await getJson(`/recordings?workspace_id=${unknown}`, ownerAuth);
    expect(foreign.status).toBe(403);
    expect(ApiError.parse(foreign.body).error.code).toBe("forbidden");

    const missing = await getJson("/recordings", ownerAuth);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("validation_failed");
    expect(missing.body.error.details.issues[0].path).toEqual(["query", "workspace_id"]);
    expect((await getJson("/recordings/not%20an%20id", ownerAuth)).status).toBe(400);
    expect((await getJson(`/workspaces?limit=0`, ownerAuth)).status).toBe(400);
  });

  test("lists filter by their query and page with an opaque cursor", async () => {
    const os = await getJson(`/recordings?workspace_id=${ID.wsPersonal}&folder_id=${ID.folderOs}&status=ready`, ownerAuth);
    expect(os.body.items.map((r: any) => r.id)).toEqual([ID.recOs5]);
    const tagged = await getJson(`/recordings?workspace_id=${ID.wsPersonal}&tag_id=${ID.tagReview}`, ownerAuth);
    expect(tagged.body.items.map((r: any) => r.id)).toEqual([ID.recOs5]);
    const accepted = await getJson(`/calendar/suggestions?workspace_id=${ID.wsPersonal}&status=accepted`, ownerAuth);
    expect(accepted.body.items.map((e: any) => e.id)).toEqual([ID.eventMidterm]);

    const first = await getJson("/workspaces?limit=1", ownerAuth);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.next_cursor).toBeString();
    const second = await getJson(`/workspaces?limit=1&cursor=${first.body.next_cursor}`, ownerAuth);
    expect(second.body.items[0].workspace.id).not.toBe(first.body.items[0].workspace.id);
    expect(second.body.next_cursor).toBeNull();
    expect((await getJson("/workspaces?cursor=garbage", ownerAuth)).status).toBe(400);
  });

  test("search highlights matches in transcripts, documents and PDF pages", async () => {
    const hits = (await getJson(`/search?workspace_id=${ID.wsPersonal}&q=${encodeURIComponent("대기 시간")}`, ownerAuth)).body.items;
    expect(new Set(hits.map((h: any) => h.kind))).toEqual(new Set(["document", "pdf_page"]));
    for (const hit of hits) {
      expect(hit.snippet.map((p: any) => p.text).join("")).toContain("대기 시간");
      expect(hit.snippet.filter((p: any) => p.highlight).map((p: any) => p.text)).toContain("대기 시간");
    }
    const none = await getJson(`/search?workspace_id=${ID.wsTeam}&q=FCFS`, ownerAuth);
    expect(none.body.items).toEqual([]);
  });
});

describe("API v2 request handling", () => {
  const createVersion = (headers: Record<string, string>, body: string) =>
    call(
      new Request(`http://localhost${API_BASE_PATH}/documents/${ID.docOs5}/versions`, {
        method: "POST",
        headers: { ...ownerAuth, ...headers },
        body,
      })
    );
  const validBody = JSON.stringify(BODIES.createDocumentVersion);

  test("saving a document version needs If-Match (428) before anything else", async () => {
    const missing = await createVersion({ "Content-Type": "application/json" }, validBody);
    expect(missing.status).toBe(428);
    expect(ApiError.parse(await missing.json()).error.code).toBe("precondition_required");
    const malformed = await createVersion({ "Content-Type": "application/json", "If-Match": "2" }, validBody);
    expect(malformed.status).toBe(400);
    const present = await createVersion({ "Content-Type": "application/json", "If-Match": versionETag(2) }, validBody);
    expect(present.status).toBe(501);
  });

  test("JSON bodies need the JSON media type, valid JSON and the request schema", async () => {
    const ifMatch = { "If-Match": versionETag(2) };
    const wrongType = await createVersion({ ...ifMatch, "Content-Type": "text/plain" }, validBody);
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json()).error.code).toBe("bad_request");
    const badJson = await createVersion({ ...ifMatch, "Content-Type": "application/json" }, "{");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe("bad_request");
    const invalid = await createVersion({ ...ifMatch, "Content-Type": "application/json; charset=utf-8" }, "{}");
    expect(invalid.status).toBe(400);
    const issues = (await invalid.json()).error.details.issues;
    expect(issues[0].path).toEqual(["body", "body"]);
  });

  test("SSE replays only what follows Last-Event-ID, per workspace", async () => {
    const stream = (lastEventId?: string, workspaceId: string = ID.wsPersonal) =>
      call(
        new Request(`http://localhost${API_BASE_PATH}/events?workspace_id=${workspaceId}`, {
          headers: { ...ownerAuth, ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}) },
        })
      );
    const ids = async (res: Response) => parseSse(await res.text()).map((e): string => e.id);

    const all = await ids(await stream());
    expect(all).toEqual(["1001", "1002", "1004", "1005"]);
    expect(await ids(await stream("1002"))).toEqual(["1004", "1005"]);
    expect(await ids(await stream("1005"))).toEqual([]);
    // An id the log does not hold: the gap is unknown, so everything is replayed.
    expect(await ids(await stream("424242"))).toEqual(all);
    expect(await ids(await stream(undefined, ID.wsTeam))).toEqual(["1003"]);

    const first = await stream();
    expect(first.headers.get("content-type")).toStartWith("text/event-stream");
    expect(await first.text()).toStartWith("retry: ");
    expect((await stream("not an id!")).status).toBe(400);
    expect((await stream(undefined, "0199f0a0-ffff-7000-8000-000000000000")).status).toBe(403);
  });

  test("unknown v2 paths answer 404 in the v2 shape; other paths still reach the legacy router", async () => {
    const unknown = await getJson("/no-such-resource", ownerAuth);
    expect(unknown.status).toBe(404);
    expect(ApiError.parse(unknown.body).error.code).toBe("not_found");
    const wrongMethod = await call(new Request(`http://localhost${API_BASE_PATH}/me`, { method: "PUT", headers: ownerAuth }));
    expect(wrongMethod.status).toBe(404);

    const legacy = await call(new Request("http://localhost/api/lectures"));
    expect(legacy.status).toBe(401);
    expect(typeof (await legacy.json()).error).toBe("string"); // v1 error shape, unchanged
    // Only /api/v2 and below belong to v2; a lookalike prefix is the legacy router's 404.
    const lookalike = await call(new Request("http://localhost/api/v2x"));
    expect(lookalike.status).toBe(404);
    expect(typeof (await lookalike.json()).error).toBe("string");
  });

  test("the OpenAPI document is public and matches the committed openapi.json", async () => {
    const res = await call(new Request(`http://localhost${API_BASE_PATH}/openapi.json`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(readFileSync(OPENAPI_FILE, "utf8"));
  });

  test("responses carry the request id and the security headers", async () => {
    const res = await call(new Request(`http://localhost${API_BASE_PATH}/me`, { headers: { ...ownerAuth, "x-request-id": "trace-v2-123456" } }));
    expect(res.headers.get("X-Request-Id")).toBe("trace-v2-123456");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
