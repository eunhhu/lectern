// "Google로 계속하기" (P5-04, CONTRACTS D-P5-5): OIDC authorization code with PKCE. Browser
// navigations outside the domain route table, so they answer with redirects, not JSON.
//
// GET /auth/google/start?next=/app/...  → Google's consent page
// GET /auth/google/callback             → a session cookie and `next` (sign-in), or back to
//                                         Settings (linking, when a user was signed in at start)
//
// The state is single use, carries the PKCE verifier and doubles as the ID token's nonce. It
// is also bound to the browser that started (a short cookie with its hash), so nobody can
// finish their own sign-in in someone else's browser. Nothing from the query or the token
// response (code, state, tokens, ID token) reaches the logs. Sign-in keeps no Google token.

import type { Context } from "hono";
import { config } from "@lectern/config";
import { sha256Hex } from "@lectern/db";
import { API_BASE_PATH } from "@lectern/domain";
import { authenticateRequest } from "../../auth.ts";
import { createSession, getUserById, recordAuditLog, touchUserLastLogin } from "../../db.ts";
import {
  authorizationUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeCode,
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
  googleClient,
  LOGIN_SCOPE,
  loginRedirectUri,
  newPkce,
  OAUTH_STATE_TTL_MS,
} from "../../google/oauth.ts";
import { logger } from "../../log.ts";
import { JwtError, verifyJwt, type JwtClaims } from "../../oauth/jwt.ts";
import { completeOAuthLogin, linkIdentity, safeNext, sessionCookieHeader } from "../../oauth/login.ts";
import { recordSessionMeta } from "../../session-meta.ts";
import { apiError, type V2Env } from "./common.ts";

const BROWSER_COOKIE = "lectern_oauth";
const BROWSER_COOKIE_PATH = `${API_BASE_PATH}/auth/`;

const loginError = (error: string) => `/app/login?error=${encodeURIComponent(error)}`;

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function browserCookie(value: string, maxAgeSec: number): string {
  const secure = !config().baseUrl.toLowerCase().startsWith("http://");
  return `${BROWSER_COOKIE}=${value}; Path=${BROWSER_COOKIE_PATH}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAgeSec}`;
}

const browserMark = (state: string) => sha256Hex(`browser:${state}`).slice(0, 43);

/** True when this browser started the sign-in with this state. */
function sameBrowser(c: Context<V2Env>, state: string): boolean {
  const cookie = c.req.header("cookie") ?? "";
  const found = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === BROWSER_COOKIE);
  return !!found && found.slice(1).join("=") === browserMark(state);
}

const notFound = (c: Context<V2Env>) => apiError(c, 404, "not_found", "API 경로를 찾을 수 없습니다.");

export function googleLoginStart(c: Context<V2Env>): Response {
  if (!config().googleLogin) return notFound(c);
  const client = googleClient();
  if (!client) return notFound(c);
  // Signed in already: this links Google to the account instead (Settings › 계정).
  const user = authenticateRequest(c.req.raw);
  const pkce = newPkce();
  const state = createOAuthState({
    userId: user?.id ?? null,
    workspaceId: null,
    purpose: "google_login",
    verifier: pkce.verifier,
    redirectAfter: safeNext(c.req.query("next")),
  });
  const location = authorizationUrl({
    clientId: client.clientId,
    redirectUri: loginRedirectUri(),
    scope: LOGIN_SCOPE,
    state,
    challenge: pkce.challenge,
    offline: false,
    nonce: state,
  });
  return redirect(location, [browserCookie(browserMark(state), Math.floor(OAUTH_STATE_TTL_MS / 1000))]);
}

export async function googleLoginCallback(c: Context<V2Env>): Promise<Response> {
  if (!config().googleLogin) return notFound(c);
  const client = googleClient();
  if (!client) return notFound(c);
  const clearBrowser = browserCookie("", 0);
  const fail = (error = "oauth") => redirect(loginError(error), [clearBrowser]);

  const query = new URL(c.req.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");
  // The state goes either way: a denied or broken callback still uses it up.
  const data = state ? consumeOAuthState(state, "google_login") : null;
  if (query.has("error") || !code || !state || !data?.verifier) return fail();
  if (!sameBrowser(c, state)) {
    logger.warn("google login failed", { step: "browser" });
    return fail();
  }

  let claims: JwtClaims;
  try {
    const tokens = await exchangeCode({ code, verifier: data.verifier, redirectUri: loginRedirectUri() });
    if (!tokens.id_token) throw new JwtError("malformed");
    claims = await verifyJwt(tokens.id_token, { jwksUrl: GOOGLE_JWKS_URL, issuers: GOOGLE_ISSUERS, audience: client.clientId, nonce: state });
  } catch (err) {
    const reason = err instanceof JwtError ? err.reason : ((err as { code?: string }).code ?? "unknown");
    logger.warn("google login failed", { step: err instanceof JwtError ? "id_token" : "exchange", reason });
    return fail();
  }
  const email = typeof claims.email === "string" ? claims.email : null;
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";

  // Linking: the user who started must still be the one signed in.
  if (data.userId) {
    const current = authenticateRequest(c.req.raw);
    if (!current || current.id !== data.userId) return fail();
    const result = linkIdentity(current.id, { provider: "google", subject: claims.sub, email });
    logger.info("google identity link", { user_id: current.id, result });
    return redirect(`/app/settings?identity=${result}#account`, [clearBrowser]);
  }

  const result = completeOAuthLogin({
    provider: "google",
    subject: claims.sub,
    email,
    emailVerified,
    displayName: typeof claims.name === "string" ? claims.name : null,
  });
  if ("error" in result) {
    logger.warn("google login refused", { reason: result.error });
    return fail(result.error);
  }
  const user = getUserById(result.userId)!;
  touchUserLastLogin(user.id);
  const token = createSession(user.id);
  recordSessionMeta(token, user.id, c.req.raw);
  recordAuditLog({ actorId: user.id, actorEmail: user.email, action: "auth.login", detail: "Google 로그인 성공" });
  return redirect(safeNext(data.redirectAfter), [sessionCookieHeader(token), clearBrowser]);
}
