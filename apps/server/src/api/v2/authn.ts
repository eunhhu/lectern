// Authentication of /api/v2 requests, in one place (P5-02). A request carries a web session
// (the `lectern_session` cookie), the v1 API token, or a personal access token (`lct_pat_…`,
// D-P5-3), or a native app access token (`lct_at_…`, D-P5-4). PATs and native tokens open
// only API v2: auth.ts authenticateRequest, which the v1 routes use, does not know them (v1
// has no scope checks). A native refresh token (`lct_rt_…`) never authenticates a request.

import { findActivePat, PAT_PREFIX, touchPat, type PatRow } from "../../access-tokens.ts";
import { extractAuthToken, resolveActiveUser } from "../../auth.ts";
import { getUserById, type UserRecord } from "../../db.ts";
import { logger } from "../../log.ts";
import { ACCESS_PREFIX, findUserByAccessToken, REFRESH_PREFIX } from "../../native-auth.ts";

export interface V2Auth {
  user: UserRecord;
  via: "session" | "api_token" | "pat" | "native";
  pat?: PatRow;
}

const isActive = (user: UserRecord | null): user is UserRecord => !!user && user.status !== "suspended" && user.status !== "pending";

export function authenticateV2(req: Request): V2Auth | null {
  const token = extractAuthToken(req, new URL(req.url))?.trim();
  if (!token) return null;
  if (token.startsWith(REFRESH_PREFIX)) return null;
  if (token.startsWith(ACCESS_PREFIX)) {
    const userId = findUserByAccessToken(token);
    const user = userId ? getUserById(userId) : null;
    return isActive(user) ? { user, via: "native" } : null;
  }
  if (token.startsWith(PAT_PREFIX)) {
    const pat = findActivePat(token);
    if (!pat) return null;
    const user = getUserById(pat.userId);
    if (!isActive(user)) return null;
    try {
      touchPat(pat.id);
    } catch (err) {
      logger.warn("access token touch failed", { token_id: pat.id, error: String(err) });
    }
    return { user, via: "pat", pat };
  }
  const user = resolveActiveUser(token);
  if (!user) return null;
  return { user, via: token.startsWith("ses_") ? "session" : "api_token" };
}
