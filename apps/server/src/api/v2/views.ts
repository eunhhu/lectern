import { sortKeyAfter, uuidv7 } from "@lectern/db";
import { db } from "../../db.ts";
import { requireWorkspace } from "./access.ts";
import { defineRouter, notFound, ok, okPage, type V2Request } from "./common.ts";
import { savedViewDto, type SavedViewRow } from "./rows.ts";

// Saved library views ("스마트 보기"): private to the user who saved them (domain README #2).

const viewsOf = (workspaceId: string, userId: string) =>
  db.query(`SELECT * FROM saved_view WHERE workspace_id = ? AND user_id = ? ORDER BY sort_key, created_at, id`).all(workspaceId, userId) as SavedViewRow[];

function ownView(req: V2Request): SavedViewRow | Response {
  const view = db.query(`SELECT * FROM saved_view WHERE id = ? AND user_id = ?`).get(String(req.params.view_id), req.user!.id) as SavedViewRow | null;
  if (!view) return notFound(req, "보기");
  // A view outlives nothing: leaving the workspace hides it.
  if (requireWorkspace(req, view.workspace_id) instanceof Response) return notFound(req, "보기");
  return view;
}

const getView = (id: string) => db.query(`SELECT * FROM saved_view WHERE id = ?`).get(id) as SavedViewRow;

export const viewsRouter = defineRouter({
  listSavedViews: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    return okPage(req, viewsOf(workspace_id, req.user!.id).map(savedViewDto));
  },
  createSavedView: (req) => {
    const body = req.body as { workspace_id: string; name: string; query: object; sort_key?: string };
    const caller = requireWorkspace(req, body.workspace_id);
    if (caller instanceof Response) return caller;
    const last = viewsOf(body.workspace_id, req.user!.id).at(-1)?.sort_key ?? null;
    const id = uuidv7();
    const now = Date.now();
    db.query(
      `INSERT INTO saved_view (id, workspace_id, user_id, name, query_json, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, body.workspace_id, req.user!.id, body.name.trim() || body.name, JSON.stringify(body.query), body.sort_key ?? sortKeyAfter(last), now, now);
    return ok(req, savedViewDto(getView(id)), { status: 201 });
  },
  updateSavedView: (req) => {
    const view = ownView(req);
    if (view instanceof Response) return view;
    const body = req.body as { name?: string; query?: object; sort_key?: string };
    db.query(`UPDATE saved_view SET name = ?, query_json = ?, sort_key = ?, updated_at = ? WHERE id = ?`).run(
      body.name?.trim() || view.name,
      body.query ? JSON.stringify(body.query) : view.query_json,
      body.sort_key ?? view.sort_key,
      Date.now(),
      view.id
    );
    return ok(req, savedViewDto(getView(view.id)));
  },
  deleteSavedView: (req) => {
    const view = ownView(req);
    if (view instanceof Response) return view;
    db.query(`DELETE FROM saved_view WHERE id = ?`).run(view.id);
    return req.c.body(null, 204);
  },
});
