import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@lectern/config";
import { createHttpApp } from "../src/http.ts";
import { handleRequest } from "../src/index.ts";

const legacyCalls: string[] = [];
const legacy = async (req: Request) => {
  legacyCalls.push(new URL(req.url).pathname);
  return new Response("legacy", { status: 404 });
};

let root: string;
let dist: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lectern-web-shell-"));
  dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), '<!doctype html><html lang="ko"><title>Lectern</title></html>');
  writeFileSync(join(dist, "assets", "main-abc123.js"), "console.log('app');");
  writeFileSync(join(dist, "assets", "main-abc123.css"), "body{}");
  writeFileSync(join(dist, "robots.txt"), "User-agent: *");
  writeFileSync(join(root, "secret.txt"), "outside the dist directory");
  symlinkSync(join(root, "secret.txt"), join(dist, "assets", "leak.txt"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const get = (app: ReturnType<typeof createHttpApp>, path: string, method = "GET") =>
  app.fetch(new Request(`http://localhost${path}`, { method }));

describe("web shell at /app", () => {
  test("LECTERN_WEB_SHELL defaults to off and accepts 1", () => {
    expect(loadConfig({}).webShell).toBe(false);
    expect(loadConfig({ LECTERN_WEB_SHELL: "1" }).webShell).toBe(true);
  });

  test("is not routed when the flag is off, so the legacy router answers", async () => {
    legacyCalls.length = 0;
    const app = createHttpApp(legacy);
    const res = await get(app, "/app/library");
    expect(await res.text()).toBe("legacy");
    expect(legacyCalls).toEqual(["/app/library"]);
    // The production entry (flag off in tests) leaves /app to the legacy router too.
    expect((await handleRequest(new Request("http://localhost/app"))).status).toBe(404);
  });

  test("client-side routes get index.html, revalidated on every load", async () => {
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    for (const path of ["/app", "/app/", "/app/library", "/app/recordings/rec_1", "/app/library/%ED%8F%B4%EB%8D%94"]) {
      const res = await get(app, path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(await res.text()).toContain("<title>Lectern</title>");
    }
  });

  test("hashed assets are served with their type and cached for a year", async () => {
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    const js = await get(app, "/app/assets/main-abc123.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(js.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const css = await get(app, "/app/assets/main-abc123.css");
    expect(css.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    const robots = await get(app, "/app/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("Cache-Control")).toBe("no-cache");
  });

  test("a missing file is a 404, never index.html", async () => {
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    const res = await get(app, "/app/assets/main-missing.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  test("paths cannot leave the dist directory", async () => {
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    for (const path of [
      "/app/%2e%2e/secret.txt",
      "/app/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/app/assets/..%5c..%5csecret.txt",
      "/app/.env.js",
      "/app/assets/leak.txt", // symlink pointing outside dist
      "/app/assets/%00.js",
    ]) {
      const res = await get(app, path);
      expect([400, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("outside the dist directory");
    }
  });

  test("HEAD works and other methods fall through to the legacy router", async () => {
    legacyCalls.length = 0;
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    const head = await get(app, "/app/library", "HEAD");
    expect(head.status).toBe(200);
    const post = await get(app, "/app/library", "POST");
    expect(await post.text()).toBe("legacy");
    expect(legacyCalls).toEqual(["/app/library"]);
  });

  test("answers 503 with a hint while the app is not built", async () => {
    const app = createHttpApp(legacy, { webShellDistDir: join(root, "missing-dist") });
    const res = await get(app, "/app/library");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("bun run web:build");
  });

  test("does not shadow neighbouring paths", async () => {
    legacyCalls.length = 0;
    const app = createHttpApp(legacy, { webShellDistDir: dist });
    await get(app, "/apple");
    await get(app, "/application/x.js");
    expect(legacyCalls).toEqual(["/apple", "/application/x.js"]);
  });
});
