import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resetConfigForTests } from "@lectern/config";
import {
  API_BASE_PATH,
  ApiError,
  HEADER,
  ROUTES,
  ROUTES_BY_OPERATION,
  toHonoPath,
  versionETag,
  type RouteDef,
} from "@lectern/domain";
import { createApiV2App } from "../src/api/v2/index.ts";
import { createSession, createUser, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// Contract tests for /api/v2 as a whole: every route in packages/domain's openapi.json is
// mounted, needs a session or token, validates its input before the handler runs, and the
// routes of later phases answer 501 `not_implemented`. Behaviour over real data is in
// api-v2-data.test.ts, the policy table in api-v2-access.test.ts.

const OPENAPI_FILE = fileURLToPath(import.meta.resolve("@lectern/domain/openapi.json"));
const openapi = JSON.parse(readFileSync(OPENAPI_FILE, "utf8")) as { paths: Record<string, Record<string, unknown>> };

/** Routes of later phases. */
const NOT_YET = new Set([
  // Accounts (P5-C): contract only until P5-09.
  "requestAccountDeletion",
  "cancelAccountDeletion",
  "getAccountDeletion",
]);

const SAMPLE_ID = "0199f0a0-1000-7000-8000-00000000abcd";

/** A syntactically valid value for every path parameter in the route table. */
const PATH_PARAMS: Record<string, string> = {
  workspace_id: SAMPLE_ID,
  device_id: "ses_0000",
  token_id: "tok_0000",
  folder_id: SAMPLE_ID,
  tag_id: SAMPLE_ID,
  view_id: SAMPLE_ID,
  upload_id: SAMPLE_ID,
  part: "1",
  recording_id: SAMPLE_ID,
  speaker_id: SAMPLE_ID,
  asset_id: SAMPLE_ID,
  document_id: SAMPLE_ID,
  version: "2",
  action_item_id: SAMPLE_ID,
  job_id: SAMPLE_ID,
  event_candidate_id: SAMPLE_ID,
  integration_id: SAMPLE_ID,
  share_link_id: SAMPLE_ID,
  thread_id: SAMPLE_ID,
  identity_id: SAMPLE_ID,
  invite_id: SAMPLE_ID,
  user_id: SAMPLE_ID,
  export_id: SAMPLE_ID,
};

const PATH_PARAM_OVERRIDES: Record<string, Record<string, string>> = {};

/** Required query values, per operation. */
const QUERIES: Record<string, Record<string, string>> = {
  search: { workspace_id: SAMPLE_ID, q: "FCFS" },
  streamEvents: { workspace_id: SAMPLE_ID },
  getAskUsage: { workspace_id: SAMPLE_ID },
  exportDocument: { format: "md" },
  listAskSuggestions: { workspace_id: SAMPLE_ID, scope_type: "workspace" },
};
for (const op of [
  "listFolders",
  "listTags",
  "listSavedViews",
  "listRecordings",
  "listActionItems",
  "listCalendarSuggestions",
  "listIntegrations",
  "listShareLinks",
  "listAskThreads",
  "getCalendarFeed",
  "deleteCalendarFeed",
]) {
  QUERIES[op] = { workspace_id: SAMPLE_ID };
}

/** A valid body for every JSON-body route, so a write reaches its handler (501). */
const BODIES: Record<string, unknown> = {
  updateMe: { display_name: "새 이름" },
  createAccessToken: { workspace_id: SAMPLE_ID, name: "스크립트", scopes: ["recordings:read"] },
  createWorkspace: { name: "새 팀" },
  updateWorkspace: { name: "이름 변경" },
  createFolder: { workspace_id: SAMPLE_ID, name: "새 폴더" },
  updateFolder: { name: "이름 변경" },
  createTag: { workspace_id: SAMPLE_ID, name: "새 태그", color: "blue" },
  updateTag: { color: "green" },
  createUpload: {
    workspace_id: SAMPLE_ID,
    files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 1024 }],
  },
  createSavedView: { workspace_id: SAMPLE_ID, name: "보기", query: {} },
  updateSavedView: { name: "새 보기" },
  batchRecordings: { action: "delete", recording_ids: [SAMPLE_ID] },
  updateRecording: { title: "새 제목" },
  updateSpeaker: { display_name: null },
  reprocessRecording: { mode: "document", dry_run: true },
  ocrAsset: { dry_run: true },
  createDocumentVersion: { markdown: "# 고친 노트" },
  updateActionItem: { status: "done" },
  updateCalendarSuggestion: { status: "accepted" },
  batchCalendarSuggestions: { event_candidate_ids: [SAMPLE_ID], action: "dismiss" },
  startGoogleIntegration: { workspace_id: SAMPLE_ID },
  createCalendarFeed: { workspace_id: SAMPLE_ID },
  createShareLink: { target_type: "document", target_id: SAMPLE_ID, scope: { transcript: false, audio: false } },
  updateShareLink: { password: null },
  createAskThread: { workspace_id: SAMPLE_ID, scope: { kind: "workspace" } },
  askQuestion: { question: "시험 범위가 어디까지야?" },
  issueNativeToken: { grant_type: "password", email: "student@example.com", password: "correct_password_1" },
  revokeNativeToken: { refresh_token: "rt_0123456789abcdef" },
  createInvite: { email: "friend@example.com", role: "member" },
  acceptInvite: { token: "inv_0123456789abcdef" },
  updateMember: { role: "viewer" },
  adminSetQuota: { audio_ms_month: null, ai_microusd_month: 5_000_000, storage_bytes: null },
  createExport: { workspace_id: SAMPLE_ID, include_audio: false },
  requestAccountDeletion: { password: "correct_password_1" },
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

  const OUTSIDE_TABLE = new Set([
    "/openapi.json",
    "/integrations/google/callback",
    "/auth/google/start",
    "/auth/google/callback",
    "/auth/apple/start",
    "/auth/apple/callback",
  ]);

  test("every openapi.json operation is mounted exactly once, and nothing else is", () => {
    const expected = Object.entries(openapi.paths)
      .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${toHonoPath(path)}`))
      .sort();
    const mounted = createApiV2App()
      // Outside the route table: the schema itself and the browser navigations of OAuth: the
      // calendar's redirect back (P4-02), Google sign-in (P5-04) and Apple sign-in (P5-05).
      .routes.filter((r) => r.method !== "ALL" && !OUTSIDE_TABLE.has(r.path))
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
    // Except the public ones (native sign-in), checked in "public routes answer without a session".
    for (const route of ROUTES.filter((r) => !r.public)) {
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

describe("API v2 routes of later phases", () => {
  test("answer 501 after authentication and validation", async () => {
    for (const route of ROUTES.filter((r) => NOT_YET.has(r.operationId))) {
      const res = await call(requestFor(route, ownerAuth));
      expect(res.status, route.operationId).toBe(501);
      const body = ApiError.parse(await res.json());
      expect(body.error.code).toBe("not_implemented");
      expect(body.error.details).toEqual({ operation_id: route.operationId });
    }
  });

  test("public routes answer without a session", async () => {
    const publicRoutes = ROUTES.filter((r) => r.public);
    expect(publicRoutes.map((r) => r.operationId).sort()).toEqual(["issueNativeToken", "revokeNativeToken"]);
    // Native sign-in (P5-03): an unknown account is refused as a bad password, not as a
    // missing session; revoking an unknown refresh token is a quiet 204.
    const issued = await call(requestFor(ROUTES_BY_OPERATION.issueNativeToken!, {}));
    expect(issued.status).toBe(401);
    expect(ApiError.parse(await issued.json()).error.message).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    const revoked = await call(requestFor(ROUTES_BY_OPERATION.revokeNativeToken!, {}));
    expect(revoked.status).toBe(204);
  });

  test("every other route has a real handler (no route answers 501)", async () => {
    // Flag-gated routes answer 501 while their flag is off (listAssetPages, ocrAsset,
    // getRecordingAlignment: LECTERN_PDF; the calendar feed routes: LECTERN_CALENDAR).
    process.env.LECTERN_PDF = "1";
    process.env.LECTERN_CALENDAR = "1";
    process.env.LECTERN_TEAMS = "1"; // invitations and members (P5-06)
    // startGoogleIntegration also needs an OAuth client (fake values; nothing is called).
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    resetConfigForTests();
    try {
      for (const route of ROUTES.filter((r) => !NOT_YET.has(r.operationId) && !r.path.startsWith("/ask"))) {
        const res = await call(requestFor(route, ownerAuth));
        expect(res.status, route.operationId).not.toBe(501);
        await res.body?.cancel();
      }
    } finally {
      delete process.env.LECTERN_PDF;
      delete process.env.LECTERN_CALENDAR;
      delete process.env.LECTERN_TEAMS;
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      resetConfigForTests();
    }
  });
});

describe("API v2 request handling", () => {
  const createVersion = (headers: Record<string, string>, body: string) =>
    call(
      new Request(`http://localhost${API_BASE_PATH}/documents/${SAMPLE_ID}/versions`, {
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
    expect(present.status).toBe(404); // validated, then the unknown document
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
    expect(issues[0].path).toEqual(["body", "body"]); // neither body nor markdown
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
