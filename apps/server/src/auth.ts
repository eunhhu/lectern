// Request authentication shared by the legacy router (index.ts) and the API v2 routes
// (api/v2). A request carries a session token (the HttpOnly `lectern_session` cookie, web)
// or an API token (`Authorization: Bearer`, `X-Lectern-Token` or `?token=`, native
// clients and shortcuts); both resolve to the same user record.

import { getUserBySessionOrApiToken, type UserRecord } from "./db.ts";
import { logger } from "./log.ts";
import { touchSession } from "./session-meta.ts";

function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...v] = part.trim().split("=");
    if (k === "lectern_session") {
      return decodeURIComponent(v.join("=").trim());
    }
  }
  return null;
}

export function extractAuthToken(req: Request, url: URL): string | null {
  const authHeader = (req.headers.get("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const tok = authHeader.slice(7).trim();
    if (tok) return tok;
  }
  const xTok = (req.headers.get("x-lectern-token") || "").trim();
  if (xTok) return xTok;
  const qTok = (url.searchParams.get("token") || "").trim();
  if (qTok) return qTok;
  return parseSessionCookie(req.headers.get("cookie"));
}

/** Resolves a session or API token to a user allowed to act (not suspended or pending). */
export function resolveActiveUser(token: string | null | undefined): UserRecord | null {
  if (!token) return null;
  const user = getUserBySessionOrApiToken(token);
  if (!user) return null;
  if (user.status === "suspended" || user.status === "pending") {
    return null;
  }
  // A web session's last use, for Settings › 기기 (at most one write per 5 minutes). API
  // tokens are not sessions. Bookkeeping never fails the sign-in.
  if (token.trim().startsWith("ses_")) {
    try {
      touchSession(token.trim());
    } catch (err) {
      logger.warn("session touch failed", { error: String(err) });
    }
  }
  return user;
}

export function authenticateRequest(req: Request): UserRecord | null {
  return resolveActiveUser(extractAuthToken(req, new URL(req.url)));
}

export function isAdminUser(user: UserRecord | null): boolean {
  if (!user) return false;
  return (
    user.is_admin === 1 || user.role === "owner" || user.role === "admin"
  );
}
