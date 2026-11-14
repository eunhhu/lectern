// GET /api/v2/integrations/google/callback (P4-02, CONTRACTS §4): where Google sends the
// browser back after the calendar consent. A cookie-authenticated top-level navigation, not
// a domain route, so it answers with redirects into the web app instead of JSON.
//
// The state is single use, bound to the user who started, and checked before any token
// request. Nothing from the query (code, state) or the token response reaches the logs.

import type { Context } from "hono";
import { config } from "@lectern/config";
import { uuidv7 } from "@lectern/db";
import { authenticateRequest } from "../../auth.ts";
import { enqueueCalendarSync } from "../../calendar/sync-job.ts";
import { db } from "../../db.ts";
import { createCalendar } from "../../google/calendar.ts";
import {
  CALENDAR_SCOPE,
  calendarRedirectUri,
  consumeOAuthState,
  exchangeCode,
  hasScope,
  revokeToken,
  type TokenResponse,
} from "../../google/oauth.ts";
import { forgetAccessToken, sealGoogleTokens } from "../../google/tokens.ts";
import { logger } from "../../log.ts";
import { roleIn } from "./access.ts";
import type { V2Env } from "./common.ts";

export const DEFAULT_RETURN = "/app/settings#integrations";
const ERROR_LOCATION = "/app/settings?google=error#integrations";
const LOGIN_LOCATION = "/app/login";
const ORIGIN = "http://lectern.invalid";

/**
 * `redirectAfter` with `google=connected` added, when it is a same-origin path (`/x`, not
 * `//host` or `/\host`); otherwise the settings page. The query goes before the fragment.
 */
export function connectedLocation(redirectAfter: string | null): string {
  let target = new URL(DEFAULT_RETURN, ORIGIN);
  if (redirectAfter && /^\/[^/\\]/.test(redirectAfter)) {
    try {
      const parsed = new URL(redirectAfter, ORIGIN);
      if (parsed.origin === ORIGIN) target = parsed;
    } catch {
      // keep the default
    }
  }
  target.searchParams.set("google", "connected");
  return `${target.pathname}${target.search}${target.hash}`;
}

interface ExistingIntegration {
  id: string;
  calendar_id: string | null;
}

export async function googleCalendarCallback(c: Context<V2Env>): Promise<Response> {
  const user = authenticateRequest(c.req.raw);
  if (!user) return c.redirect(LOGIN_LOCATION, 302);
  const fail = () => c.redirect(ERROR_LOCATION, 302);

  const query = new URL(c.req.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");
  // The state goes either way: a denied or broken callback still uses it up.
  const data = state ? consumeOAuthState(state, "google_calendar") : null;
  if (!config().calendar || query.has("error") || !code || !data) return fail();
  if (data.userId !== user.id || !data.workspaceId || !data.verifier) return fail();
  const workspaceId = data.workspaceId;
  if (!roleIn(user.id, workspaceId)) return fail();

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCode({ code, verifier: data.verifier, redirectUri: calendarRedirectUri() });
  } catch (err) {
    logger.warn("google calendar connect failed", { step: "exchange", user_id: user.id, error_code: (err as { code?: string }).code ?? "unknown" });
    return fail();
  }

  // Google's granular consent lets the user untick the calendar scope; without a refresh
  // token nothing could sync later. Either way the grant is useless: revoke it.
  const refreshToken = tokens.refresh_token;
  const problem = !refreshToken ? "no_refresh_token" : !hasScope(tokens.scope, CALENDAR_SCOPE) ? "scope_not_granted" : null;
  if (problem || !refreshToken) {
    await revokeToken(refreshToken ?? tokens.access_token);
    logger.warn("google calendar connect failed", { step: "grant", user_id: user.id, error_code: problem });
    return fail();
  }

  try {
    const existing = db
      .query(`SELECT id, calendar_id FROM integration WHERE workspace_id = ? AND user_id = ? AND provider = 'google'`)
      .get(workspaceId, user.id) as ExistingIntegration | null;
    // Reconnecting (after needs_reauth) keeps the calendar it already made, so events stay in one place.
    const calendarId = existing?.calendar_id ?? (await createCalendar(tokens.access_token, user.timezone || "Asia/Seoul"));
    const now = Date.now();
    const integrationId = existing?.id ?? uuidv7(now);
    if (existing) {
      db.query(
        `UPDATE integration SET scopes_json = ?, token_enc = ?, calendar_id = ?, status = 'active', updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify([CALENDAR_SCOPE]), sealGoogleTokens({ refresh_token: refreshToken }), calendarId, now, existing.id);
      forgetAccessToken(existing.id);
    } else {
      db.query(
        `INSERT INTO integration (id, workspace_id, user_id, provider, scopes_json, token_enc, calendar_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'google', ?, ?, ?, 'active', ?, ?)`,
      ).run(integrationId, workspaceId, user.id, JSON.stringify([CALENDAR_SCOPE]), sealGoogleTokens({ refresh_token: refreshToken }), calendarId, now, now);
    }
    // Events accepted before connecting (or while it needed reauth) go in now (P4-03).
    enqueueCalendarSync(integrationId);
  } catch (err) {
    // Leave no grant behind that no integration row points at.
    await revokeToken(refreshToken);
    const status = (err as { status?: number }).status;
    logger.warn("google calendar connect failed", {
      step: "store",
      user_id: user.id,
      error: err instanceof Error ? err.name : "unknown",
      ...(status === undefined ? {} : { status }),
    });
    return fail();
  }

  logger.info("google calendar connected", { user_id: user.id, workspace_id: workspaceId });
  return c.redirect(connectedLocation(data.redirectAfter), 302);
}
