import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, uuidv7 } from "@lectern/db";
import { API_BASE_PATH, ROUTES, type RouteDef } from "@lectern/domain";
import { createSession, db, generateId, type UserRecord } from "../../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../../src/index.ts";
import { embeddedWorker, type JobWorker } from "../../src/queue.ts";
import { sealSecret } from "../../src/secrets.ts";
import { createShareLink, makeUser, seedLecture, tokenAuth, v2 } from "./helpers.ts";
import { bodyFor, queriesFor, requestFor, send, WRITE_METHODS, type Targets } from "./routes.ts";

// P5-15 · Other people's resources. User A owns one of everything the route table takes an
// id of; user B (a stranger) calls every v2 route with A's ids in the path, the query and the
// body. Then: no credentials at all, a team viewer writing, a teammate's private recording,
// the shape of new ids, and the event stream.

const RESEND_URL = "https://api.resend.com/emails";
const ON = {
  LECTERN_TEAMS: "1",
  LECTERN_CALENDAR: "1",
  LECTERN_PDF: "1",
  LECTERN_ASK: "1",
  GOOGLE_OAUTH_CLIENT_ID: "test-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
  RESEND_API_KEY: "test-key-never-sent",
  LECTERN_WORKER_MODE: "external",
};
const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};

const realFetch = globalThis.fetch;
let paused: JobWorker | null = null;

let A: UserRecord;
let B: UserRecord;
const SECRET_TITLE = "A의 비밀 강의";
/** A's ids, by path parameter name. */
const ids: Record<string, string> = {};
let targets: Targets;
let team = "";
let teamRecording = "";
let teamFolder = "";

const idOf = (body: any): string => body?.id ?? body?.invite?.id ?? body?.thread?.id ?? body?.export?.id ?? body?.token?.id ?? body?.link?.id;

async function created(label: string, res: Promise<{ status: number; body: any; text: string }>): Promise<string> {
  const r = await res;
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${r.text}`);
  const id = idOf(r.body);
  if (!id) throw new Error(`${label}: no id in ${r.text}`);
  return id;
}

beforeAll(async () => {
  setEnv(ON);
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === RESEND_URL ? Response.json({ id: "email_test" }) : realFetch(url, init)) as typeof fetch;
  paused = embeddedWorker();
  await paused?.drain(10_000);

  A = makeUser({ email: `${generateId("alice")}@victim.test`.toLowerCase() });
  B = makeUser();
  const ws = personalWorkspaceId(A.id);
  const a = tokenAuth(A);
  const seeded = seedLecture(A, SECRET_TITLE);
  const now = Date.now();

  ids.workspace_id = ws;
  ids.recording_id = seeded.recordingId;
  ids.document_id = seeded.documentId;
  ids.version = "1";
  ids.part = "1";
  ids.folder_id = await created("folder", v2("POST", "/folders", { headers: a, body: { workspace_id: ws, name: "A의 폴더" } }));
  ids.tag_id = await created("tag", v2("POST", "/tags", { headers: a, body: { workspace_id: ws, name: "A의 태그", color: "blue" } }));
  ids.view_id = await created("view", v2("POST", "/views", { headers: a, body: { workspace_id: ws, name: "A의 보기", query: {} } }));
  ids.upload_id = await created(
    "upload",
    v2("POST", "/uploads", { headers: a, body: { workspace_id: ws, files: [{ kind: "audio", filename: "a.m4a", mime: "audio/mp4", bytes: 1024 }] } })
  );
  ids.asset_id = (await v2("GET", `/recordings/${seeded.recordingId}`, { headers: a })).body.assets[0].id;
  ids.share_link_id = (await createShareLink(A, seeded.recordingId)).id;
  // The ask service is decided once per process (ask/service.ts): when an earlier test file
  // read it with LECTERN_ASK off, the ask routes answer 501 for everyone, so A's thread is a
  // row here rather than a request.
  ids.thread_id = uuidv7();
  db.query(
    `INSERT INTO ask_thread (id, workspace_id, user_id, scope_kind, scope_json, recording_id, folder_id, title, turn_count, created_at, updated_at)
     VALUES (?, ?, ?, 'workspace', '{"kind":"workspace"}', NULL, NULL, 'A의 질문', 0, ?, ?)`
  ).run(ids.thread_id, ws, A.id, now, now);
  ids.export_id = await created("export", v2("POST", "/me/exports", { headers: a, body: { workspace_id: ws, include_audio: false } }));
  ids.token_id = await created(
    "token",
    v2("POST", "/me/tokens", { headers: a, body: { workspace_id: ws, name: "A의 토큰", scopes: ["recordings:read"] } })
  );
  const session = createSession(A.id);
  const devices = (await v2("GET", "/me/devices", { cookie: session })).body.items as { id: string; current: boolean }[];
  ids.device_id = (devices.find((d) => d.current) ?? devices[0]!).id;
  // A push device of A's under the same id (the app chooses push device ids; the path
  // parameter has one name for both kinds of device).
  const push = await v2("PUT", `/me/push-devices/${ids.device_id}`, {
    headers: a,
    body: { platform: "ios", apns_token: randomBytes(32).toString("hex"), name: "A의 아이폰" },
  });
  if (push.status !== 200) throw new Error(`push device: ${push.status} ${push.text}`);
  ids.marker_id = await created("marker", v2("POST", `/recordings/${seeded.recordingId}/markers`, { headers: a, body: { at_ms: 1_000, label: "A의 표시" } }));
  ids.job_id = (db.query(`SELECT id FROM job WHERE workspace_id = ? OR owner_id = ? LIMIT 1`).get(ws, A.id) as { id: string }).id;

  // Rows no route makes on demand: an identity, a calendar link, a speaker, an action item
  // and a calendar suggestion of A's.
  ids.identity_id = uuidv7();
  db.query(`INSERT INTO oauth_identity (id, user_id, provider, subject, email, created_at) VALUES (?, ?, 'google', ?, ?, ?)`).run(ids.identity_id, A.id, generateId("sub"), A.email, now);
  ids.integration_id = uuidv7();
  db.query(
    `INSERT INTO integration (id, workspace_id, user_id, provider, scopes_json, token_enc, calendar_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'google', '[]', ?, NULL, 'active', ?, ?)`
  ).run(ids.integration_id, ws, A.id, sealSecret(JSON.stringify({ refresh_token: "rt-a" })), now, now);
  ids.speaker_id = uuidv7();
  db.query(`INSERT INTO speaker (id, workspace_id, recording_id, label, display_name, confidence, created_at, updated_at) VALUES (?, ?, ?, 'S1', 'A 화자', 0.9, ?, ?)`).run(
    ids.speaker_id,
    ws,
    seeded.recordingId,
    now,
    now
  );
  ids.action_item_id = uuidv7();
  db.query(
    `INSERT INTO action_item (id, workspace_id, recording_id, text, status, evidence_json, created_at, updated_at) VALUES (?, ?, ?, 'A의 할 일', 'open', '{"sources":[],"quote":"근거"}', ?, ?)`
  ).run(ids.action_item_id, ws, seeded.recordingId, now, now);
  ids.event_candidate_id = uuidv7();
  db.query(
    `INSERT INTO event_candidate (id, workspace_id, recording_id, kind, title, start_at, end_at, all_day, tz, raw_expression, resolution_json, confidence, evidence_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'exam', 'A의 시험', ?, NULL, 0, 'Asia/Seoul', '다음 주', '{"method":"parser","rule":"x"}', 0.9, '{"sources":[],"quote":"근거"}', 'suggested', ?, ?)`
  ).run(ids.event_candidate_id, ws, seeded.recordingId, now + 86_400_000, now, now);

  // A team A owns, with an invitation, a member (A) and a recording shared with the team.
  team = uuidv7();
  db.query(`INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at) VALUES (?, 'A의 팀', 'team', 'free', '{}', NULL, ?, ?)`).run(team, now, now);
  db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)`).run(team, A.id, now, now);
  ids.invite_id = await created("invite", v2("POST", `/workspaces/${team}/invites`, { headers: a, body: { email: `${generateId("inv")}@test.local`, role: "member" } }));
  ids.user_id = A.id;
  teamRecording = seedTeamRecording(A, "workspace");
  teamFolder = await created("team folder", v2("POST", "/folders", { headers: a, body: { workspace_id: team, name: "팀 폴더" } }));

  targets = { workspaceId: ws, recordingId: seeded.recordingId, documentId: seeded.documentId, eventCandidateId: ids.event_candidate_id };
});
beforeEach(() => resetAuthRateLimits());
afterAll(() => {
  globalThis.fetch = realFetch;
  db.query(`DELETE FROM job WHERE state = 'queued' AND (workspace_id = ? OR owner_id = ?)`).run(personalWorkspaceId(A.id), A.id);
  setEnv(Object.fromEntries(Object.keys(ON).map((k) => [k, undefined])));
});

/** A recording row of the team without a lecture (as api-v2-access.test.ts seeds them). */
function seedTeamRecording(by: UserRecord, visibility: "workspace" | "private"): string {
  const id = uuidv7();
  const now = Date.now();
  db.query(
    `INSERT INTO recording (id, workspace_id, folder_id, title, domain, template_id, language, recorded_at, recorded_at_source,
       duration_ms, status, created_by, visibility, lecture_id, source_client, failure_code, failure_message, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'lecture', NULL, NULL, ?, 'upload', NULL, 'ready', ?, ?, NULL, 'test', NULL, NULL, ?, ?)`
  ).run(id, team, visibility === "private" ? "팀원의 비공개 녹음" : "팀 녹음", now, by.id, visibility, now, now);
  return id;
}

const isTargeted = (route: RouteDef, t: Targets) =>
  route.path.includes("{") ||
  "workspace_id" in queriesFor(route, t.workspaceId) ||
  [t.workspaceId, t.recordingId, t.documentId, t.eventCandidateId].some((id) => JSON.stringify(bodyFor(route, t) ?? "").includes(id));

/** GETs first, so a write that wrongly succeeds cannot hide a read that would have. */
const ordered = () => [...ROUTES.filter((r) => !r.public)].sort((x, y) => Number(WRITE_METHODS.has(x.method)) - Number(WRITE_METHODS.has(y.method)));

/**
 * A batch answers 200 with a result per item (recordings.ts): that is a refusal when every
 * item failed as not found or forbidden.
 */
const batchRefused = (route: RouteDef, status: number, text: string) => {
  if (route.operationId !== "batchRecordings" || status !== 200) return false;
  const results = (JSON.parse(text) as { results: { ok: boolean; error: { code: string } | null }[] }).results;
  return results.length > 0 && results.every((r) => !r.ok && (r.error?.code === "not_found" || r.error?.code === "forbidden"));
};

/** The ask routes answer 501 to everyone while this process has no ask service: no data is reached. */
const askOff = (route: RouteDef, status: number) => route.path.startsWith("/ask") && status === 501;

/** A push device id is chosen by the app: another account's PUT on it is 409 and changes nothing. */
const takenRefused = (route: RouteDef, status: number) => route.operationId === "upsertPushDevice" && status === 409;

const leaks = (text: string) =>
  [A.email, SECRET_TITLE, "A의 폴더", "A의 태그", "A의 할 일", "A의 시험", "A의 토큰", "A의 아이폰", "A의 표시"].filter((s) => text.includes(s));

describe("security: other people's resources", () => {
  test("every v2 route refuses a foreign workspace", async () => {
    const wrong: string[] = [];
    for (const asAuth of [tokenAuth(B), { Cookie: `lectern_session=${encodeURIComponent(createSession(B.id))}` }]) {
      for (const workspaceId of [ids.workspace_id!, team]) {
        for (const route of ordered()) {
          // The team pass is for the routes that take a workspace in their path.
          if (workspaceId === team && !route.path.includes("{workspace_id}")) continue;
          const t = { ...targets, workspaceId };
          const { status, text } = await send(requestFor(route, { params: { ...ids, workspace_id: workspaceId }, targets: t, headers: asAuth }));
          const leaked = leaks(text);
          if (leaked.length) wrong.push(`${route.operationId}: leaks ${leaked.join(", ")}`);
          if (isTargeted(route, t) && status !== 403 && status !== 404 && !batchRefused(route, status, text) && !askOff(route, status) && !takenRefused(route, status)) wrong.push(`${route.operationId} (${workspaceId === team ? "team" : "personal"}): ${status}`);
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
    // A's things are all still there.
    expect((await v2("GET", `/recordings/${ids.recording_id}`, { headers: tokenAuth(A) })).body.recording.title).toBe(SECRET_TITLE);
    expect((db.query(`SELECT user_id FROM push_device WHERE id = ?`).get(ids.device_id!) as { user_id: string }).user_id).toBe(A.id);
    expect((await v2("GET", `/recordings/${ids.recording_id}/markers`, { headers: tokenAuth(A) })).text).toContain("A의 표시");
  });

  test("unauthenticated", async () => {
    const wrong: string[] = [];
    for (const route of ordered()) {
      const forged: Record<string, string>[] = [{}, { Cookie: "lectern_session=ses_forged" }, { Authorization: "Bearer lct_pat_forged" }];
      for (const auth of forged) {
        const { status } = await send(requestFor(route, { params: ids, targets, headers: auth }));
        if (status !== 401) wrong.push(`${route.operationId} ${JSON.stringify(auth)} ${status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("viewer cannot write", async () => {
    // An ordinary account; only its membership in the team is `viewer`.
    const viewer = makeUser();
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'viewer', ?, ?)`).run(team, viewer.id, now, now);
    const teamTargets: Targets = { workspaceId: team, recordingId: teamRecording, documentId: ids.document_id!, eventCandidateId: ids.event_candidate_id! };
    const params = { ...ids, workspace_id: team, recording_id: teamRecording, folder_id: teamFolder };
    // What a viewer may still do: change their own account and push devices, and keep things
    // of their own in the workspace — saved views (saved_view.user_id), their calendar feed (one per user and
    // workspace, D-P4-2) and their Google Calendar link (integration.user_id). Those change
    // nothing the team shares.
    const ownAccount = new Set([
      "updateMe", "createWorkspace", "createAccessToken", "revokeAccessToken", "revokeDevice", "unlinkIdentity",
      "requestAccountDeletion", "cancelAccountDeletion", "acceptInvite", "createExport", "issueNativeToken", "revokeNativeToken",
      "createSavedView", "updateSavedView", "deleteSavedView", "createCalendarFeed", "deleteCalendarFeed",
      "startGoogleIntegration", "disconnectIntegration", "upsertPushDevice", "deletePushDevice",
    ]);
    const wrong: string[] = [];
    for (const route of ROUTES.filter((r) => WRITE_METHODS.has(r.method) && !r.public && !ownAccount.has(r.operationId) && r.tag !== "admin")) {
      const { status, text } = await send(requestFor(route, { params, targets: teamTargets, headers: tokenAuth(viewer) }));
      if (status !== 403 && status !== 404 && !batchRefused(route, status, text) && !askOff(route, status)) wrong.push(`${route.operationId} ${status}`);
    }
    expect(wrong).toEqual([]);
    // The team's things are unchanged.
    expect((await v2("GET", `/recordings/${teamRecording}`, { headers: tokenAuth(A) })).body.recording.title).toBe("팀 녹음");
    // The ones that name the team directly answer 403 to the viewer, and the owner may do them.
    expect((await v2("POST", "/folders", { headers: tokenAuth(viewer), body: { workspace_id: team, name: "뷰어 폴더" } })).status).toBe(403);
    expect((await v2("PATCH", `/recordings/${teamRecording}`, { headers: tokenAuth(viewer), body: { title: "뷰어가 바꿈" } })).status).toBe(403);
    expect((await v2("POST", "/folders", { headers: tokenAuth(A), body: { workspace_id: team, name: "소유자 폴더" } })).status).toBe(201);
    expect((await v2("PATCH", `/recordings/${teamRecording}`, { headers: tokenAuth(A), body: { title: "팀 녹음" } })).status).toBe(200);
  });

  test("private recording inside a shared workspace", async () => {
    const mate = makeUser();
    const now = Date.now();
    db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?)`).run(team, mate.id, now, now);
    const hidden = seedTeamRecording(A, "private");
    const m = tokenAuth(mate);
    expect((await v2("GET", `/recordings/${hidden}`, { headers: m })).status).toBe(404);
    expect((await v2("PATCH", `/recordings/${hidden}`, { headers: m, body: { title: "바꿈" } })).status).toBe(404);
    expect((await v2("DELETE", `/recordings/${hidden}`, { headers: m })).status).toBe(404);
    const listed = await v2("GET", `/recordings?workspace_id=${team}`, { headers: m });
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(hidden);
    expect(listed.text).not.toContain("팀원의 비공개 녹음");
    const search = await v2("GET", `/search?workspace_id=${team}&q=${encodeURIComponent("비공개")}`, { headers: m });
    expect(search.text).not.toContain(hidden);
    // Its creator still sees it.
    expect((await v2("GET", `/recordings/${hidden}`, { headers: tokenAuth(A) })).status).toBe(200);
  });

  test("ids are not guessable sequences", async () => {
    const user = makeUser();
    const made: string[] = [];
    for (let i = 0; i < 2; i++) {
      const bytes = new TextEncoder().encode(`recording ${i} ${crypto.randomUUID()}`.padEnd(1024, "x"));
      const up = await v2("POST", "/uploads", {
        headers: tokenAuth(user),
        body: { workspace_id: personalWorkspaceId(user.id), files: [{ kind: "audio", filename: `r${i}.mp3`, mime: "audio/mpeg", bytes: bytes.length }] },
      });
      await v2("PUT", `/uploads/${up.body.id}/parts/1`, { headers: { ...tokenAuth(user), "Content-Type": "application/octet-stream" }, raw: bytes });
      made.push((await v2("POST", `/uploads/${up.body.id}/complete`, { headers: tokenAuth(user) })).body.recording.id);
    }
    const [first, second] = made as [string, string];
    for (const id of made) {
      expect(id).not.toMatch(/^\d+$/);
      expect(id.length).toBeGreaterThanOrEqual(20);
    }
    // Not the next of anything: the random tails differ in most places.
    const tail = (id: string) => id.replace(/-/g, "").slice(-12);
    const same = [...tail(first)].filter((c, i) => c === tail(second)[i]).length;
    expect(same).toBeLessThan(6);
    // Neither id can be had by a stranger, guessed or not.
    for (const id of made) expect((await v2("GET", `/recordings/${id}`, { headers: tokenAuth(B) })).status).toBe(404);
  });

  test("SSE stream only carries my workspaces", async () => {
    const wsB = personalWorkspaceId(B.id);
    expect((await v2("GET", `/events?workspace_id=${ids.workspace_id}`, { headers: tokenAuth(B) })).status).toBe(403);
    expect((await v2("GET", `/events?workspace_id=${team}`, { headers: tokenAuth(B) })).status).toBe(403);

    const mine = seedLecture(B, "B의 강의");
    // From the start of the log (Last-Event-ID 0) and live: only B's workspace.
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}/events?workspace_id=${wsB}`, { headers: { ...tokenAuth(B), "Last-Event-ID": "0" } })
    );
    expect(res.status).toBe(200);
    setTimeout(() => {
      void v2("PATCH", `/recordings/${ids.recording_id}`, { headers: tokenAuth(A), body: { title: `${SECRET_TITLE} (고침)` } });
      setTimeout(() => void v2("PATCH", `/recordings/${mine.recordingId}`, { headers: tokenAuth(B), body: { title: "B의 강의 (고침)" } }), 150);
    }, 150);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 4_000;
    try {
      while (Date.now() < deadline && !text.includes("B의 강의 (고침)")) {
        const chunk = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => null)]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    expect(text).toContain("B의 강의 (고침)"); // the stream works
    expect(text).not.toContain(ids.workspace_id!);
    expect(text).not.toContain(ids.recording_id!);
    expect(text).not.toContain(SECRET_TITLE);
    const workspaces = [...text.matchAll(/"workspace_id":"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(workspaces)).toEqual(new Set([wsB]));
  });
  // Last: it may delete A's things. Every id B was refused must be one A's own requests reach,
  // or the refusals above could be the answer to an id that does not exist.
  test("A reaches its own ids (control for the refusals above)", async () => {
    const tried = new Set<string>();
    const reached = new Set<string>();
    // What removes a recording (and its speakers, action items, suggestions, links) or a
    // workspace goes last, so the other routes still find them.
    const removes = new Set(["batchRecordings", "deleteRecording", "deleteRecordingAudio", "deleteWorkspace", "removeMember"]);
    const routes = ordered().sort((x, y) => Number(removes.has(x.operationId)) - Number(removes.has(y.operationId)));
    for (const workspaceId of [ids.workspace_id!, team]) {
      for (const route of routes) {
        if (workspaceId === team && !route.path.includes("{workspace_id}")) continue;
        const names = [...route.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!);
        if (names.length === 0) continue;
        const { status } = await send(requestFor(route, { params: { ...ids, workspace_id: workspaceId }, targets: { ...targets, workspaceId }, headers: tokenAuth(A) }));
        for (const name of names) tried.add(name);
        // Found and acted on, or found and refused for a reason only a real row gives.
        if ((status >= 200 && status < 300) || status === 409 || status === 412) for (const name of names) reached.add(name);
      }
    }
    // The ask routes answer 501 to everyone while this process has no ask service.
    const askServiceOff = (await v2("GET", `/ask/threads/${ids.thread_id}`, { headers: tokenAuth(A) })).status === 501;
    const unreached = [...tried].filter((name) => !reached.has(name) && !(askServiceOff && name === "thread_id"));
    expect(unreached).toEqual([]);
    expect(tried.size).toBeGreaterThanOrEqual(Object.keys(ids).length - 1);
  });
});
