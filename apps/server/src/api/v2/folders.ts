import { appendSortKey, uuidv7 } from "@lectern/db";
import { db, mirrorRecordingToLecture } from "../../db.ts";
import { requireWorkspace } from "./access.ts";
import { apiError, defineRouter, notFound, ok, okPage, type V2Request } from "./common.ts";
import { folderDto, type FolderRow, type RecordingRow } from "./rows.ts";
import { announceLectures, courseForFolder, folderSubtree, foldersOf, getFolderRow, nameKey, transact } from "./store.ts";

// Folders nest; v1 clients only know a recording's leaf folder name as its course, so a
// rename or delete is mirrored to the lectures of the affected recordings (store.ts).

function siblingConflict(workspaceId: string, parentId: string | null, name: string, exceptId: string | null): boolean {
  return foldersOf(workspaceId).some((f) => f.parent_id === parentId && f.id !== exceptId && nameKey(f.name) === nameKey(name));
}

function conflict(req: V2Request, message: string): Response {
  return apiError(req.c, 409, "conflict", message);
}

const SIBLING_MESSAGE = "같은 위치에 이름이 같은 폴더가 있습니다.";

/** The folder the caller may change, or the error response. */
function writableFolder(req: V2Request): FolderRow | Response {
  const folder = getFolderRow(String(req.params.folder_id));
  if (!folder) return notFound(req, "폴더");
  const caller = requireWorkspace(req, folder.workspace_id);
  if (caller instanceof Response) return notFound(req, "폴더");
  const writer = requireWorkspace(req, folder.workspace_id, "folder:write");
  return writer instanceof Response ? writer : folder;
}

/** Re-mirrors the course of every lecture-backed recording directly in these folders. */
function remirrorFolders(folderIds: string[]): string[] {
  if (!folderIds.length) return [];
  const recordings = db
    .query(`SELECT * FROM recording WHERE folder_id IN (${folderIds.map(() => "?").join(",")}) AND lecture_id IS NOT NULL`)
    .all(...folderIds) as RecordingRow[];
  for (const r of recordings) mirrorRecordingToLecture(r.lecture_id!, { course: courseForFolder(r.folder_id) });
  return recordings.map((r) => r.lecture_id!);
}

export const foldersRouter = defineRouter({
  listFolders: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    return okPage(req, foldersOf(workspace_id).map(folderDto));
  },

  createFolder: (req) => {
    const body = req.body as { workspace_id: string; parent_id?: string | null; name: string; sort_key?: string };
    const caller = requireWorkspace(req, body.workspace_id, "folder:write");
    if (caller instanceof Response) return caller;
    const parentId = body.parent_id ?? null;
    if (parentId) {
      const parent = getFolderRow(parentId);
      if (!parent || parent.workspace_id !== body.workspace_id) {
        return apiError(req.c, 400, "bad_request", "상위 폴더를 찾을 수 없습니다.");
      }
    }
    const name = body.name.trim();
    if (!name) return apiError(req.c, 400, "bad_request", "폴더 이름을 입력하세요.");
    const id = uuidv7();
    const now = Date.now();
    const created = transact(() => {
      if (siblingConflict(body.workspace_id, parentId, name, null)) return false;
      db.query(
        `INSERT INTO folder (id, workspace_id, parent_id, name, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, body.workspace_id, parentId, name, body.sort_key ?? appendSortKey(db, body.workspace_id, parentId), now, now);
      return true;
    });
    if (!created) return conflict(req, SIBLING_MESSAGE);
    return ok(req, folderDto(getFolderRow(id)!), { status: 201 });
  },

  updateFolder: (req) => {
    const folder = writableFolder(req);
    if (folder instanceof Response) return folder;
    const body = req.body as { parent_id?: string | null; name?: string; sort_key?: string };
    const parentId = body.parent_id === undefined ? folder.parent_id : body.parent_id;
    const name = body.name === undefined ? folder.name : body.name.trim();
    if (!name) return apiError(req.c, 400, "bad_request", "폴더 이름을 입력하세요.");
    if (parentId) {
      const parent = getFolderRow(parentId);
      if (!parent || parent.workspace_id !== folder.workspace_id) {
        return apiError(req.c, 400, "bad_request", "상위 폴더를 찾을 수 없습니다.");
      }
      if (folderSubtree(folder.workspace_id, folder.id).includes(parentId)) {
        return conflict(req, "폴더를 자기 자신이나 하위 폴더 안으로 옮길 수 없습니다.");
      }
    }
    const moved = parentId !== folder.parent_id;
    let renamedLectures: string[] = [];
    const result = transact(() => {
      if ((moved || name !== folder.name) && siblingConflict(folder.workspace_id, parentId, name, folder.id)) return false;
      db.query(`UPDATE folder SET parent_id = ?, name = ?, sort_key = ?, updated_at = ? WHERE id = ?`).run(
        parentId,
        name,
        body.sort_key ?? (moved && body.sort_key === undefined ? appendSortKey(db, folder.workspace_id, parentId) : folder.sort_key),
        Date.now(),
        folder.id
      );
      if (name !== folder.name) renamedLectures = remirrorFolders([folder.id]);
      return true;
    });
    if (!result) return conflict(req, SIBLING_MESSAGE);
    announceLectures(renamedLectures);
    return ok(req, folderDto(getFolderRow(folder.id)!));
  },

  // Recordings and subfolders move to the deleted folder's parent (domain README #11).
  // Saved views that filter on it keep the id and match nothing.
  deleteFolder: (req) => {
    const folder = writableFolder(req);
    if (folder instanceof Response) return folder;
    const lectures = transact(() => {
      const now = Date.now();
      const affected = db.query(`SELECT * FROM recording WHERE folder_id = ?`).all(folder.id) as RecordingRow[];
      db.query(`UPDATE recording SET folder_id = ?, updated_at = ? WHERE folder_id = ?`).run(folder.parent_id, now, folder.id);
      db.query(`UPDATE folder SET parent_id = ?, updated_at = ? WHERE parent_id = ?`).run(folder.parent_id, now, folder.id);
      db.query(`DELETE FROM folder WHERE id = ?`).run(folder.id);
      const course = courseForFolder(folder.parent_id);
      const mirrored = affected.filter((r) => r.lecture_id);
      for (const r of mirrored) mirrorRecordingToLecture(r.lecture_id!, { course });
      return mirrored.map((r) => r.lecture_id!);
    });
    announceLectures(lectures);
    return req.c.body(null, 204);
  },
});
