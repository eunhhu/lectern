// Workspace invitations (P5-06, CONTRACTS D-P5-6): made with an e-mail and a role, sent as a
// mail link (/app/invite?token=…), valid 7 days. The person accepts after signing in with the
// invited address, which makes the membership. The token travels in the mail only (D-0-7):
// the server keeps its SHA-256, and neither the API nor the logs ever show it.

import { randomBytes } from "node:crypto";
import { config } from "@lectern/config";
import { escapeHtml } from "@lectern/core";
import { sha256Hex, uuidv7 } from "@lectern/db";
import { db } from "./db.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRole = "admin" | "member" | "viewer";

export interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: InviteRole;
  token_hash: string;
  invited_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  accepted_by: string | null;
  revoked_at: number | null;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function createInvite(p: { workspaceId: string; email: string; role: InviteRole; invitedBy: string }, now = Date.now()): {
  id: string;
  token: string;
  expiresAt: number;
} {
  const token = randomBytes(32).toString("base64url");
  const id = uuidv7(now);
  const expiresAt = now + INVITE_TTL_MS;
  db.query(
    `INSERT INTO workspace_invite (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
  ).run(id, p.workspaceId, normalizeEmail(p.email), p.role, sha256Hex(token), p.invitedBy, now, expiresAt);
  return { id, token, expiresAt };
}

export function getInvite(id: string): InviteRow | null {
  return db.query(`SELECT * FROM workspace_invite WHERE id = ?`).get(id) as InviteRow | null;
}

export function findInviteByToken(token: string): InviteRow | null {
  return db.query(`SELECT * FROM workspace_invite WHERE token_hash = ?`).get(sha256Hex(token)) as InviteRow | null;
}

/** Invitations still waiting: not accepted, revoked or expired. */
export function pendingInvites(workspaceId: string, now = Date.now()): InviteRow[] {
  return db
    .query(
      `SELECT * FROM workspace_invite WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(workspaceId, now) as InviteRow[];
}

export type AcceptError = "invalid" | "expired" | "revoked" | "used" | "email_mismatch";

export function acceptInvite(token: string, user: { id: string; email: string }, now = Date.now()): { workspaceId: string; role: string } | { error: AcceptError } {
  return db.transaction((): { workspaceId: string; role: string } | { error: AcceptError } => {
    const invite = findInviteByToken(token);
    if (!invite) return { error: "invalid" };
    if (invite.revoked_at !== null) return { error: "revoked" };
    if (invite.accepted_at !== null) return { error: "used" };
    if (invite.expires_at <= now) return { error: "expired" };
    if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) return { error: "email_mismatch" };
    const member = db.query(`SELECT role FROM membership WHERE workspace_id = ? AND user_id = ?`).get(invite.workspace_id, user.id) as {
      role: string;
    } | null;
    // Already a member: the invitation is used up, the role stays as it is.
    if (!member) {
      db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        invite.workspace_id,
        user.id,
        invite.role,
        now,
        now
      );
    }
    db.query(`UPDATE workspace_invite SET accepted_at = ?, accepted_by = ? WHERE id = ?`).run(now, user.id, invite.id);
    return { workspaceId: invite.workspace_id, role: member?.role ?? invite.role };
  })();
}

const ROLE_LABEL: Record<string, string> = { admin: "관리자", member: "멤버", viewer: "보기 전용" };

export function inviteMail(p: { workspaceName: string; inviterName: string; role: string; token: string }): { subject: string; html: string } {
  const base = config().baseUrl.replace(/\/+$/, "");
  const link = `${base}/app/invite?token=${encodeURIComponent(p.token)}`;
  const role = ROLE_LABEL[p.role] ?? p.role;
  const subject = `[Lectern] ${p.inviterName}님이 "${p.workspaceName}" 워크스페이스에 초대했습니다`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 28px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; color: #111827;">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 20px; color: #111827;">Lectern</div>
      <p style="font-size: 15px; line-height: 24px; color: #111827; margin: 0 0 24px;">${escapeHtml(p.inviterName)}님이 Lectern의 "${escapeHtml(p.workspaceName)}" 워크스페이스에 ${escapeHtml(role)}(으)로 초대했습니다.</p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(link)}" style="display: inline-block; padding: 12px 20px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600;">초대 수락하기</a>
      </p>
      <p style="font-size: 13px; line-height: 20px; color: #4b5563; margin: 0 0 12px;">이 초대는 7일 동안 유효합니다. 초대를 받은 이메일 주소로 로그인해야 수락할 수 있습니다.</p>
      <p style="font-size: 12px; color: #9ca3af; margin: 0;">초대를 요청한 적이 없다면 이 메일을 무시해 주세요.</p>
    </div>
  `;
  return { subject, html };
}
