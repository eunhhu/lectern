// TanStack Query hooks over the ApiClient interface. Hooks never import an
// implementation: the client comes from <ApiContext>, so swapping fixtures for the real
// /api/v2 client happens in api/index.ts alone.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AdminAuditQuery, AdminJobsQuery, AdminLecture, AdminLecturesQuery, AdminNewUser, AdminSettings, AdminUserPatch } from "./admin.ts";
import { createContext, useContext, useEffect } from "react";
import { ApiClientError, type ApiClient } from "./client.ts";
import { errorMessage } from "./errors.ts";
import { askSuggestions, pickSuggestions } from "../lib/ask-suggestions.ts";
import type {
  AskScope,
  ActionItem,
  BatchRecordingsRequest,
  CreateAccessTokenRequest,
  CreateInviteRequest,
  WorkspaceQuota,
  MembershipRole,
  CreateExportRequest,
  DataExport,
  RecordingProgress,
  CreateFolderRequest,
  CreateShareLinkRequest,
  CreateTagRequest,
  DocumentBody,
  EventCandidate,
  JobId,
  RecordingListItem,
  SearchKind,
  ServerEvent,
  StageName,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateRecordingRequest,
  UpdateTagRequest,
  MyWorkspace,
  WorkspaceId,
  WorkspaceSettings,
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
  accessTokens: ["access-tokens"] as const,
  identities: ["identities"] as const,
  exports: ["exports"] as const,
  accountDeletion: ["account-deletion"] as const,
  oauthProviders: ["oauth-providers"] as const,
  invites: (ws: string) => ["invites", ws] as const,
  usage: (ws: string) => ["usage", ws] as const,
  admin: ["admin"] as const,
  adminOverview: ["admin", "overview"] as const,
  adminJobs: (state?: string, kind?: string) => ["admin", "jobs", state ?? null, kind ?? null] as const,
  adminJob: (id: string) => ["admin", "job", id] as const,
  adminUsage: (period: string) => ["admin", "usage", period] as const,
  adminLectures: (status?: string, q?: string, owner?: string) => ["admin", "lectures", status ?? null, q ?? null, owner ?? null] as const,
  adminLecture: (id: string) => ["admin", "lecture", id] as const,
  adminStorage: ["admin", "storage"] as const,
  adminOps: ["admin", "ops"] as const,
  adminSettings: ["admin", "settings"] as const,
  adminAudit: (action?: string, q?: string) => ["admin", "audit", action ?? null, q ?? null] as const,
  workspaceActionItems: (ws: string) => ["workspace-action-items", ws] as const,
  calendar: (ws: string) => ["calendar", ws] as const,
  shareLinks: (ws: string) => ["share-links", ws] as const,
  integrations: (ws: string) => ["integrations", ws] as const,
  calendarFeed: (ws: string) => ["calendar-feed", ws] as const,
  assetPages: (id: string) => ["asset-pages", id] as const,
  search: (ws: string, q: string, kind?: string) => ["search", ws, q, kind ?? null] as const,
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

// --- admin console (P5-12) -------------------------------------------------------------

/** Operators are the system role owner or admin (the server's isAdminUser). */
export function useIsOperator(): boolean | undefined {
  const me = useMe().data;
  if (!me) return undefined;
  return me.system_role === "owner" || me.system_role === "admin";
}

/**
 * `pollMs`: read again on a timer while the tab is visible (TanStack pauses a background
 * tab), as the old console did on 개요 and 작업.
 */
export function useAdminOverview(enabled = true, pollMs?: number) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminOverview, queryFn: () => api.admin.overview(), enabled, refetchInterval: pollMs ?? false });
}

export function useAdminOps(options: { enabled?: boolean; pollMs?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminOps, queryFn: () => api.admin.ops(), enabled: options.enabled ?? true, refetchInterval: options.pollMs ?? false });
}

export function useAdminStorage(options: { enabled?: boolean; pollMs?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminStorage, queryFn: () => api.admin.storage(), enabled: options.enabled ?? true, refetchInterval: options.pollMs ?? false });
}

/** The settings form's values: read once; a save writes the answer back. */
export function useAdminSettings() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminSettings, queryFn: () => api.admin.settings(), staleTime: Infinity });
}

export function useSaveAdminSettings() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AdminSettings>) => api.admin.saveSettings(patch),
    gcTime: 0,
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.adminSettings, settings);
      return Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.adminOverview }),
        qc.invalidateQueries({ queryKey: queryKeys.adminStorage }),
        qc.invalidateQueries({ queryKey: ["admin", "audit"] }),
      ]);
    },
  });
}

export function useAdminAudit(filter: Pick<AdminAuditQuery, "action" | "q">) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.adminAudit(filter.action, filter.q),
    queryFn: ({ pageParam }) => api.admin.audit({ ...filter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** After a storage or maintenance run: every admin read but the settings form. */
export function useRefreshAdmin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && q.queryKey[1] !== "settings" });
}

export function useUpdateAdminUser() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUserPatch }) => api.admin.updateUser(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminOverview }),
    // The patch can carry a new password: do not keep it in the mutation cache.
    gcTime: 0,
  });
}

export function useCreateAdminUser() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminNewUser) => api.admin.createUser(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminOverview }),
    gcTime: 0,
  });
}

export function useDeleteAdminUser() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminOverview }),
  });
}

/** Jobs newest first, a page at a time ("더 보기"). */
export function useAdminJobs(filter: Pick<AdminJobsQuery, "state" | "kind">) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.adminJobs(filter.state, filter.kind),
    queryFn: ({ pageParam }) => api.admin.jobs({ ...filter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/** How many jobs are in a state, up to `cap` (one page): the overview's counts. */
export function useAdminJobCount(state: AdminJobsQuery["state"], cap = 200) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.adminJobs(state, undefined), "count", cap],
    queryFn: async () => {
      const page = await api.admin.jobs({ state, limit: cap });
      return { count: page.items.length, more: page.next_cursor !== null };
    },
  });
}

export function useAdminJob(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminJob(id), queryFn: () => api.admin.job(id) });
}

export function useRetryJob() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.retryJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "job"] }).then(() => qc.invalidateQueries({ queryKey: ["admin", "jobs"] })),
  });
}

/** Every account's v1 lectures, fifty at a time ("더 보기"). */
/** The old console read the lectures again every five seconds while one was being worked on. */
const ADMIN_LECTURE_POLL_MS = 5_000;
const lectureBusy = (l: Pick<AdminLecture, "status" | "job_state">) => l.status === "processing" || l.job_state !== null;

export function useAdminLectures(filter: Pick<AdminLecturesQuery, "status" | "q" | "owner">) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.adminLectures(filter.status, filter.q, filter.owner),
    queryFn: ({ pageParam }) => api.admin.lectures({ ...filter, offset: pageParam, limit: 50 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.lectures.length < last.total ? last.offset + last.lectures.length : undefined),
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.lectures.some(lectureBusy)) ? ADMIN_LECTURE_POLL_MS : false),
  });
}

export function useAdminLecture(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.adminLecture(id),
    queryFn: () => api.admin.lecture(id),
    refetchInterval: (q) => (q.state.data && lectureBusy(q.state.data) ? ADMIN_LECTURE_POLL_MS : false),
  });
}

/** A lecture action (retry, compact, delete audio, delete): lists, the lecture and the counts change. */
export function useAdminLectureAction<T>(run: (api: ReturnType<typeof useApi>, id: string) => Promise<T>) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => run(api, id),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "lectures"] }),
        qc.invalidateQueries({ queryKey: ["admin", "lecture"] }),
        qc.invalidateQueries({ queryKey: queryKeys.adminOverview }),
      ]),
  });
}

export function useAdminUsage(period: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.adminUsage(period), queryFn: () => api.admin.usage(period) });
}

export function useSetQuota() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, quota }: { workspaceId: string; quota: WorkspaceQuota }) => api.admin.setQuota(workspaceId, quota),
    onSuccess: (_q, { workspaceId }) => qc.invalidateQueries({ queryKey: queryKeys.usage(workspaceId) }),
  });
}

// --- team workspaces (P5-11) ---------------------------------------------------------

export function useUpdateMember(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MembershipRole }) => api.updateMember(ws, userId, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members(ws) });
      // My own role may have changed.
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useRemoveMember(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(ws, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useInvites(ws: WorkspaceId, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.invites(ws), queryFn: () => allPages(() => api.listInvites(ws)), enabled });
}

export function useCreateInvite(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteRequest) => api.createInvite(ws, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.invites(ws) }),
  });
}

export function useRevokeInvite(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(ws, inviteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.invites(ws) }),
  });
}

/** Joining adds a workspace: the list is read again. The token is never cached. */
export function useAcceptInvite() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (token: string) => api.acceptInvite(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
}

export function useWorkspaceUsage(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.usage(ws), queryFn: () => api.getWorkspaceUsage(ws) });
}

export function useDevices() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.devices, queryFn: () => allPages(() => api.listDevices()) });
}

// --- account (P5-10) -----------------------------------------------------------------

export function useAccessTokens() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.accessTokens, queryFn: () => allPages(() => api.listAccessTokens()) });
}

/**
 * The secret is only in the mutation result: it never goes into the query cache, and
 * `gcTime: 0` drops the mutation (and the secret) as soon as the dialog that made it closes.
 */
export function useCreateAccessToken() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: CreateAccessTokenRequest) => api.createAccessToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.accessTokens }),
  });
}

export function useRevokeAccessToken() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api.revokeAccessToken(tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.accessTokens }),
  });
}

export function useIdentities() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.identities, queryFn: () => allPages(() => api.listIdentities()) });
}

export function useUnlinkIdentity() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (identityId: string) => api.unlinkIdentity(identityId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.identities }),
  });
}

const exportBusy = (e: DataExport) => e.state === "queued" || e.state === "running";

/** Re-reads every 10 s while an export is being made, and stops when none is. */
export function useExports() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.exports,
    queryFn: () => allPages(() => api.listExports()),
    refetchInterval: (query) => (query.state.data?.some(exportBusy) ? 10_000 : false),
  });
}

export function useCreateExport() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExportRequest) => api.createExport(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.exports }),
  });
}

export function useAccountDeletion() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.accountDeletion, queryFn: () => api.getAccountDeletion() });
}

/** The password is the mutation's variable: `gcTime: 0` forgets it once the dialog closes. */
export function useRequestAccountDeletion() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (password?: string) => api.requestAccountDeletion(password),
    onSuccess: (info) => qc.setQueryData(queryKeys.accountDeletion, info),
  });
}

export function useCancelAccountDeletion() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelAccountDeletion(),
    onSuccess: (info) => qc.setQueryData(queryKeys.accountDeletion, info),
  });
}

/**
 * Which "…로 계속하기" buttons to draw. The client remembers a definite answer for the
 * session (asking again costs nothing); one spoiled by a network error is asked again
 * when the data goes stale.
 */
export function useOAuthProviders() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.oauthProviders, queryFn: () => api.oauthProviders(), staleTime: 5 * 60_000, retry: false });
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

// --- calendar connections and reminders (P4-07) -------------------------------------
// Answers 501 while the server has the calendar feature off: no retries, the screens say
// "준비 중입니다." instead.

export function useIntegrations(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.integrations(ws), queryFn: () => allPages(() => api.listIntegrations(ws)), retry: false });
}

export function useCalendarFeed(ws: WorkspaceId) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.calendarFeed(ws), queryFn: () => api.getCalendarFeed(ws), retry: false });
}

export function useStartGoogleIntegration(ws: WorkspaceId) {
  const api = useApi();
  return useMutation({ mutationFn: (returnTo: string) => api.startGoogleIntegration(ws, returnTo) });
}

export function useDisconnectIntegration(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disconnectIntegration(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.integrations(ws) }),
  });
}

export function useCreateCalendarFeed(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createCalendarFeed(ws),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.calendarFeed(ws) }),
  });
}

export function useDeleteCalendarFeed(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteCalendarFeed(ws),
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.calendarFeed(ws) }),
  });
}

/**
 * Changes some workspace settings. Always sends the whole merged object (the current
 * settings with `patch` on top), so a server that replaces settings keeps the rest.
 */
export function useUpdateWorkspaceSettings(ws: WorkspaceId) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<WorkspaceSettings>) => {
      const current = qc.getQueryData<MyWorkspace[]>(queryKeys.workspaces)?.find((w) => w.workspace.id === ws)?.workspace.settings ?? {};
      return api.updateWorkspaceSettings(ws, { ...current, ...patch });
    },
    onSuccess: (workspace) => {
      qc.setQueryData<MyWorkspace[]>(queryKeys.workspaces, (list) => list?.map((w) => (w.workspace.id === ws ? { ...w, workspace } : w)));
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
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
  const api = useApi();
  const recordings = (useRecordings(ws).data ?? []).filter((r) => PROCESSED_STATUSES.has(r.status));
  const recordingId = scope.kind === "recording" ? scope.recording_id : "";
  const questions = useQuestions(recordingId, scope.kind === "recording").data;
  const fallback = askSuggestions({ scope, recordings, questions: questions ?? [] });
  const scopeId = scope.kind === "recording" ? scope.recording_id : scope.kind === "folder" ? scope.folder_id : "";
  // The server's list (D-P2-4) first; any error (501 included) quietly keeps the fallback.
  const remote = useQuery({
    queryKey: ["ask-suggestions", ws, scope.kind, scopeId] as const,
    queryFn: () =>
      api
        .listAskSuggestions({ workspace_id: ws, scope_type: scope.kind, ...(scopeId ? { scope_id: scopeId } : {}) })
        .then((r) => r.suggestions),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return pickSuggestions(remote.data, fallback);
}

/** The dry-run estimate shown before a reprocess is confirmed; never cached. */
export function useReprocessEstimate(recordingId: string, mode: "full" | "document", enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["reprocess-estimate", recordingId, mode] as const,
    queryFn: () => api.reprocessRecording(recordingId, { mode, dry_run: true }),
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
}

export function useReprocess(recordingId: string, ws: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: "full" | "document") => api.reprocessRecording(recordingId, { mode }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.recording(recordingId) });
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
    },
  });
}

/** The search screen: hybrid /search hits of the workspace, two characters or more. */
export function useSearchHits(ws: WorkspaceId, q: string, kind?: SearchKind) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.search(ws, q, kind),
    queryFn: () => api.search({ workspace_id: ws, q, kind, limit: 50 }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

/** A PDF's pages and whether it is a scan (the viewer's OCR offer). */
export function useAssetPages(assetId: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.assetPages(assetId), queryFn: () => api.listAssetPages(assetId), retry: false });
}

/** The dry-run OCR estimate shown before OCR is confirmed; never cached. */
export function useOcrEstimate(assetId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["ocr-estimate", assetId] as const,
    queryFn: () => api.ocrAsset(assetId, { dry_run: true }),
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
}

/** Queues OCR of a scanned PDF (`dry_run: false`); only called from the confirm button of the estimate dialog. */
export function useOcrAsset(assetId: string, recordingId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ocrAsset(assetId, { dry_run: false }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.assetPages(assetId) });
      void qc.invalidateQueries({ queryKey: queryKeys.recording(recordingId) });
    },
  });
}

export function useDeleteAudio(recordingId: string, ws: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteRecordingAudio(recordingId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.recording(recordingId) });
      void qc.invalidateQueries({ queryKey: queryKeys.recordings(ws) });
    },
  });
}
