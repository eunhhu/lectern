import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetConfigForTests } from "@lectern/config";
import { createUser, db, generateId, type UserRecord } from "../src/db.ts";
import { handleRequest } from "../src/index.ts";
import { runMaintenanceNow } from "../src/maintenance.ts";
import {
  classifyV1Client,
  flushV1Usage,
  isRetiredV1Path,
  isV1ApiPath,
  normalizeV1Route,
  pruneV1Usage,
  recordV1Usage,
  seoulDay,
  setV1UsageWriterForTests,
  v1Blocked,
  v1Headers,
} from "../src/v1-sunset.ts";

// Retiring API v1 (P6-03, D-P6-5): calls are counted per Seoul day, route and client; a sunset
// date adds Deprecation/Sunset headers; LECTERN_V1_BLOCK closes the retired paths after it.
// Every test counts under its own X-Client, since the test DB is shared with other files.

const DAY = 86_400_000;
let admin: UserRecord;
let member: UserRecord;

beforeAll(() => {
  const user = (role: "admin" | "member") =>
    createUser({ email: `${generateId("v1s")}@test.local`, displayName: `v1 ${role}`, password: "correct_password_1", role });
  admin = user("admin");
  member = user("member");
});

function v1Env(sunset?: string, block?: boolean): void {
  if (sunset) process.env.LECTERN_V1_SUNSET = sunset;
  else delete process.env.LECTERN_V1_SUNSET;
  if (block) process.env.LECTERN_V1_BLOCK = "1";
  else delete process.env.LECTERN_V1_BLOCK;
  resetConfigForTests();
}

afterEach(() => {
  setV1UsageWriterForTests(null);
  v1Env();
});
afterAll(() => flushV1Usage());

const client = () => `t-${crypto.randomUUID().slice(0, 12)}`;

function request(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Response> {
  return handleRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

function rowsOf(name: string) {
  flushV1Usage();
  return db.query(`SELECT day, route, client, count FROM v1_usage WHERE client = ? ORDER BY route`).all(name) as Array<{
    day: string;
    route: string;
    client: string;
    count: number;
  }>;
}

describe("classification", () => {
  test("route normalisation", () => {
    expect(normalizeV1Route("GET", "/api/lectures/0a1b2c3d-4e5f-6789-abcd-ef0123456789/audio?x=1")).toBe("GET /api/lectures/:id/audio");
    expect(normalizeV1Route("post", "/api/ingest/shortcut")).toBe("POST /api/ingest/shortcut");
    expect(normalizeV1Route("GET", "/api/lectures")).toBe("GET /api/lectures");
    expect(normalizeV1Route("DELETE", "/api/lectures/12345")).toBe("DELETE /api/lectures/:id");
    expect(normalizeV1Route("GET", "/api/lectures/lec_mz3k9q2x7v8w1abc")).toBe("GET /api/lectures/:id");
    expect(normalizeV1Route("GET", `/api/${"a".repeat(10)}/${"b".repeat(10)}/${"c".repeat(200)}`).length).toBeLessThanOrEqual(120);
  });

  test("client classification", () => {
    const h = (headers: Record<string, string>) => classifyV1Client(new Headers(headers));
    expect(h({ "X-Client": "macos-native-menubar", "User-Agent": "Mozilla/5.0" })).toBe("macos-native-menubar");
    expect(h({ "X-Client": "Android-Share" })).toBe("android-share");
    expect(h({ "X-Client": "Bad Value!", "User-Agent": "LecternMenuBar/1.2 CFNetwork/1500" })).toBe("macos");
    expect(h({ "User-Agent": "Shortcuts/1146 CFNetwork/1500" })).toBe("shortcuts");
    expect(h({ "User-Agent": "WorkflowKit/1.0" })).toBe("shortcuts");
    expect(h({ "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 14)" })).toBe("android");
    expect(h({ "User-Agent": "okhttp/4.12.0" })).toBe("android");
    expect(h({ "User-Agent": "Lectern/1 CFNetwork/1498 Darwin/24.0.0" })).toBe("apple-other");
    expect(h({ "User-Agent": "Mozilla/5.0 (Macintosh)" })).toBe("browser");
    expect(h({})).toBe("no-ua");
    expect(h({ "User-Agent": "curl/8.7.1" })).toBe("other");
  });

  test("which paths are v1 and which may be closed", () => {
    for (const path of ["/api/lectures", "/api/auth/login", "/api/admin/overview", "/api/events", "/api/cd/deploy"]) expect(isV1ApiPath(path)).toBe(true);
    for (const path of ["/api/v2/me", "/api/v2", "/api/health", "/app", "/s/abc", "/"]) expect(isV1ApiPath(path)).toBe(false);
    for (const path of ["/api/lectures", "/api/lectures/x/audio", "/api/ingest/shortcut", "/api/events", "/api/clients/macos"]) {
      expect(isRetiredV1Path(path)).toBe(true);
    }
    for (const path of ["/api/auth/login", "/api/admin/overview", "/api/cd/deploy", "/api/health", "/api/lecturesx", "/api/v2/recordings"]) {
      expect(isRetiredV1Path(path)).toBe(false);
    }
  });
});

describe("counting", () => {
  test("counts one row per day, route and client", async () => {
    const name = client();
    for (let i = 0; i < 3; i++) {
      await request("GET", "/api/lectures/0a1b2c3d-4e5f-6789-abcd-ef0123456789/audio", { "X-Client": name, "X-Lectern-Token": member.api_token });
    }
    expect(rowsOf(name)).toEqual([{ day: seoulDay(), route: "GET /api/lectures/:id/audio", client: name, count: 3 }]);
    // A second flush adds to the row.
    await request("GET", "/api/lectures/0a1b2c3d-4e5f-6789-abcd-ef0123456789/audio", { "X-Client": name });
    expect(rowsOf(name)[0]!.count).toBe(4);
  });

  test("v2 and health are not counted", async () => {
    const name = client();
    await request("GET", "/api/v2/me", { "X-Client": name, "X-Lectern-Token": member.api_token });
    await request("GET", "/api/health", { "X-Client": name });
    expect(rowsOf(name)).toEqual([]);
  });

  test("the Seoul day", () => {
    // 2027-02-28 15:00 UTC is 2027-03-01 00:00 in Seoul.
    expect(seoulDay(Date.UTC(2027, 1, 28, 14, 59))).toBe("2027-02-28");
    expect(seoulDay(Date.UTC(2027, 1, 28, 15, 0))).toBe("2027-03-01");
  });

  test("flush failure does not break requests", async () => {
    setV1UsageWriterForTests(() => {
      throw new Error("disk I/O error");
    });
    const name = client();
    const res = await request("GET", "/api/lectures", { "X-Client": name, "X-Lectern-Token": member.api_token });
    expect(res.status).toBe(200);
    expect(() => flushV1Usage()).not.toThrow();
    // Past 500 keys the request itself flushes: still answered.
    for (let i = 0; i < 501; i++) recordV1Usage(`GET /api/x${i}`, name);
    expect((await request("GET", "/api/lectures", { "X-Client": name, "X-Lectern-Token": member.api_token })).status).toBe(200);
    setV1UsageWriterForTests(null);
    flushV1Usage();
    expect(rowsOf(name).filter((r) => r.route.startsWith("GET /api/x"))).toEqual([]); // the failed batch is dropped
  });
});

describe("sunset and block", () => {
  test("no variables: responses unchanged", async () => {
    v1Env();
    expect(v1Headers()).toEqual({});
    const res = await request("GET", "/api/lectures", { "X-Lectern-Token": member.api_token });
    expect(res.status).toBe(200);
    for (const name of ["deprecation", "sunset", "link"]) expect(res.headers.get(name)).toBeNull();
  });

  test("sunset adds headers", async () => {
    v1Env("2027-03-01");
    const res = await request("GET", "/api/lectures", { "X-Lectern-Token": member.api_token });
    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("sunset")).toBe("Sun, 28 Feb 2027 15:00:00 GMT");
    expect(res.headers.get("link")).toBe('</api/v2/openapi.json>; rel="successor-version"');
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["courses", "lectures"]); // the body is untouched
    // Error answers of v1 get them too; v2 never.
    expect((await request("GET", "/api/lectures")).headers.get("sunset")).toBe("Sun, 28 Feb 2027 15:00:00 GMT");
    const v2 = await request("GET", "/api/v2/me", { "X-Lectern-Token": member.api_token });
    expect(v2.status).toBe(200);
    for (const name of ["deprecation", "sunset", "link"]) expect(v2.headers.get(name)).toBeNull();
  });

  test("block needs both the flag and the date", async () => {
    const auth = { "X-Lectern-Token": member.api_token };
    v1Env("2020-01-01", false); // date passed, flag off
    expect((await request("GET", "/api/lectures", auth)).status).toBe(200);
    v1Env("2999-01-01", true); // flag on, date ahead
    expect((await request("GET", "/api/lectures", auth)).status).toBe(200);
    expect(v1Blocked("/api/lectures")).toBe(false);
    v1Env("2020-01-01", true); // both
    const res = await request("GET", "/api/lectures", auth);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "이 API는 종료되었습니다. 앱을 최신 버전으로 업데이트해 주세요.", code: "v1_gone" });
    expect(res.headers.get("sunset")).toBe("Tue, 31 Dec 2019 15:00:00 GMT");
    expect((await request("POST", "/api/ingest/shortcut", auth, {})).status).toBe(410);
    expect((await request("GET", "/api/events", auth)).status).toBe(410);
    // The exact moment: 00:00 in Seoul.
    expect(v1Blocked("/api/lectures", Date.UTC(2019, 11, 31, 14, 59))).toBe(false);
    expect(v1Blocked("/api/lectures", Date.UTC(2019, 11, 31, 15, 0))).toBe(true);
  });

  test("auth and admin stay open when blocked", async () => {
    v1Env("2020-01-01", true);
    const login = await request("POST", "/api/auth/login", {}, { email: "nobody@test.local", password: "wrong_password_1" });
    expect(login.status).not.toBe(410);
    const overview = await request("GET", "/api/admin/overview", { "X-Lectern-Token": admin.api_token });
    expect(overview.status).toBe(200);
    expect((await request("GET", "/api/health")).status).not.toBe(410);
  });

  test("v2 is never affected", async () => {
    v1Env("2020-01-01", true);
    const res = await request("GET", "/api/v2/me", { "X-Lectern-Token": member.api_token });
    expect(res.status).toBe(200);
    expect(res.headers.get("sunset")).toBeNull();
  });

  test("blocked requests are still counted", async () => {
    v1Env("2020-01-01", true);
    const name = client();
    expect((await request("GET", "/api/lectures", { "X-Client": name })).status).toBe(410);
    expect(rowsOf(name)).toEqual([{ day: seoulDay(), route: "GET /api/lectures", client: name, count: 1 }]);
  });
});

describe("operator list and upkeep", () => {
  test("admin list", async () => {
    const name = client();
    await request("GET", "/api/lectures", { "X-Client": name, "X-Lectern-Token": member.api_token });
    await request("GET", "/api/lectures", { "X-Client": name, "X-Lectern-Token": member.api_token });
    const old = seoulDay(Date.now() - 40 * DAY);
    db.query(`INSERT INTO v1_usage (day, route, client, count) VALUES (?, 'GET /api/lectures', ?, 7)`).run(old, name);

    // Not flushed by hand: the list writes the pending counts first.
    const res = await request("GET", "/api/v2/admin/v1-usage", { "X-Lectern-Token": admin.api_token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ day: string; route: string; client: string; count: number }>; next_cursor: null };
    expect(body.next_cursor).toBeNull();
    expect(body.items.filter((r) => r.client === name)).toEqual([{ day: seoulDay(), route: "GET /api/lectures", client: name, count: 2 }]);
    const days = body.items.map((r) => r.day);
    expect([...days].sort().reverse()).toEqual(days);

    const ranged = (await (
      await request("GET", `/api/v2/admin/v1-usage?from=${old}&to=${old}`, { "X-Lectern-Token": admin.api_token })
    ).json()) as typeof body;
    expect(ranged.items.filter((r) => r.client === name)).toEqual([{ day: old, route: "GET /api/lectures", client: name, count: 7 }]);

    expect((await request("GET", "/api/v2/admin/v1-usage", { "X-Lectern-Token": member.api_token })).status).toBe(403);
    expect((await request("GET", "/api/v2/admin/v1-usage?from=2027-1-1", { "X-Lectern-Token": admin.api_token })).status).toBe(400);
  });

  test("prune", async () => {
    const name = client();
    const now = Date.now();
    const insert = db.query(`INSERT INTO v1_usage (day, route, client, count) VALUES (?, ?, ?, 1)`);
    insert.run(seoulDay(now - 401 * DAY), "GET /api/old", name);
    insert.run(seoulDay(now - 399 * DAY), "GET /api/kept", name);
    expect(pruneV1Usage(now)).toBeGreaterThanOrEqual(1);
    expect(rowsOf(name).map((r) => r.route)).toEqual(["GET /api/kept"]);
    // Maintenance runs it.
    insert.run(seoulDay(now - 500 * DAY), "GET /api/old", name);
    const result = await runMaintenanceNow();
    expect(result.errors.filter((e) => e.startsWith("v1 usage"))).toEqual([]);
    expect(rowsOf(name).map((r) => r.route)).toEqual(["GET /api/kept"]);
  });
});
