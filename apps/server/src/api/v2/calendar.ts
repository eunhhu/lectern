import { config } from "@lectern/config";
import { createFeed, deleteFeed, getFeed } from "../../calendar/feed.ts";
import { enqueueCalendarSyncForWorkspace } from "../../calendar/sync-job.ts";
import { db } from "../../db.ts";
import { syncRemindersForEvent } from "../../reminders.ts";
import { callerIn, can, requireWorkspace } from "./access.ts";
import { apiError, defineRouter, notFound, notImplemented, ok, pageBounds, pageFrom, type V2Request } from "./common.ts";
import { eventCandidateDto, type EventCandidateRow, iso, type RecordingRow } from "./rows.ts";
import { transact } from "./store.ts";

// The suggestion inbox over event_candidate. Decisions and edits queue a Google Calendar
// sync of the workspace (P4-03, D-P4-5): a synced event can still be edited (Google gets the
// change) or dismissed (Google loses it); accepting it again keeps it `synced`. They also
// reschedule the event's e-mail reminders (P4-05).

/** A candidate the caller may decide on (they may change its recording), or the error. */
function decidable(req: V2Request, id: string): EventCandidateRow | Response {
  const row = db.query(`SELECT * FROM event_candidate WHERE id = ?`).get(id) as EventCandidateRow | null;
  if (!row) return notFound(req, "일정 제안");
  const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(row.recording_id) as RecordingRow | null;
  const caller = recording ? callerIn(req, recording.workspace_id) : null;
  if (!recording || !caller || !can(caller, "recording:read", recording)) return notFound(req, "일정 제안");
  if (!can(caller, "recording:update", recording)) return apiError(req.c, 403, "forbidden", "이 일정을 바꿀 권한이 없습니다.");
  return row;
}

const get = (id: string) => db.query(`SELECT * FROM event_candidate WHERE id = ?`).get(id) as EventCandidateRow;

export const calendarRouter = defineRouter({
  listCalendarSuggestions: (req) => {
    const q = req.query as { workspace_id: string; status?: string; statuses?: string; start_after?: string; start_before?: string };
    const caller = requireWorkspace(req, q.workspace_id);
    if (caller instanceof Response) return caller;
    const bounds = pageBounds(req);
    if (bounds instanceof Response) return bounds;
    const statuses = q.statuses ? q.statuses.split(",") : [q.status ?? "suggested"];
    const where = [`e.workspace_id = ?`, `(r.visibility = 'workspace' OR r.created_by = ?)`, `e.status IN (${statuses.map(() => "?").join(",")})`];
    const params: Array<string | number> = [q.workspace_id, req.user!.id, ...statuses];
    if (q.start_after) (where.push(`e.start_at >= ?`), params.push(Date.parse(q.start_after)));
    if (q.start_before) (where.push(`e.start_at < ?`), params.push(Date.parse(q.start_before)));
    const rows = db
      .query(
        `SELECT e.* FROM event_candidate e JOIN recording r ON r.id = e.recording_id WHERE ${where.join(" AND ")}
         ORDER BY e.start_at, e.id LIMIT ? OFFSET ?`
      )
      .all(...params, bounds.limit + 1, bounds.offset) as EventCandidateRow[];
    const page = pageFrom(rows, bounds);
    return ok(req, { items: page.items.map(eventCandidateDto), next_cursor: page.next_cursor });
  },
  updateCalendarSuggestion: (req) => {
    const row = decidable(req, String(req.params.event_candidate_id));
    if (row instanceof Response) return row;
    const body = req.body as { status?: string; title?: string; kind?: string; start_at?: string; end_at?: string | null; all_day?: boolean };
    const status = body.status === undefined || (body.status === "accepted" && row.status === "synced") ? row.status : body.status;
    db.query(`UPDATE event_candidate SET status = ?, title = ?, kind = ?, start_at = ?, end_at = ?, all_day = ?, updated_at = ? WHERE id = ?`).run(
      status,
      body.title ?? row.title,
      body.kind ?? row.kind,
      body.start_at ? Date.parse(body.start_at) : row.start_at,
      body.end_at === undefined ? row.end_at : body.end_at === null ? null : Date.parse(body.end_at),
      body.all_day === undefined ? row.all_day : body.all_day ? 1 : 0,
      Date.now(),
      row.id
    );
    enqueueCalendarSyncForWorkspace(row.workspace_id);
    syncRemindersForEvent(row.id);
    return ok(req, eventCandidateDto(get(row.id)));
  },
  batchCalendarSuggestions: (req) => {
    const body = req.body as { event_candidate_ids: string[]; action: "accept" | "dismiss" };
    const rows: EventCandidateRow[] = [];
    for (const id of body.event_candidate_ids) {
      const row = decidable(req, id);
      if (row instanceof Response) return row;
      rows.push(row);
    }
    const status = body.action === "accept" ? "accepted" : "dismissed";
    transact(() => {
      for (const row of rows) {
        // Accepting an event already in Google changes nothing.
        if (row.status === "synced" && status === "accepted") continue;
        db.query(`UPDATE event_candidate SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), row.id);
      }
    });
    for (const workspaceId of new Set(rows.map((r) => r.workspace_id))) enqueueCalendarSyncForWorkspace(workspaceId);
    for (const row of rows) syncRemindersForEvent(row.id);
    return ok(req, { items: rows.map((r) => eventCandidateDto(get(r.id))) });
  },
  // ICS subscription (P4-01, CONTRACTS §4): any member may have one per workspace. The
  // URL carries the token, so it is only in the create response (D-0-7).
  getCalendarFeed: (req) => {
    if (!config().calendar) return notImplemented(req);
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const feed = getFeed(caller.userId, workspace_id);
    return ok(req, { exists: feed.exists, url: null, created_at: feed.createdAt === null ? null : iso(feed.createdAt) });
  },
  createCalendarFeed: (req) => {
    if (!config().calendar) return notImplemented(req);
    const { workspace_id } = req.body as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const feed = createFeed(caller.userId, workspace_id);
    return ok(req, { url: feed.url, created_at: iso(feed.createdAt) });
  },
  deleteCalendarFeed: (req) => {
    if (!config().calendar) return notImplemented(req);
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    deleteFeed(caller.userId, workspace_id);
    return req.c.body(null, 204);
  },
});
