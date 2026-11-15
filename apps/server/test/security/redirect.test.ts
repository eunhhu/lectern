import "../preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { CALENDAR_SYNC_JOB_KIND } from "../../src/calendar/sync-job.ts";
import { db, generateId, updateSystemSettings } from "../../src/db.ts";
import { createHttpApp } from "../../src/http.ts";
import { handleRequest } from "../../src/index.ts";
import { clearJwksCache } from "../../src/oauth/jwt.ts";
import { embeddedWorker, type JobWorker } from "../../src/queue.ts";
import { createFakeGoogle } from "../fakes/google.ts";
import { makeUser, tokenAuth, v2 } from "./helpers.ts";

// P5-15 · Open redirects: where the server sends a browser after Google sign-in (`next`),
// after connecting Google Calendar (`return_to`), and from `/`. The property checked is that
// a Location never leaves the server's own origin, whatever the request carried.

const EVIL = ["https://evil.example", "//evil.example", "/\\evil.example", "/%2F%2Fevil.example", "javascript:alert(1)"];
const ORIGIN = "https://lectern.example";

/** Where a browser on ORIGIN ends up when it follows `location`. */
const landsOn = (location: string) => new URL(location, ORIGIN);
const stays = (location: string) => {
  expect(location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\"), location).toBe(true);
  expect(landsOn(location).origin, location).toBe(ORIGIN);
};

const google = createFakeGoogle();
const ON = {
  LECTERN_GOOGLE_LOGIN: "1",
  LECTERN_CALENDAR: "1",
  GOOGLE_OAUTH_CLIENT_ID: "test-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
  LECTERN_WORKER_MODE: "external",
};
const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigForTests();
};

let paused: JobWorker | null = null;
beforeAll(async () => {
  google.install();
  setEnv(ON);
  paused = embeddedWorker();
  await paused?.drain(10_000);
});
beforeEach(() => {
  setEnv(ON);
  clearJwksCache();
  updateSystemSettings({ allow_public_signup: true, default_require_approval: false });
});
afterAll(() => {
  db.query(`DELETE FROM job WHERE kind = ? AND state = 'queued'`).run(CALENDAR_SYNC_JOB_KIND);
  google.restore();
  setEnv(Object.fromEntries(Object.keys(ON).map((k) => [k, undefined])));
});

const get = (path: string, headers: Record<string, string> = {}) => handleRequest(new Request(`http://localhost${path}`, { headers }));
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");

describe("security: redirects", () => {
  test("oauth next", async () => {
    for (const next of EVIL) {
      const started = await get(`${API_BASE_PATH}/auth/google/start?next=${encodeURIComponent(next)}`);
      expect(started.status, next).toBe(302);
      const url = new URL(started.headers.get("location")!);
      google.authorize(url);
      const code = generateId("code");
      const email = `${generateId("g")}@gmail.test`;
      google.issueCode(code, { refreshToken: null, idToken: { sub: generateId("sub"), email, email_verified: true } });
      const back = await get(`${API_BASE_PATH}/auth/google/callback?${new URLSearchParams({ code, state: url.searchParams.get("state")! })}`, {
        Cookie: cookiesOf(started),
      });
      expect(back.status, next).toBe(302);
      const location = back.headers.get("location")!;
      stays(location);
      // The plainly foreign ones fall back to the app's home.
      if (next !== "/%2F%2Fevil.example") expect(location, next).toBe("/app");
    }
  });

  test("google calendar return_to", async () => {
    for (const returnTo of EVIL) {
      const user = makeUser();
      const res = await v2("POST", "/integrations/google", {
        headers: tokenAuth(user),
        body: { workspace_id: personalWorkspaceId(user.id), return_to: returnTo },
      });
      if (res.status === 400) continue; // refused by the schema
      expect(res.status, returnTo).toBe(200);
      const url = new URL(res.body.authorization_url);
      const code = generateId("code");
      google.issueCode(code);
      const back = await get(`${API_BASE_PATH}/integrations/google/callback?${new URLSearchParams({ code, state: url.searchParams.get("state")! })}`, tokenAuth(user));
      expect(back.status, returnTo).toBe(302);
      stays(back.headers.get("location")!);
    }
  });

  test("/ and /admin redirects are fixed", async () => {
    // `/` sends the browser to the web app when it is on (http.ts); built here with a stand-in
    // dist so the redirect itself is exercised. The Location is relative and only ever /app.
    const dist = mkdtempSync(join(tmpdir(), "lectern-sec-shell-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Lectern</title>");
    const app = createHttpApp(() => Promise.resolve(new Response("legacy")), { webShellDistDir: dist });
    for (const [path, host] of [
      ["/", "evil.example"],
      ["/?next=//evil.example", "lectern.example"],
      ["/?redirect=https://evil.example", "evil.example:443"],
    ] as const) {
      const res = await app.fetch(new Request(`http://${host}${path}`, { headers: { Host: host, "X-Forwarded-Host": "evil.example" } }));
      expect(res.status, path).toBe(302);
      const location = res.headers.get("location")!;
      expect(location.startsWith("/app"), location).toBe(true);
      stays(location);
    }
    // The old admin console is a page, not a redirect, whatever Host says.
    for (const host of ["evil.example", "localhost"]) {
      const res = await handleRequest(new Request(`http://${host}/admin`, { headers: { Host: host, "X-Forwarded-Host": "evil.example" } }));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
