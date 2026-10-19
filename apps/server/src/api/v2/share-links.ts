import { denyUnlessMember } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

export const shareLinksRouter = defineRouter({
  listShareLinks: (req) => {
    const { workspace_id, target_id } = req.query as { workspace_id: string; target_id?: string };
    return (
      denyUnlessMember(req, workspace_id) ??
      okPage(
        req,
        F.shareLinks.filter((l) => l.workspace_id === workspace_id && (target_id === undefined || l.target_id === target_id))
      )
    );
  },
  createShareLink: notImplemented,
  updateShareLink: notImplemented,
  revokeShareLink: notImplemented,
});
