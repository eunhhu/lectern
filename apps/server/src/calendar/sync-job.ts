// The `calendar_sync` job (P4-03, CONTRACTS D-P4-4, D-P4-5, D-P4-6): makes an integration's
// Google calendar match the accepted events its user may read. One direction only (Lectern →
// Google); changes made in Google are not read back.
//
// - Subject = integration id; the queue keeps one queued or running job per integration.
// - No duplicates: every Google event carries `lectern_event_id`; without a link row the
//   event is looked up by it first and adopted when found.
// - A Google token Lectern can no longer use ends the job quietly with the integration at
//   `needs_reauth` (no retries). Network, 429 and 5xx failures throw so the queue retries.

import { config } from "@lectern/config";
import { personalWorkspaceId } from "@lectern/db";
import { db, onLectureDeleted } from "../db.ts";
import {
  deleteEvent,
  eventResource,
  findEventByLecternId,
  GoogleApiError,
  insertEvent,
  isTransientGoogleError,
  patchEvent,
} from "../google/calendar.ts";
import { GoogleAuthError } from "../google/oauth.ts";
import { accessTokenFor, forgetAccessToken, markNeedsReauth } from "../google/tokens.ts";
import { logger } from "../log.ts";
import { enqueueJob, type JobOutcome, type LeasedJob, registerJobHandler } from "../queue.ts";

export const CALENDAR_SYNC_JOB_KIND = "calendar_sync";

/** Delayed retries after network, 429 or 5xx failures (the queue itself does not retry): 1, 2, 4, 8, 16 min. */
export const CALENDAR_SYNC_RETRIES = 5;
const RETRY_BASE_MS = 60_000;

export interface CalendarSyncResult {
  inserted: number;
  patched: number;
  deleted: number;
  adopted: number;
  /** Events Google refused for a reason a retry will not fix (logged; retried next sync). */
  failed: number;
}

interface IntegrationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  calendar_id: string | null;
  status: string;
}

interface TargetRow {
  id: string;
  title: string;
  start_at: number;
  end_at: number | null;
  all_day: number;
  tz: string;
  status: string;
  updated_at: number;
  recording_title: string;
}

interface LinkRow {
  event_candidate_id: string;
  external_event_id: string;
  state: string;
  last_synced_at: number;
}

/** Queues (or keeps the queued) sync of one integration. */
export function enqueueCalendarSync(integrationId: string): void {
  const row = db.query(`SELECT user_id FROM integration WHERE id = ?`).get(integrationId) as { user_id: string } | null;
  if (!row) return;
  enqueueJob({ kind: CALENDAR_SYNC_JOB_KIND, ownerId: row.user_id, subjectId: integrationId, priority: -1 });
}

/** Queues a sync for every active Google integration of the workspace; a no-op while LECTERN_CALENDAR is off. */
export function enqueueCalendarSyncForWorkspace(workspaceId: string): void {
  if (!config().calendar) return;
  const rows = db
    .query(`SELECT id FROM integration WHERE workspace_id = ? AND provider = 'google' AND status = 'active' AND calendar_id IS NOT NULL`)
    .all(workspaceId) as Array<{ id: string }>;
  for (const { id } of rows) enqueueCalendarSync(id);
}

/** Thrown inside a run when Google refused the access token twice: the run stops quietly. */
class StopSync extends Error {}

function targetsOf(integration: IntegrationRow): TargetRow[] {
  return db
    .query(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.tz, e.status, e.updated_at, r.title AS recording_title
       FROM event_candidate e JOIN recording r ON r.id = e.recording_id
       WHERE e.workspace_id = ? AND r.workspace_id = ? AND e.status IN ('accepted', 'synced')
         AND (r.visibility = 'workspace' OR r.created_by = ?)
       ORDER BY e.start_at, e.id`,
    )
    .all(integration.workspace_id, integration.workspace_id, integration.user_id) as TargetRow[];
}

/**
 * Records that Google holds `eventId` as of the version whose updated_at is `version`. Storing
 * that version (not the time of the call) as last_synced_at means an edit made while the
 * Google call was in flight still counts as newer next time.
 */
function saveLink(integrationId: string, eventId: string, external: { id: string; etag: string }, version: number): void {
  db.transaction(() => {
    db.query(
      `INSERT INTO calendar_event_link (event_candidate_id, integration_id, external_event_id, external_etag, state, last_synced_at, error_code)
       VALUES (?, ?, ?, ?, 'synced', ?, NULL)
       ON CONFLICT(event_candidate_id) DO UPDATE SET integration_id = excluded.integration_id, external_event_id = excluded.external_event_id,
         external_etag = excluded.external_etag, state = 'synced', last_synced_at = excluded.last_synced_at, error_code = NULL`,
    ).run(eventId, integrationId, external.id, external.etag || null, version);
    // updated_at stays: it is the user's last change, which the next run compares with last_synced_at.
    db.query(`UPDATE event_candidate SET status = 'synced' WHERE id = ? AND status = 'accepted'`).run(eventId);
  })();
}

function markLinkError(eventId: string, integrationId: string, status: number): void {
  db.query(`UPDATE calendar_event_link SET state = 'error', error_code = ? WHERE event_candidate_id = ? AND integration_id = ?`).run(
    `http_${status}`,
    eventId,
    integrationId,
  );
}

const isGone = (err: unknown) => err instanceof GoogleApiError && (err.status === 404 || err.status === 410);

export async function runCalendarSync(integrationId: string, signal?: AbortSignal): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { inserted: 0, patched: 0, deleted: 0, adopted: 0, failed: 0 };
  const integration = db.query(`SELECT id, workspace_id, user_id, calendar_id, status FROM integration WHERE id = ?`).get(integrationId) as
    | IntegrationRow
    | null;
  if (!integration || integration.status !== "active" || !integration.calendar_id) return result;
  const calendarId = integration.calendar_id;

  let token = "";
  let refreshed = false;
  const isUnauthorized = (err: unknown) => err instanceof GoogleAuthError && err.code === "unauthorized";
  const refusedAgain = (): never => {
    markNeedsReauth(integrationId);
    throw new StopSync("Google refused the access token again");
  };
  /** Runs one Calendar call; a 401 drops the cached token and retries once per run, a second one stops the run (D-P4-6). */
  const call = async <T>(fn: (accessToken: string) => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    try {
      return await fn(token);
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      if (refreshed) refusedAgain();
      refreshed = true;
      forgetAccessToken(integrationId);
      token = await accessTokenFor(integrationId);
      try {
        return await fn(token);
      } catch (retryErr) {
        if (isUnauthorized(retryErr)) refusedAgain();
        throw retryErr;
      }
    }
  };

  try {
    token = await accessTokenFor(integrationId);
    const targets = targetsOf(integration);
    const links = new Map(
      (
        db
          .query(`SELECT event_candidate_id, external_event_id, state, last_synced_at FROM calendar_event_link WHERE integration_id = ?`)
          .all(integrationId) as LinkRow[]
      ).map((l) => [l.event_candidate_id, l]),
    );

    for (const target of targets) {
      const link = links.get(target.id);
      const version = target.updated_at;
      if (link && link.state === "synced" && target.updated_at <= link.last_synced_at) {
        if (target.status === "accepted") saveLink(integrationId, target.id, { id: link.external_event_id, etag: "" }, link.last_synced_at);
        continue;
      }
      const resource = eventResource({
        id: target.id,
        title: target.title,
        startAt: target.start_at,
        endAt: target.end_at,
        allDay: Boolean(target.all_day),
        tz: target.tz,
        recordingTitle: target.recording_title || null,
      });
      try {
        if (link) {
          try {
            saveLink(integrationId, target.id, await call((t) => patchEvent(t, calendarId, link.external_event_id, resource)), version);
            result.patched++;
            continue;
          } catch (err) {
            if (!isGone(err)) throw err;
            // Deleted in Google: forget the link and put it back.
            db.query(`DELETE FROM calendar_event_link WHERE event_candidate_id = ? AND integration_id = ?`).run(target.id, integrationId);
          }
        }
        const found = await call((t) => findEventByLecternId(t, calendarId, target.id));
        if (found) {
          saveLink(integrationId, target.id, await call((t) => patchEvent(t, calendarId, found.id, resource)), version);
          result.adopted++;
        } else {
          saveLink(integrationId, target.id, await call((t) => insertEvent(t, calendarId, resource)), version);
          result.inserted++;
        }
      } catch (err) {
        if (err instanceof StopSync || err instanceof GoogleAuthError || isTransientGoogleError(err) || !(err instanceof GoogleApiError)) throw err;
        result.failed++;
        markLinkError(target.id, integrationId, err.status);
        logger.warn("calendar event sync failed", { integration_id: integrationId, event_candidate_id: target.id, status: err.status });
      }
    }

    // Links whose event is no longer accepted (dismissed, back to suggested, or gone with its recording).
    const live = new Set(targets.map((t) => t.id));
    for (const link of links.values()) {
      if (live.has(link.event_candidate_id)) continue;
      await call((t) => deleteEvent(t, calendarId, link.external_event_id));
      db.query(`DELETE FROM calendar_event_link WHERE event_candidate_id = ? AND integration_id = ?`).run(link.event_candidate_id, integrationId);
      result.deleted++;
    }
    return result;
  } catch (err) {
    if (err instanceof StopSync) {
      logger.warn("calendar sync stopped: Google refused the token twice", { integration_id: integrationId });
      return result;
    }
    if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
      logger.warn("calendar sync stopped: the integration needs to be connected again", { integration_id: integrationId });
      return result;
    }
    throw err;
  }
}

/** True when something changed after `since` that a run starting then may have missed. */
function changedSince(integrationId: string, workspaceId: string, since: number): boolean {
  const edited = db.query(`SELECT 1 FROM event_candidate WHERE workspace_id = ? AND updated_at >= ? LIMIT 1`).get(workspaceId, since);
  const orphaned = db
    .query(
      `SELECT 1 FROM calendar_event_link l LEFT JOIN event_candidate e ON e.id = l.event_candidate_id
       WHERE l.integration_id = ? AND e.id IS NULL LIMIT 1`,
    )
    .get(integrationId);
  return Boolean(edited || orphaned);
}

export async function runCalendarSyncJob(job: LeasedJob): Promise<JobOutcome> {
  const integrationId = job.subjectId!;
  const startedAt = Date.now();
  const retry = typeof job.payload.retry === "number" ? job.payload.retry : 0;
  try {
    const result = await runCalendarSync(integrationId);
    const row = db.query(`SELECT workspace_id, status FROM integration WHERE id = ?`).get(integrationId) as
      | { workspace_id: string; status: string }
      | null;
    // An enqueue while this ran was merged into this job: run again for what it may have missed.
    const again = row?.status === "active" && changedSince(integrationId, row.workspace_id, startedAt);
    return { ok: true, result: { ...result }, followUp: again ? () => enqueueCalendarSync(integrationId) : undefined };
  } catch (err) {
    const transient = isTransientGoogleError(err);
    logger.warn("calendar sync failed", {
      job_id: job.id,
      integration_id: integrationId,
      error: err instanceof Error ? err.name : "unknown",
      retry,
      ...(err instanceof GoogleApiError ? { status: err.status } : {}),
      ...(err instanceof GoogleAuthError ? { error_code: err.code } : {}),
    });
    const retryLater =
      transient && retry < CALENDAR_SYNC_RETRIES
        ? () =>
            enqueueJob({
              kind: CALENDAR_SYNC_JOB_KIND,
              ownerId: job.ownerId,
              subjectId: integrationId,
              priority: -1,
              payload: { retry: retry + 1 },
              delayMs: RETRY_BASE_MS * 2 ** retry,
            })
        : undefined;
    return { ok: false, error: err instanceof Error ? err.message : String(err), followUp: retryLater };
  }
}

registerJobHandler(CALENDAR_SYNC_JOB_KIND, runCalendarSyncJob, { concurrency: 1 });

// A deleted lecture took its events with it (its recording lives in the owner's personal workspace).
onLectureDeleted((_lectureId, ownerId) => enqueueCalendarSyncForWorkspace(personalWorkspaceId(ownerId)));
