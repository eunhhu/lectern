import { ensurePersonalWorkspace, personalWorkspaceId, sha256Hex } from "@lectern/db";
import { extractAuthToken } from "../../auth.ts";
import { db, getUserById, updateUserProfile, type UserRecord } from "../../db.ts";
import { roleIn } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok, okPage, type V2Request } from "./common.ts";
import { iso, meDto } from "./rows.ts";

function meOf(user: UserRecord) {
  // Safety net for accounts created by code paths that bypass createUser().
  if (!roleIn(user.id, personalWorkspaceId(user.id))) ensurePersonalWorkspace(db, user.id, Date.parse(user.created_at) || Date.now());
  return meDto(user, personalWorkspaceId(user.id));
}

/** A login session's public id: never the session token itself. */
const deviceIdOf = (token: string) => `ses_${sha256Hex(token).slice(0, 32)}`;

interface SessionRow {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

function sessionsOf(userId: string): SessionRow[] {
  return (db.query(`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as SessionRow[]).filter(
    (s) => Date.parse(s.expires_at) > Date.now()
  );
}

const toIso = (text: string) => {
  const t = Date.parse(text);
  return Number.isFinite(t) ? iso(t) : iso(0);
};

function currentToken(req: V2Request): string | null {
  return extractAuthToken(req.c.req.raw, new URL(req.c.req.url));
}

// Devices are the v1 login sessions (web cookies; native apps use the API token, below).
// The v1 schema records no device name, user agent or last use (ARCHITECTURE §10 adds
// them with auth_session in P5), so those are null and last_seen_at is the sign-in time.
export const meRouter = defineRouter({
  getMe: (req) => ok(req, meOf(req.user!)),
  updateMe: (req) => {
    const body = req.body as { display_name?: string; timezone?: string };
    const updated = updateUserProfile(req.user!.id, { displayName: body.display_name, timezone: body.timezone });
    return ok(req, meOf(updated ?? req.user!));
  },
  listDevices: (req) => {
    const user = req.user!;
    const current = currentToken(req);
    return okPage(
      req,
      sessionsOf(user.id).map((s) => ({
        id: deviceIdOf(s.token),
        workspace_id: personalWorkspaceId(user.id),
        user_id: user.id,
        client: "web",
        device_name: null,
        user_agent: null,
        created_at: toIso(s.created_at),
        last_seen_at: toIso(s.created_at),
        expires_at: toIso(s.expires_at),
        revoked_at: null,
        current: s.token === current,
      }))
    );
  },
  revokeDevice: (req) => {
    const session = sessionsOf(req.user!.id).find((s) => deviceIdOf(s.token) === req.params.device_id);
    if (!session) return notFound(req, "기기");
    db.query(`DELETE FROM sessions WHERE token = ?`).run(session.token);
    return req.c.body(null, 204);
  },
  // The v1 API token (one per account, rotated in the v1 settings) is shown as the only
  // access token. Named, scoped personal access tokens come with P5.
  listAccessTokens: (req) => {
    const user = getUserById(req.user!.id) ?? req.user!;
    return okPage(req, [
      {
        id: `tok_${sha256Hex(user.api_token).slice(0, 32)}`,
        workspace_id: personalWorkspaceId(user.id),
        user_id: user.id,
        name: "API 토큰",
        prefix: user.api_token.slice(0, 8),
        scopes: ["recordings:read", "recordings:write"],
        expires_at: null,
        last_used_at: null,
        created_at: toIso(user.created_at),
        revoked_at: null,
      },
    ]);
  },
  createAccessToken: notImplemented,
  revokeAccessToken: notImplemented,
  // Accounts (P5-C contract; P5-01..P5-09 implement them).
  listIdentities: notImplemented,
  unlinkIdentity: notImplemented,
  createExport: notImplemented,
  listExports: notImplemented,
  getExportContent: notImplemented,
  requestAccountDeletion: notImplemented,
  cancelAccountDeletion: notImplemented,
  getAccountDeletion: notImplemented,
});
