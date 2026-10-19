import { db } from "../../db.ts";
import { requireWorkspace } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import { integrationDto, type IntegrationRow } from "./rows.ts";

// Google Calendar is P4 (ARCHITECTURE §11): the list is real (empty until then).
export const integrationsRouter = defineRouter({
  listIntegrations: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const rows = db.query(`SELECT * FROM integration WHERE workspace_id = ? AND user_id = ? ORDER BY created_at`).all(workspace_id, req.user!.id) as IntegrationRow[];
    return okPage(req, rows.map(integrationDto));
  },
  startGoogleIntegration: notImplemented,
  disconnectIntegration: notImplemented,
});
