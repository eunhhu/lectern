// API v2 (docs/v2/ARCHITECTURE.md §6), mounted by http.ts at API_BASE_PATH (/api/v2).
// Every route in packages/domain's ROUTES is registered by one resource router below. In
// P0 the reads answer fixed fixtures and the writes answer 501; see README.md here for
// the per-endpoint table and the order in which they become real.

import { Hono } from "hono";
import { API_BASE_PATH, serializeOpenApi } from "@lectern/domain";
import { logger } from "../../log.ts";
import { actionItemsRouter } from "./action-items.ts";
import { adminRouter } from "./admin.ts";
import { assetsRouter } from "./assets.ts";
import { calendarRouter } from "./calendar.ts";
import { apiError, type V2Env } from "./common.ts";
import { documentsRouter } from "./documents.ts";
import { eventsRouter } from "./events.ts";
import { foldersRouter } from "./folders.ts";
import { integrationsRouter } from "./integrations.ts";
import { jobsRouter } from "./jobs.ts";
import { meRouter } from "./me.ts";
import { recordingsRouter } from "./recordings.ts";
import { searchRouter } from "./search.ts";
import { shareLinksRouter } from "./share-links.ts";
import { tagsRouter } from "./tags.ts";
import { uploadsRouter } from "./uploads.ts";
import { workspacesRouter } from "./workspaces.ts";

export { API_BASE_PATH };

export const RESOURCE_ROUTERS = [
  meRouter,
  workspacesRouter,
  foldersRouter,
  tagsRouter,
  uploadsRouter,
  recordingsRouter,
  assetsRouter,
  documentsRouter,
  actionItemsRouter,
  jobsRouter,
  searchRouter,
  calendarRouter,
  integrationsRouter,
  shareLinksRouter,
  eventsRouter,
  adminRouter,
];

let openApiJson: string | null = null;

export function createApiV2App() {
  const v2 = new Hono<V2Env>();

  // Authenticated API responses are never stored by browsers or proxies.
  v2.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  // The schema is public (it is generated from this public repository's packages/domain).
  // The committed openapi.json is byte-identical to this (packages/domain staleness test).
  v2.get("/openapi.json", (c) => {
    openApiJson ??= serializeOpenApi();
    return c.body(openApiJson, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  });

  for (const router of RESOURCE_ROUTERS) v2.route("/", router);

  // Unknown /api/v2 paths (and known paths with another method) answer in the v2 error
  // shape instead of falling through to the legacy router.
  v2.all("*", (c) => apiError(c, 404, "not_found", "API 경로를 찾을 수 없습니다."));

  v2.onError((err, c) => {
    const requestId = c.get("requestId");
    logger.error("unhandled request error", {
      request_id: requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      err,
    });
    return apiError(c, 500, "internal", "서버 내부 오류가 발생했습니다.", requestId ? { request_id: requestId } : undefined);
  });

  return v2;
}
