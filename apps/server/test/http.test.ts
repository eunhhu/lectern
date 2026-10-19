import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resetConfigForTests } from "@lectern/config";
import { createHttpApp } from "../src/http.ts";
import { handleRequest } from "../src/index.ts";
import { log } from "../src/log.ts";

describe("HTTP entry", () => {
  test("every response carries a request id, generated or reused from the proxy", async () => {
    const generated = await handleRequest(new Request("http://localhost/api/health"));
    expect(generated.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await handleRequest(
      new Request("http://localhost/api/health", { headers: { "x-request-id": "proxy-req-12345" } })
    );
    expect(reused.headers.get("X-Request-Id")).toBe("proxy-req-12345");

    // Anything that could smuggle text into logs or headers is replaced, not echoed.
    const rejected = await handleRequest(
      new Request("http://localhost/api/health", { headers: { "x-request-id": "bad id\" injected" } })
    );
    expect(rejected.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("routes the Hono app does not define fall through to the legacy router", async () => {
    const res = await handleRequest(new Request("http://localhost/api/lectures"));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("policy pages are served when their HTML exists and 404 otherwise", async () => {
    for (const page of ["privacy", "terms"]) {
      const exists = existsSync(join(import.meta.dir, `../static/legal/${page}.html`));
      const res = await handleRequest(new Request(`http://localhost/${page}`));
      expect(res.status).toBe(exists ? 200 : 404);
      if (exists) expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    }
  });

  test("an unhandled error answers 500 with the request id and logs it", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = createHttpApp(async () => {
        throw new Error("boom");
      });
      const res = await app.fetch(
        new Request("http://localhost/x", { headers: { "x-request-id": "trace-abcdef12" } })
      );
      expect(res.status).toBe(500);
      expect(res.headers.get("X-Request-Id")).toBe("trace-abcdef12");
      expect(await res.json()).toMatchObject({ request_id: "trace-abcdef12" });
      const line = JSON.parse(String(errors.mock.calls[0]?.[0]));
      expect(line).toMatchObject({ level: "error", request_id: "trace-abcdef12", path: "/x" });
      expect(line.err.message).toBe("boom");
    } finally {
      errors.mockRestore();
    }
  });
});

describe("logger", () => {
  test("writes one JSON object per line, warnings and errors to stderr", () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      log("info", "request", { status: 200, path: "/api/x" });
      log("warn", "slow", { ms: 900 });
      const info = JSON.parse(String(out.mock.calls[0]?.[0]));
      expect(info).toMatchObject({ level: "info", msg: "request", status: 200, path: "/api/x" });
      expect(typeof info.ts).toBe("string");
      expect(JSON.parse(String(err.mock.calls[0]?.[0]))).toMatchObject({ level: "warn", ms: 900 });
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  test("LECTERN_LOG_FORMAT=pretty writes a readable line", () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    process.env.LECTERN_LOG_FORMAT = "pretty";
    resetConfigForTests();
    try {
      log("info", "request", { status: 200, path: "/api/x" });
      expect(String(out.mock.calls[0]?.[0])).toBe("INFO  request status=200 path=/api/x");
    } finally {
      delete process.env.LECTERN_LOG_FORMAT;
      resetConfigForTests();
      out.mockRestore();
    }
  });
});
