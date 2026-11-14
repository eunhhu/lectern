import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { uuidv7 } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { can, type Action, type WorkspaceRole } from "../src/api/v2/access.ts";
import { createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// The policy table (ARCHITECTURE §6, §10). Rows: caller role and how the recording relates
// to them; columns: actions. `true` = allowed.

type Relation = "own private" | "own shared" | "other's private" | "other's shared";

const ME = "usr_me";
const recordingFor = (relation: Relation) => ({
  created_by: relation.startsWith("own") ? ME : "usr_other",
  visibility: relation.endsWith("private") ? ("private" as const) : ("workspace" as const),
});

const WORKSPACE_ACTIONS: Action[] = ["workspace:read", "workspace:update", "folder:write", "tag:write", "recording:create", "member:manage"];
const WORKSPACE_TABLE: Record<WorkspaceRole | "none", boolean[]> = {
  //       read   update  folders tags   create members
  owner: [true, true, true, true, true, true],
  admin: [true, true, true, true, true, true],
  member: [true, false, true, true, true, false],
  viewer: [true, false, false, false, false, false],
  none: [false, false, false, false, false, false],
};

const RECORDING_ACTIONS: Action[] = ["recording:read", "recording:update", "recording:delete"];
const RECORDING_TABLE: Record<WorkspaceRole | "none", Record<Relation, boolean[]>> = {
  owner: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false], // private means the creator only, even for the owner
    "other's shared": [true, true, true],
  },
  admin: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false],
    "other's shared": [true, true, true],
  },
  member: {
    "own private": [true, true, true],
    "own shared": [true, true, true],
    "other's private": [false, false, false],
    "other's shared": [true, false, false],
  },
  viewer: {
    "own private": [true, false, false],
    "own shared": [true, false, false],
    "other's private": [false, false, false],
    "other's shared": [true, false, false],
  },
  none: {
    "own private": [false, false, false],
    "own shared": [false, false, false],
    "other's private": [false, false, false],
    "other's shared": [false, false, false],
  },
};

describe("API v2 policy", () => {
  for (const [role, expected] of Object.entries(WORKSPACE_TABLE)) {
    test(`workspace actions for ${role}`, () => {
      const caller = { userId: ME, role: role === "none" ? null : (role as WorkspaceRole) };
      expect(WORKSPACE_ACTIONS.map((a) => can(caller, a))).toEqual(expected);
    });
  }

  for (const [role, relations] of Object.entries(RECORDING_TABLE)) {
    for (const [relation, expected] of Object.entries(relations)) {
      test(`recording actions for ${role}, ${relation}`, () => {
        const caller = { userId: ME, role: role === "none" ? null : (role as WorkspaceRole) };
        expect(RECORDING_ACTIONS.map((a) => can(caller, a, recordingFor(relation as Relation)))).toEqual(expected);
      });
    }
  }

  test("recording actions need a recording", () => {
    for (const action of RECORDING_ACTIONS) expect(can({ userId: ME, role: "owner" }, action)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The same rules over HTTP in a team workspace (P5-06): role × action × recording.
// ---------------------------------------------------------------------------

describe("team workspace over HTTP (P5-06)", () => {
  const RESEND_URL = "https://api.resend.com/emails";
  const realFetch = globalThis.fetch;
  type Who = WorkspaceRole | "none";
  const ROLES: Who[] = ["owner", "admin", "member", "viewer", "none"];
  const users = {} as Record<Who, UserRecord>;
  let creator: UserRecord; // another member who made the recordings below
  let ws = "";

  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigForTests();
  };

  async function call(user: UserRecord, method: string, path: string, body?: unknown): Promise<number> {
    const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await handleRequest(
      new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    );
    await res.body?.cancel();
    return res.status;
  }

  /** A recording row of the team without a lecture (the projection never touches it). */
  function seedRecording(by: UserRecord, visibility: "workspace" | "private"): string {
    const id = uuidv7();
    const now = Date.now();
    db.query(
      `INSERT INTO recording (id, workspace_id, folder_id, title, domain, template_id, language, recorded_at, recorded_at_source,
         duration_ms, status, created_by, visibility, lecture_id, source_client, failure_code, failure_message, created_at, updated_at)
       VALUES (?, ?, NULL, '표 녹음', 'lecture', NULL, NULL, ?, 'upload', NULL, 'ready', ?, ?, NULL, 'test', NULL, NULL, ?, ?)`
    ).run(id, ws, now, by.id, visibility, now, now);
    return id;
  }

  beforeAll(() => {
    setEnv({ LECTERN_TEAMS: "1", RESEND_API_KEY: "test-key-never-sent" });
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url) === RESEND_URL ? Response.json({ id: "email_test" }) : realFetch(url, init)) as typeof fetch;
    const make = (name: string) => createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
    for (const role of ROLES) users[role] = make(role);
    creator = make("creator");
    ws = uuidv7();
    const now = Date.now();
    db.query(`INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at) VALUES (?, '권한 표', 'team', 'free', '{}', NULL, ?, ?)`).run(ws, now, now);
    const members: Array<[UserRecord, WorkspaceRole]> = [
      [users.owner, "owner"],
      [users.admin, "admin"],
      [users.member, "member"],
      [users.viewer, "viewer"],
      [creator, "member"],
    ];
    for (const [user, role] of members) {
      db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(ws, user.id, role, now, now);
    }
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    setEnv({ LECTERN_TEAMS: undefined, RESEND_API_KEY: undefined });
  });

  // Expected status per role (owner, admin, member, viewer, non-member); null = not applicable.
  const TABLE: Array<[string, (who: Who) => Promise<number | null>, Array<number | null>]> = [
    ["view the workspace", (who) => call(users[who], "GET", `/workspaces/${ws}`), [200, 200, 200, 200, 403]],
    ["change its settings", (who) => call(users[who], "PATCH", `/workspaces/${ws}`, { name: "권한 표" }), [200, 200, 403, 403, 403]],
    [
      "invite a member",
      (who) => call(users[who], "POST", `/workspaces/${ws}/invites`, { email: `${generateId("i")}@example.com`, role: "member" }),
      [201, 201, 403, 403, 403],
    ],
    [
      "invite an admin",
      (who) => call(users[who], "POST", `/workspaces/${ws}/invites`, { email: `${generateId("i")}@example.com`, role: "admin" }),
      [201, 403, 403, 403, 403],
    ],
    [
      "upload",
      (who) =>
        call(users[who], "POST", "/uploads", { workspace_id: ws, files: [{ kind: "audio", filename: "t.m4a", mime: "audio/mp4", bytes: 100 }] }),
      [201, 201, 201, 403, 403],
    ],
    ["read a workspace recording", (who) => call(users[who], "GET", `/recordings/${seedRecording(creator, "workspace")}`), [200, 200, 200, 200, 404]],
    ["read someone else's private recording", (who) => call(users[who], "GET", `/recordings/${seedRecording(creator, "private")}`), [404, 404, 404, 404, 404]],
    [
      "read one's own private recording",
      async (who) => (who === "viewer" || who === "none" ? null : call(users[who], "GET", `/recordings/${seedRecording(users[who], "private")}`)),
      [200, 200, 200, null, null],
    ],
    [
      "change someone else's workspace recording",
      (who) => call(users[who], "PATCH", `/recordings/${seedRecording(creator, "workspace")}`, { title: "바꿈" }),
      [200, 200, 403, 403, 404],
    ],
    [
      "delete someone else's workspace recording",
      (who) => call(users[who], "DELETE", `/recordings/${seedRecording(creator, "workspace")}`),
      [204, 204, 403, 403, 404],
    ],
    ["create a folder", (who) => call(users[who], "POST", "/folders", { workspace_id: ws, name: `폴더 ${generateId("f")}` }), [201, 201, 201, 403, 403]],
  ];

  for (const [action, run, expected] of TABLE) {
    test(action, async () => {
      const got: Array<number | null> = [];
      for (const who of ROLES) got.push(await run(who));
      expect(got).toEqual(expected);
    });
  }
});
