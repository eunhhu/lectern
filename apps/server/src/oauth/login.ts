// Signing in with Google or Apple (P5-04, CONTRACTS D-P5-1): finding, creating and linking
// the account behind a verified identity, and the session cookie. Shared by the Google and
// Apple callbacks (P5-05).
//
// D-P5-1: an identity already linked signs its user in. Otherwise the provider's e-mail must
// be verified: an account with that e-mail gets the identity, or a new account is made. An
// unverified e-mail never reaches an existing account.

import { randomBytes } from "node:crypto";
import { config } from "@lectern/config";
import { uuidv7 } from "@lectern/db";
import { createUser, db, getSystemSettings, getUserByEmail, getUserById, recordAuditLog, type UserRecord } from "../db.ts";

export type OAuthProvider = "google" | "apple";

export type OAuthLoginError = "email_unverified" | "no_email" | "inactive" | "signup_closed";

const SESSION_MAX_AGE_SEC = 30 * 86400;
const DEFAULT_NEXT = "/app";
const MAX_NEXT = 512;

/** `next` when it is a path on this site ("/x", not "//host" or "/\host"), else "/app". */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > MAX_NEXT) return DEFAULT_NEXT;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT;
  // Control characters (a CR/LF in a Location header) are never a real path.
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;
  return next;
}

/**
 * The `lectern_session` cookie, the one definition (the password login in index.ts uses it
 * too). Only a deployment explicitly served over plain http (local dev) drops `Secure`.
 */
export function sessionCookieHeader(token: string, maxAgeSec = SESSION_MAX_AGE_SEC): string {
  const secure = !config().baseUrl.toLowerCase().startsWith("http://");
  return `lectern_session=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAgeSec}`;
}

const isActive = (user: UserRecord) => user.status !== "suspended" && user.status !== "pending";

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  email: string | null;
  created_at: number;
}

function identityOf(provider: OAuthProvider, subject: string): IdentityRow | null {
  return db.query(`SELECT * FROM oauth_identity WHERE provider = ? AND subject = ?`).get(provider, subject) as IdentityRow | null;
}

function insertIdentity(userId: string, p: { provider: OAuthProvider; subject: string; email: string | null }): void {
  db.query(`INSERT OR IGNORE INTO oauth_identity (id, user_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    uuidv7(),
    userId,
    p.provider,
    p.subject,
    p.email,
    Date.now(),
  );
}

/** Links an identity to a signed-in user. "taken" when it already belongs to someone else. */
export function linkIdentity(userId: string, p: { provider: OAuthProvider; subject: string; email: string | null }): "linked" | "taken" {
  insertIdentity(userId, p);
  return identityOf(p.provider, p.subject)?.user_id === userId ? "linked" : "taken";
}

const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

export function completeOAuthLogin(p: {
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName?: string | null;
}): { userId: string; created: boolean } | { error: OAuthLoginError } {
  const known = identityOf(p.provider, p.subject);
  const knownUser = known ? getUserById(known.user_id) : null;
  if (knownUser) return isActive(knownUser) ? { userId: knownUser.id, created: false } : { error: "inactive" };

  const email = p.email?.trim().toLowerCase() || null;
  if (!email) return { error: "no_email" };
  if (!p.emailVerified) return { error: "email_unverified" };

  const existing = getUserByEmail(email);
  if (existing) {
    if (!isActive(existing)) return { error: "inactive" };
    if (linkIdentity(existing.id, { provider: p.provider, subject: p.subject, email }) !== "linked") return { error: "inactive" };
    return { userId: existing.id, created: false };
  }

  // A new account follows the sign-up rules of the operator settings, as /api/auth/register does.
  const settings = getSystemSettings();
  if (!settings.allow_public_signup) return { error: "signup_closed" };
  const status = settings.default_require_approval ? "pending" : "active";
  const name = p.displayName?.trim() || email.split("@")[0] || email;
  const user = createUser({
    email,
    displayName: name.slice(0, 100),
    // Nobody knows this password: the account signs in through the provider until the
    // user sets one with the password reset.
    password: randomBytes(64).toString("base64url"),
    role: settings.default_user_role,
    status,
    canIngest: settings.default_user_role !== "viewer",
    canShare: settings.default_user_role !== "viewer",
    canUseServerKey: settings.default_can_use_server_key,
    quotaMb: settings.default_quota_mb,
  });
  insertIdentity(user.id, { provider: p.provider, subject: p.subject, email });
  recordAuditLog({
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.register",
    detail: `${PROVIDER_LABEL[p.provider]} 계정으로 가입 (역할: ${user.role}, 상태: ${user.status})`,
  });
  if (status !== "active") return { error: "inactive" };
  return { userId: user.id, created: true };
}

/**
 * Whether the user has a password they chose. There is no column for it (v1 users table), so:
 * an account made by a provider sign-in (its first identity within 5 seconds of the account)
 * has none until a password reset is on record. Unknown is "no" (never strand an account).
 */
export function hasOwnPassword(user: UserRecord): boolean {
  const first = db.query(`SELECT MIN(created_at) AS at FROM oauth_identity WHERE user_id = ?`).get(user.id) as { at: number | null };
  const createdAt = Date.parse(user.created_at);
  const madeByProvider = first.at !== null && Number.isFinite(createdAt) && Math.abs(first.at - createdAt) <= 5_000;
  if (!madeByProvider) return true;
  const reset = db
    .query(`SELECT 1 FROM audit_logs WHERE target_id = ? AND action IN ('account.password_reset', 'account.password_change') LIMIT 1`)
    .get(user.id);
  return !!reset;
}
