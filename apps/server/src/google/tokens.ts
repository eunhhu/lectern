// A Google integration's tokens (P4-02, D-0-8, D-P4-6). The refresh token is sealed with the
// host key (secrets.ts) in integration.token_enc; access tokens live only in this process's
// memory until a minute before they expire. A grant Google no longer accepts, or a sealed
// value this host can no longer open (the host key was replaced), marks the integration
// `needs_reauth` so the web app offers "다시 연결".

import { db } from "../db.ts";
import { openSecret, sealSecret } from "../secrets.ts";
import { GoogleAuthError, refreshAccessToken } from "./oauth.ts";

export interface GoogleTokens {
  refresh_token: string;
}

export function sealGoogleTokens(t: GoogleTokens): string {
  return sealSecret(JSON.stringify({ refresh_token: t.refresh_token }));
}

/** The sealed tokens, or null when the value is malformed or sealed under another host key. */
export function openGoogleTokens(tokenEnc: string | null | undefined): GoogleTokens | null {
  const plain = openSecret(tokenEnc);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === "string" && parsed.refresh_token ? { refresh_token: parsed.refresh_token } : null;
  } catch {
    return null;
  }
}

/** Refresh a cached access token this long before Google's expiry. */
const EXPIRY_MARGIN_MS = 60_000;
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

/** Drops the cached access token (new grant, disconnect, needs_reauth). */
export function forgetAccessToken(integrationId: string): void {
  accessTokens.delete(integrationId);
}

export function markNeedsReauth(integrationId: string): void {
  forgetAccessToken(integrationId);
  db.query(`UPDATE integration SET status = 'needs_reauth', updated_at = ? WHERE id = ?`).run(Date.now(), integrationId);
}

/**
 * A usable access token for the integration. Refreshes when the cached one is missing or
 * near expiry. Throws GoogleAuthError("invalid_grant") — after marking the integration
 * `needs_reauth` — when the grant is gone or the sealed token cannot be opened.
 */
export async function accessTokenFor(integrationId: string): Promise<string> {
  const cached = accessTokens.get(integrationId);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.token;

  const row = db.query(`SELECT token_enc, status FROM integration WHERE id = ?`).get(integrationId) as
    | { token_enc: string; status: string }
    | null;
  if (!row) throw new Error(`integration ${integrationId} not found`);
  if (row.status === "needs_reauth") throw new GoogleAuthError("invalid_grant", "integration needs to be connected again");
  const tokens = openGoogleTokens(row.token_enc);
  if (!tokens) {
    markNeedsReauth(integrationId);
    throw new GoogleAuthError("invalid_grant", "sealed Google token cannot be opened on this host");
  }
  try {
    const fresh = await refreshAccessToken(tokens.refresh_token);
    accessTokens.set(integrationId, { token: fresh.access_token, expiresAt: Date.now() + fresh.expires_in * 1000 });
    return fresh.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "invalid_grant") markNeedsReauth(integrationId);
    throw err;
  }
}
