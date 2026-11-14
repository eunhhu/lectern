import { ensurePersonalWorkspace, personalWorkspaceId, sha256Hex } from "@lectern/db";
import { extractAuthToken } from "../../auth.ts";
import { db, deleteSession, getUserById, updateUserProfile, type UserRecord } from "../../db.ts";
import { sessionIdOf, sessionMetaOf } from "../../session-meta.ts";
import { roleIn } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok, okPage, type V2Request } from "./common.ts";
import { iso, meDto } from "./rows.ts";

function meOf(user: UserRecord) {
  // Safety net for accounts created by code paths that bypass createUser().
  if (!roleIn(user.id, personalWorkspaceId(user.id))) ensurePersonalWorkspace(db, user.id, Date.parse(user.created_at) || Date.now());
  return meDto(user, personalWorkspaceId(user.id));
}

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
// Their device name, user agent and last use come from auth_session_meta (P5-01, D-P5-2).
// Sessions from before it have no row: null names, and last_seen_at is the sign-in time.
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
    const meta = sessionMetaOf(user.id);
    return okPage(
      req,
      sessionsOf(user.id).map((s) => {
        const m = meta.get(sessionIdOf(s.token));
        return {
          id: sessionIdOf(s.token),
          workspace_id: personalWorkspaceId(user.id),
          user_id: user.id,
          client: "web",
          device_name: m?.deviceName ?? null,
          user_agent: m?.userAgent ?? null,
          created_at: toIso(s.created_at),
          last_seen_at: m ? iso(m.lastSeenAt) : toIso(s.created_at),
          expires_at: toIso(s.expires_at),
          revoked_at: null,
          current: s.token === current,
        };
      })
    );
  },
  revokeDevice: (req) => {
    const session = sessionsOf(req.user!.id).find((s) => sessionIdOf(s.token) === req.params.device_id);
    if (!session) return notFound(req, "기기");
    deleteSession(session.token); // with its auth_session_meta row
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
