// Scope and permission filter for ask and search (docs/adr/0009-ask-rag.md, "권한").
//
// Every retrieval runs against an AccessScope: one workspace plus an explicit list of
// recording ids the caller may read. The list is computed here from the thread's
// AskScope and the caller's membership, default-deny, and every query filters on both
// the workspace and the list. Passages and citations are checked against the same
// scope again before they reach the model or the client (assertInScope).
//
// The catalog (recordings, folders) is passed in: until the v2 tables exist (P2) the
// caller supplies the rows, and the function stays pure and table-testable.

import type { AskScope } from "@lectern/domain";

export type MembershipRole = "owner" | "admin" | "member" | "viewer";

export interface RecordingAccessRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  /** `private`: only the creator; `workspace`: every member. */
  visibility: "private" | "workspace" | (string & {});
  created_by: string;
  title: string;
  recorded_at: string;
  /** Recordings being deleted or not yet processed are skipped. */
  status: string;
}

export interface FolderRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
}

export interface Caller {
  userId: string;
  /** The caller's role in the workspace, or null when not a member. */
  role: MembershipRole | null;
}

export interface AccessScope {
  workspaceId: string;
  scope: AskScope;
  /** Recordings the caller may read within the scope, sorted. Empty means nothing to search. */
  recordingIds: readonly string[];
  /** Titles and dates for passage headers and citations. */
  recordings: ReadonlyMap<string, { title: string; recordedAt: string }>;
}

export type ScopeError = { code: "forbidden" | "not_found"; message: string };

/** Roles that may ask (it spends the workspace's AI budget). Viewers read only. */
export const ASK_ROLES: readonly MembershipRole[] = ["owner", "admin", "member"];

const SEARCHABLE_STATUS = new Set(["ready", "partial"]);

export function canReadRecording(caller: Caller, rec: RecordingAccessRow, workspaceId: string): boolean {
  if (rec.workspace_id !== workspaceId || caller.role === null) return false;
  if (!SEARCHABLE_STATUS.has(rec.status)) return false;
  // A private recording is the creator's alone, whatever the role: workspace admins
  // manage members, they do not read members' private notes.
  return rec.visibility === "workspace" || rec.created_by === caller.userId;
}

/** `rootId` and, if asked, every folder below it. Tolerates cycles. */
export function folderSubtree(folders: readonly FolderRow[], rootId: string, includeDescendants: boolean): Set<string> {
  const out = new Set([rootId]);
  if (!includeDescendants) return out;
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parent_id === null) continue;
    children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f.id]);
  }
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * Resolves what `caller` may search for `scope` in `workspaceId`. A recording or folder
 * the caller cannot see answers not_found (not forbidden), so ids do not leak.
 */
export function resolveAccessScope(args: {
  workspaceId: string;
  caller: Caller;
  scope: AskScope;
  recordings: readonly RecordingAccessRow[];
  folders: readonly FolderRow[];
  /** Roles allowed to run this (ASK_ROLES for ask; every role for plain search). */
  roles?: readonly MembershipRole[];
}): AccessScope | ScopeError {
  const { workspaceId, caller, scope } = args;
  if (caller.role === null || !(args.roles ?? ASK_ROLES).includes(caller.role)) {
    return { code: "forbidden", message: "이 워크스페이스에서 물어보기를 쓸 권한이 없습니다." };
  }
  const readable = args.recordings.filter((r) => canReadRecording(caller, r, workspaceId));
  let picked: RecordingAccessRow[];
  switch (scope.kind) {
    case "recording": {
      const rec = readable.find((r) => r.id === scope.recording_id);
      if (!rec) return { code: "not_found", message: "녹음을 찾을 수 없습니다." };
      picked = [rec];
      break;
    }
    case "folder": {
      const folder = args.folders.find((f) => f.id === scope.folder_id && f.workspace_id === workspaceId);
      if (!folder) return { code: "not_found", message: "폴더를 찾을 수 없습니다." };
      const ids = folderSubtree(
        args.folders.filter((f) => f.workspace_id === workspaceId),
        folder.id,
        scope.include_subfolders,
      );
      picked = readable.filter((r) => r.folder_id !== null && ids.has(r.folder_id));
      break;
    }
    case "workspace":
      picked = readable;
      break;
    default:
      return { code: "not_found", message: "알 수 없는 범위입니다." };
  }
  picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    workspaceId,
    scope,
    recordingIds: picked.map((r) => r.id),
    recordings: new Map(picked.map((r) => [r.id, { title: r.title, recordedAt: r.recorded_at }])),
  };
}

export function isScopeError(value: AccessScope | ScopeError): value is ScopeError {
  return "code" in value;
}

/** Defense in depth: throws if a chunk lies outside the scope it was retrieved for. */
export function assertInScope(access: AccessScope, chunk: { workspaceId: string; recordingId: string; id: string }): void {
  if (chunk.workspaceId !== access.workspaceId || !access.recordings.has(chunk.recordingId)) {
    throw new Error(`chunk ${chunk.id} is outside the ask scope`);
  }
}
