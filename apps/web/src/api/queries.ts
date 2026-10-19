// TanStack Query hooks over the ApiClient interface. Hooks never import an
// implementation: the client comes from <ApiContext>, so swapping fixtures for the real
// /api/v2 client happens in api/index.ts alone.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect } from "react";
import { ApiClientError, type ApiClient } from "./client.ts";
import type { JobId, RecordingListItem, ServerEvent, StageName, UpdateRecordingRequest, WorkspaceId } from "./types.ts";

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext is missing");
  return api;
}

export const queryKeys = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  folders: (ws: string) => ["folders", ws] as const,
  tags: (ws: string) => ["tags", ws] as const,
  recordings: (ws: string) => ["recordings", ws] as const,
  recording: (id: string) => ["recording", id] as const,
  transcript: (id: string) => ["transcript", id] as const,
  document: (id: string) => ["document", id] as const,
  questions: (id: string) => ["questions", id] as const,
  recordingEvents: (id: string) => ["recording-events", id] as const,
  actionItems: (id: string) => ["action-items", id] as const,
  suggestions: (ws: string) => ["suggestions", ws] as const,
  jobProgress: (jobId: string) => ["job-progress", jobId] as const,
};

/** Follows `next_cursor` until the last page (lists in the shell are small). */
async function allPages<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; next_cursor: string | null }>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe() });
}

export function useWorkspaces() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.workspaces, queryFn: () => allPages(() => api.listWorkspaces()) });
}

export function useFolders(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.folders(ws), queryFn: () => allPages(() => api.listFolders(ws)) });
}

export function useTags(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tags(ws), queryFn: () => allPages(() => api.listTags(ws)) });
}

export function useRecordings(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.recordings(ws),
    queryFn: () => allPages((cursor) => api.listRecordings({ workspace_id: ws, cursor, limit: 200 })),
  });
}

export function useRecording(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.recording(id), queryFn: () => api.getRecording(id) });
}

export function useTranscript(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.transcript(id), queryFn: () => api.getTranscript(id), enabled, staleTime: Infinity });
}

export function useDocument(documentId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.document(documentId ?? "none"),
    queryFn: () => api.getDocument(documentId!),
    enabled: Boolean(documentId),
  });
}

export function useQuestions(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.questions(id), queryFn: () => allPages(() => api.listQuestions(id)), enabled });
}

export function useRecordingEvents(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.recordingEvents(id), queryFn: () => allPages(() => api.listRecordingEvents(id)), enabled });
}

export function useActionItems(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.actionItems(id), queryFn: () => allPages(() => api.listActionItems(id)), enabled });
}

export function useSuggestions(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.suggestions(ws),
    queryFn: () => allPages((cursor) => api.listCalendarSuggestions({ workspace_id: ws, cursor })),
  });
}

export interface JobProgressValue {
  stage: StageName;
  progress: number | null;
}

/**
 * Latest progress of a job. The REST API has no progress field (README "domain 요청"),
 * so this is fed only by `job.progress` events, which the event stream replays on connect.
 */
export function useJobProgress(jobId: JobId | null | undefined) {
  return useQuery<JobProgressValue | null>({
    queryKey: queryKeys.jobProgress(jobId ?? "none"),
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });
}

function applyEvent(qc: QueryClient, ws: string, event: ServerEvent) {
  switch (event.type) {
    case "job.progress": {
      const value: JobProgressValue = { stage: event.payload.stage, progress: event.payload.progress };
      qc.setQueryData(queryKeys.jobProgress(event.payload.job_id), () => value);
      break;
    }
    case "recording.created":
    case "recording.updated":
    case "job.updated":
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
      if (event.recording_id) void qc.invalidateQueries({ queryKey: queryKeys.recording(event.recording_id) });
      break;
    case "recording.deleted":
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
      qc.removeQueries({ queryKey: queryKeys.recording(event.payload.recording_id) });
      break;
    case "transcript.ready":
      if (event.recording_id) void qc.invalidateQueries({ queryKey: queryKeys.transcript(event.recording_id) });
      break;
    case "document.updated":
      void qc.invalidateQueries({ queryKey: queryKeys.document(event.payload.document_id) });
      if (event.recording_id) void qc.invalidateQueries({ queryKey: queryKeys.recording(event.recording_id) });
      break;
    case "calendar.suggested":
      void qc.invalidateQueries({ queryKey: queryKeys.suggestions(ws) });
      break;
    default:
      // Unknown event types are ignored (the domain's unions are open).
      break;
  }
}

/** Keeps the query cache in step with the workspace event stream. */
export function useWorkspaceEvents(ws: WorkspaceId | null) {
  const api = useApi();
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws) return;
    return api.subscribe(ws, (event) => applyEvent(qc, ws, event));
  }, [api, qc, ws]);
}

export interface BulkResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

async function settle(ids: string[], run: (id: string) => Promise<unknown>): Promise<BulkResult> {
  // No bulk endpoint yet (README "domain 요청"): one request per recording, in parallel.
  const results = await Promise.allSettled(ids.map(run));
  const out: BulkResult = { succeeded: [], failed: [] };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out.succeeded.push(ids[i]!);
    else out.failed.push({ id: ids[i]!, message: r.reason instanceof ApiClientError ? r.reason.message : "요청을 처리하지 못했습니다." });
  });
  return out;
}

export function useBulkUpdate(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: (rec: RecordingListItem | undefined) => UpdateRecordingRequest }) => {
      const list = qc.getQueryData<RecordingListItem[]>(queryKeys.recordings(ws)) ?? [];
      return settle(ids, (id) => api.updateRecording(id, patch(list.find((r) => r.id === id))));
    },
    onSettled: (_data, _error, { ids }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
      for (const id of ids) void qc.invalidateQueries({ queryKey: queryKeys.recording(id) });
    },
  });
}

export function useBulkDelete(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => settle(ids, (id) => api.deleteRecording(id)),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) }),
  });
}

export function useDecideSuggestion(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "accepted" | "dismissed" }) => api.updateCalendarSuggestion(id, { status }),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.suggestions(ws) }),
  });
}
