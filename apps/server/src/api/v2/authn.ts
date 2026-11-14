// Authentication of /api/v2 requests, in one place (P5-02). A request carries a web session
// (the `lectern_session` cookie), the v1 API token, or a personal access token (`lct_pat_…`,
// D-P5-3). PATs open only API v2: auth.ts authenticateRequest, which the v1 routes use, does
// not know them, because v1 has no scope checks. P5-03 adds native access tokens here.

import { findActivePat, PAT_PREFIX, touchPat, type PatRow } from "../../access-tokens.ts";
import { extractAuthToken, resolveActiveUser } from "../../auth.ts";
import { getUserById, type UserRecord } from "../../db.ts";
import { logger } from "../../log.ts";

export interface V2Auth {
  user: UserRecord;
  via: "session" | "api_token" | "pat";
  pat?: PatRow;
}

export function authenticateV2(req: Request): V2Auth | null {
  const token = extractAuthToken(req, new URL(req.url))?.trim();
  if (!token) return null;
  if (token.startsWith(PAT_PREFIX)) {
    const pat = findActivePat(token);
    if (!pat) return null;
    const user = getUserById(pat.userId);
    if (!user || user.status === "suspended" || user.status === "pending") return null;
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
