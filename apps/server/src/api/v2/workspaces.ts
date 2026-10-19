import { defineRouter, notFound, notImplemented, ok, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

const findWorkspace = (id: unknown) => F.workspaces.find((w) => w.workspace.id === id)?.workspace;

export const workspacesRouter = defineRouter({
  listWorkspaces: (req) => okPage(req, F.workspaces),
  createWorkspace: notImplemented,
  getWorkspace: (req) => {
    const workspace = findWorkspace(req.params.workspace_id);
    return workspace ? ok(req, workspace) : notFound(req, "워크스페이스");
  },
  updateWorkspace: notImplemented,
  listWorkspaceMembers: (req) => {
    const workspace = findWorkspace(req.params.workspace_id);
    if (!workspace) return notFound(req, "워크스페이스");
    return okPage(req, F.members.filter((m) => m.workspace_id === workspace.id));
  },
});
