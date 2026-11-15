// Cross-site request forgery defence for writes authenticated by the session cookie
// (SECURITY-REVIEW.md finding 1). AGENTS.md: by Origin / Sec-Fetch-Site, never a custom
// header (the web UI sends none). SameSite=Lax already keeps the cookie off a cross-site POST
// in current browsers, but not off one from a sibling subdomain (same-site) or from a client
// that ignores SameSite. Token requests (Authorization, X-Lectern-Token, ?token=) are not
// affected: a browser never attaches those by itself.
//
// API v2 runs this in its own middleware (api/v2/index.ts, v2 error shape); http.ts runs it
// for every other path (the v1 routes, the old admin console, the share page).

import { config } from "@lectern/config";
import { authTokenSource } from "./auth.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_SITE_MESSAGE = "다른 사이트에서 보낸 요청은 받지 않습니다.";

export interface CrossSiteRefusal {
  /** The request's Sec-Fetch-Site, or null when the browser sent none. */
  site: string | null;
  origin: string | null;
}

/**
 * Why `req` must be refused, or null when it may go on.
 *
 * Only a write (not GET/HEAD/OPTIONS) whose credential is the session cookie is checked:
 * - `Sec-Fetch-Site`, when present, decides: `same-origin` and `none` pass, `same-site` and
 *   `cross-site` do not. Browsers set it and pages cannot change it.
 * - Otherwise (a browser too old to send it) `Origin` must be this server's own origin as the
 *   request reached it, or the public origin (`LECTERN_BASE_URL`; behind the proxy the
 *   request URL is plain http). `Origin: null` is refused.
 * - With neither header the request did not come from a web page (curl, scripts, tests):
 *   browsers send `Origin` on every cross-origin write.
 */
export function crossSiteCookieWrite(req: Request): CrossSiteRefusal | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  const url = new URL(req.url);
  if (authTokenSource(req, url) !== "cookie") return null;
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? null;
  const origin = req.headers.get("origin")?.trim() ?? null;
  if (site !== null) return site === "same-origin" || site === "none" ? null : { site, origin };
  if (origin === null) return null;
  return origin === url.origin || origin === publicOrigin() ? null : { site, origin };
}

function publicOrigin(): string | null {
  try {
    return new URL(config().baseUrl).origin;
  } catch {
    return null;
  }
}
