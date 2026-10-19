import { uuidv7 } from "@lectern/db";
import { db } from "../../db.ts";
import { requireWorkspace } from "./access.ts";
import { apiError, defineRouter, notFound, ok, okPage, type V2Request } from "./common.ts";
import { tagDto, type TagRow } from "./rows.ts";
import { nameKey, transact } from "./store.ts";

const tagsOf = (workspaceId: string) =>
  db.query(`SELECT * FROM tag WHERE workspace_id = ? ORDER BY name, id`).all(workspaceId) as TagRow[];

const getTag = (id: string) => db.query(`SELECT * FROM tag WHERE id = ?`).get(id) as TagRow | null;

const nameTaken = (workspaceId: string, name: string, exceptId: string | null) =>
  tagsOf(workspaceId).some((t) => t.id !== exceptId && nameKey(t.name) === nameKey(name));

const CONFLICT = "이름이 같은 태그가 있습니다.";

function writableTag(req: V2Request): TagRow | Response {
  const tag = getTag(String(req.params.tag_id));
  if (!tag) return notFound(req, "태그");
  if (requireWorkspace(req, tag.workspace_id) instanceof Response) return notFound(req, "태그");
  const writer = requireWorkspace(req, tag.workspace_id, "tag:write");
  return writer instanceof Response ? writer : tag;
}

export const tagsRouter = defineRouter({
  listTags: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    return okPage(req, tagsOf(workspace_id).map(tagDto));
  },
  createTag: (req) => {
    const body = req.body as { workspace_id: string; name: string; color: string };
    const caller = requireWorkspace(req, body.workspace_id, "tag:write");
    if (caller instanceof Response) return caller;
    const name = body.name.trim();
    if (!name) return apiError(req.c, 400, "bad_request", "태그 이름을 입력하세요.");
    const id = uuidv7();
    const now = Date.now();
    const created = transact(() => {
      if (nameTaken(body.workspace_id, name, null)) return false;
      db.query(`INSERT INTO tag (id, workspace_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id,
        body.workspace_id,
        name,
        body.color,
        now,
        now
      );
      return true;
    });
    if (!created) return apiError(req.c, 409, "conflict", CONFLICT);
    return ok(req, tagDto(getTag(id)!), { status: 201 });
  },
  updateTag: (req) => {
    const tag = writableTag(req);
    if (tag instanceof Response) return tag;
    const body = req.body as { name?: string; color?: string };
    const name = body.name === undefined ? tag.name : body.name.trim();
    if (!name) return apiError(req.c, 400, "bad_request", "태그 이름을 입력하세요.");
    const updated = transact(() => {
      if (nameTaken(tag.workspace_id, name, tag.id)) return false;
      db.query(`UPDATE tag SET name = ?, color = ?, updated_at = ? WHERE id = ?`).run(name, body.color ?? tag.color, Date.now(), tag.id);
      return true;
    });
    if (!updated) return apiError(req.c, 409, "conflict", CONFLICT);
    return ok(req, tagDto(getTag(tag.id)!));
  },
  deleteTag: (req) => {
    const tag = writableTag(req);
    if (tag instanceof Response) return tag;
    transact(() => {
      db.query(`DELETE FROM recording_tag WHERE tag_id = ?`).run(tag.id);
      db.query(`DELETE FROM tag WHERE id = ?`).run(tag.id);
    });
    return req.c.body(null, 204);
  },
});
