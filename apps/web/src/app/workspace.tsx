// The active workspace (ROADMAP D5: data is workspace-scoped from day one). The choice is
// remembered per viewer; the team UI itself (invites, sharing) arrives in P5.

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMe, useWorkspaces, useWorkspaceEvents } from "../api/queries.ts";
import type { MyWorkspace, WorkspaceId } from "../api/types.ts";

const KEY = "lectern.web.workspace";

interface WorkspaceContextValue {
  workspaceId: WorkspaceId;
  current: MyWorkspace | undefined;
  workspaces: MyWorkspace[];
  switchTo: (id: WorkspaceId) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const list = useWorkspaces();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(remembered);

  const workspaces = list.data ?? [];
  const fallback = me.data?.personal_workspace_id ?? workspaces[0]?.workspace.id ?? null;
  const workspaceId = workspaces.some((w) => w.workspace.id === chosen) ? chosen : fallback;

  useWorkspaceEvents(workspaceId);

  const switchTo = useCallback(
    (id: WorkspaceId) => {
      setChosen(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        // Not remembered when storage is blocked.
      }
      void qc.invalidateQueries();
    },
    [qc],
  );

  useEffect(() => {
    if (workspaceId) document.documentElement.dataset.workspace = workspaceId;
  }, [workspaceId]);

  const value = useMemo<WorkspaceContextValue | null>(
    () =>
      workspaceId
        ? { workspaceId, current: workspaces.find((w) => w.workspace.id === workspaceId), workspaces, switchTo }
        : null,
    [workspaceId, workspaces, switchTo],
  );

  if (!value) return null; // first load: under 300 ms with fixtures, so no skeleton (DESIGN.md §4.2)
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider is missing");
  return value;
}
