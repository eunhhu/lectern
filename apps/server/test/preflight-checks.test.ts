import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpApp } from "../src/http.ts";
import { buildPreflightChecks, rootRedirectProblems, type PreflightResponse } from "../src/preflight-checks.ts";

type Answers = Record<string, PreflightResponse>;

function fakeGet(answers: Answers) {
  return async (path: string): Promise<PreflightResponse> => {
    const answer = answers[path];
    if (!answer) throw new Error(`unexpected request ${path}`);
    return answer;
  };
}

const healthy: Answers = {
  "/": { status: 302, location: "/app" },
  "/?legacy=1": { status: 200, location: null },
  "/app": { status: 200, location: null },
};

describe("buildPreflightChecks", () => {
  test("root row is 200 when the shell is off", () => {
    const checks = buildPreflightChecks(false, []);
    expect(checks).toContainEqual(["/", 200]);
    expect(checks.some(([path, status]) => path === "/" && status === 302)).toBe(false);
  });

  test("root row is 302 when the shell is on", () => {
    const checks = buildPreflightChecks(true, []);
    expect(checks).toContainEqual(["/", 302]);
    expect(checks).not.toContainEqual(["/", 200]);
  });

  test("page scripts are appended", () => {
    const checks = buildPreflightChecks(false, ["a.js"]);
    expect(checks.at(-1)).toEqual(["/assets/a.js", 200]);
  });
});

describe("rootRedirectProblems", () => {
  test("redirect to /app passes", async () => {
    expect(await rootRedirectProblems(fakeGet(healthy), { distBuilt: true })).toEqual([]);
  });

  test("wrong Location is reported", async () => {
    const problems = await rootRedirectProblems(fakeGet({ ...healthy, "/": { status: 302, location: "/login" } }), {
      distBuilt: true,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("/app");
  });

  test("legacy root must be 200", async () => {
    const problems = await rootRedirectProblems(
      fakeGet({ ...healthy, "/?legacy=1": { status: 302, location: "/app?legacy=1" } }),
      { distBuilt: true }
    );
    expect(problems.join("\n")).toContain("/?legacy=1 → 302");
  });

  test("/app is skipped when dist is not built", async () => {
    const problems = await rootRedirectProblems(fakeGet({ ...healthy, "/app": { status: 503, location: null } }), {
      distBuilt: false,
    });
    expect(problems).toEqual([]);
  });

  test("/app 503 is reported when dist is built", async () => {
    const problems = await rootRedirectProblems(fakeGet({ ...healthy, "/app": { status: 503, location: null } }), {
      distBuilt: true,
    });
    expect(problems.join("\n")).toContain("/app → 503");
  });
});

describe("real app with the shell on", () => {
  let root: string;
  let dist: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "lectern-preflight-checks-"));
    dist = join(root, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), '<!doctype html><html lang="ko"><title>Lectern</title></html>');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("real app: shell on redirects", async () => {
    const legacy = async () => new Response("legacy", { status: 200 });
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    const get = async (path: string): Promise<PreflightResponse> => {
      const res = await app.fetch(new Request(`http://localhost${path}`));
      return { status: res.status, location: res.headers.get("Location") };
    };

    const rootRes = await get("/");
    expect(rootRes.status).toBe(302);
    expect(rootRes.location).toBe("/app");
    const legacyRes = await app.fetch(new Request("http://localhost/?legacy=1"));
    expect(legacyRes.status).toBe(200);
    expect(await legacyRes.text()).toBe("legacy");
    expect((await get("/app")).status).toBe(200);
    expect(await rootRedirectProblems(get, { distBuilt: true })).toEqual([]);
  });
});
