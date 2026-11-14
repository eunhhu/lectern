// API v2 (docs/v2/ARCHITECTURE.md §6), mounted by http.ts at API_BASE_PATH (/api/v2).
// Every route in packages/domain's ROUTES is registered by one resource router below,
// over the v2 tables (packages/db). README.md here has the per-endpoint table; the few
// routes of later phases still answer 501.

import { Hono } from "hono";
import { API_BASE_PATH, serializeOpenApi } from "@lectern/domain";
import { syncPendingLectures } from "../../db.ts";
import { logger } from "../../log.ts";
import { askService, type AskService } from "../../ask/service.ts";
import { actionItemsRouter } from "./action-items.ts";
import { adminRouter } from "./admin.ts";
import { createAskRouter } from "./ask.ts";
import { assetsRouter } from "./assets.ts";
import { authNativeRouter } from "./auth-native.ts";
import { calendarRouter } from "./calendar.ts";
import { apiError, type V2Env } from "./common.ts";
import { documentsRouter } from "./documents.ts";
import { eventsRouter } from "./events.ts";
import { foldersRouter } from "./folders.ts";
import { googleCalendarCallback } from "./google-callback.ts";
import { googleLoginCallback, googleLoginStart } from "./auth-google.ts";
import { integrationsRouter } from "./integrations.ts";
import { jobsRouter } from "./jobs.ts";
import { meRouter } from "./me.ts";
import { recordingsRouter } from "./recordings.ts";
import { createSearchRouter } from "./search.ts";
import { shareLinksRouter } from "./share-links.ts";
import { tagsRouter } from "./tags.ts";
import { digestPendingAssets } from "./store.ts";
import { sweepOrphanParts, uploadsRouter } from "./uploads.ts";
import { viewsRouter } from "./views.ts";
import { workspacesRouter } from "./workspaces.ts";

export { API_BASE_PATH };

export const RESOURCE_ROUTERS = [
  meRouter,
  authNativeRouter,
  workspacesRouter,
  foldersRouter,
  viewsRouter,
  tagsRouter,
  uploadsRouter,
  recordingsRouter,
  assetsRouter,
  documentsRouter,
  actionItemsRouter,
  jobsRouter,
  calendarRouter,
  integrationsRouter,
  shareLinksRouter,
  eventsRouter,
  adminRouter,
];

let openApiJson: string | null = null;

export interface ApiV2Options {
  /** The 물어보기 service (default: from the configuration; null while LECTERN_ASK is off). */
  askService?: () => AskService | null;
}

/** How often missing digests of migrated audio are computed (store.ts digestPendingAssets). */
const DIGEST_INTERVAL_MS = 5 * 60_000;
let backgroundStarted = false;

/** Upload leftovers and asset digests, once per process; timers never keep it alive. */
function startBackgroundWork(): void {
  if (backgroundStarted) return;
  backgroundStarted = true;
  try {
    sweepOrphanParts();
  } catch (err) {
    logger.error("could not sweep upload parts", { err });
  }
  const timer = setInterval(() => void digestPendingAssets().catch((err) => logger.error("asset digests failed", { err })), DIGEST_INTERVAL_MS);
  timer.unref?.();
}

export function createApiV2App(options: ApiV2Options = {}) {
  const v2 = new Hono<V2Env>();
  startBackgroundWork();

  // Lecture writes that bypassed db.ts (compaction) are projected before any v2 read.
  v2.use("*", async (_c, next) => {
    syncPendingLectures();
    await next();
  });

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
  v2.route("/", createAskRouter(options.askService ?? askService));
  v2.route("/", createSearchRouter(options.askService ?? askService));

  // Google's redirect back after the calendar consent (P4-02): a browser navigation, outside
  // the domain route table.
  v2.get("/integrations/google/callback", googleCalendarCallback);
  // "Google로 계속하기" (P5-04): browser navigations too.
  v2.get("/auth/google/start", googleLoginStart);
  v2.get("/auth/google/callback", googleLoginCallback);

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
