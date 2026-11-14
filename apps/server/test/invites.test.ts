import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId, verifyLegacy } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { PART_SIZE } from "../src/api/v2/uploads.ts";
import { completeLectureRecord, createUser, db, generateId, getLectureById, type UserRecord } from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";

// Team workspaces (P5-06, D-P5-6, D-P2-8): invitations by mail, accepting them, roles,
// removing members, and uploads into a team. Resend is faked; no mail leaves the machine.

const RESEND_URL = "https://api.resend.com/emails";
const realFetch = globalThis.fetch;
const mails: Array<{ to: string[]; subject: string; html: string }> = [];
let resendStatus = 200;

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};

beforeAll(() => {
  setEnv({ LECTERN_TEAMS: "1", RESEND_API_KEY: "test-key-never-sent" });
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === RESEND_URL) {
      mails.push(JSON.parse(String(init?.body)));
      return resendStatus === 200 ? Response.json({ id: "email_test" }) : new Response("upstream error", { status: resendStatus });
    }
    return realFetch(url, init);
  }) as typeof fetch;
});
beforeEach(() => {
  setEnv({ LECTERN_TEAMS: "1", RESEND_API_KEY: "test-key-never-sent" });
  resendStatus = 200;
  resetAuthRateLimits();
});
afterAll(() => {
  globalThis.fetch = realFetch;
  setEnv({ LECTERN_TEAMS: undefined, RESEND_API_KEY: undefined });
});

interface Res {
  status: number;
  body: any;
}

async function api(method: string, path: string, user: UserRecord, body?: unknown, raw?: Uint8Array): Promise<Res> {
  const headers: Record<string, string> = { "X-Lectern-Token": user.api_token };
  let payload: BodyInit | undefined;
  if (raw) {
    headers["Content-Type"] = "application/octet-stream";
    payload = new Blob([raw as Uint8Array<ArrayBuffer>]);
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await handleRequest(new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: payload }));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null };
}

const makeUser = (name: string) => createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });

async function team(owner: UserRecord): Promise<string> {
  const res = await api("POST", "/workspaces", owner, { name: "알고리즘 스터디" });
  expect(res.status).toBe(201);
  return res.body.id;
}

const tokenIn = (html: string) => decodeURIComponent(/\/app\/invite\?token=([^"&]+)/.exec(html)![1]!);

/** Invites `email` and returns the token from the mail. */
async function invite(by: UserRecord, workspaceId: string, email: string, role = "member"): Promise<{ res: Res; token: string | null }> {
  const before = mails.length;
  const res = await api("POST", `/workspaces/${workspaceId}/invites`, by, { email, role });
  const mail = mails.length > before ? mails[mails.length - 1]! : null;
  return { res, token: mail ? tokenIn(mail.html) : null };
}

async function join(owner: UserRecord, workspaceId: string, user: UserRecord, role = "member"): Promise<void> {
  const { token } = await invite(owner, workspaceId, user.email, role);
  const accepted = await api("POST", "/invites/accept", user, { token });
  expect(accepted.status).toBe(200);
}

const memberRoles = async (viewer: UserRecord, workspaceId: string) =>
  Object.fromEntries(((await api("GET", `/workspaces/${workspaceId}/members`, viewer)).body.items as any[]).map((m) => [m.user_id, m.role]));

describe("invitations", () => {
  test("invite sends one mail with the link", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const before = mails.length;
    const email = `${generateId("new")}@example.com`;
    const { res, token } = await invite(owner, ws, email.toUpperCase(), "member");
    expect(res.status).toBe(201);
    expect(mails.length).toBe(before + 1);
    const mail = mails[mails.length - 1]!;
    expect(mail.to).toEqual([email]);
    expect(mail.subject).toBe(`[Lectern] owner님이 "알고리즘 스터디" 워크스페이스에 초대했습니다`);
    expect(mail.html).toContain("/app/invite?token=");
    expect(mail.html).toContain("멤버(으)로 초대했습니다");
    expect(mail.html).toContain("이 초대는 7일 동안 유효합니다.");
    expect(res.body).toMatchObject({ workspace_id: ws, email, role: "member", invited_by: owner.id, accepted_at: null, revoked_at: null });
    expect(JSON.stringify(res.body)).not.toContain(token!);
    expect(JSON.stringify(db.query(`SELECT * FROM workspace_invite`).all())).not.toContain(token!);
    const listed = await api("GET", `/workspaces/${ws}/invites`, owner);
    expect(listed.body.items.map((i: any) => i.id)).toContain(res.body.id);
    expect(JSON.stringify(listed.body)).not.toContain(token!);
  });

  test("the mail escapes names", async () => {
    const owner = createUser({ email: `${generateId("o")}@example.com`, displayName: "<b>악당</b>", password: "correct_password_1" });
    const ws = (await api("POST", "/workspaces", owner, { name: "<script>x</script>" })).body.id;
    await invite(owner, ws, `${generateId("n")}@example.com`);
    const html = mails[mails.length - 1]!.html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>악당");
  });

  test("accept creates the membership", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    const { token } = await invite(owner, ws, guest.email, "viewer");
    const accepted = await api("POST", "/invites/accept", guest, { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe("viewer");
    expect(accepted.body.workspace.id).toBe(ws);
    expect((await memberRoles(owner, ws))[guest.id]).toBe("viewer");
    // The pending list no longer shows it.
    expect((await api("GET", `/workspaces/${ws}/invites`, owner)).body.items).toHaveLength(0);
  });

  test("wrong e-mail is refused", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const { token } = await invite(owner, ws, `${generateId("someone")}@example.com`);
    const res = await api("POST", "/invites/accept", makeUser("other"), { token });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("이 초대는 다른 이메일 주소로 보낸 것입니다. 초대받은 주소로 로그인해 주세요.");
  });

  test("expired", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    const { res, token } = await invite(owner, ws, guest.email);
    db.query(`UPDATE workspace_invite SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, res.body.id);
    const accepted = await api("POST", "/invites/accept", guest, { token });
    expect(accepted.status).toBe(409);
    expect(accepted.body.error.message).toBe("만료된 초대입니다. 다시 초대해 달라고 요청해 주세요.");
  });

  test("revoked / used twice", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    const first = await invite(owner, ws, guest.email);
    expect((await api("DELETE", `/workspaces/${ws}/invites/${first.res.body.id}`, owner)).status).toBe(204);
    expect((await api("DELETE", `/workspaces/${ws}/invites/${first.res.body.id}`, owner)).status).toBe(404);
    const revoked = await api("POST", "/invites/accept", guest, { token: first.token });
    expect(revoked.status).toBe(404);
    expect(revoked.body.error.message).toBe("초대를 찾을 수 없습니다. 이미 사용했거나 취소된 초대입니다.");

    const second = await invite(owner, ws, guest.email);
    expect((await api("POST", "/invites/accept", guest, { token: second.token })).status).toBe(200);
    expect((await api("POST", "/invites/accept", guest, { token: second.token })).status).toBe(404);
  });

  test("re-invite replaces the old link", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    const first = await invite(owner, ws, guest.email);
    const second = await invite(owner, ws, guest.email, "viewer");
    expect(second.res.status).toBe(201);
    expect((await api("GET", `/workspaces/${ws}/invites`, owner)).body.items).toHaveLength(1);
    expect((await api("POST", "/invites/accept", guest, { token: first.token })).status).toBe(404);
    const accepted = await api("POST", "/invites/accept", guest, { token: second.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe("viewer");
  });

  test("already a member", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    await join(owner, ws, guest);
    const again = await invite(owner, ws, guest.email.toUpperCase());
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.message).toBe("이미 이 워크스페이스의 멤버입니다.");
  });

  test("personal workspace", async () => {
    const owner = makeUser("owner");
    const res = await api("POST", `/workspaces/${personalWorkspaceId(owner.id)}/invites`, owner, { email: "x@example.com", role: "member" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("개인 워크스페이스에는 초대할 수 없습니다.");
  });

  test("mail failure rolls back", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    resendStatus = 500;
    const warn = spyOn(console, "log").mockImplementation(() => {});
    let res: Res;
    try {
      res = await api("POST", `/workspaces/${ws}/invites`, owner, { email: `${generateId("x")}@example.com`, role: "member" });
    } finally {
      warn.mockRestore();
    }
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe("초대 메일을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    expect(db.query(`SELECT COUNT(*) AS n FROM workspace_invite WHERE workspace_id = ?`).get(ws)).toEqual({ n: 0 });
  });

  test("a failed re-invite keeps the old link", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const guest = makeUser("guest");
    const first = await invite(owner, ws, guest.email);
    resendStatus = 500;
    expect((await invite(owner, ws, guest.email)).res.status).toBe(503);
    resendStatus = 200;
    expect((await api("POST", "/invites/accept", guest, { token: first.token })).status).toBe(200);
  });

  test("only an owner invites an admin; 50 pending at most", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const admin = makeUser("admin");
    await join(owner, ws, admin, "admin");
    const byAdmin = await invite(admin, ws, `${generateId("a")}@example.com`, "admin");
    expect(byAdmin.res.status).toBe(403);
    expect((await invite(admin, ws, `${generateId("m")}@example.com`, "member")).res.status).toBe(201);
    expect((await invite(owner, ws, `${generateId("a")}@example.com`, "admin")).res.status).toBe(201);
    const now = Date.now();
    for (let i = 0; i < 48; i++) {
      db.query(
        `INSERT INTO workspace_invite (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?, ?, ?)`
      ).run(generateId("inv"), ws, `bulk${i}@example.com`, generateId("hash"), owner.id, now, now + 86_400_000);
    }
    const tooMany = await invite(owner, ws, `${generateId("m")}@example.com`);
    expect(tooMany.res.status).toBe(409);
    expect(tooMany.res.body.error.message).toBe("대기 중인 초대가 너무 많습니다.");
  });

  test("accept is rate limited", async () => {
    const guest = makeUser("guest");
    for (let i = 0; i < 10; i++) expect((await api("POST", "/invites/accept", guest, { token: `wrong-token-${i}-xxxxxxxx` })).status).toBe(404);
    const blocked = await api("POST", "/invites/accept", guest, { token: "wrong-token-11-xxxxxxxx" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
  });
});

describe("members", () => {
  test("last owner cannot be demoted or removed", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const demote = await api("PATCH", `/workspaces/${ws}/members/${owner.id}`, owner, { role: "member" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.message).toBe("owner가 한 명은 있어야 합니다. 다른 멤버를 먼저 owner로 지정해 주세요.");
    expect((await api("DELETE", `/workspaces/${ws}/members/${owner.id}`, owner)).status).toBe(409);
    expect((await memberRoles(owner, ws))[owner.id]).toBe("owner");
  });

  test("owner hands over", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const next = makeUser("next");
    await join(owner, ws, next);
    const promoted = await api("PATCH", `/workspaces/${ws}/members/${next.id}`, owner, { role: "owner" });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ user_id: next.id, role: "owner", email: next.email });
    expect((await api("PATCH", `/workspaces/${ws}/members/${owner.id}`, owner, { role: "member" })).status).toBe(200);
    expect(await memberRoles(next, ws)).toEqual({ [owner.id]: "member", [next.id]: "owner" });
  });

  test("admin cannot touch owners or admins", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const admin = makeUser("admin");
    const other = makeUser("admin2");
    const member = makeUser("member");
    await join(owner, ws, admin, "admin");
    await join(owner, ws, other, "admin");
    await join(owner, ws, member, "member");
    expect((await api("PATCH", `/workspaces/${ws}/members/${owner.id}`, admin, { role: "member" })).status).toBe(403);
    expect((await api("DELETE", `/workspaces/${ws}/members/${other.id}`, admin)).status).toBe(403);
    expect((await api("PATCH", `/workspaces/${ws}/members/${member.id}`, admin, { role: "admin" })).status).toBe(403);
    // A member or viewer is theirs to manage.
    expect((await api("PATCH", `/workspaces/${ws}/members/${member.id}`, admin, { role: "viewer" })).status).toBe(200);
    expect((await api("DELETE", `/workspaces/${ws}/members/${member.id}`, admin)).status).toBe(204);
    // A plain member manages nobody.
    const plain = makeUser("plain");
    await join(owner, ws, plain);
    expect((await api("PATCH", `/workspaces/${ws}/members/${admin.id}`, plain, { role: "viewer" })).status).toBe(403);
    expect((await api("GET", `/workspaces/${ws}/invites`, plain)).status).toBe(403);
    // Unknown member: 404.
    expect((await api("PATCH", `/workspaces/${ws}/members/${makeUser("x").id}`, owner, { role: "viewer" })).status).toBe(404);
  });

  test("member leaves", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const member = makeUser("member");
    await join(owner, ws, member);
    expect((await api("DELETE", `/workspaces/${ws}/members/${member.id}`, member)).status).toBe(204);
    expect((await api("GET", `/workspaces/${ws}`, member)).status).toBe(403);
  });
});

describe("team uploads", () => {
  const audio = new Uint8Array(1024).map((_, i) => (i * 7) % 251);
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const uploadBody = (workspaceId: string, extra: Record<string, unknown> = {}) => ({
    workspace_id: workspaceId,
    files: [{ kind: "audio", filename: "team.m4a", mime: "audio/mp4", bytes: audio.length, sha256: sha(audio) }],
    ...extra,
  });

  test("viewer cannot upload", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const viewer = makeUser("viewer");
    await join(owner, ws, viewer, "viewer");
    expect((await api("POST", "/uploads", viewer, uploadBody(ws))).status).toBe(403);
  });

  test("member uploads into the team", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const member = makeUser("member");
    const reader = makeUser("reader");
    await join(owner, ws, member);
    await join(owner, ws, reader, "viewer");
    const folder = (await api("POST", "/folders", owner, { workspace_id: ws, name: "운영체제" })).body;
    const created = await api("POST", "/uploads", member, uploadBody(ws, { recording: { title: "팀 강의", folder_id: folder.id } }));
    expect(created.status).toBe(201);
    expect(created.body.workspace_id).toBe(ws);
    expect(PART_SIZE).toBeGreaterThan(audio.length);
    expect((await api("PUT", `/uploads/${created.body.id}/parts/1`, member, undefined, audio)).status).toBe(200);
    const done = await api("POST", `/uploads/${created.body.id}/complete`, member);
    expect(done.status).toBe(200);
    const recordingId = done.body.recording.id as string;
    expect(done.body.recording).toMatchObject({ workspace_id: ws, folder_id: folder.id, visibility: "workspace", created_by: member.id });

    // The lecture's course is the team folder; no folder of that name appeared in the personal workspace.
    expect(getLectureById(recordingId)!.course).toBe("운영체제");
    expect(db.query(`SELECT COUNT(*) AS n FROM folder WHERE workspace_id = ? AND name = '운영체제'`).get(personalWorkspaceId(member.id))).toEqual({ n: 0 });

    // The pipeline finishing (a lecture write) keeps it in the team.
    completeLectureRecord(recordingId, { title: "팀 강의", courseName: "운영체제", markdown: "# 팀\n\n노트", excerpt: "노트", modelUsed: "gemini-3.8-flash", durationSec: 60 });
    const listed = await api("GET", `/recordings?workspace_id=${ws}`, reader);
    expect(listed.body.items.map((r: any) => r.id)).toContain(recordingId);
    const read = await api("GET", `/recordings/${recordingId}`, reader);
    expect(read.status).toBe(200);
    expect(read.body.recording.workspace_id).toBe(ws);
    expect(read.body.recording.folder_id).toBe(folder.id);
    // Not in the uploader's personal workspace.
    expect((await api("GET", `/recordings?workspace_id=${personalWorkspaceId(member.id)}`, member)).body.items.map((r: any) => r.id)).not.toContain(recordingId);
    expect(verifyLegacy(db).mismatches.filter((m) => m.lecture_id === recordingId)).toEqual([]);

    // An admin of the team may change and delete it; a viewer may not.
    expect((await api("PATCH", `/recordings/${recordingId}`, reader, { title: "x" })).status).toBe(403);
    expect((await api("PATCH", `/recordings/${recordingId}`, owner, { title: "고친 제목" })).status).toBe(200);
    expect(getLectureById(recordingId)!.title).toBe("고친 제목");
    expect((await api("GET", `/recordings/${recordingId}`, reader)).body.recording.workspace_id).toBe(ws);

    // Leaving the team leaves the recording there.
    expect((await api("DELETE", `/workspaces/${ws}/members/${member.id}`, member)).status).toBe(204);
    expect((await api("GET", `/recordings/${recordingId}`, reader)).status).toBe(200);
    expect((await api("DELETE", `/recordings/${recordingId}`, owner)).status).toBe(204);
  });

  test("the same audio in the team and the personal workspace makes two recordings", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    const bytes = new Uint8Array(512).map((_, i) => (i * 13) % 251);
    const body = (workspaceId: string) => ({
      workspace_id: workspaceId,
      files: [{ kind: "audio", filename: "same.m4a", mime: "audio/mp4", bytes: bytes.length, sha256: sha(bytes) }],
    });
    const ids: string[] = [];
    for (const workspaceId of [personalWorkspaceId(owner.id), ws, ws]) {
      const created = await api("POST", "/uploads", owner, body(workspaceId));
      await api("PUT", `/uploads/${created.body.id}/parts/1`, owner, undefined, bytes);
      const done = await api("POST", `/uploads/${created.body.id}/complete`, owner);
      expect(done.body.recording.workspace_id).toBe(workspaceId);
      ids.push(done.body.recording.id);
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe(ids[1]); // deduplicated within the team
  });

  test("flag off", async () => {
    const owner = makeUser("owner");
    const ws = await team(owner);
    setEnv({ LECTERN_TEAMS: "0" });
    const routes: Array<[string, string, unknown?]> = [
      ["GET", `/workspaces/${ws}/invites`],
      ["POST", `/workspaces/${ws}/invites`, { email: "x@example.com", role: "member" }],
      ["DELETE", `/workspaces/${ws}/invites/0199f0a0-1000-7000-8000-00000000abcd`],
      ["POST", "/invites/accept", { token: "x".repeat(20) }],
      ["PATCH", `/workspaces/${ws}/members/${owner.id}`, { role: "owner" }],
      ["DELETE", `/workspaces/${ws}/members/${owner.id}`],
    ];
    for (const [method, path, body] of routes) {
      const res = await api(method, path, owner, body);
      expect(res.status, `${method} ${path}`).toBe(501);
    }
    const upload = await api("POST", "/uploads", owner, uploadBody(ws));
    expect(upload.status).toBe(400);
    expect(upload.body.error.message).toBe("지금은 개인 워크스페이스에만 업로드할 수 있습니다.");
  });
});
