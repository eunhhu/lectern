import { config } from "@lectern/config";
import { db } from "../../db.ts";
import {
  authorizationUrl,
  CALENDAR_SCOPE,
  calendarRedirectUri,
  createOAuthState,
  googleClient,
  newPkce,
  revokeToken,
} from "../../google/oauth.ts";
import { forgetAccessToken, openGoogleTokens } from "../../google/tokens.ts";
import { requireWorkspace } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok, okPage } from "./common.ts";
import { DEFAULT_RETURN } from "./google-callback.ts";
import { integrationDto, type IntegrationRow } from "./rows.ts";
import { transact } from "./store.ts";

// Google Calendar (P4-02, CONTRACTS D-P4-3, D-P4-6). Connecting is OAuth with PKCE; the
// callback is google-callback.ts. An integration belongs to one user in one workspace.
export const integrationsRouter = defineRouter({
  listIntegrations: (req) => {
    const { workspace_id } = req.query as { workspace_id: string };
    const caller = requireWorkspace(req, workspace_id);
    if (caller instanceof Response) return caller;
    const rows = db.query(`SELECT * FROM integration WHERE workspace_id = ? AND user_id = ? ORDER BY created_at`).all(workspace_id, req.user!.id) as IntegrationRow[];
    return okPage(req, rows.map(integrationDto));
  },

  startGoogleIntegration: (req) => {
    const client = config().calendar ? googleClient() : null;
    if (!client) return notImplemented(req);
    const body = req.body as { workspace_id: string; return_to?: string };
    const caller = requireWorkspace(req, body.workspace_id);
    if (caller instanceof Response) return caller;
    const pkce = newPkce();
    const state = createOAuthState({
      userId: caller.userId,
      workspaceId: body.workspace_id,
      purpose: "google_calendar",
      verifier: pkce.verifier,
      redirectAfter: body.return_to ?? DEFAULT_RETURN,
    });
    return ok(req, {
      authorization_url: authorizationUrl({
        clientId: client.clientId,
        redirectUri: calendarRedirectUri(),
        scope: CALENDAR_SCOPE,
        state,
        challenge: pkce.challenge,
      }),
    });
  },

  // D-P4-6: revoke at Google (best effort, first, outside the transaction), then forget the
  // links and put synced events back to accepted. Events already in Google stay there.
  // Works with the flag off too, so a user can always take the grant back.
  disconnectIntegration: async (req) => {
    const id = String(req.params.integration_id);
    const row = db.query(`SELECT * FROM integration WHERE id = ?`).get(id) as IntegrationRow | null;
    if (!row || row.user_id !== req.user!.id) return notFound(req, "연동");
    const tokens = openGoogleTokens(row.token_enc);
    if (tokens) await revokeToken(tokens.refresh_token);
    transact(() => {
      const now = Date.now();
      db.query(
        `UPDATE event_candidate SET status = 'accepted', updated_at = ?
         WHERE status = 'synced' AND id IN (SELECT event_candidate_id FROM calendar_event_link WHERE integration_id = ?)`,
      ).run(now, id);
      db.query(`DELETE FROM calendar_event_link WHERE integration_id = ?`).run(id);
      db.query(`DELETE FROM integration WHERE id = ?`).run(id);
    });
    forgetAccessToken(id);
    return req.c.body(null, 204);
  },
});
