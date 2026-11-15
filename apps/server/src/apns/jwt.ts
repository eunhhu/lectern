// The APNs provider token (CONTRACTS D-P6-2): an ES256 JWT signed with the team's `.p8` key.
// Apple refuses tokens older than an hour and throttles fresh ones made more often than every
// 20 minutes, so one token is reused for 50 minutes. Never log the key or a token.

import { existsSync, readFileSync } from "node:fs";
import { config, readSecret } from "@lectern/config";
import { importP8, signEs256Jwt } from "../apple/es256.ts";

export const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;

export interface ApnsAuth {
  teamId: string;
  keyId: string;
  keyFile: string;
}

/** The team, key id and key file; null when LECTERN_APNS is off or any of them is missing. */
export function apnsAuth(): ApnsAuth | null {
  const conf = config().apns;
  if (!conf.enabled) return null;
  const teamId = readSecret("APNS_TEAM_ID");
  const keyId = readSecret("APNS_KEY_ID");
  const keyFile = conf.privateKeyFile;
  if (!teamId || !keyId || !keyFile || !existsSync(keyFile)) return null;
  return { teamId, keyId, keyFile };
}

const keys = new Map<string, Promise<CryptoKey>>();
const tokens = new Map<string, { token: string; issuedAt: number }>();

/** The key file is read once per path. */
function signingKey(keyFile: string): Promise<CryptoKey> {
  let key = keys.get(keyFile);
  if (!key) {
    key = importP8(readFileSync(keyFile, "utf8"));
    keys.set(keyFile, key);
    key.catch(() => keys.delete(keyFile)); // a bad file is read again next time
  }
  return key;
}

/** A provider token, reused per key id for 50 minutes. */
export async function apnsProviderToken(auth: ApnsAuth, now = Date.now()): Promise<string> {
  const cached = tokens.get(auth.keyId);
  if (cached && now - cached.issuedAt < APNS_TOKEN_TTL_MS && now >= cached.issuedAt) return cached.token;
  const token = await signEs256Jwt(await signingKey(auth.keyFile), { alg: "ES256", kid: auth.keyId }, { iss: auth.teamId, iat: Math.floor(now / 1000) });
  tokens.set(auth.keyId, { token, issuedAt: now });
  return token;
}

/** Drops the cached token (Apple answered ExpiredProviderToken) or everything (tests). */
export function resetApnsTokenCache(keyId?: string): void {
  if (keyId) {
    tokens.delete(keyId);
    return;
  }
  tokens.clear();
  keys.clear();
}
