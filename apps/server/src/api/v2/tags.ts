import { denyUnlessMember } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

export const tagsRouter = defineRouter({
  listTags: (req) => {
    const { workspace_id } = req.query;
    return denyUnlessMember(req, workspace_id) ?? okPage(req, F.tags.filter((t) => t.workspace_id === workspace_id));
  },
  createTag: notImplemented,
  updateTag: notImplemented,
  deleteTag: notImplemented,
});
