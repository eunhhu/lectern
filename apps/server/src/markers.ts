// Recording markers (CONTRACTS D-P6-3): points a user marked as important while recording,
// in original-audio milliseconds. The notes pipeline turns them into transcript segments the
// structure stage must not leave out (packages/harness markerSegments).

import { uuidv7 } from "@lectern/db";
import { db } from "./db.ts";

/** Markers per recording. */
export const MAX_MARKERS_PER_RECORDING = 200;
/** A second tap by the same user this close to an earlier marker is the same marker. */
export const MARKER_DOUBLE_TAP_MS = 500;

export interface MarkerRow {
  id: string;
  workspace_id: string;
  recording_id: string;
  at_ms: number;
  label: string | null;
  created_by: string;
  created_at: number;
}

export function listMarkers(recordingId: string): MarkerRow[] {
  return db.query(`SELECT * FROM recording_marker WHERE recording_id = ? ORDER BY at_ms, created_at, id`).all(recordingId) as MarkerRow[];
}

export function getMarker(recordingId: string, markerId: string): MarkerRow | null {
  return db.query(`SELECT * FROM recording_marker WHERE id = ? AND recording_id = ?`).get(markerId, recordingId) as MarkerRow | null;
}

/**
 * Adds a marker. A marker of the same user within ±500 ms is returned instead (a double tap:
 * `created: false`); `"full"` when the recording already has 200.
 */
export function createMarker(
  p: { workspaceId: string; recordingId: string; atMs: number; label: string | null; userId: string },
  now = Date.now()
): { marker: MarkerRow; created: boolean } | "full" {
  return db.transaction((): { marker: MarkerRow; created: boolean } | "full" => {
    const near = db
      .query(
        `SELECT * FROM recording_marker WHERE recording_id = ? AND created_by = ? AND at_ms BETWEEN ? AND ?
         ORDER BY abs(at_ms - ?) LIMIT 1`
      )
      .get(p.recordingId, p.userId, p.atMs - MARKER_DOUBLE_TAP_MS, p.atMs + MARKER_DOUBLE_TAP_MS, p.atMs) as MarkerRow | null;
    if (near) return { marker: near, created: false };
    const { n } = db.query(`SELECT COUNT(*) AS n FROM recording_marker WHERE recording_id = ?`).get(p.recordingId) as { n: number };
    if (n >= MAX_MARKERS_PER_RECORDING) return "full";
    const id = uuidv7(now);
    db.query(
      `INSERT INTO recording_marker (id, workspace_id, recording_id, at_ms, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, p.workspaceId, p.recordingId, p.atMs, p.label, p.userId, now);
    return { marker: getMarker(p.recordingId, id)!, created: true };
  })();
}

export function deleteMarker(recordingId: string, markerId: string): boolean {
  return db.query(`DELETE FROM recording_marker WHERE id = ? AND recording_id = ?`).run(markerId, recordingId).changes > 0;
}

/** What the notes pipeline needs (D-P6-3): time and label, in audio order. */
export function markersForNotes(recordingId: string): { at_ms: number; label: string | null }[] {
  return listMarkers(recordingId).map((m) => ({ at_ms: m.at_ms, label: m.label }));
}
