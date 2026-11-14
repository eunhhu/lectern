import { uuidv7 } from "@lectern/db";
import { db } from "../../db.ts";
import { syncRemindersForWorkspace } from "../../reminders.ts";
import { requireWorkspace } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok, okPage } from "./common.ts";
import { membershipDto, workspaceDto, type MembershipRow, type WorkspaceRow } from "./rows.ts";
import { transact } from "./store.ts";

/**
 * The stored settings with `patch` laid over them (shallow, P4-04): sending one key keeps the
 * others. A key whose value is null is removed.
 */
export function mergeSettings(storedJson: string, patch: Record<string, unknown>): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(storedJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    // unreadable settings are replaced by the patch
  }
  const merged: Record<string, unknown> = { ...stored, ...patch };
  for (const [key, value] of Object.entries(merged)) if (value === null || value === undefined) delete merged[key];
  return merged;
}

function workspaceRow(id: string): WorkspaceRow | null {
  return db.query(`SELECT * FROM workspace WHERE id = ?`).get(id) as WorkspaceRow | null;
}

export const workspacesRouter = defineRouter({
  listWorkspaces: (req) => {
    const rows = db
      .query(
        `SELECT w.*, m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
         WHERE m.user_id = ? ORDER BY w.kind = 'personal' DESC, w.created_at, w.id`
      )
      .all(req.user!.id) as Array<WorkspaceRow & { role: string }>;
    return okPage(req, rows.map((w) => ({ workspace: workspaceDto(w), role: w.role })));
  },
  // A team workspace owned by the caller. Inviting members is P5 (ARCHITECTURE §10).
  createWorkspace: (req) => {
    const { name } = req.body as { name: string };
    const id = uuidv7();
    const now = Date.now();
    transact(() => {
      db.query(
        `INSERT INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at)
         VALUES (?, ?, 'team', 'free', '{}', NULL, ?, ?)`
      ).run(id, name.trim(), now, now);
      db.query(`INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)`).run(
        id,
        req.user!.id,
        now,
        now
      );
    });
    return ok(req, workspaceDto(workspaceRow(id)!), { status: 201 });
  },
  getWorkspace: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id);
    if (caller instanceof Response) return caller;
    return ok(req, workspaceDto(workspace));
  },
  updateWorkspace: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id, "workspace:update");
    if (caller instanceof Response) return caller;
    const body = req.body as { name?: string; settings?: Record<string, unknown> };
    db.query(`UPDATE workspace SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?`).run(
      body.name?.trim() || workspace.name,
      body.settings ? JSON.stringify(mergeSettings(workspace.settings_json, body.settings)) : workspace.settings_json,
      Date.now(),
      workspace.id
    );
    if (body.settings && "reminders" in body.settings) syncRemindersForWorkspace(workspace.id);
    return ok(req, workspaceDto(workspaceRow(workspace.id)!));
  },
  listWorkspaceMembers: (req) => {
    const workspace = workspaceRow(String(req.params.workspace_id));
    if (!workspace) return notFound(req, "워크스페이스");
    const caller = requireWorkspace(req, workspace.id);
    if (caller instanceof Response) return caller;
    const rows = db
      .query(
        `SELECT m.*, u.display_name, u.email FROM membership m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? ORDER BY m.created_at, m.user_id`
      )
      .all(workspace.id) as Array<MembershipRow & { display_name: string; email: string }>;
    return okPage(
      req,
      rows.map((m) => ({ ...membershipDto(m), display_name: m.display_name, email: m.email }))
    );
  },
  // Team workspaces (P5-C contract; P5-06, P5-07 implement them).
  listInvites: notImplemented,
  createInvite: notImplemented,
  revokeInvite: notImplemented,
  acceptInvite: notImplemented,
  updateMember: notImplemented,
  removeMember: notImplemented,
  getWorkspaceUsage: notImplemented,
});
