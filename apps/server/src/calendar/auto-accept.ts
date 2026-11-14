// Calendar auto-add (P4-04, CONTRACTS D-P4-1). The default is suggestions only; with the
// workspace setting `calendar_auto_add` on, a publish accepts the events the date parser
// resolved without a verify flag at or above `min_confidence`, and queues the Google sync.
// Past events are never auto-added.

import { config } from "@lectern/config";
import { WorkspaceSettings } from "@lectern/domain";
import { db } from "../db.ts";
import { logger } from "../log.ts";
import { syncRemindersForWorkspace } from "../reminders.ts";
import { enqueueCalendarSyncForWorkspace } from "./sync-job.ts";

function autoAddSetting(workspaceId: string): { enabled: boolean; min_confidence: number } | null {
  const row = db.query(`SELECT settings_json FROM workspace WHERE id = ?`).get(workspaceId) as { settings_json: string } | null;
  if (!row) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(row.settings_json);
  } catch {
    return null;
  }
  const parsed = WorkspaceSettings.safeParse(raw);
  return parsed.success ? (parsed.data.calendar_auto_add ?? null) : null;
}

/** Accepts the events of one recording that qualify for auto-add (D-P4-1). Returns how many it accepted. */
export function autoAcceptEvents(recordingId: string, workspaceId: string): number {
  if (!config().calendar) return 0;
  const setting = autoAddSetting(workspaceId);
  if (!setting?.enabled) return 0;
  const now = Date.now();
  const res = db
    .query(
      `UPDATE event_candidate SET status = 'accepted', updated_at = ?
       WHERE recording_id = ? AND workspace_id = ? AND status = 'suggested'
         AND json_extract(resolution_json, '$.method') = 'parser'
         AND flags_json = '[]'
         AND confidence >= ?
         AND start_at >= ?`,
    )
    .run(now, recordingId, workspaceId, setting.min_confidence, now);
  return res.changes;
}

/**
 * Called right after publishNotes. Queues the sync whether or not anything was accepted: a
 * republish may have dropped events Google still holds. Then reschedules the workspace's
 * e-mail reminders (P4-05). Never throws: a calendar problem
 * must not fail notes that are already published.
 */
export function afterNotesPublished(recordingId: string, workspaceId: string): void {
  try {
    const accepted = autoAcceptEvents(recordingId, workspaceId);
    if (accepted > 0) logger.info("events auto-accepted", { recording_id: recordingId, workspace_id: workspaceId, accepted });
    if (config().calendar) enqueueCalendarSyncForWorkspace(workspaceId);
    // Accepted events and new action items get their reminders; dropped ones lose theirs.
    syncRemindersForWorkspace(workspaceId);
  } catch (err) {
    logger.warn("calendar step after publish failed", { recording_id: recordingId, workspace_id: workspaceId, err });
  }
}
