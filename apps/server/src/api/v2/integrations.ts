import { denyUnlessMember } from "./access.ts";
import { defineRouter, notImplemented, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

export const integrationsRouter = defineRouter({
  listIntegrations: (req) => {
    const { workspace_id } = req.query;
    return denyUnlessMember(req, workspace_id) ?? okPage(req, F.integrations.filter((i) => i.workspace_id === workspace_id));
  },
  startGoogleIntegration: notImplemented,
  disconnectIntegration: notImplemented,
});
