// Sign in with Apple, web flow (P5-05, CONTRACTS D-P5-5): authorization code with
// response_mode=form_post, and a client secret that is an ES256 JWT this server signs with
// the `.p8` key (5 minutes, made per request). Plain fetch, no SDK.
//
// Never log or put into an error message: the code, the state, the client secret, the key,
// tokens, or a response body.

import { existsSync, readFileSync } from "node:fs";
import { config, readSecret } from "@lectern/config";
import { API_BASE_PATH } from "@lectern/domain";
import { importP8, signEs256Jwt } from "./es256.ts";

export const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_ISSUER = "https://appleid.apple.com";
const CLIENT_SECRET_TTL_SEC = 300;

export class AppleAuthError extends Error {
  constructor(readonly code: "unauthorized" | "transient" | "config") {
    super(`Sign in with Apple failed: ${code}`);
    this.name = "AppleAuthError";
  }
}

/** The Services ID, team, key id and key file; null when any is missing or the file does not exist. */
export function appleSigninConfig(): { clientId: string; teamId: string; keyId: string; keyFile: string } | null {
  const clientId = readSecret("APPLE_SIGNIN_CLIENT_ID");
  const teamId = readSecret("APPLE_SIGNIN_TEAM_ID");
  const keyId = readSecret("APPLE_SIGNIN_KEY_ID");
  const keyFile = config().appleSignin.privateKeyFile;
  if (!clientId || !teamId || !keyId || !keyFile || !existsSync(keyFile)) return null;
  return { clientId, teamId, keyId, keyFile };
}

export function appleRedirectUri(): string {
  return `${config().baseUrl.replace(/\/+$/, "")}${API_BASE_PATH}/auth/apple/callback`;
}

function requireConfig() {
  const conf = appleSigninConfig();
  if (!conf) throw new AppleAuthError("config");
  return conf;
}

export async function appleClientSecret(now = Date.now()): Promise<string> {
  const conf = requireConfig();
  let key: CryptoKey;
  try {
    key = await importP8(readFileSync(conf.keyFile, "utf8"));
  } catch {
    throw new AppleAuthError("config");
  }
  const iat = Math.floor(now / 1000);
  return signEs256Jwt(
    key,
    { alg: "ES256", kid: conf.keyId },
    { iss: conf.teamId, iat, exp: iat + CLIENT_SECRET_TTL_SEC, aud: APPLE_ISSUER, sub: conf.clientId },
  );
}

export function appleAuthorizationUrl(p: { clientId: string; redirectUri: string; state: string; nonce: string }): string {
  const url = new URL(APPLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state: p.state,
    nonce: p.nonce,
  }).toString();
  return url.toString();
}

/** Trades the code for tokens; only the ID token is used (no Apple token is kept). */
export async function exchangeAppleCode(code: string, redirectUri: string): Promise<{ id_token: string }> {
  const conf = requireConfig();
  const form = {
    client_id: conf.clientId,
    client_secret: await appleClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  };
  let res: Response;
  try {
    res = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppleAuthError("transient");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AppleAuthError(res.status === 429 || res.status >= 500 ? "transient" : "unauthorized");
  if (typeof body.id_token !== "string") throw new AppleAuthError("unauthorized");
  return { id_token: body.id_token };
}
