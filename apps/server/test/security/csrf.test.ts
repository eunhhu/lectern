import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { createApiV2App } from "../../src/api/v2/index.ts";
import { createSession, getUserByEmail } from "../../src/db.ts";
import { resetAuthRateLimits } from "../../src/index.ts";
import { call, makeUser, PASSWORD, seedLecture, tokenAuth, v2 } from "./helpers.ts";
import { requestFor, routesWhere, send, WRITE_METHODS } from "./routes.ts";

// P5-15 · Cross-site requests with the session cookie (AGENTS.md: the CSRF defence is by
// Origin / Sec-Fetch-Site, apps/server/src/csrf.ts). Every v2 route whose method changes state is sent the way a
// page on another site would send it: the browser's cookie, that site's Origin, and
// `Sec-Fetch-Site: cross-site`. SameSite=Lax keeps the cookie off a cross-site POST in
// current browsers, but not off one from a sibling subdomain (same-site), and not in every
// client; these tests check what the server itself does.

const CROSS_SITE = { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" };
const SAME_ORIGIN = { Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" };
const cookie = (session: string) => ({ Cookie: `lectern_session=${encodeURIComponent(session)}` });

const writes = () => routesWhere((r) => WRITE_METHODS.has(r.method) && !r.public);

beforeEach(() => resetAuthRateLimits());

describe("security: cross-site cookie requests", () => {
  test("cross-site cookie requests are refused", async () => {
    const user = makeUser();
    const session = createSession(user.id);
    const ws = personalWorkspaceId(user.id);
    // State that must not change: the profile name and a folder.
    const before = (await v2("GET", "/me", { headers: tokenAuth(user) })).body.display_name;
    const folder = await v2("POST", "/folders", { headers: tokenAuth(user), body: { workspace_id: ws, name: "지키는 폴더" } });
    expect(folder.status).toBe(201);
    await v2("PATCH", "/me", { cookie: session, headers: CROSS_SITE, body: { display_name: "다른 사이트가 바꾼 이름" } });
    await v2("DELETE", `/folders/${folder.body.id}`, { cookie: session, headers: CROSS_SITE });
    const nameAfter = (await v2("GET", "/me", { headers: tokenAuth(user) })).body.display_name;
    const folders = (await v2("GET", `/folders?workspace_id=${ws}`, { headers: tokenAuth(user) })).body.items as { id: string }[];

    const accepted: string[] = [];
    for (const route of writes()) {
      const { status } = await send(requestFor(route, { targets: { workspaceId: ws }, headers: { ...cookie(session), ...CROSS_SITE } }));
      if (status !== 403) accepted.push(`${route.operationId} ${status}`);
    }
    expect({ nameChanged: nameAfter !== before, folderDeleted: !folders.some((f) => f.id === folder.body.id), accepted }).toEqual({
      nameChanged: false,
      folderDeleted: false,
      accepted: [],
    });
  });

  // Each pass runs on its own fresh account, so a create that succeeds once does not
  // conflict the second time; the two status lists must be the same.
  async function statuses(headersFor: (user: ReturnType<typeof makeUser>) => Promise<Record<string, string>>, extra: Record<string, string>) {
    const user = makeUser({ role: "admin" });
    const ws = personalWorkspaceId(user.id);
    const headers = { ...(await headersFor(user)), ...extra };
    const out: Record<string, number> = {};
    for (const route of writes()) out[route.operationId] = (await send(requestFor(route, { targets: { workspaceId: ws }, headers }))).status;
    return out;
  }
  const withCookie = async (user: ReturnType<typeof makeUser>) => cookie(createSession(user.id));
  const withPat = async (user: ReturnType<typeof makeUser>) => {
    const pat = await v2("POST", "/me/tokens", {
      headers: tokenAuth(user),
      body: { workspace_id: personalWorkspaceId(user.id), name: "스크립트", scopes: ["recordings:read", "recordings:write"] },
    });
    expect(pat.status).toBe(201);
    return { Authorization: `Bearer ${pat.body.secret}` };
  };

  test("same-origin cookie requests pass", async () => {
    const plain = await statuses(withCookie, {});
    resetAuthRateLimits();
    const same = await statuses(withCookie, SAME_ORIGIN);
    expect(Object.values(same)).not.toContain(401);
    expect(same).toEqual(plain);
  });

  test("token requests need no origin check", async () => {
    const plain = await statuses(withPat, {});
    resetAuthRateLimits();
    const cross = await statuses(withPat, CROSS_SITE);
    expect(Object.values(cross)).not.toContain(401);
    expect(cross).toEqual(plain);
  });

  test("form content types cannot reach JSON routes", async () => {
    // What an HTML form (or a no-preflight fetch) can send: the JSON text under another type.
    // An operator, so the admin routes get as far as reading the body.
    const user = makeUser({ role: "admin" });
    const session = createSession(user.id);
    const ws = personalWorkspaceId(user.id);
    const reached: string[] = [];
    for (const route of routesWhere((r) => WRITE_METHODS.has(r.method) && !!r.body && "schema" in r.body)) {
      for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"]) {
        const { status } = await send(requestFor(route, { targets: { workspaceId: ws }, headers: { ...cookie(session), "Content-Type": type } }));
        if (status !== 400 && status !== 415) reached.push(`${route.operationId} ${type} ${status}`);
      }
    }
    expect(reached).toEqual([]);
  });

  test("apple callback is the only cross-site POST", async () => {
    // Every POST the v2 app mounts (the route table and the OAuth callbacks), sent cross-site
    // with a session cookie. Only Apple's form_post callback may be let through (it is guarded
    // by the single-use state and Apple's Origin instead). The public native sign-in routes do
    // not read the cookie at all, so they are not cookie requests and are left out.
    const user = makeUser();
    const session = createSession(user.id);
    const ws = personalWorkspaceId(user.id);
    const mounted = createApiV2App()
      .routes.filter((r) => r.method === "POST")
      .map((r) => r.path);
    const letThrough: string[] = [];
    for (const path of [...new Set(mounted)]) {
      const route = routesWhere((r) => r.method === "post" && r.path.replace(/\{([a-z_]+)\}/g, ":$1") === path)[0];
      if (route?.public) continue;
      const origin = path === "/auth/apple/callback" ? { Origin: "https://appleid.apple.com", "Sec-Fetch-Site": "cross-site" } : CROSS_SITE;
      const req = route
        ? requestFor(route, { targets: { workspaceId: ws }, headers: { ...cookie(session), ...origin } })
        : new Request(`http://localhost${API_BASE_PATH}${path}`, {
            method: "POST",
            headers: { ...cookie(session), ...origin, "Content-Type": "application/x-www-form-urlencoded" },
            body: "state=nope&code=nope",
          });
      const { status } = await send(req);
      if (status !== 403) letThrough.push(path);
    }
    expect(letThrough).toEqual(["/auth/apple/callback"]);
  });
});

describe("security: where a cookie write may come from", () => {
  /** PATCH /me with the session cookie and `headers`; returns the status and whether the name changed. */
  async function rename(headers: Record<string, string>, path = "/me") {
    const user = makeUser();
    const session = createSession(user.id);
    const { status } = await v2("PATCH", path, { cookie: session, headers, body: { display_name: "바뀐 이름" } });
    const after = (await v2("GET", "/me", { headers: tokenAuth(user) })).body.display_name;
    return { status, changed: after === "바뀐 이름" };
  }

  test("same-site cookie requests are refused", async () => {
    // A page on a sibling subdomain: SameSite=Lax lets the cookie through, the server must not.
    expect(await rename({ Origin: "https://other.example.test", "Sec-Fetch-Site": "same-site" })).toEqual({ status: 403, changed: false });
  });

  test("Sec-Fetch-Site decides when present", async () => {
    expect(await rename({ "Sec-Fetch-Site": "none" })).toEqual({ status: 200, changed: true });
    // A matching Origin does not overrule what the browser said about the request.
    expect(await rename({ Origin: "http://localhost", "Sec-Fetch-Site": "cross-site" })).toEqual({ status: 403, changed: false });
  });

  test("without Sec-Fetch-Site the Origin decides", async () => {
    expect(await rename({ Origin: "https://evil.example" })).toEqual({ status: 403, changed: false });
    expect(await rename({ Origin: "null" })).toEqual({ status: 403, changed: false });
    // The origin the request reached, and the public origin (behind the proxy the request URL is plain http).
    expect(await rename({ Origin: "http://localhost" })).toEqual({ status: 200, changed: true });
    expect(await rename({ Origin: new URL(config().baseUrl).origin })).toEqual({ status: 200, changed: true });
  });

  test("an empty token falls back to the cookie and is checked", async () => {
    // extractAuthToken skips an empty header or query value and uses the cookie: still a cookie request.
    expect(await rename({ ...CROSS_SITE, Authorization: "Bearer " })).toEqual({ status: 403, changed: false });
    expect(await rename({ ...CROSS_SITE, "X-Lectern-Token": "" })).toEqual({ status: 403, changed: false });
    expect(await rename(CROSS_SITE, "/me?token=")).toEqual({ status: 403, changed: false });
    // A real token next to the cookie is what authenticates, and a page cannot send one by itself.
    const user = makeUser();
    const res = await v2("PATCH", "/me", { cookie: createSession(user.id), headers: { ...CROSS_SITE, ...tokenAuth(user) }, body: { display_name: "토큰 이름" } });
    expect(res.status).toBe(200);
  });

  test("reads are not checked", async () => {
    const user = makeUser();
    expect((await v2("GET", "/me", { cookie: createSession(user.id), headers: CROSS_SITE })).status).toBe(200);
  });

  test("v1 cookie writes are checked too", async () => {
    // The old pages and the new admin console call the v1 auth, admin and lecture routes with the cookie.
    const operator = makeUser({ role: "admin" });
    const session = createSession(operator.id);
    const email = `csrf-${crypto.randomUUID()}@test.local`;
    const created = await call("POST", "/api/admin/users", { cookie: session, headers: CROSS_SITE, body: { email, password: PASSWORD } });
    expect(created.status).toBe(403);
    expect(typeof created.body.error).toBe("string"); // the v1 error shape
    expect(getUserByEmail(email)).toBeNull();

    const { lectureId } = seedLecture(operator);
    expect((await call("DELETE", `/api/lectures/${lectureId}`, { cookie: session, headers: CROSS_SITE })).status).toBe(403);
    expect((await call("GET", `/api/lectures/${lectureId}`, { headers: tokenAuth(operator) })).status).toBe(200);

    expect((await call("POST", "/api/auth/logout", { cookie: session, headers: CROSS_SITE })).status).toBe(403);
    expect((await v2("GET", "/me", { cookie: session })).status).toBe(200);

    // The same requests from our own pages go through.
    expect((await call("POST", "/api/admin/users", { cookie: session, headers: SAME_ORIGIN, body: { email, password: PASSWORD } })).status).toBe(201);
    expect(getUserByEmail(email)).not.toBeNull();
    expect((await call("DELETE", `/api/lectures/${lectureId}`, { cookie: session, headers: SAME_ORIGIN })).status).toBe(200);
    expect((await call("POST", "/api/auth/logout", { cookie: session, headers: SAME_ORIGIN })).status).toBe(200);
    expect((await v2("GET", "/me", { cookie: session })).status).toBe(401);
  });
});
