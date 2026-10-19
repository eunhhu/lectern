// Who may do what (ARCHITECTURE §6 "권한", §10): the one policy function every v2 route
// asks, plus the request helpers that turn its answer into 403/404. Workspace roles are
// separate from the operator role on the user (`users.role`): an operator gets no access
// to other people's workspaces here; the v1 admin console keeps its own endpoints.
//
// Rules (table-tested in apps/server/test/api-v2-access.test.ts):
//   - a non-member can do nothing in a workspace;
//   - every member reads the workspace, its folders, tags and members;
//   - owner/admin/member create recordings and edit folders and tags; viewers only read;
//   - owner/admin rename the workspace and change its settings;
//   - a `private` recording is visible to its creator only, whatever their role; a
//     `workspace` recording to every member;
//   - a recording is changed or deleted by its creator, or (when `workspace`-visible) by
//     an owner/admin. A viewer changes nothing.

import { db } from "../../db.ts";
import { apiError, forbidden, notFound, type V2Request } from "./common.ts";
import type { RecordingRow } from "./rows.ts";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type Action =
  | "workspace:read"
  | "workspace:update"
  | "folder:write"
  | "tag:write"
  | "recording:create"
  | "recording:read"
  | "recording:update"
  | "recording:delete";

export interface Caller {
  userId: string;
  /** The caller's role in the workspace in question; null when not a member. */
  role: WorkspaceRole | null;
}

const WRITERS: readonly WorkspaceRole[] = ["owner", "admin", "member"];
const MANAGERS: readonly WorkspaceRole[] = ["owner", "admin"];

export function can(caller: Caller, action: Action, recording?: Pick<RecordingRow, "created_by" | "visibility">): boolean {
  const { role } = caller;
  if (!role) return false;
  switch (action) {
    case "workspace:read":
      return true;
    case "workspace:update":
      return MANAGERS.includes(role);
    case "folder:write":
    case "tag:write":
    case "recording:create":
      return WRITERS.includes(role);
    case "recording:read":
      return Boolean(recording) && (recording!.visibility === "workspace" || recording!.created_by === caller.userId);
    case "recording:update":
    case "recording:delete": {
      if (!recording || role === "viewer") return false;
      if (recording.created_by === caller.userId) return true;
      return recording.visibility === "workspace" && MANAGERS.includes(role);
    }
  }
}

/** The caller's role in `workspaceId`, or null. */
export function roleIn(userId: string, workspaceId: string): WorkspaceRole | null {
  const row = db.query(`SELECT role FROM membership WHERE workspace_id = ? AND user_id = ?`).get(workspaceId, userId) as
    | { role: WorkspaceRole }
    | null;
  return row?.role ?? null;
}

export function callerIn(req: V2Request, workspaceId: string): Caller {
  return { userId: req.user!.id, role: roleIn(req.user!.id, workspaceId) };
}

/** The caller (allowed to `action` in the workspace) or the 403 response. */
export function requireWorkspace(req: V2Request, workspaceId: unknown, action: Action = "workspace:read"): Caller | Response {
  const caller = callerIn(req, String(workspaceId));
  if (!caller.role) return forbidden(req);
  if (!can(caller, action)) return apiError(req.c, 403, "forbidden", "이 작업을 할 권한이 없습니다.");
  return caller;
}

/** Back-compat name used by the read-only routers. */
export function denyUnlessMember(req: V2Request, workspaceId: unknown): Response | null {
  const caller = requireWorkspace(req, workspaceId);
  return caller instanceof Response ? caller : null;
}

/**
 * A recording the caller may `action`. Unknown, or not visible to the caller: 404 (a
 * private recording's existence is not revealed). Visible but not allowed: 403.
 */
export function loadRecording(req: V2Request, recordingId: unknown, action: Action = "recording:read"): RecordingRow | Response {
  const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(String(recordingId)) as RecordingRow | null;
  if (!recording) return notFound(req, "녹음");
  const caller = callerIn(req, recording.workspace_id);
  if (!can(caller, "recording:read", recording)) return notFound(req, "녹음");
  if (action !== "recording:read" && !can(caller, action, recording)) {
    return apiError(req.c, 403, "forbidden", "이 녹음을 바꿀 권한이 없습니다.");
  }
  return recording;
}

/** SQL filter for the recordings `userId` can read in one workspace (params: user id). */
export const VISIBLE_RECORDING_SQL = `(r.visibility = 'workspace' OR r.created_by = ?)`;
