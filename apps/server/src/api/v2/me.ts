import { existsSync } from "node:fs";
import { ensurePersonalWorkspace, personalWorkspaceId, sha256Hex, uuidv7 } from "@lectern/db";
import { extractAuthToken } from "../../auth.ts";
import { db, deleteSession, getUserById, updateUserProfile, type UserRecord } from "../../db.ts";
import { countActivePats, createPat, listPats, revokePat, type PatRow } from "../../access-tokens.ts";
import { EXPORT_JOB_KIND, exportFilePath, getExport, type DataExportRow } from "../../export/job.ts";
import { hasOwnPassword } from "../../oauth/login.ts";
import { enqueueJob } from "../../queue.ts";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXPORTS_PER_DAY = 5;
const MAX_LISTED_EXPORTS = 20;

function exportDto(e: DataExportRow) {
  return {
    id: e.id,
    workspace_id: e.workspace_id,
    include_audio: e.include_audio === 1,
    state: e.state,
    bytes: e.bytes,
    requested_at: iso(e.requested_at),
    ready_at: isoOrNull(e.ready_at),
    expires_at: isoOrNull(e.expires_at),
    error: e.error,
  };
}

/** "20261115": the date in Seoul, for the download's file name. */
const seoulDate = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");

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
  // Google and Apple sign-in methods linked to the account (P5-04, D-P5-1).
  listIdentities: (req) => {
    const rows = db
      .query(`SELECT id, provider, email, created_at FROM oauth_identity WHERE user_id = ? ORDER BY created_at, id`)
      .all(req.user!.id) as Array<{ id: string; provider: string; email: string | null; created_at: number }>;
    return okPage(req, rows.map((r) => ({ id: r.id, provider: r.provider, email: r.email, created_at: iso(r.created_at) })));
  },
  unlinkIdentity: (req) => {
    const user = getUserById(req.user!.id) ?? req.user!;
    const identity = db.query(`SELECT id FROM oauth_identity WHERE id = ? AND user_id = ?`).get(String(req.params.identity_id), user.id);
    if (!identity) return notFound(req, "로그인 수단");
    const others = (db.query(`SELECT COUNT(*) AS n FROM oauth_identity WHERE user_id = ? AND id != ?`).get(user.id, String(req.params.identity_id)) as { n: number }).n;
    // The last way in stays: without another identity the account needs a password of its own.
    if (others === 0 && !hasOwnPassword(user)) {
      return apiError(req.c, 409, "conflict", "마지막 로그인 수단은 연결을 해제할 수 없습니다. 먼저 비밀번호를 설정해 주세요.");
    }
    db.query(`DELETE FROM oauth_identity WHERE id = ? AND user_id = ?`).run(String(req.params.identity_id), user.id);
    return req.c.body(null, 204);
  },
  // A workspace export zip (D-P5-8), built by the `export` job. One at a time per user, at
  // most 5 a day; only the user who asked can list or download it.
  createExport: (req) => {
    const user = req.user!;
    const body = req.body as { workspace_id: string; include_audio: boolean };
    const caller = requireWorkspace(req, body.workspace_id);
    if (caller instanceof Response) return caller;
    const now = Date.now();
    const busy = db.query(`SELECT 1 FROM data_export WHERE user_id = ? AND state IN ('queued', 'running')`).get(user.id);
    if (busy) return apiError(req.c, 409, "conflict", "이미 만들고 있는 내보내기가 있습니다.");
    const today = (db.query(`SELECT COUNT(*) AS n FROM data_export WHERE user_id = ? AND requested_at > ?`).get(user.id, now - DAY_MS) as { n: number }).n;
    if (today >= MAX_EXPORTS_PER_DAY) return apiError(req.c, 409, "conflict", "내보내기는 하루에 5번까지 만들 수 있습니다.");
    const id = uuidv7(now);
    // One transaction: a row without its job would hold the one-at-a-time slot.
    db.transaction(() => {
      db.query(
        `INSERT INTO data_export (id, user_id, workspace_id, include_audio, state, blob_key, bytes, requested_at, ready_at, expires_at, error)
         VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, NULL, NULL, NULL)`
      ).run(id, user.id, body.workspace_id, body.include_audio ? 1 : 0, now);
      enqueueJob({ kind: EXPORT_JOB_KIND, ownerId: user.id, subjectId: id, maxAttempts: 2 });
    })();
    return ok(req, exportDto(getExport(id)!), { status: 202 });
  },
  listExports: (req) => {
    const rows = db
      .query(`SELECT * FROM data_export WHERE user_id = ? ORDER BY requested_at DESC, id DESC LIMIT ?`)
      .all(req.user!.id, MAX_LISTED_EXPORTS) as DataExportRow[];
    return ok(req, { items: rows.map(exportDto), next_cursor: null });
  },
  getExportContent: (req) => {
    const row = getExport(String(req.params.export_id));
    if (!row || row.user_id !== req.user!.id) return notFound(req, "내보내기");
    if (row.state !== "ready") return apiError(req.c, 409, "conflict", "아직 준비되지 않았거나 만료된 내보내기입니다.");
    const path = exportFilePath(row.blob_key);
    const file = path ? Bun.file(path) : null;
    if (!path || !existsSync(path) || !file) return notFound(req, "내보내기 파일");
    return new Response(file.stream(), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename="lectern-export-${seoulDate(row.ready_at ?? row.requested_at)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  requestAccountDeletion: notImplemented,
  cancelAccountDeletion: notImplemented,
  getAccountDeletion: notImplemented,
});
