import { config } from "@lectern/config";
import { uuidv7 } from "@lectern/db";
import { db } from "../../db.ts";
import {
  acceptInvite,
  createInvite,
  getInvite,
  inviteMail,
  normalizeEmail,
  pendingInvites,
  type AcceptError,
  type InviteRole,
  type InviteRow,
} from "../../invites.ts";
import { logger } from "../../log.ts";
import { sendMail } from "../../mail.ts";
import { authRateLimits, tooManyRequestsMessage } from "../../rate-limit.ts";
import { syncRemindersForWorkspace } from "../../reminders.ts";
import { quotaOf, refreshLedger } from "../../usage.ts";
import { callerIn, requireWorkspace, type WorkspaceRole } from "./access.ts";
import { apiError, defineRouter, forbidden, notFound, notImplemented, ok, okPage, type V2Request } from "./common.ts";
import { membershipDto, workspaceDto, type MembershipRow, type WorkspaceRow } from "./rows.ts";
import { transact } from "./store.ts";

const MAX_PENDING_INVITES = 50;
const LAST_OWNER = "owner가 한 명은 있어야 합니다. 다른 멤버를 먼저 owner로 지정해 주세요.";
const ADMIN_LIMIT = "관리자는 owner나 다른 관리자의 역할을 바꾸거나 내보낼 수 없습니다.";

const isoOrNull = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function inviteDto(i: InviteRow) {
  return {
    id: i.id,
    workspace_id: i.workspace_id,
    email: i.email,
    role: i.role,
    invited_by: i.invited_by,
    created_at: new Date(i.created_at).toISOString(),
    expires_at: new Date(i.expires_at).toISOString(),
    accepted_at: isoOrNull(i.accepted_at),
    revoked_at: isoOrNull(i.revoked_at),
  };
}

type MemberRow = MembershipRow & { display_name: string; email: string };

function memberRow(workspaceId: string, userId: string): MemberRow | null {
  return db
    .query(`SELECT m.*, u.display_name, u.email FROM membership m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?`)
    .get(workspaceId, userId) as MemberRow | null;
}

const memberDto = (m: MemberRow) => ({ ...membershipDto(m), display_name: m.display_name, email: m.email });

const ownerCount = (workspaceId: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM membership WHERE workspace_id = ? AND role = 'owner'`).get(workspaceId) as { n: number }).n;

/** The team workspace of a P5-06 route, or the response (501 with LECTERN_TEAMS off, 404 unknown). */
function teamRoute(req: V2Request): WorkspaceRow | Response {
  if (!config().teams) return notImplemented(req);
  const workspace = workspaceRow(String(req.params.workspace_id));
  return workspace ?? notFound(req, "워크스페이스");
}

const ACCEPT_ERRORS: Record<AcceptError, [number, "not_found" | "conflict" | "forbidden", string]> = {
  invalid: [404, "not_found", "초대를 찾을 수 없습니다. 이미 사용했거나 취소된 초대입니다."],
  revoked: [404, "not_found", "초대를 찾을 수 없습니다. 이미 사용했거나 취소된 초대입니다."],
  used: [404, "not_found", "초대를 찾을 수 없습니다. 이미 사용했거나 취소된 초대입니다."],
  expired: [409, "conflict", "만료된 초대입니다. 다시 초대해 달라고 요청해 주세요."],
  email_mismatch: [403, "forbidden", "이 초대는 다른 이메일 주소로 보낸 것입니다. 초대받은 주소로 로그인해 주세요."],
};

/**
 * The stored settings with `patch` laid over them (shallow, P4-04): sending one key keeps the
 * others. A key whose value is null is removed.
 */
export function mergeSettings(storedJson: string, patch: Record<string, unknown>): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(storedJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    // unreadable settings are replaced by the patch
  }
  const merged: Record<string, unknown> = { ...stored, ...patch };
  for (const [key, value] of Object.entries(merged)) if (value === null || value === undefined) delete merged[key];
  return merged;
}

function workspaceRow(id: string): WorkspaceRow | null {
  return db.query(`SELECT * FROM workspace WHERE id = ?`).get(id) as WorkspaceRow | null;
}

export const workspacesRouter = defineRouter({
  listWorkspaces: (req) => {
    const rows = db
      .query(
        `SELECT w.*, m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
         WHERE m.user_id = ? ORDER BY w.kind = 'personal' DESC, w.created_at, w.id`
      )
      .all(req.user!.id) as Array<WorkspaceRow & { role: string }>;
    // A personal access token sees only the workspace it was made for.
    const visible = req.pat ? rows.filter((w) => w.id === req.pat!.workspaceId) : rows;
    return okPage(req, visible.map((w) => ({ workspace: workspaceDto(w), role: w.role })));
  },
  // A team workspace owned by the caller. Inviting members is P5 (ARCHITECTURE §10).
  createWorkspace: (req) => {
    const { name } = req.body as { name: string };
    const id = uuidv7();
    const now = Date.now();
    transact(() => {
      db.query(
        `INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at)
         VALUES (?, ?, 'team', 'free', '{}', NULL, ?, ?)`
      ).run(id, name.trim(), now, now);
      db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)`).run(
        id,
        req.user!.id,
        now,
        now
      );
    });
    return ok(req, workspaceDto(workspaceRow(id)!), { status: 201 });
  },
  getWorkspace: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id);
    if (caller instanceof Response) return caller;
    return ok(req, workspaceDto(workspace));
  },
  updateWorkspace: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id, "workspace:update");
    if (caller instanceof Response) return caller;
    const body = req.body as { name?: string; settings?: Record<string, unknown> };
    db.query(`UPDATE workspace SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?`).run(
      body.name?.trim() || workspace.name,
      body.settings ? JSON.stringify(mergeSettings(workspace.settings_json, body.settings)) : workspace.settings_json,
      Date.now(),
      workspace.id
    );
    if (body.settings && "reminders" in body.settings) syncRemindersForWorkspace(workspace.id);
    return ok(req, workspaceDto(workspaceRow(workspace.id)!));
  },
  listWorkspaceMembers: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id);
    if (caller instanceof Response) return caller;
    const rows = db
      .query(
        `SELECT m.*, u.display_name, u.email FROM membership m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? ORDER BY m.created_at, m.user_id`
      )
      .all(workspace.id) as Array<MembershipRow & { display_name: string; email: string }>;
    return okPage(
      req,
      rows.map((m) => ({ ...membershipDto(m), display_name: m.display_name, email: m.email }))
    );
  },
  // Team workspaces (P5-06, D-P5-6): invitations and members. LECTERN_TEAMS=1 only.
  listInvites: (req) => {
    const workspace = teamRoute(req);
    if (workspace instanceof Response) return workspace;
    const caller = requireWorkspace(req, workspace.id, "member:manage");
    if (caller instanceof Response) return caller;
    return okPage(req, pendingInvites(workspace.id).map(inviteDto));
  },
  createInvite: async (req) => {
    const workspace = teamRoute(req);
    if (workspace instanceof Response) return workspace;
    const caller = requireWorkspace(req, workspace.id, "member:manage");
    if (caller instanceof Response) return caller;
    const body = req.body as { email: string; role: InviteRole };
    if (workspace.kind === "personal") return apiError(req.c, 409, "conflict", "개인 워크스페이스에는 초대할 수 없습니다.");
    if (body.role === "admin" && caller.role !== "owner") return apiError(req.c, 403, "forbidden", "관리자로 초대하는 것은 owner만 할 수 있습니다.");
    const email = normalizeEmail(body.email);
    const member = db
      .query(`SELECT 1 FROM membership m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND lower(u.email) = ?`)
      .get(workspace.id, email);
    if (member) return apiError(req.c, 409, "conflict", "이미 이 워크스페이스의 멤버입니다.");
    // A live invitation to the same address is replaced (counted once).
    const pending = pendingInvites(workspace.id).filter((i) => i.email !== email);
    if (pending.length >= MAX_PENDING_INVITES) return apiError(req.c, 409, "conflict", "대기 중인 초대가 너무 많습니다.");

    const user = req.user!;
    const invite = createInvite({ workspaceId: workspace.id, email, role: body.role, invitedBy: user.id });
    const mail = inviteMail({
      workspaceName: workspace.name,
      inviterName: user.display_name?.trim() || user.email.split("@")[0] || user.email,
      role: body.role,
      token: invite.token,
    });
    try {
      await sendMail({ to: email, ...mail });
    } catch (err) {
      // No mail, no invitation: the link exists nowhere else.
      db.query(`DELETE FROM workspace_invite WHERE id = ?`).run(invite.id);
      logger.warn("workspace invite mail failed", { workspace_id: workspace.id, error: err instanceof Error ? err.name : "unknown" });
      return apiError(req.c, 503, "unavailable", "초대 메일을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    db.query(
      `UPDATE workspace_invite SET revoked_at = ? WHERE workspace_id = ? AND email = ? AND id != ? AND accepted_at IS NULL AND revoked_at IS NULL`
    ).run(Date.now(), workspace.id, email, invite.id);
    logger.info("workspace invite sent", { workspace_id: workspace.id, invite_id: invite.id, role: body.role });
    return ok(req, inviteDto(getInvite(invite.id)!), { status: 201 });
  },
  revokeInvite: (req) => {
    const workspace = teamRoute(req);
    if (workspace instanceof Response) return workspace;
    const caller = requireWorkspace(req, workspace.id, "member:manage");
    if (caller instanceof Response) return caller;
    const revoked = db
      .query(`UPDATE workspace_invite SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`)
      .run(Date.now(), String(req.params.invite_id), workspace.id).changes;
    if (!revoked) return notFound(req, "초대");
    return req.c.body(null, 204);
  },
  acceptInvite: (req) => {
    if (!config().teams) return notImplemented(req);
    const user = req.user!;
    const limiter = authRateLimits.inviteAcceptUser;
    const wait = limiter.retryAfterSec(user.id);
    if (wait) {
      const res = apiError(req.c, 429, "rate_limited", tooManyRequestsMessage(wait));
      res.headers.set("Retry-After", String(wait));
      return res;
    }
    limiter.hit(user.id);
    const result = acceptInvite((req.body as { token: string }).token, { id: user.id, email: user.email });
    if ("error" in result) {
      const [status, code, message] = ACCEPT_ERRORS[result.error];
      return apiError(req.c, status, code, message);
    }
    logger.info("workspace invite accepted", { workspace_id: result.workspaceId, user_id: user.id });
    return ok(req, { workspace: workspaceDto(workspaceRow(result.workspaceId)!), role: result.role });
  },
  updateMember: (req) => {
    const workspace = teamRoute(req);
    if (workspace instanceof Response) return workspace;
    const caller = requireWorkspace(req, workspace.id, "member:manage");
    if (caller instanceof Response) return caller;
    const role = (req.body as { role: WorkspaceRole }).role;
    const targetId = String(req.params.user_id);
    // Checked and written in one transaction: no path leaves the workspace without an owner.
    const outcome = transact((): Response | MemberRow => {
      const target = memberRow(workspace.id, targetId);
      if (!target) return notFound(req, "멤버");
      if (caller.role !== "owner") {
        if (target.role === "owner" || target.role === "admin") return apiError(req.c, 403, "forbidden", ADMIN_LIMIT);
        if (role === "owner" || role === "admin") return apiError(req.c, 403, "forbidden", "owner만 owner나 관리자를 지정할 수 있습니다.");
      }
      if (target.role === "owner" && role !== "owner" && ownerCount(workspace.id) <= 1) return apiError(req.c, 409, "conflict", LAST_OWNER);
      if (target.role !== role) {
        db.query(`UPDATE membership SET role = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?`).run(role, Date.now(), workspace.id, targetId);
      }
      return memberRow(workspace.id, targetId)!;
    });
    if (outcome instanceof Response) return outcome;
    return ok(req, memberDto(outcome));
  },
  removeMember: (req) => {
    const workspace = teamRoute(req);
    if (workspace instanceof Response) return workspace;
    const targetId = String(req.params.user_id);
    const self = targetId === req.user!.id;
    // Anyone may leave; removing someone else is for owners and admins.
    const caller = self ? callerIn(req, workspace.id) : requireWorkspace(req, workspace.id, "member:manage");
    if (caller instanceof Response) return caller;
    if (!caller.role) return forbidden(req);
    const outcome = transact((): Response | null => {
      const target = memberRow(workspace.id, targetId);
      if (!target) return notFound(req, "멤버");
      if (!self && caller.role !== "owner" && (target.role === "owner" || target.role === "admin")) {
        return apiError(req.c, 403, "forbidden", ADMIN_LIMIT);
      }
      if (target.role === "owner" && ownerCount(workspace.id) <= 1) return apiError(req.c, 409, "conflict", LAST_OWNER);
      // Their recordings stay in the workspace (created_by is kept).
      db.query(`DELETE FROM membership WHERE workspace_id = ? AND user_id = ?`).run(workspace.id, targetId);
      return null;
    });
    if (outcome) return outcome;
    logger.info("workspace member removed", { workspace_id: workspace.id, user_id: targetId, by: req.user!.id });
    return req.c.body(null, 204);
  },
  // Any member. Refreshing the ledger here keeps the operator's list current too.
  getWorkspaceUsage: (req) => {
    const workspaceId = String(req.params.workspace_id);
    const caller = requireWorkspace(req, workspaceId);
    if (caller instanceof Response) return caller;
    return ok(req, { ...refreshLedger(workspaceId), quota: quotaOf(workspaceId) });
  },
});
