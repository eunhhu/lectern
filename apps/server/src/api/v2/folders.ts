import { denyUnlessMember } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

export const foldersRouter = defineRouter({
  listFolders: (req) => {
    const { workspace_id } = req.query;
    return denyUnlessMember(req, workspace_id) ?? okPage(req, F.folders.filter((f) => f.workspace_id === workspace_id));
  },
  createFolder: notImplemented,
  updateFolder: notImplemented,
  deleteFolder: notImplemented,
});
