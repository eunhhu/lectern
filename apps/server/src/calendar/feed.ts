// The ICS subscription store (P4-01, CONTRACTS §4 `calendar_feed`, D-0-7). One active feed
// per user and workspace; only the token's SHA-256 is stored, so the URL is shown once on
// create and never again. Recreating revokes the old URL in the same transaction.

import { randomBytes } from "node:crypto";
import { config } from "@lectern/config";
import { sha256Hex, uuidv7 } from "@lectern/db";
import { transact } from "../api/v2/store.ts";
import { db } from "../db.ts";
import type { IcsEvent } from "./ics.ts";

/** Token in the URL: 32 random bytes, base64url (43 characters). */
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

const feedUrl = (token: string) => `${config().baseUrl.replace(/\/+$/, "")}/cal/${token}.ics`;

export function createFeed(userId: string, workspaceId: string): { url: string; createdAt: number } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  transact(() => {
    db.query(`UPDATE calendar_feed SET revoked_at = ? WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL`).run(
      now,
      userId,
      workspaceId,
    );
    db.query(`INSERT INTO calendar_feed (id, user_id, workspace_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)`).run(
      uuidv7(now),
      userId,
      workspaceId,
      sha256Hex(token),
      now,
    );
  });
  return { url: feedUrl(token), createdAt: now };
}

export function getFeed(userId: string, workspaceId: string): { exists: boolean; createdAt: number | null } {
  const row = db
    .query(`SELECT created_at FROM calendar_feed WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get(userId, workspaceId) as { created_at: number } | null;
  return { exists: row !== null, createdAt: row?.created_at ?? null };
}

export function deleteFeed(userId: string, workspaceId: string): void {
  db.query(`UPDATE calendar_feed SET revoked_at = ? WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL`).run(
    Date.now(),
    userId,
    workspaceId,
  );
}

/** The active feed a token opens, or null (unknown and revoked look the same). */
export function feedByToken(token: string): { userId: string; workspaceId: string } | null {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const row = db
    .query(`SELECT user_id, workspace_id FROM calendar_feed WHERE token_hash = ? AND revoked_at IS NULL`)
    .get(sha256Hex(token)) as { user_id: string; workspace_id: string } | null;
  return row ? { userId: row.user_id, workspaceId: row.workspace_id } : null;
}

interface FeedEventRow {
  id: string;
  title: string;
  start_at: number;
  end_at: number | null;
  all_day: number;
  tz: string;
  updated_at: number;
  recording_title: string;
}

/**
 * The events the feed shows: accepted or synced candidates of the workspace whose recording
 * the user may read (shared, or their own private one). Nothing once they left the workspace.
 */
export function feedEvents(userId: string, workspaceId: string): IcsEvent[] {
  const member = db.query(`SELECT 1 FROM membership WHERE workspace_id = ? AND user_id = ?`).get(workspaceId, userId);
  if (!member) return [];
  const rows = db
    .query(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.tz, e.updated_at, r.title AS recording_title
       FROM event_candidate e JOIN recording r ON r.id = e.recording_id
       WHERE e.workspace_id = ? AND r.workspace_id = ? AND e.status IN ('accepted', 'synced')
         AND (r.visibility = 'workspace' OR r.created_by = ?)
       ORDER BY e.start_at, e.id`,
    )
    .all(workspaceId, workspaceId, userId) as FeedEventRow[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: Boolean(r.all_day),
    tz: r.tz,
    updatedAt: r.updated_at,
    recordingTitle: r.recording_title || null,
  }));
}
