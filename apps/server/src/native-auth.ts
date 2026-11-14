// Native app sign-in (P5-03, CONTRACTS D-P5-4): an access token (1 hour) and a refresh token
// (60 days) per sign-in. A refresh is single use: it returns a new pair in the same family.
// A refresh token that comes back after it was used means it was copied: the whole family
// (every pair from that sign-in) is revoked. One native_session row is one pair; only the
// SHA-256 of each token is stored, never the token itself.

import { randomBytes } from "node:crypto";
import { sha256Hex, uuidv7 } from "@lectern/db";
import { db, revokeNativeSessionsOfUser } from "./db.ts";
import { logger } from "./log.ts";

export { revokeNativeSessionsOfUser };

export const ACCESS_PREFIX = "lct_at_";
export const REFRESH_PREFIX = "lct_rt_";
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60_000;
const TOUCH_MEMORY_LIMIT = 10_000;
// Revoked pairs are kept a day for the logs, then go.
const REVOKED_KEEP_MS = 24 * 60 * 60 * 1000;

/** expiresIn is in seconds (3600). */
export interface NativePair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface Row {
  id: string;
  user_id: string;
  family_id: string;
  device_name: string | null;
  platform: string | null;
  access_expires_at: number;
  refresh_expires_at: number;
  refresh_used_at: number | null;
  revoked_at: number | null;
}

const newToken = (prefix: string) => prefix + randomBytes(32).toString("base64url");

export function issueNativePair(p: { userId: string; deviceName?: string; platform?: string; familyId?: string }, now = Date.now()): NativePair {
  const accessToken = newToken(ACCESS_PREFIX);
  const refreshToken = newToken(REFRESH_PREFIX);
  db.query(
    `INSERT INTO native_session (id, user_id, family_id, device_name, platform, access_hash, access_expires_at, refresh_hash,
       refresh_expires_at, refresh_used_at, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)`
  ).run(
    uuidv7(),
    p.userId,
    p.familyId ?? uuidv7(),
    p.deviceName ?? null,
    p.platform ?? null,
    sha256Hex(accessToken),
    now + ACCESS_TTL_MS,
    sha256Hex(refreshToken),
    now + REFRESH_TTL_MS,
    now
  );
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
}

type RotateResult = { pair: NativePair; userId: string } | { error: "invalid" | "reused" | "expired" };

/** Trades a refresh token for a new pair. A reused one revokes its family. */
export function rotateNativePair(refreshToken: string, now = Date.now()): RotateResult {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) return { error: "invalid" };
  return db.transaction((): RotateResult => {
    const row = db.query(`SELECT * FROM native_session WHERE refresh_hash = ?`).get(sha256Hex(refreshToken)) as Row | null;
    if (!row || row.revoked_at !== null) return { error: "invalid" };
    if (row.refresh_used_at !== null) {
      db.query(`UPDATE native_session SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`).run(now, row.family_id);
      logger.warn("native refresh token reused: sign-in revoked", { family_id: row.family_id });
      return { error: "reused" };
    }
    if (row.refresh_expires_at <= now) return { error: "expired" };
    // The old pair ends now: its refresh is spent and its access token stops working.
    db.query(`UPDATE native_session SET refresh_used_at = ?, access_expires_at = MIN(access_expires_at, ?) WHERE id = ?`).run(now, now, row.id);
    lastTouches.delete(row.id);
    const pair = issueNativePair(
      { userId: row.user_id, familyId: row.family_id, deviceName: row.device_name ?? undefined, platform: row.platform ?? undefined },
      now
    );
    return { pair, userId: row.user_id };
  })();
}

/** Signs the app out: revokes the family of this refresh token. Unknown tokens are ignored. */
export function revokeNativeFamilyByRefresh(refreshToken: string, now = Date.now()): void {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) return;
  const row = db.query(`SELECT family_id FROM native_session WHERE refresh_hash = ?`).get(sha256Hex(refreshToken)) as { family_id: string } | null;
  if (!row) return;
  db.query(`UPDATE native_session SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`).run(now, row.family_id);
}

// When this process last wrote last_used_at for a pair: one write per 5 minutes at most.
const lastTouches = new Map<string, number>();

/** The user id of a live access token; null when unknown, revoked or expired. */
export function findUserByAccessToken(accessToken: string, now = Date.now()): string | null {
  if (!accessToken.startsWith(ACCESS_PREFIX)) return null;
  const row = db
    .query(`SELECT id, user_id, access_expires_at, revoked_at FROM native_session WHERE access_hash = ?`)
    .get(sha256Hex(accessToken)) as Pick<Row, "id" | "user_id" | "access_expires_at" | "revoked_at"> | null;
  if (!row || row.revoked_at !== null || row.access_expires_at <= now) return null;
  const last = lastTouches.get(row.id);
  if (last === undefined || now - last >= TOUCH_EVERY_MS) {
    if (lastTouches.size >= TOUCH_MEMORY_LIMIT) lastTouches.clear();
    lastTouches.set(row.id, now);
    db.query(`UPDATE native_session SET last_used_at = ? WHERE id = ?`).run(now, row.id);
  }
  return row.user_id;
}

/** Drops pairs whose refresh token has expired, and revoked pairs after a day (maintenance). */
export function pruneNativeSessions(now = Date.now()): number {
  return db
    .query(`DELETE FROM native_session WHERE refresh_expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)`)
    .run(now, now - REVOKED_KEEP_MS).changes;
}
