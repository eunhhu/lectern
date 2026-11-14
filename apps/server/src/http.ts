// The HTTP entry: a Hono app that owns cross-cutting concerns (request ids, errors) and
// hands every route it does not define yet to the legacy router in index.ts. API v2
// routes (docs/v2/ARCHITECTURE.md §6) are added here, one module per resource, as they
// move off the legacy if-chain.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { config } from "@lectern/config";
import { API_BASE_PATH, createApiV2App } from "./api/v2/index.ts";
import { feedByToken, feedEvents } from "./calendar/feed.ts";
import { renderIcs } from "./calendar/ics.ts";
import { LEGAL_PAGES, legalPageHtml } from "./legal.ts";
import { createShareRouter } from "./share-page.ts";
import { logger } from "./log.ts";
import { redactUrlForLog } from "./ops.ts";
import { WEB_SHELL_BASE, webShellResponse } from "./web-shell.ts";

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
      path: redactUrlForLog(new URL(c.req.url)),
      err,
    });
    return c.json({ error: "서버 내부 오류가 발생했습니다.", request_id: requestId }, 500);
  });

  app.route(API_BASE_PATH, createApiV2App());

  // ICS subscription (P4-01, D-P4-2): a secret URL, no sign-in. Off, malformed, unknown
  // and revoked all give the same 404, so a guess learns nothing.
  app.get("/cal/:file", (c) => {
    const match = /^([A-Za-z0-9_-]{20,128})\.ics$/.exec(c.req.param("file"));
    const feed = config().calendar && match ? feedByToken(match[1]!) : null;
    if (!feed) return c.text("Not found", 404, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    return new Response(renderIcs(feedEvents(feed.userId, feed.workspaceId)), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex",
      },
    });
  });

  // Public policy pages (linked from the OAuth consent screen and the app stores), with
  // the operator's contact, officer and effective date filled in (legal.ts).
  for (const page of LEGAL_PAGES) {
    app.get(`/${page}`, async (c, next) => {
      const html = legalPageHtml(page);
      if (html === null) return next();
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    });
  }

  // The v2 web app (apps/web). When enabled, / redirects to /app unless ?legacy=1 is set.
  const webShellDistDir = options.webShellDistDir;
  if (webShellDistDir) {
    app.get("/", async (c) => {
      const url = new URL(c.req.url);
      if (url.searchParams.get("legacy") === "1") return legacy(c.req.raw);
      return c.redirect(`${WEB_SHELL_BASE}${url.search}`, 302);
    });
    for (const path of [WEB_SHELL_BASE, `${WEB_SHELL_BASE}/*`]) {
      app.get(path, (c) => webShellResponse(new URL(c.req.url).pathname, webShellDistDir) ?? c.notFound());
    }
  }

  // Share links (D-P2-3): /s/:token from share_link rows. Unknown and revoked tokens fall
  // through to the v1 handler below, which keeps its 404/403 sentences.
  app.route("/", createShareRouter());

  // v2 routes go above this line.
  app.all("*", (c) => legacy(c.req.raw));

  return app;
}
