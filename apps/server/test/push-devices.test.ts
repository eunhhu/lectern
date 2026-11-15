import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lectureRecordingId } from "@lectern/db";
import { API_BASE_PATH, PushDeviceDto } from "@lectern/domain";
import {
  completeLectureRecord,
  createPendingLecture,
  createUser,
  DATA_DIR,
  db,
  generateId,
  syncPendingLectures,
  updateUserPassword,
  type UserRecord,
} from "../src/db.ts";
import { handleRequest, resetAuthRateLimits } from "../src/index.ts";
import { logger } from "../src/log.ts";
import { deletePushDeviceByToken, MAX_PUSH_DEVICES_PER_USER } from "../src/push-devices.ts";

// Push devices and Live Activity tokens (P6-01, D-P6-1): PUT registers and updates, a token
// belongs to one user, the device list is capped, and a native sign-out drops the devices.

const PASSWORD = "correct_password_1";
const token = (n: number) => n.toString(16).padStart(2, "0").repeat(32); // 64 hex characters

function makeUser(name: string): UserRecord {
  return createUser({ email: `${generateId(name)}@example.com`, displayName: name, password: PASSWORD });
}

async function call(user: UserRecord | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (user) headers["X-Lectern-Token"] = user.api_token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return handleRequest(
    new Request(`http://localhost${API_BASE_PATH}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  );
}

const register = (user: UserRecord, deviceId: string, body: Record<string, unknown>) =>
  call(user, "PUT", `/me/push-devices/${deviceId}`, { platform: "ios", ...body });

/** A finished v1 lecture of `owner`, projected into its v2 recording (personal and private to others). */
function recordingOf(owner: UserRecord): string {
  const id = generateId("lec");
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const audioPath = join(DATA_DIR, "uploads", `${id}.m4a`);
  writeFileSync(audioPath, "audio");
  createPendingLecture({
    id,
    ownerId: owner.id,
    title: "푸시 강의",
    course: "자료구조",
    audioPath,
    audioMime: "audio/mp4",
    audioSize: 5,
    modelRequested: "gemini-3.8-flash",
    sourceClient: "bun-test",
  });
  completeLectureRecord(id, { title: "푸시 강의", courseName: "자료구조", markdown: "# 노트", excerpt: "", modelUsed: "gemini-3.8-flash", durationSec: 60 });
  syncPendingLectures();
  return lectureRecordingId(id);
}

const devicesOf = (user: UserRecord) =>
  db.query(`SELECT id, name, apns_token, last_seen_at FROM push_device WHERE user_id = ? ORDER BY id`).all(user.id) as Array<{
    id: string;
    name: string | null;
    apns_token: string;
    last_seen_at: number;
  }>;

const activitiesOf = (deviceId: string) =>
  db.query(`SELECT recording_id, push_token, state, ended_at FROM live_activity WHERE device_id = ?`).all(deviceId) as Array<{
    recording_id: string;
    push_token: string;
    state: string;
    ended_at: number | null;
  }>;

beforeEach(() => resetAuthRateLimits());

describe("push devices", () => {
  test("register then update", async () => {
    const a = makeUser("a");
    const device = crypto.randomUUID();
    const first = await register(a, device, { apns_token: token(1).toUpperCase(), name: "iPhone", app_version: "1.0 (1)" });
    expect(first.status).toBe(200);
    const body = PushDeviceDto.parse(await first.json());
    expect(body).toMatchObject({ id: device, platform: "ios", name: "iPhone", app_version: "1.0 (1)" });
    const before = devicesOf(a);
    expect(before).toHaveLength(1);
    expect(before[0]!.apns_token).toBe(token(1)); // stored as lowercase hex
    await Bun.sleep(5);

    const second = await register(a, device, { apns_token: token(1), name: "학생의 iPhone" });
    expect(second.status).toBe(200);
    const text = await second.text();
    expect(text).not.toContain(token(1)); // tokens never go back out
    expect(JSON.parse(text)).not.toHaveProperty("apns_token");
    const after = devicesOf(a);
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe("학생의 iPhone");
    expect(after[0]!.last_seen_at).toBeGreaterThan(before[0]!.last_seen_at);

    // The push-to-start token: set, kept by a PUT that omits it, cleared by null.
    const pushToStart = () =>
      (db.query(`SELECT push_to_start_token AS t FROM push_device WHERE id = ?`).get(device) as { t: string | null }).t;
    await register(a, device, { apns_token: token(1), push_to_start_token: token(31) });
    expect(pushToStart()).toBe(token(31));
    await register(a, device, { apns_token: token(1) });
    expect(pushToStart()).toBe(token(31));
    await register(a, device, { apns_token: token(1), push_to_start_token: null });
    expect(pushToStart()).toBeNull();
  });

  test("same token on a new device id replaces the old row", async () => {
    const a = makeUser("a");
    const old = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    expect((await register(a, old, { apns_token: token(2) })).status).toBe(200);
    expect((await register(a, fresh, { apns_token: token(2) })).status).toBe(200);
    expect(devicesOf(a).map((d) => d.id)).toEqual([fresh]);
  });

  test("token moves to another user", async () => {
    const a = makeUser("a");
    const b = makeUser("b");
    const recording = recordingOf(a);
    const aDevice = crypto.randomUUID();
    expect((await register(a, aDevice, { apns_token: token(3) })).status).toBe(200);
    expect((await call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: aDevice, push_token: token(9) })).status).toBe(204);
    expect((await register(b, crypto.randomUUID(), { apns_token: token(3) })).status).toBe(200);
    expect(devicesOf(a)).toEqual([]);
    expect(devicesOf(b)).toHaveLength(1);
    expect(activitiesOf(aDevice)).toEqual([]); // the old row's activities went with it
  });

  test("device id of someone else", async () => {
    const a = makeUser("a");
    const b = makeUser("b");
    const device = crypto.randomUUID();
    expect((await register(a, device, { apns_token: token(4) })).status).toBe(200);
    const res = await register(b, device, { apns_token: token(5) });
    expect(res.status).toBe(409);
    expect(devicesOf(a).map((d) => d.apns_token)).toEqual([token(4)]);
    expect(devicesOf(b)).toEqual([]);
  });

  test("invalid token", async () => {
    const a = makeUser("a");
    expect((await register(a, crypto.randomUUID(), { apns_token: "zz" })).status).toBe(400);
  });

  test("delete", async () => {
    const a = makeUser("a");
    const recording = recordingOf(a);
    const device = crypto.randomUUID();
    await register(a, device, { apns_token: token(6) });
    expect((await call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: device, push_token: token(7) })).status).toBe(204);
    expect((await call(a, "DELETE", `/me/push-devices/${device}`)).status).toBe(204);
    expect(devicesOf(a)).toEqual([]);
    expect(activitiesOf(device)).toEqual([]);
    expect((await call(a, "DELETE", `/me/push-devices/${device}`)).status).toBe(404);
    // Someone else's device is "not found" too.
    const b = makeUser("b");
    const theirs = crypto.randomUUID();
    await register(b, theirs, { apns_token: token(8) });
    expect((await call(a, "DELETE", `/me/push-devices/${theirs}`)).status).toBe(404);
    expect(devicesOf(b)).toHaveLength(1);
  });

  test("live activity token", async () => {
    const a = makeUser("a");
    const recording = recordingOf(a);
    const device = crypto.randomUUID();
    await register(a, device, { apns_token: token(10) });
    const set = (pushToken: string) => call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: device, push_token: pushToken });
    expect((await set(token(11))).status).toBe(204);
    expect((await set(token(12).toUpperCase())).status).toBe(204);
    expect(activitiesOf(device)).toEqual([{ recording_id: recording, push_token: token(12), state: "active", ended_at: null }]);
    // A device that is not the caller's: 404, nothing written.
    expect((await call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: crypto.randomUUID(), push_token: token(13) })).status).toBe(404);
  });

  test("live activity on someone else's recording", async () => {
    const a = makeUser("a");
    const b = makeUser("b");
    const recording = recordingOf(a);
    const device = crypto.randomUUID();
    await register(b, device, { apns_token: token(14) });
    expect((await call(b, "PUT", `/recordings/${recording}/live-activity`, { device_id: device, push_token: token(15) })).status).toBe(404);
    expect(activitiesOf(device)).toEqual([]);
  });

  test("end", async () => {
    const a = makeUser("a");
    const recording = recordingOf(a);
    const device = crypto.randomUUID();
    await register(a, device, { apns_token: token(16) });
    const end = () => call(a, "DELETE", `/recordings/${recording}/live-activity?device_id=${device}`);
    expect((await end()).status).toBe(404); // nothing started yet
    await call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: device, push_token: token(17) });
    expect((await end()).status).toBe(204);
    const [row] = activitiesOf(device);
    expect(row!.state).toBe("ended");
    expect(row!.ended_at).toBeGreaterThan(0);
    // Starting again reopens the same row.
    await call(a, "PUT", `/recordings/${recording}/live-activity`, { device_id: device, push_token: token(18) });
    expect(activitiesOf(device)).toEqual([{ recording_id: recording, push_token: token(18), state: "active", ended_at: null }]);
  });

  test("native logout removes devices", async () => {
    const a = makeUser("a");
    await register(a, crypto.randomUUID(), { apns_token: token(19) });
    await register(a, crypto.randomUUID(), { apns_token: token(20), platform: "macos" });
    const issued = await call(null, "POST", "/auth/native/token", { grant_type: "password", email: a.email, password: PASSWORD, platform: "ios" });
    expect(issued.status).toBe(200);
    const { refresh_token } = (await issued.json()) as { refresh_token: string };
    expect(devicesOf(a)).toHaveLength(2);
    expect((await call(null, "POST", "/auth/native/revoke", { refresh_token })).status).toBe(204);
    expect(devicesOf(a)).toEqual([]);
    // An unknown refresh token touches nobody's devices.
    const b = makeUser("b");
    await register(b, crypto.randomUUID(), { apns_token: token(21) });
    expect((await call(null, "POST", "/auth/native/revoke", { refresh_token: "lct_rt_unknown_unknown" })).status).toBe(204);
    expect(devicesOf(b)).toHaveLength(1);
  });

  test("a new password removes devices; web sign-out does not", async () => {
    const a = makeUser("a");
    await register(a, crypto.randomUUID(), { apns_token: token(22) });
    const login = await handleRequest(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: a.email, password: PASSWORD }),
      })
    );
    expect(login.status).toBe(200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const logout = await handleRequest(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { Cookie: cookie } }));
    expect(logout.status).toBeLessThan(400);
    expect(devicesOf(a)).toHaveLength(1);
    updateUserPassword(a.id, "another_password_2");
    expect(devicesOf(a)).toEqual([]);
  });

  test("limit of 20", async () => {
    const a = makeUser("a");
    const ids: string[] = [];
    for (let i = 0; i <= MAX_PUSH_DEVICES_PER_USER; i += 1) {
      const id = crypto.randomUUID();
      ids.push(id);
      expect((await register(a, id, { apns_token: token(100 + i) })).status).toBe(200);
      await Bun.sleep(2); // distinct last_seen_at
    }
    const left = devicesOf(a).map((d) => d.id);
    expect(left).toHaveLength(MAX_PUSH_DEVICES_PER_USER);
    expect(left).not.toContain(ids[0]!); // the one seen longest ago
    expect(left).toContain(ids.at(-1)!);
  });

  test("a dead token (APNs 410) removes its device", async () => {
    const a = makeUser("a");
    await register(a, crypto.randomUUID(), { apns_token: token(23) });
    deletePushDeviceByToken(token(23).toUpperCase());
    expect(devicesOf(a)).toEqual([]);
  });

  test("tokens are not logged", async () => {
    const a = makeUser("a");
    const logged: unknown[][] = [];
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      spyOn(logger, level).mockImplementation(((...args: unknown[]) => void logged.push(args)) as never)
    );
    try {
      const device = crypto.randomUUID();
      await register(a, device, { apns_token: token(24) });
      await call(a, "PUT", `/recordings/${recordingOf(a)}/live-activity`, { device_id: device, push_token: token(25) });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const text = JSON.stringify(logged);
    expect(text).not.toContain(token(24));
    expect(text).not.toContain(token(25));
  });
});
