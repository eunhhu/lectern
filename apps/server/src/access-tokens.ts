// Personal access tokens (P5-02, CONTRACTS D-P5-3): named, scoped, optionally expiring
// tokens a user makes in Settings for scripts and shortcuts. Each acts on one workspace only.
// The secret is shown once, when it is made; the server keeps its SHA-256 and its first 12
// characters (`lct_pat_` + 4, enough to tell tokens apart). The secret is never stored or
// logged. The v1 single API token (`users.api_token`) is separate and keeps working.

import { randomBytes } from "node:crypto";
import { personalWorkspaceId, sha256Hex, uuidv7 } from "@lectern/db";
import { db } from "./db.ts";

export const PAT_PREFIX = "lct_pat_";
const PREFIX_LENGTH = 12;
const TOUCH_EVERY_MS = 5 * 60_000;
const TOUCH_MEMORY_LIMIT = 10_000;

export interface PatRow {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  tokenPrefix: string;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

interface DbRow {
  id: string;
  user_id: string;
  name: string;
  scopes_json: string;
  token_prefix: string;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  revoked_at: number | null;
}

// access_token has no workspace_id column (contract DDL): the workspace is kept with the
// scopes, `{"scopes": [...], "workspace_id": "..."}`. A bare array is the user's personal
// workspace.
function toPat(row: DbRow): PatRow {
  let scopes: string[] = [];
  let workspaceId = personalWorkspaceId(row.user_id);
  try {
    const parsed = JSON.parse(row.scopes_json) as unknown;
    if (Array.isArray(parsed)) scopes = parsed.map(String);
    else if (parsed && typeof parsed === "object") {
      const p = parsed as { scopes?: unknown; workspace_id?: unknown };
      if (Array.isArray(p.scopes)) scopes = p.scopes.map(String);
      if (typeof p.workspace_id === "string" && p.workspace_id) workspaceId = p.workspace_id;
    }
  } catch {
    scopes = []; // unreadable: a token that can do nothing
  }
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId,
    name: row.name,
    scopes,
    tokenPrefix: row.token_prefix,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export function createPat(p: { userId: string; workspaceId: string; name: string; scopes: string[]; expiresAt: number | null }): {
  row: PatRow;
  secret: string;
} {
  const secret = PAT_PREFIX + randomBytes(32).toString("base64url");
  const row: DbRow = {
    id: uuidv7(),
    user_id: p.userId,
    name: p.name,
    scopes_json: JSON.stringify({ scopes: [...new Set(p.scopes)], workspace_id: p.workspaceId }),
    token_prefix: secret.slice(0, PREFIX_LENGTH),
    expires_at: p.expiresAt,
    last_used_at: null,
    created_at: Date.now(),
    revoked_at: null,
  };
  db.query(
    `INSERT INTO access_token (id, user_id, name, scopes_json, token_hash, token_prefix, expires_at, last_used_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`
  ).run(row.id, row.user_id, row.name, row.scopes_json, sha256Hex(secret), row.token_prefix, row.expires_at, row.created_at);
  return { row: toPat(row), secret };
}

/** The token for this secret, or null when unknown, revoked or expired. */
export function findActivePat(secret: string, now = Date.now()): PatRow | null {
  if (!secret.startsWith(PAT_PREFIX)) return null;
  const row = db.query(`SELECT * FROM access_token WHERE token_hash = ?`).get(sha256Hex(secret)) as DbRow | null;
  if (!row || row.revoked_at !== null) return null;
  if (row.expires_at !== null && row.expires_at <= now) return null;
  return toPat(row);
}

/** A user's tokens that are not revoked (expired ones included), newest first. */
export function listPats(userId: string): PatRow[] {
  const rows = db
    .query(`SELECT * FROM access_token WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`)
    .all(userId) as DbRow[];
  return rows.map(toPat);
}

/** Tokens that still work: neither revoked nor expired. */
export function countActivePats(userId: string, now = Date.now()): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM access_token WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .get(userId, now) as { n: number };
  return row.n;
}

/** Revokes one of the user's own tokens. False when there is no such live token of theirs. */
export function revokePat(userId: string, id: string, now = Date.now()): boolean {
  lastTouches.delete(id);
  return db.query(`UPDATE access_token SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(now, id, userId).changes > 0;
}

// When this process last wrote last_used_at for a token: one write per 5 minutes at most.
const lastTouches = new Map<string, number>();

export function touchPat(id: string, now = Date.now()): void {
  const last = lastTouches.get(id);
  if (last !== undefined && now - last < TOUCH_EVERY_MS) return;
  if (lastTouches.size >= TOUCH_MEMORY_LIMIT) lastTouches.clear();
  lastTouches.set(id, now);
  db.query(`UPDATE access_token SET last_used_at = ? WHERE id = ?`).run(now, id);
}
