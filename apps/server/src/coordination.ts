// Process coordination through `system_state` (same host, same SQLite file).
// - The API records the release (git SHA) it booted; an external worker exits when the
//   API moved to a newer release, so systemd restarts it on the same code (deploys only
//   restart the API directly).
// - Workers write a heartbeat; the API reports "worker missing" when LECTERN_WORKER_MODE
//   is external but no worker has been seen for a minute (e.g. the unit isn't installed).

import { db } from "./db.ts";

const RELEASE_KEY = "release:api";
const WORKER_PREFIX = "worker:";

function put(key: string, value: string, now = Date.now()): void {
  db.query(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export function publishApiRelease(sha: string): void {
  put(RELEASE_KEY, sha);
}

export function readApiRelease(): { sha: string; at: number } | null {
  const row = db.query(`SELECT value, updated_at FROM system_state WHERE key = ?`).get(RELEASE_KEY) as
    | { value: string; updated_at: number }
    | null;
  return row ? { sha: row.value, at: row.updated_at } : null;
}

export interface WorkerHeartbeat {
  id: string;
  pid: number;
  sha: string;
  active: number;
  lastSeenAt: string;
}

export function writeWorkerHeartbeat(id: string, info: { pid: number; sha: string; active: number }): void {
  put(`${WORKER_PREFIX}${id}`, JSON.stringify(info));
}

export function removeWorkerHeartbeat(id: string): void {
  db.query(`DELETE FROM system_state WHERE key = ?`).run(`${WORKER_PREFIX}${id}`);
}

/** Workers seen within `maxAgeMs`; older heartbeats are deleted. */
export function liveWorkers(maxAgeMs = 60_000, now = Date.now()): WorkerHeartbeat[] {
  db.query(`DELETE FROM system_state WHERE key LIKE 'worker:%' AND updated_at < ?`).run(now - 24 * 3600_000);
  const rows = db
    .query(`SELECT key, value, updated_at FROM system_state WHERE key LIKE 'worker:%' AND updated_at >= ?`)
    .all(now - maxAgeMs) as Array<{ key: string; value: string; updated_at: number }>;
  return rows.map((r) => {
    const info = JSON.parse(r.value) as { pid: number; sha: string; active: number };
    return {
      id: r.key.slice(WORKER_PREFIX.length),
      ...info,
      lastSeenAt: new Date(r.updated_at).toISOString(),
    };
  });
}
