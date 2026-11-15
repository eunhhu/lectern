import { db } from "../../db.ts";
import { syncRemindersForActionItem } from "../../reminders.ts";
import { callerIn, can, loadRecording, requireWorkspace } from "./access.ts";
import { defineRouter, notFound, ok, pageBounds, pageFrom } from "./common.ts";
import { actionItemDto, type ActionItemRow, type RecordingRow } from "./rows.ts";

// Per-recording lists live on the recording (/recordings/{id}/action-items, recordings.ts).
export const actionItemsRouter = defineRouter({
  listActionItems: (req) => {
    const q = req.query as { workspace_id: string; status?: string; due_after?: string; due_before?: string; recording_id?: string };
    const caller = requireWorkspace(req, q.workspace_id);
    if (caller instanceof Response) return caller;
    const bounds = pageBounds(req);
    if (bounds instanceof Response) return bounds;
    const where = [`a.workspace_id = ?`, `(r.visibility = 'workspace' OR r.created_by = ?)`];
    const params: Array<string | number> = [q.workspace_id, req.user!.id];
    if (q.status) (where.push(`a.status = ?`), params.push(q.status));
    if (q.recording_id) (where.push(`a.recording_id = ?`), params.push(q.recording_id));
    if (q.due_after) (where.push(`a.due_at >= ?`), params.push(Date.parse(q.due_after)));
    if (q.due_before) (where.push(`a.due_at < ?`), params.push(Date.parse(q.due_before)));
    const rows = db
      .query(
        `SELECT a.* FROM action_item a JOIN recording r ON r.id = a.recording_id WHERE ${where.join(" AND ")}
         ORDER BY a.due_at IS NULL, a.due_at, a.created_at, a.id LIMIT ? OFFSET ?`
      )
      .all(...params, bounds.limit + 1, bounds.offset) as ActionItemRow[];
    const page = pageFrom(rows, bounds);
    return ok(req, { items: page.items.map(actionItemDto), next_cursor: page.next_cursor });
  },
  updateActionItem: (req) => {
    const item = db.query(`SELECT * FROM action_item WHERE id = ?`).get(String(req.params.action_item_id)) as ActionItemRow | null;
    if (!item) return notFound(req, "할 일");
    const recording = loadRecording(req, item.recording_id, "recording:read");
    if (recording instanceof Response) return notFound(req, "할 일");
    // Completing an item is editing the recording's extracted data.
    if (!can(callerIn(req, recording.workspace_id), "recording:update", recording as RecordingRow)) {
      return req.c.json({ error: { code: "forbidden", message: "이 할 일을 바꿀 권한이 없습니다." } }, 403);
    }
    const body = req.body as { text?: string; owner_name?: string | null; due_at?: string | null; status?: string };
    db.query(`UPDATE action_item SET text = ?, owner_name = ?, due_at = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      body.text ?? item.text,
      body.owner_name === undefined ? item.owner_name : body.owner_name,
      body.due_at === undefined ? item.due_at : body.due_at === null ? null : Date.parse(body.due_at),
      body.status ?? item.status,
      Date.now(),
      item.id
    );
    syncRemindersForActionItem(item.id);
    return ok(req, actionItemDto(db.query(`SELECT * FROM action_item WHERE id = ?`).get(item.id) as ActionItemRow));
  },
});
