// Google OAuth 2.0 for the calendar connection (P4-02, CONTRACTS D-P4-3): authorization code
// with PKCE, offline access, one scope (calendar.app.created). Plain fetch, no SDK. P5's
// Google sign-in reuses the state store and the token calls.
//
// Never log or put into an error message: the authorization code, the state, tokens, or a
// response body (it can echo them).

import { createHash, randomBytes } from "node:crypto";
import { config, readSecret } from "@lectern/config";
import { sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { db } from "../db.ts";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

/** How long a started authorization may take before its state expires. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export type GoogleAuthErrorCode = "invalid_grant" | "unauthorized" | "transient" | "config";

export class GoogleAuthError extends Error {
  constructor(
    readonly code: GoogleAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** The OAuth client from the environment (read live), or null when either value is missing. */
export function googleClient(): { clientId: string; clientSecret: string } | null {
  const clientId = readSecret("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = readSecret("GOOGLE_OAUTH_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The calendar callback URL: the same string goes to the authorization request and the exchange. */
export function calendarRedirectUri(): string {
  return `${config().baseUrl.replace(/\/+$/, "")}${API_BASE_PATH}/integrations/google/callback`;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizationUrl(p: { clientId: string; redirectUri: string; scope: string; state: string; challenge: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: p.scope,
    access_type: "offline",
    prompt: "consent",
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function requireClient(): { clientId: string; clientSecret: string } {
  const client = googleClient();
  if (!client) throw new GoogleAuthError("config", "Google OAuth client is not configured");
  return client;
}

/** POSTs a form to the token endpoint and classifies failures without echoing the body. */
async function tokenRequest(form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new GoogleAuthError("transient", "Google token endpoint unreachable");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return body;
  if (body.error === "invalid_grant") throw new GoogleAuthError("invalid_grant", "Google rejected the grant");
  if (res.status === 401) throw new GoogleAuthError("unauthorized", "Google rejected the client");
  if (res.status === 429 || res.status >= 500) throw new GoogleAuthError("transient", `Google token endpoint answered ${res.status}`);
  throw new GoogleAuthError("unauthorized", `Google token endpoint answered ${res.status}`);
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export async function exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<TokenResponse> {
  const client = requireClient();
  const body = await tokenRequest({
    code: p.code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
    code_verifier: p.verifier,
  });
  if (typeof body.access_token !== "string") throw new GoogleAuthError("transient", "Google token response has no access token");
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expires_in: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scope: typeof body.scope === "string" ? body.scope : "",
    id_token: typeof body.id_token === "string" ? body.id_token : undefined,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const client = requireClient();
  const body = await tokenRequest({
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
  });
  if (typeof body.access_token !== "string") throw new GoogleAuthError("transient", "Google token response has no access token");
  return { access_token: body.access_token, expires_in: typeof body.expires_in === "number" ? body.expires_in : 3600 };
}

/** Asks Google to revoke a token. Best effort: never throws (disconnecting must not fail on it). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // The grant stays until the user removes it in their Google account; nothing to do here.
  }
}

/** True when a granted scope list (space-separated) includes `scope`. */
export function hasScope(granted: string, scope: string): boolean {
  return granted.split(/\s+/).includes(scope);
}

// ---------------------------------------------------------------------------
// State (oauth_state): CSRF protection and the PKCE verifier between start and callback.
// ---------------------------------------------------------------------------

export type OAuthPurpose = "google_calendar" | "google_login" | "apple_login";

export interface OAuthStateData {
  userId: string | null;
  workspaceId: string | null;
  verifier: string | null;
  redirectAfter: string | null;
}

/** Stores a new state (its hash only) and returns the raw value for the authorization URL. */
export function createOAuthState(p: {
  userId: string | null;
  workspaceId: string | null;
  purpose: OAuthPurpose;
  verifier: string | null;
  redirectAfter: string | null;
}): string {
  const state = base64url(randomBytes(32));
  const now = Date.now();
  db.query(
    `INSERT INTO oauth_state (state_hash, user_id, workspace_id, purpose, code_verifier, redirect_after, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256Hex(state), p.userId, p.workspaceId, p.purpose, p.verifier, p.redirectAfter, now, now + OAUTH_STATE_TTL_MS);
  return state;
}

interface OAuthStateRow {
  user_id: string | null;
  workspace_id: string | null;
  purpose: string;
  code_verifier: string | null;
  redirect_after: string | null;
  expires_at: number;
}

/**
 * Takes a state out of the store: the row is deleted in the same statement that reads it, so
 * a state works once even under concurrent callbacks. Null when it is unknown, expired or for
 * another purpose. Expired rows are swept on the way.
 */
export function consumeOAuthState(state: string, purpose: OAuthPurpose): OAuthStateData | null {
  const now = Date.now();
  db.query(`DELETE FROM oauth_state WHERE expires_at <= ?`).run(now);
  if (!state) return null;
  const row = db.query(`DELETE FROM oauth_state WHERE state_hash = ? RETURNING *`).get(sha256Hex(state)) as OAuthStateRow | null;
  if (!row || row.expires_at <= now || row.purpose !== purpose) return null;
  return { userId: row.user_id, workspaceId: row.workspace_id, verifier: row.code_verifier, redirectAfter: row.redirect_after };
}
