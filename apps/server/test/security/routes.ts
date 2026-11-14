// Sample requests for every route of the v2 table (the same samples as api-v2.test.ts), with
// path parameters, queries and bodies that the security tests can point at real resources.

import { API_BASE_PATH, HEADER, ROUTES, versionETag, type RouteDef } from "@lectern/domain";
import { handleRequest } from "../../src/index.ts";

export const SAMPLE_ID = "0199f0a0-1000-7000-8000-00000000abcd";

export const PATH_PARAMS: Record<string, string> = {
  workspace_id: SAMPLE_ID,
  device_id: "ses_0000",
  token_id: "tok_0000",
  folder_id: SAMPLE_ID,
  tag_id: SAMPLE_ID,
  view_id: SAMPLE_ID,
  upload_id: SAMPLE_ID,
  part: "1",
  recording_id: SAMPLE_ID,
  speaker_id: SAMPLE_ID,
  asset_id: SAMPLE_ID,
  document_id: SAMPLE_ID,
  version: "1",
  action_item_id: SAMPLE_ID,
  job_id: SAMPLE_ID,
  event_candidate_id: SAMPLE_ID,
  integration_id: SAMPLE_ID,
  share_link_id: SAMPLE_ID,
  thread_id: SAMPLE_ID,
  identity_id: SAMPLE_ID,
  invite_id: SAMPLE_ID,
  user_id: SAMPLE_ID,
  export_id: SAMPLE_ID,
};

/** Required query values, per operation (`workspace_id` is replaced by the caller's choice). */
export function queriesFor(route: RouteDef, workspaceId: string): Record<string, string> {
  const op = route.operationId;
  const special: Record<string, Record<string, string>> = {
    search: { workspace_id: workspaceId, q: "보안" },
    streamEvents: { workspace_id: workspaceId },
    getAskUsage: { workspace_id: workspaceId },
    exportDocument: { format: "md" },
    listAskSuggestions: { workspace_id: workspaceId, scope_type: "workspace" },
  };
  if (special[op]) return special[op]!;
  const byWorkspace = [
    "listFolders",
    "listTags",
    "listSavedViews",
    "listRecordings",
    "listActionItems",
    "listCalendarSuggestions",
    "listIntegrations",
    "listShareLinks",
    "listAskThreads",
    "getCalendarFeed",
    "deleteCalendarFeed",
  ];
  return byWorkspace.includes(op) ? { workspace_id: workspaceId } : {};
}

export interface Targets {
  workspaceId: string;
  recordingId: string;
  documentId: string;
  eventCandidateId: string;
}

/** A valid JSON body for every JSON-body route, pointed at `t`. */
export function bodyFor(route: RouteDef, t: Targets): unknown {
  const ws = t.workspaceId;
  const bodies: Record<string, unknown> = {
    updateMe: { display_name: "새 이름" },
    createAccessToken: { workspace_id: ws, name: "스크립트", scopes: ["recordings:read"] },
    createWorkspace: { name: "새 팀" },
    updateWorkspace: { name: "이름 변경" },
    createFolder: { workspace_id: ws, name: "새 폴더" },
    updateFolder: { name: "이름 변경" },
    createTag: { workspace_id: ws, name: "새 태그", color: "blue" },
    updateTag: { color: "green" },
    createUpload: { workspace_id: ws, files: [{ kind: "audio", filename: "lecture.m4a", mime: "audio/mp4", bytes: 1024 }] },
    createSavedView: { workspace_id: ws, name: "보기", query: {} },
    updateSavedView: { name: "새 보기" },
    batchRecordings: { action: "delete", recording_ids: [t.recordingId] },
    updateRecording: { title: "새 제목" },
    updateSpeaker: { display_name: null },
    reprocessRecording: { mode: "document", dry_run: true },
    ocrAsset: { dry_run: true },
    createDocumentVersion: { markdown: "# 고친 노트" },
    updateActionItem: { status: "done" },
    updateCalendarSuggestion: { status: "accepted" },
    batchCalendarSuggestions: { event_candidate_ids: [t.eventCandidateId], action: "dismiss" },
    startGoogleIntegration: { workspace_id: ws },
    createCalendarFeed: { workspace_id: ws },
    createShareLink: { target_type: "document", target_id: t.documentId, scope: { transcript: false, audio: false } },
    updateShareLink: { password: null },
    createAskThread: { workspace_id: ws, scope: { kind: "workspace" } },
    askQuestion: { question: "시험 범위가 어디까지야?" },
    issueNativeToken: { grant_type: "password", email: "student@example.com", password: "correct_password_1" },
    revokeNativeToken: { refresh_token: "rt_0123456789abcdef" },
    createInvite: { email: "friend@example.com", role: "member" },
    acceptInvite: { token: "inv_0123456789abcdef" },
    updateMember: { role: "viewer" },
    adminSetQuota: { audio_ms_month: null, ai_microusd_month: 5_000_000, storage_bytes: null },
    createExport: { workspace_id: ws, include_audio: false },
    requestAccountDeletion: { password: "correct_password_1" },
  };
  return bodies[route.operationId];
}

export const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

export interface Sample {
  params?: Record<string, string>;
  targets?: Partial<Targets>;
  headers?: Record<string, string>;
}

const DEFAULT_TARGETS: Targets = { workspaceId: SAMPLE_ID, recordingId: SAMPLE_ID, documentId: SAMPLE_ID, eventCandidateId: SAMPLE_ID };

export function requestFor(route: RouteDef, sample: Sample = {}): Request {
  const targets = { ...DEFAULT_TARGETS, ...sample.targets };
  const params = { ...PATH_PARAMS, ...sample.params };
  const path = route.path.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`no sample for path param ${name}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams(queriesFor(route, targets.workspaceId)).toString();
  const headers: Record<string, string> = { ...sample.headers };
  let body: BodyInit | undefined;
  if (route.body && "schema" in route.body) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(bodyFor(route, targets));
  } else if (route.body) {
    headers["Content-Type"] ??= "application/octet-stream";
    body = new Uint8Array(1024);
  }
  if (route.headers?.shape[HEADER.ifMatch]) headers[HEADER.ifMatch] = versionETag(1);
  return new Request(`http://localhost${API_BASE_PATH}${path}${search ? `?${search}` : ""}`, { method: route.method.toUpperCase(), headers, body });
}

/** Sends the request and returns the status and the body text (a stream is read briefly). */
export async function send(req: Request): Promise<{ status: number; text: string }> {
  const res = await handleRequest(req);
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/event-stream")) {
    await res.body?.cancel();
    return { status: res.status, text: "" };
  }
  return { status: res.status, text: await res.text() };
}

export const routesWhere = (pred: (r: RouteDef) => boolean) => ROUTES.filter(pred);
