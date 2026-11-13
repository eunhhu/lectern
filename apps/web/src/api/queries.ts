// TanStack Query hooks over the ApiClient interface. Hooks never import an
// implementation: the client comes from <ApiContext>, so swapping fixtures for the real
// /api/v2 client happens in api/index.ts alone.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect } from "react";
import { ApiClientError, type ApiClient } from "./client.ts";
import { errorMessage } from "./errors.ts";
import { askSuggestions } from "../lib/ask-suggestions.ts";
import type {
  AskScope,
  ActionItem,
  BatchRecordingsRequest,
  RecordingProgress,
  CreateFolderRequest,
  CreateShareLinkRequest,
  CreateTagRequest,
  DocumentBody,
  EventCandidate,
  JobId,
  RecordingListItem,
  ServerEvent,
  StageName,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateRecordingRequest,
  UpdateTagRequest,
  WorkspaceId,
} from "./types.ts";

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext is missing");
  return api;
}

export const queryKeys = {
  session: ["session"] as const,
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
  members: (ws: string) => ["members", ws] as const,
  devices: ["devices"] as const,
  workspaceActionItems: (ws: string) => ["workspace-action-items", ws] as const,
  calendar: (ws: string) => ["calendar", ws] as const,
  shareLinks: (ws: string) => ["share-links", ws] as const,
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

/** Saves a user edit as a new version (If-Match on `baseVersion`): a structured `body` or a legacy note's Markdown. */
export function useSaveDocument(documentId: string, recordingId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body?: DocumentBody; markdown?: string; baseVersion: number }) =>
      api.createDocumentVersion(documentId, v.body !== undefined ? { body: v.body } : { markdown: v.markdown! }, v.baseVersion),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.document(documentId) });
      void qc.invalidateQueries({ queryKey: queryKeys.recording(recordingId) });
    },
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
 * Latest `job.progress` event of a job (the event stream sends them as the job runs).
 * Screens start from the recording's REST `progress` and let these replace it
 * (useLiveProgress).
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

export interface LiveProgress {
  stage: StageName;
  progress: number | null;
  /** Short status line from the server (`노트 정리 중...`), when it sends one. */
  message: string | null;
  /** Place in the queue while waiting (1 = next). */
  queuePosition: number | null;
}

/** A recording's progress: the REST value first, then live `job.progress` events. */
export function useLiveProgress(initial: RecordingProgress | null | undefined): LiveProgress | null {
  const live = useJobProgress(initial?.job_id).data;
  if (!initial && !live) return null;
  return {
    stage: live?.stage ?? initial!.stage,
    progress: live?.progress ?? initial?.progress ?? null,
    message: live ? null : (initial?.message ?? null),
    queuePosition: initial?.state === "queued" && !live ? initial.queue_position : null,
  };
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
    else out.failed.push({ id: ids[i]!, message: errorMessage(r.reason, "요청을 처리하지 못했습니다.") });
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

/** POST /recordings/batch: one request for many recordings, results per recording. */
export function useBatchRecordings(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: BatchRecordingsRequest): Promise<BulkResult> => {
      const { results } = await api.batchRecordings(body);
      return {
        succeeded: results.filter((r) => r.ok).map((r) => r.recording_id),
        failed: results.filter((r) => !r.ok).map((r) => ({ id: r.recording_id, message: r.error?.message ?? "요청을 처리하지 못했습니다." })),
      };
    },
    onSettled: (_data, _error, body) => {
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
      for (const id of body.recording_ids) {
        if (body.action === "delete") qc.removeQueries({ queryKey: queryKeys.recording(id) });
        else void qc.invalidateQueries({ queryKey: queryKeys.recording(id) });
      }
    },
  });
}

export function useDecideSuggestion(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "accepted" | "dismissed" }) => api.updateCalendarSuggestion(id, { status }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suggestions(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.calendar(ws) });
    },
  });
}

// --- account ----------------------------------------------------------------

export function useMembers(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.members(ws), queryFn: () => allPages(() => api.listMembers(ws)) });
}

export function useDevices() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.devices, queryFn: () => allPages(() => api.listDevices()) });
}

export function useUpdateMe() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => api.updateMe(body),
    onSuccess: (me) => {
      qc.setQueryData(queryKeys.me, me);
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

// --- folders and tags -------------------------------------------------------

function useOrganise<TArgs, TResult>(ws: WorkspaceId, run: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.folders(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.tags(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
      void qc.invalidateQueries({ queryKey: ["recording"] });
    },
  });
}

export function useFolderActions(ws: WorkspaceId) {
  const api = useApi();
  return {
    create: useOrganise(ws, (body: Omit<CreateFolderRequest, "workspace_id">) => api.createFolder({ ...body, workspace_id: ws })),
    update: useOrganise(ws, ({ id, body }: { id: string; body: UpdateFolderRequest }) => api.updateFolder(id, body)),
    remove: useOrganise(ws, (id: string) => api.deleteFolder(id)),
  };
}

export function useTagActions(ws: WorkspaceId) {
  const api = useApi();
  return {
    create: useOrganise(ws, (body: Omit<CreateTagRequest, "workspace_id">) => api.createTag({ ...body, workspace_id: ws })),
    update: useOrganise(ws, ({ id, body }: { id: string; body: UpdateTagRequest }) => api.updateTag(id, body)),
    remove: useOrganise(ws, (id: string) => api.deleteTag(id)),
  };
}

// --- calendar -----------------------------------------------------------------

/** The workspace's action items (GET /action-items), each with its recording. */
export function useWorkspaceActionItems(ws: WorkspaceId) {
  const api = useApi();
  const recordings = useRecordings(ws).data;
  const items = useQuery({
    queryKey: queryKeys.workspaceActionItems(ws),
    queryFn: () => allPages((cursor) => api.listWorkspaceActionItems({ workspace_id: ws, cursor, limit: 200 })),
  });
  const byId = new Map((recordings ?? []).map((r) => [r.id as string, r]));
  return {
    ...items,
    data:
      items.data && recordings
        ? items.data.flatMap((item): { item: ActionItem; recording: RecordingListItem }[] => {
            const recording = byId.get(item.recording_id);
            return recording ? [{ item, recording }] : [];
          })
        : undefined,
  };
}

/** Events the user confirmed (accepted, or already synced to their calendar), in one request. */
export function useConfirmedEvents(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.calendar(ws),
    queryFn: async (): Promise<EventCandidate[]> => {
      const events = await allPages((cursor) => api.listCalendarSuggestions({ workspace_id: ws, statuses: "accepted,synced", cursor, limit: 200 }));
      return events.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
    },
  });
}

export function useUpdateActionItem(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "done" | "dismissed" }) => api.updateActionItem(id, { status }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaceActionItems(ws) });
      void qc.invalidateQueries({ queryKey: ["action-items"] });
    },
  });
}

// --- share links (D-P2-3) ---------------------------------------------------------------

/** Links that are not revoked (one recording's, or the workspace's). The token URL is never here. */
export function useShareLinks(ws: string, targetId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.shareLinks(ws), targetId ?? "all"],
    queryFn: () => api.listShareLinks(ws as WorkspaceId, targetId).then((p) => p.items),
  });
}

export function useCreateShareLink(ws: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShareLinkRequest) => api.createShareLink(body),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.shareLinks(ws) }),
  });
}

export function useRevokeShareLink(ws: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeShareLink(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.shareLinks(ws) }),
  });
}

export function useRevokeDevice() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeDevice(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.devices }),
  });
}

// --- 물어보기 ---------------------------------------------------------------------
// Answers stream through ApiClient.askQuestion (routes/ask/session.ts); these read
// history. Threads are not filtered by workspace id here: while the server bridges v1
// lectures, it answers with the caller's own workspace id rather than the one asked for.

export const askKeys = {
  threads: (ws: string) => ["ask-threads", ws] as const,
  thread: (id: string | null) => ["ask-thread", id] as const,
};

export function useAskThreads(ws: WorkspaceId, recordingId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...askKeys.threads(ws), recordingId ?? null],
    queryFn: () => allPages((cursor) => api.listAskThreads({ workspace_id: ws, cursor, limit: 200, ...(recordingId ? { recording_id: recordingId as never } : {}) })),
    retry: (count, err) => !(err instanceof ApiClientError && err.status > 0 && err.status < 500) && count < 1,
  });
}

/** A saved conversation; read again every 2 s while one of its turns is still running. */
export function useAskThread(threadId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: askKeys.thread(threadId),
    enabled: threadId !== null,
    queryFn: () => api.getAskThread(threadId!),
    refetchInterval: (query) => (query.state.data?.turns.some((t) => t.status === "running") ? 2_000 : false),
  });
}

const PROCESSED_STATUSES = new Set(["ready", "partial"]);

/** Chips under the composer, from the notes the screen already loaded. */
export function useAskSuggestions(ws: WorkspaceId, scope: AskScope): string[] {
  const recordings = (useRecordings(ws).data ?? []).filter((r) => PROCESSED_STATUSES.has(r.status));
  const recordingId = scope.kind === "recording" ? scope.recording_id : "";
  const questions = useQuestions(recordingId, scope.kind === "recording").data;
  return askSuggestions({ scope, recordings, questions: questions ?? [] });
}
