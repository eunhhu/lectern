// Lecture change events. Whichever process makes a change (the API on a user action, a
// worker while processing) emits it here: the event is appended to `job_event` and handed
// to listeners in the same process right away. The API additionally tails `job_event` for
// rows written by *other* processes (an external worker) and feeds both into SSE, so the
// wire format and latency are the same whether the worker is embedded or separate.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { LectureSummaryDto } from "./admin-api.ts";
import { db } from "./db.ts";

/** Identifies this process in `job_event.origin`. */
export const PROCESS_ORIGIN = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface LectureEventPayload {
  type: "created" | "progress" | "completed" | "error" | "updated" | "deleted";
  id?: string;
  ids?: string[];
  lecture?: LectureSummaryDto;
  stage?: string;
  stage_message?: string;
  progress?: number;
  error_message?: string | null;
}

type Listener = (ownerId: string, payload: LectureEventPayload) => void;
const listeners = new Set<Listener>();

/** Subscribes to events emitted in this process; returns an unsubscribe function. */
export function onLectureEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLectureEvent(ownerId: string, payload: LectureEventPayload): void {
  try {
    db.query(
      `INSERT INTO job_event (owner_id, subject_id, type, payload, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(ownerId, payload.id ?? null, payload.type, JSON.stringify(payload), PROCESS_ORIGIN, Date.now());
  } catch (err) {
    console.error("Could not record lecture event:", err);
  }
  for (const listener of listeners) {
    try {
      listener(ownerId, payload);
    } catch (err) {
      console.error("Lecture event listener failed:", err);
    }
  }
}

/**
 * Polls `job_event` for rows other processes wrote after now and passes them to `deliver`.
 * Returns a stop function. The timer is unref'd so it never keeps a process alive.
 */
export function tailForeignLectureEvents(
  deliver: Listener,
  options: { pollMs?: number } = {}
): () => void {
  let lastId =
    (db.query(`SELECT MAX(id) AS id FROM job_event`).get() as { id: number | null }).id ?? 0;
  const timer = setInterval(() => {
    try {
      const rows = db
        .query(
          `SELECT id, owner_id, payload FROM job_event
           WHERE id > ? AND origin != ? ORDER BY id LIMIT 500`
        )
        .all(lastId, PROCESS_ORIGIN) as Array<{ id: number; owner_id: string; payload: string }>;
      for (const row of rows) {
        lastId = row.id;
        try {
          deliver(row.owner_id, JSON.parse(row.payload));
        } catch (err) {
          console.error("Could not deliver lecture event:", err);
        }
      }
      if (rows.length === 0) {
        // Skip past our own rows too, so the next query starts after them.
        const max = (db.query(`SELECT MAX(id) AS id FROM job_event`).get() as { id: number | null }).id;
        if (max && max > lastId) {
          const foreignAhead = db
            .query(`SELECT 1 FROM job_event WHERE id > ? AND origin != ? LIMIT 1`)
            .get(lastId, PROCESS_ORIGIN);
          if (!foreignAhead) lastId = max;
        }
      }
    } catch (err) {
      console.error("Lecture event tail failed:", err);
    }
  }, options.pollMs ?? 500);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Deletes events older than `maxAgeMs` (maintenance). Returns the number removed. */
export function pruneLectureEvents(maxAgeMs: number, now = Date.now()): number {
  return db.query(`DELETE FROM job_event WHERE created_at < ?`).run(now - maxAgeMs).changes;
}
