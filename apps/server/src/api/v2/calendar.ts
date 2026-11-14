import { db } from "../../db.ts";
import { callerIn, can, requireWorkspace } from "./access.ts";
import { apiError, defineRouter, notFound, notImplemented, ok, pageBounds, pageFrom, type V2Request } from "./common.ts";
import { eventCandidateDto, type EventCandidateRow, type RecordingRow } from "./rows.ts";
import { transact } from "./store.ts";

// The suggestion inbox over event_candidate. The extract stage that fills it is P4; until
// then the lists are empty, and decisions work on whatever rows exist.

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
    if (row.status === "synced") return apiError(req.c, 409, "conflict", "이미 캘린더에 등록된 일정입니다.");
    const body = req.body as { status?: string; title?: string; kind?: string; start_at?: string; end_at?: string | null; all_day?: boolean };
    db.query(`UPDATE event_candidate SET status = ?, title = ?, kind = ?, start_at = ?, end_at = ?, all_day = ?, updated_at = ? WHERE id = ?`).run(
      body.status ?? row.status,
      body.title ?? row.title,
      body.kind ?? row.kind,
      body.start_at ? Date.parse(body.start_at) : row.start_at,
      body.end_at === undefined ? row.end_at : body.end_at === null ? null : Date.parse(body.end_at),
      body.all_day === undefined ? row.all_day : body.all_day ? 1 : 0,
      Date.now(),
      row.id
    );
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
        if (row.status !== "synced") db.query(`UPDATE event_candidate SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), row.id);
      }
    });
    return ok(req, { items: rows.map((r) => eventCandidateDto(get(r.id))) });
  },
  // ICS subscription (CONTRACTS §4): P4-01.
  getCalendarFeed: notImplemented,
  createCalendarFeed: notImplemented,
  deleteCalendarFeed: notImplemented,
});
