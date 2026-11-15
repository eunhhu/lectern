// "Apple로 계속하기" (P5-05, CONTRACTS D-P5-5): the web flow of Sign in with Apple. The same
// account rules as Google sign-in (oauth/login.ts), with three differences: the client secret
// is an ES256 JWT this server signs, the callback is a POST from Apple (response_mode
// form_post), and the e-mail may be Apple's relay address (used as it is).
//
// GET  /auth/apple/start?next=/app/...  → Apple's consent page
// POST /auth/apple/callback             → 303 to `next` with a session cookie, or to Settings
//                                         when linking (a user was signed in at start)
//
// The callback is a cross-site POST from appleid.apple.com, so the SameSite=Lax session
// cookie does not come with it: the user is never read from a cookie there. The protection is
// the state (single use, 10 minutes, also the ID token's nonce) and, when the browser sends
// one, an Origin of appleid.apple.com. Nothing from the form or the token response reaches
// the logs, and no Apple token is kept.

import type { Context } from "hono";
import { config } from "@lectern/config";
import { APPLE_ISSUER, APPLE_JWKS_URL, appleAuthorizationUrl, appleRedirectUri, appleSigninConfig, exchangeAppleCode } from "../../apple/signin.ts";
import { authenticateRequest } from "../../auth.ts";
import { createSession, getUserById, recordAuditLog, touchUserLastLogin } from "../../db.ts";
import { consumeOAuthState, createOAuthState } from "../../google/oauth.ts";
import { logger } from "../../log.ts";
import { JwtError, verifyJwt, type JwtClaims } from "../../oauth/jwt.ts";
import { completeOAuthLogin, linkIdentity, safeNext, sessionCookieHeader } from "../../oauth/login.ts";
import { recordSessionMeta } from "../../session-meta.ts";
import { apiError, type V2Env } from "./common.ts";

const APPLE_ORIGIN = "https://appleid.apple.com";
const MAX_FORM_BYTES = 64 * 1024;

const notFound = (c: Context<V2Env>) => apiError(c, 404, "not_found", "API 경로를 찾을 수 없습니다.");

/** After a POST the browser must GET the next page: every answer is a 303. */
function seeOther(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

const fail = (error = "oauth") => seeOther(`/app/login?error=${encodeURIComponent(error)}`);

/** "김선우" from Apple's first-login `user` field (last name first); null when it has no name. */
export function appleDisplayName(userField: string | null): string | null {
  if (!userField) return null;
  try {
    const name = (JSON.parse(userField) as { name?: { firstName?: unknown; lastName?: unknown } }).name;
    const part = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const full = `${part(name?.lastName)}${part(name?.firstName)}`;
    return full || null;
  } catch {
    return null;
  }
}

export function appleLoginStart(c: Context<V2Env>): Response {
  if (!config().appleLogin) return notFound(c);
  const conf = appleSigninConfig();
  if (!conf) return apiError(c, 501, "not_implemented", "Apple 로그인은 아직 준비 중입니다.");
  // Signed in already: this links Apple to the account instead (Settings › 계정).
  const user = authenticateRequest(c.req.raw);
  const state = createOAuthState({
    userId: user?.id ?? null,
    workspaceId: null,
    purpose: "apple_login",
    verifier: null,
    redirectAfter: safeNext(c.req.query("next")),
  });
  const location = appleAuthorizationUrl({ clientId: conf.clientId, redirectUri: appleRedirectUri(), state, nonce: state });
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

// A cross-site form_post from appleid.apple.com: no session cookie arrives, and none is
// needed. It is protected by the single-use state (and the Origin when present).
export async function appleLoginCallback(c: Context<V2Env>): Promise<Response> {
  if (!config().appleLogin) return notFound(c);
  const conf = appleSigninConfig();
  if (!conf) return apiError(c, 501, "not_implemented", "Apple 로그인은 아직 준비 중입니다.");

  const text = await c.req.text();
  if (text.length > MAX_FORM_BYTES) return fail();
  const form = new URLSearchParams(text);
  const code = form.get("code");
  const state = form.get("state");
  // The state goes either way: a denied or broken callback still uses it up.
  const data = state ? consumeOAuthState(state, "apple_login") : null;
  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== APPLE_ORIGIN) {
    logger.warn("apple login failed", { step: "origin" });
    return fail();
  }
  if (form.has("error") || !code || !state || !data) return fail();

  let claims: JwtClaims;
  try {
    const { id_token } = await exchangeAppleCode(code, appleRedirectUri());
    claims = await verifyJwt(id_token, { jwksUrl: APPLE_JWKS_URL, issuers: [APPLE_ISSUER], audience: conf.clientId, nonce: state });
  } catch (err) {
    const reason = err instanceof JwtError ? err.reason : ((err as { code?: string }).code ?? "unknown");
    logger.warn("apple login failed", { step: err instanceof JwtError ? "id_token" : "exchange", reason });
    return fail();
  }
  const email = typeof claims.email === "string" ? claims.email : null;
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";

  // Linking: the state was made by this user while signed in (no cookie comes with the POST).
  if (data.userId) {
    const owner = getUserById(data.userId);
    if (!owner) return fail();
    const result = linkIdentity(owner.id, { provider: "apple", subject: claims.sub, email });
    logger.info("apple identity link", { user_id: owner.id, result });
    return seeOther(`/app/settings?identity=${result}#account`);
  }

  const result = completeOAuthLogin({
    provider: "apple",
    subject: claims.sub,
    email,
    emailVerified,
    displayName: appleDisplayName(form.get("user")),
  });
  if ("error" in result) {
    logger.warn("apple login refused", { reason: result.error });
    return fail(result.error);
  }
  const user = getUserById(result.userId)!;
  touchUserLastLogin(user.id);
  const token = createSession(user.id);
  recordSessionMeta(token, user.id, c.req.raw);
  recordAuditLog({ actorId: user.id, actorEmail: user.email, action: "auth.login", detail: "Apple 로그인 성공" });
  return seeOther(safeNext(data.redirectAfter), [sessionCookieHeader(token)]);
}
