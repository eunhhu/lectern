// The HTTP entry: a Hono app that owns cross-cutting concerns (request ids, errors) and
// hands every route it does not define yet to the legacy router in index.ts. API v2
// routes (docs/v2/ARCHITECTURE.md §6) are added here, one module per resource, as they
// move off the legacy if-chain.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { API_BASE_PATH, createApiV2App } from "./api/v2/index.ts";
import { logger } from "./log.ts";
import { WEB_SHELL_BASE, webShellResponse } from "./web-shell.ts";

const LEGAL_DIR = join(import.meta.dir, "../static/legal");

type Env = { Variables: { requestId: string } };

export interface HttpAppOptions {
  /** Build output of apps/web to serve at /app, or null to leave /app unrouted (LECTERN_WEB_SHELL=0). */
  webShellDistDir?: string | null;
}

/** A request id from the proxy is reused when it looks like one; otherwise a new UUID. */
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function createHttpApp(legacy: (req: Request) => Promise<Response>, options: HttpAppOptions = {}) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    await next();
    c.res.headers.set("X-Request-Id", requestId);
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    logger.error("unhandled request error", {
      request_id: requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      err,
    });
    return c.json({ error: "서버 내부 오류가 발생했습니다.", request_id: requestId }, 500);
  });

  app.route(API_BASE_PATH, createApiV2App());

  // Public policy pages (linked from the OAuth consent screen and the app stores).
  for (const page of ["privacy", "terms"] as const) {
    app.get(`/${page}`, async (c, next) => {
      const file = join(LEGAL_DIR, `${page}.html`);
      if (!existsSync(file)) return next();
      return new Response(Bun.file(file), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    });
  }

  // The v2 web app (apps/web). Off by default; the legacy UI at / is unaffected.
  const webShellDistDir = options.webShellDistDir;
  if (webShellDistDir) {
    for (const path of [WEB_SHELL_BASE, `${WEB_SHELL_BASE}/*`]) {
      app.get(path, (c) => webShellResponse(new URL(c.req.url).pathname, webShellDistDir) ?? c.notFound());
    }
  }

  // v2 routes go above this line.
  app.all("*", (c) => legacy(c.req.raw));

  return app;
}
