// Device metadata of web login sessions (D-P5-2): a readable device name ("Mac의 Chrome"), the
// User-Agent and the last use, for Settings › 기기. The v1 `sessions` table stays as it is
// (D-0-4); this is a side table keyed by the session's public id, never by the token. No IP
// address is kept. Rows go with their session (db.ts deleteSession, deleteAllUserSessions).

import { db, sessionIdOf } from "./db.ts";

export { sessionIdOf };

const TOUCH_EVERY_MS = 5 * 60_000;
const TOUCH_MEMORY_LIMIT = 10_000;
const USER_AGENT_MAX = 512;

const DEVICES: Array<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
  [/CrOS/, "Chromebook"],
];

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Whale\//, "Whale"],
  [/SamsungBrowser\//, "삼성 인터넷"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

/** "Mac의 Chrome", "iPhone", "Firefox", or null. The first match wins (iPhone before Mac: its UA says "like Mac OS X"). */
export function deviceNameFromUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const device = DEVICES.find(([re]) => re.test(ua))?.[1] ?? null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (device && browser) return `${device}의 ${browser}`;
  return device ?? browser;
}

/** Records the device of a session just created (sign-in, sign-up). */
export function recordSessionMeta(token: string, userId: string, req: Request): void {
  const ua = req.headers.get("user-agent")?.slice(0, USER_AGENT_MAX) || null;
  const now = Date.now();
  db.query(
    `INSERT OR REPLACE INTO auth_session_meta (session_id, user_id, client_kind, device_name, user_agent, created_at, last_seen_at)
     VALUES (?, ?, 'web', ?, ?, ?, ?)`
  ).run(sessionIdOf(token), userId, deviceNameFromUserAgent(ua), ua, now, now);
}

// When this process last wrote last_seen_at for a session: one write per 5 minutes at most.
const lastWrites = new Map<string, number>();

/** Moves last_seen_at forward, at most once per 5 minutes per session. Sessions from before have no row and get none. */
export function touchSession(token: string, now = Date.now()): void {
  const id = sessionIdOf(token);
  const last = lastWrites.get(id);
  if (last !== undefined && now - last < TOUCH_EVERY_MS) return;
  if (lastWrites.size >= TOUCH_MEMORY_LIMIT) lastWrites.clear();
  lastWrites.set(id, now);
  db.query(`UPDATE auth_session_meta SET last_seen_at = ? WHERE session_id = ?`).run(now, id);
}

export function deleteSessionMeta(token: string): void {
  const id = sessionIdOf(token);
  lastWrites.delete(id);
  db.query(`DELETE FROM auth_session_meta WHERE session_id = ?`).run(id);
}

export function deleteSessionMetaOfUser(userId: string): void {
  db.query(`DELETE FROM auth_session_meta WHERE user_id = ?`).run(userId);
}

/** The metadata of a user's sessions, by session id. */
export function sessionMetaOf(userId: string): Map<string, { deviceName: string | null; userAgent: string | null; lastSeenAt: number }> {
  const rows = db
    .query(`SELECT session_id, device_name, user_agent, last_seen_at FROM auth_session_meta WHERE user_id = ?`)
    .all(userId) as Array<{ session_id: string; device_name: string | null; user_agent: string | null; last_seen_at: number }>;
  return new Map(rows.map((r) => [r.session_id, { deviceName: r.device_name, userAgent: r.user_agent, lastSeenAt: r.last_seen_at }]));
}
