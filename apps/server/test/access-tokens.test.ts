import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lectureRecordingId, personalWorkspaceId, sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { PAT_PREFIX } from "../src/access-tokens.ts";
import { completeLectureRecord, createPendingLecture, createUser, DATA_DIR, db, deleteUserAndData, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";

// P5-02: personal access tokens (D-P5-3). Named, scoped, expiring, bound to one workspace,
// API v2 only; the secret is shown once and only its hash is kept.

interface Res {
  status: number;
  body: any;
}

async function v2(method: string, path: string, auth: Record<string, string>, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { ...auth };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.startsWith("application/json") ? await res.json() : null };
}

const asUser = (user: UserRecord) => ({ "X-Lectern-Token": user.api_token });
const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: "correct_password_1" });
}

function seedRecording(owner: UserRecord): string {
  const id = generateId("lec");
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}.m4a`);
  writeFileSync(audioPath, "audio");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title: "운영체제 3주차",
    course: "운영체제",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  completeLectureRecord(id, {
    title: "운영체제 3주차",
    courseName: "운영체제",
    markdown: "# 스케줄링\n\nFCFS",
    excerpt: "FCFS",
    modelUsed: "gemini-3.8-flash",
    durationSec: 60,
  });
  return lectureRecordingId(id);
}

async function makeToken(user: UserRecord, scopes: string[], extra: Record<string, unknown> = {}): Promise<{ id: string; secret: string; token: any }> {
  const res = await v2("POST", "/me/tokens", asUser(user), {
    workspace_id: personalWorkspaceId(user.id),
    name: "스크립트",
    scopes,
    ...extra,
  });
  expect(res.status).toBe(201);
  return { id: res.body.token.id, secret: res.body.secret, token: res.body.token };
}

let alice: UserRecord;
let recordingId: string;

beforeAll(() => {
  alice = makeUser("alice");
  recordingId = seedRecording(alice);
});

const recordingsOf = (user: UserRecord) => `/recordings?workspace_id=${personalWorkspaceId(user.id)}`;

describe("personal access tokens (P5-02)", () => {
  test("create returns the secret once", async () => {
    const { id, secret, token } = await makeToken(alice, ["recordings:read"]);
    expect(secret.startsWith(PAT_PREFIX)).toBe(true);
    expect(token.prefix).toBe(secret.slice(0, 12));
    expect(token.scopes).toEqual(["recordings:read"]);
    expect(token.workspace_id).toBe(personalWorkspaceId(alice.id));
    expect(token.expires_at).toBeNull();

    const list = await v2("GET", "/me/tokens", asUser(alice));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    // The v1 API token stays first; the new token follows.
    expect(list.body.items[0].id).toMatch(/^tok_/);
    expect(list.body.items.map((t: any) => t.id)).toContain(id);
  });

  test("no plaintext in the database", async () => {
    const { id, secret } = await makeToken(alice, ["recordings:read"]);
    const everything = JSON.stringify(db.query(`SELECT * FROM access_token`).all());
    expect(everything).not.toContain(secret);
    const row = db.query(`SELECT token_hash, token_prefix FROM access_token WHERE id = ?`).get(id) as { token_hash: string; token_prefix: string };
    expect(row.token_hash).toBe(sha256Hex(secret));
    expect(row.token_prefix).toBe(secret.slice(0, 12));
  });

  test("bearer and X-Lectern-Token both work", async () => {
    const { secret } = await makeToken(alice, ["recordings:read"]);
    for (const auth of [bearer(secret), { "X-Lectern-Token": secret }]) {
      const res = await v2("GET", recordingsOf(alice), auth);
      expect(res.status).toBe(200);
      expect(res.body.items.map((r: any) => r.id)).toContain(recordingId);
    }
  });

  test("read-only token cannot write", async () => {
    const { secret } = await makeToken(alice, ["recordings:read"]);
    const res = await v2("PATCH", `/recordings/${recordingId}`, bearer(secret), { title: "바뀐 제목" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("이 토큰에는 필요한 권한이 없습니다.");
  });

  test("a write token can write", async () => {
    const { secret } = await makeToken(alice, ["recordings:read", "recordings:write"]);
    const res = await v2("PATCH", `/recordings/${recordingId}`, bearer(secret), { title: "토큰으로 바꾼 제목" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("토큰으로 바꾼 제목");
  });

  test("write-only token cannot read", async () => {
    const { secret } = await makeToken(alice, ["recordings:write"]);
    const res = await v2("GET", recordingsOf(alice), bearer(secret));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("이 토큰에는 필요한 권한이 없습니다.");
  });

  test("expired token", async () => {
    const { id, secret } = await makeToken(alice, ["recordings:read"], { expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await v2("GET", recordingsOf(alice), bearer(secret))).status).toBe(200);
    db.query(`UPDATE access_token SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, id);
    const res = await v2("GET", recordingsOf(alice), bearer(secret));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  test("an expiry in the past is refused", async () => {
    const res = await v2("POST", "/me/tokens", asUser(alice), {
      workspace_id: personalWorkspaceId(alice.id),
      name: "지난 토큰",
      scopes: ["recordings:read"],
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  test("revoked token", async () => {
    const { id, secret } = await makeToken(alice, ["recordings:read"]);
    const revoked = await v2("DELETE", `/me/tokens/${id}`, asUser(alice));
    expect(revoked.status).toBe(204);
    expect((await v2("GET", recordingsOf(alice), bearer(secret))).status).toBe(401);
    const list = await v2("GET", "/me/tokens", asUser(alice));
    expect(list.body.items.map((t: any) => t.id)).not.toContain(id);
    // Revoking again: gone.
    expect((await v2("DELETE", `/me/tokens/${id}`, asUser(alice))).status).toBe(404);
  });

  test("account routes are closed to tokens", async () => {
    const { secret } = await makeToken(alice, ["recordings:read", "recordings:write"]);
    const closed: Array<[string, string, unknown?]> = [
      ["POST", "/me/tokens", { workspace_id: personalWorkspaceId(alice.id), name: "x", scopes: ["recordings:read"] }],
      ["GET", "/me/devices"],
      ["GET", "/admin/jobs"],
      ["PATCH", "/me", { timezone: "Asia/Seoul" }],
      ["POST", "/share-links", { target_type: "recording", target_id: recordingId, scope: "notes" }],
      ["POST", "/invites/accept", { token: "x".repeat(20) }],
    ];
    for (const [method, path, body] of closed) {
      const res = await v2(method, path, bearer(secret), body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.message).toBe("개인 액세스 토큰으로는 이 작업을 할 수 없습니다.");
    }
    const me = await v2("GET", "/me", bearer(secret));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(alice.id);
  });

  test("bound to its workspace", async () => {
    const team = await v2("POST", "/workspaces", asUser(alice), { name: "알고리즘 스터디" });
    expect(team.status).toBe(201);
    const teamId = team.body.id as string;
    expect((await v2("GET", `/recordings?workspace_id=${teamId}`, asUser(alice))).status).toBe(200);

    const { secret } = await makeToken(alice, ["recordings:read"]);
    expect((await v2("GET", `/recordings?workspace_id=${teamId}`, bearer(secret))).status).toBe(403);
    const workspaces = await v2("GET", "/workspaces", bearer(secret));
    expect(workspaces.body.items.map((w: any) => w.workspace.id)).toEqual([personalWorkspaceId(alice.id)]);

    // A token made for the team cannot reach the personal workspace's recordings.
    const teamToken = await v2("POST", "/me/tokens", asUser(alice), { workspace_id: teamId, name: "팀 스크립트", scopes: ["recordings:read"] });
    expect(teamToken.status).toBe(201);
    expect((await v2("GET", recordingsOf(alice), bearer(teamToken.body.secret))).status).toBe(403);
    expect((await v2("GET", `/recordings/${recordingId}`, bearer(teamToken.body.secret))).status).toBe(404);
  });

  test("a token for a workspace the user is not in cannot be made", async () => {
    const bob = makeUser("bob");
    const res = await v2("POST", "/me/tokens", asUser(bob), { workspace_id: personalWorkspaceId(alice.id), name: "남의 것", scopes: ["recordings:read"] });
    expect(res.status).toBe(403);
  });

  test("does not open v1", async () => {
    const { secret } = await makeToken(alice, ["recordings:read", "recordings:write"]);
    for (const auth of [bearer(secret), { "X-Lectern-Token": secret }]) {
      const res = await handleRequest(new Request("http://localhost/api/lectures", { headers: auth }));
      expect(res.status).toBe(401);
    }
  });

  test("v1 api token still works", async () => {
    expect((await v2("GET", recordingsOf(alice), asUser(alice))).status).toBe(200);
    const res = await handleRequest(new Request("http://localhost/api/lectures", { headers: asUser(alice) }));
    expect(res.status).toBe(200);
  });

  test("the v1 token cannot be revoked here", async () => {
    const list = await v2("GET", "/me/tokens", asUser(alice));
    const v1Id = list.body.items[0].id as string;
    const res = await v2("DELETE", `/me/tokens/${v1Id}`, asUser(alice));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("이 토큰은 여기서 회수할 수 없습니다. 예전 설정 화면에서 다시 발급해 주세요.");
  });

  test("another user's token id", async () => {
    const { id, secret } = await makeToken(alice, ["recordings:read"]);
    const bob = makeUser("bob");
    expect((await v2("DELETE", `/me/tokens/${id}`, asUser(bob))).status).toBe(404);
    expect((await v2("GET", recordingsOf(alice), bearer(secret))).status).toBe(200);
  });

  test("limit of 20", async () => {
    const carol = makeUser("carol");
    for (let i = 0; i < 20; i++) await makeToken(carol, ["recordings:read"]);
    const res = await v2("POST", "/me/tokens", asUser(carol), {
      workspace_id: personalWorkspaceId(carol.id),
      name: "21번째",
      scopes: ["recordings:read"],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("액세스 토큰은 20개까지 만들 수 있습니다.");
  });

  test("last_used_at", async () => {
    const { id, secret, token } = await makeToken(alice, ["recordings:read"]);
    expect(token.last_used_at).toBeNull();
    await v2("GET", recordingsOf(alice), bearer(secret));
    const list = await v2("GET", "/me/tokens", asUser(alice));
    const listed = list.body.items.find((t: any) => t.id === id);
    expect(listed.last_used_at).not.toBeNull();
  });

  test("deleting the user deletes their tokens", async () => {
    const erin = makeUser("erin");
    await makeToken(erin, ["recordings:read"]);
    deleteUserAndData(erin.id);
    expect(db.query(`SELECT COUNT(*) AS n FROM access_token WHERE user_id = ?`).get(erin.id)).toEqual({ n: 0 });
  });

  test("a suspended user's token stops working", async () => {
    const dave = makeUser("dave");
    const { secret } = await makeToken(dave, ["recordings:read"]);
    expect((await v2("GET", recordingsOf(dave), bearer(secret))).status).toBe(200);
    db.query(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(dave.id);
    expect((await v2("GET", recordingsOf(dave), bearer(secret))).status).toBe(401);
  });
});
