import { ensurePersonalWorkspace, personalWorkspaceId, sha256Hex } from "@lectern/db";
import { extractAuthToken } from "../../auth.ts";
import { db, deleteSession, getUserById, updateUserProfile, type UserRecord } from "../../db.ts";
import { countActivePats, createPat, listPats, revokePat, type PatRow } from "../../access-tokens.ts";
import { sessionIdOf, sessionMetaOf } from "../../session-meta.ts";
import { requireWorkspace, roleIn } from "./access.ts";
import { apiError, defineRouter, notFound, notImplemented, ok, okPage, type V2Request } from "./common.ts";
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

const MAX_LIVE_TOKENS = 20;

const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));

function patDto(t: PatRow) {
  return {
    id: t.id,
    workspace_id: t.workspaceId,
    user_id: t.userId,
    name: t.name,
    prefix: t.tokenPrefix,
    scopes: t.scopes,
    expires_at: isoOrNull(t.expiresAt),
    last_used_at: isoOrNull(t.lastUsedAt),
    created_at: iso(t.createdAt),
    revoked_at: isoOrNull(t.revokedAt),
  };
}

/** The id the v1 API token is listed under. */
const v1TokenId = (user: UserRecord) => `tok_${sha256Hex(user.api_token).slice(0, 32)}`;

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
  // The v1 API token (one per account, rotated in the v1 settings) comes first, then the
  // personal access tokens (P5-02, D-P5-3), newest first. Secrets are never listed.
  listAccessTokens: (req) => {
    const user = getUserById(req.user!.id) ?? req.user!;
    return okPage(req, [
      {
        id: v1TokenId(user),
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
      ...listPats(user.id).map(patDto),
    ]);
  },
  createAccessToken: (req) => {
    const body = req.body as { workspace_id: string; name: string; scopes: string[]; expires_at?: string | null };
    const user = req.user!;
    const caller = requireWorkspace(req, body.workspace_id);
    if (caller instanceof Response) return caller;
    const name = body.name.trim();
    if (!name) return apiError(req.c, 400, "bad_request", "토큰 이름을 입력해 주세요.");
    const expiresAt = body.expires_at ? Date.parse(body.expires_at) : null;
    if (expiresAt !== null && expiresAt <= Date.now()) return apiError(req.c, 400, "bad_request", "만료 시각은 지금보다 뒤여야 합니다.");
    if (countActivePats(user.id) >= MAX_LIVE_TOKENS) {
      return apiError(req.c, 409, "conflict", `액세스 토큰은 ${MAX_LIVE_TOKENS}개까지 만들 수 있습니다.`);
    }
    const { row, secret } = createPat({ userId: user.id, workspaceId: body.workspace_id, name, scopes: body.scopes, expiresAt });
    return ok(req, { token: patDto(row), secret }, { status: 201 });
  },
  revokeAccessToken: (req) => {
    const user = getUserById(req.user!.id) ?? req.user!;
    const id = String(req.params.token_id);
    if (id === v1TokenId(user)) {
      return apiError(req.c, 409, "conflict", "이 토큰은 여기서 회수할 수 없습니다. 예전 설정 화면에서 다시 발급해 주세요.");
    }
    if (!revokePat(user.id, id)) return notFound(req, "토큰");
    return req.c.body(null, 204);
  },
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
