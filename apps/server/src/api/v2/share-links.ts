import { db } from "../../db.ts";
import { requireWorkspace, VISIBLE_RECORDING_SQL } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import { shareLinkDto, type ShareLinkRow } from "./rows.ts";

// Share links: migrated v1 share tokens are rows here (packages/db legacy.ts). A private
// lecture's token is a revoked link, which is not listed. Creating and changing links is
// P5 (ARCHITECTURE §10); until then v1 `PATCH /api/lectures/{id}/visibility` does it.
export const shareLinksRouter = defineRouter({
  listShareLinks: (req) => {
    const { workspace_id, target_id } = req.query as { workspace_id: string; target_id?: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const rows = db
      .query(
        `SELECT s.* FROM share_link s
         JOIN recording r ON r.id = s.target_id OR r.id = (SELECT d.recording_id FROM document d WHERE d.id = s.target_id)
         WHERE s.workspace_id = ? AND s.revoked_at IS NULL AND ${VISIBLE_RECORDING_SQL} ${target_id ? "AND s.target_id = ?" : ""}
         ORDER BY s.created_at DESC, s.id`
      )
      .all(...(target_id ? [workspace_id, req.user!.id, target_id] : [workspace_id, req.user!.id])) as ShareLinkRow[];
    return okPage(req, rows.map(shareLinkDto));
  },
  createShareLink: notImplemented,
  updateShareLink: notImplemented,
  revokeShareLink: notImplemented,
});
