// The data boundary of the web app. Screens and TanStack Query hooks only talk to this
// interface; its types are the packages/domain DTOs of /api/v2 (one method per route in
// packages/domain/src/api/routes.ts, named after the operationId; types via ./types.ts).
// Two implementations: the real /api/v2 client (./http/client.ts, production builds) and
// the in-memory fixtures (./fixture/client.ts, tests and `web:dev`). ./index.ts picks one
// at build time.

import type {
  ActionItem,
  ActionItemPage,
  BatchRecordingsRequest,
  BatchRecordingsResponse,
  ListActionItemsQuery,
  AskStreamEvent,
  AskThread,
  AskThreadDetail,
  AskThreadPage,
  AskTurn,
  AskUsage,
  CompleteUploadResponse,
  CreateAskThreadRequest,
  CreateDocumentVersionRequest,
  CreatedShareLink,
  CreateFolderRequest,
  CreateShareLinkRequest,
  CreateTagRequest,
  CreateUploadRequest,
  DevicePage,
  DocumentVersion,
  DocumentWithVersion,
  EventCandidate,
  EventCandidatePage,
  Folder,
  FolderPage,
  ListAskThreadsQuery,
  ListRecordingsParams,
  ListSuggestionsParams,
  Me,
  MyWorkspacePage,
  QuestionPage,
  Recording,
  RecordingDetail,
  RecordingPage,
  SearchHitPage,
  SearchParams,
  ServerEvent,
  ShareLinkPage,
  Tag,
  TagPage,
  Transcript,
  UpdateActionItemRequest,
  UpdateEventCandidateRequest,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateRecordingRequest,
  UpdateTagRequest,
  UploadPartReceipt,
  UploadSession,
  WorkspaceId,
  WorkspaceMemberPage,
} from "./types.ts";

/**
 * Error thrown by every ApiClient method. `code` is the domain ErrorCode of the
 * `{ error: { code, message } }` body, or one of the client's own codes:
 * `network` (no response, or the stream broke) and `invalid_response` (a body that does
 * not match the domain schema).
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** The signed-in account as the existing (v1) auth endpoints report it. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

/** POST /api/auth/register: signed in at once, or waiting for an operator's approval. */
export type RegisterResult = { kind: "signedIn"; user: SessionUser } | { kind: "pending"; message: string };

export interface AskQuestionOptions {
  signal?: AbortSignal;
  /** Every stream event, in order (`turn.started`, `retrieval`, `answer.delta`, …). */
  onEvent: (event: AskStreamEvent) => void;
}

export interface ApiClient {
  /** "fixture" shows the preview banner and runs the silent media clock. */
  readonly mode: "fixture" | "http";

  // --- session (the existing cookie auth: /api/auth/*) -------------------------
  /** The signed-in user, or null without a session. */
  getSession(): Promise<SessionUser | null>;
  /** Signs in; the server sets the HttpOnly session cookie. Rejects with the server's message. */
  login(email: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  /** Mails a 6-digit code (POST /api/auth/send-code). Resolves with the server's sentence. */
  sendCode(email: string, purpose: "signup" | "reset"): Promise<string>;
  /** Creates an account (POST /api/auth/register); the session token in the body is ignored. */
  register(input: { email: string; displayName: string; password: string; verificationCode: string }): Promise<RegisterResult>;
  /** Sets a new password with a mailed code (POST /api/auth/reset-password). Resolves with the server's sentence. */
  resetPassword(input: { email: string; verificationCode: string; newPassword: string }): Promise<string>;
  /** Called whenever a request answers 401 (the session ended). Returns an unsubscribe function. */
  onUnauthorized(listener: () => void): () => void;

  getMe(): Promise<Me>;
  updateMe(body: UpdateMeRequest): Promise<Me>;
  listDevices(): Promise<DevicePage>;
  /** Signs a device out (DELETE /me/devices/{id}). */
  revokeDevice(deviceId: string): Promise<void>;
  listWorkspaces(): Promise<MyWorkspacePage>;
  listMembers(workspaceId: WorkspaceId): Promise<WorkspaceMemberPage>;

  listFolders(workspaceId: WorkspaceId): Promise<FolderPage>;
  createFolder(body: CreateFolderRequest): Promise<Folder>;
  /** Rename, move (parent_id) or reorder (sort_key). */
  updateFolder(folderId: string, body: UpdateFolderRequest): Promise<Folder>;
  /** Recordings in the folder move to its parent (packages/domain deleteFolder). */
  deleteFolder(folderId: string): Promise<void>;

  listTags(workspaceId: WorkspaceId): Promise<TagPage>;
  createTag(body: CreateTagRequest): Promise<Tag>;
  updateTag(tagId: string, body: UpdateTagRequest): Promise<Tag>;
  deleteTag(tagId: string): Promise<void>;

  listRecordings(query: ListRecordingsParams): Promise<RecordingPage>;
  getRecording(recordingId: string): Promise<RecordingDetail>;
  updateRecording(recordingId: string, body: UpdateRecordingRequest): Promise<Recording>;
  deleteRecording(recordingId: string): Promise<void>;
  /** One action (move, add_tags, remove_tags, delete) on many recordings; each succeeds or fails on its own. */
  batchRecordings(body: BatchRecordingsRequest): Promise<BatchRecordingsResponse>;
  getTranscript(recordingId: string): Promise<Transcript>;
  listQuestions(recordingId: string): Promise<QuestionPage>;
  listRecordingEvents(recordingId: string): Promise<EventCandidatePage>;
  listActionItems(recordingId: string): Promise<ActionItemPage>;
  /** Action items of the whole workspace, soonest due first (GET /action-items). */
  listWorkspaceActionItems(query: ListActionItemsQuery): Promise<ActionItemPage>;
  updateActionItem(actionItemId: string, body: UpdateActionItemRequest): Promise<ActionItem>;
  getDocument(documentId: string): Promise<DocumentWithVersion>;
  /**
   * Saves a user edit as a new version. `baseVersion` is the version the edit started
   * from (sent as `If-Match`); a newer version on the server answers 412
   * `precondition_failed`.
   */
  createDocumentVersion(documentId: string, body: CreateDocumentVersionRequest, baseVersion: number): Promise<DocumentVersion>;

  // --- share links (D-P2-3) -------------------------------------------------------
  /** Links that are not revoked, optionally for one recording or document. */
  listShareLinks(workspaceId: WorkspaceId, targetId?: string): Promise<ShareLinkPage>;
  /** The link and its URL; the URL (with the token) is in this response only. */
  createShareLink(body: CreateShareLinkRequest): Promise<CreatedShareLink>;
  revokeShareLink(shareLinkId: string): Promise<void>;

  listCalendarSuggestions(query: ListSuggestionsParams): Promise<EventCandidatePage>;
  updateCalendarSuggestion(eventCandidateId: string, body: UpdateEventCandidateRequest): Promise<EventCandidate>;

  search(query: SearchParams): Promise<SearchHitPage>;

  // --- 물어보기 (docs/adr/0009-ask-rag.md) ------------------------------------------
  /** Starts a conversation over a recording, a folder or the workspace (no model call). */
  createAskThread(body: CreateAskThreadRequest): Promise<AskThread>;
  /**
   * Asks a question in a thread. Resolves with the completed turn (`turn.completed`).
   * Rejects with an ApiClientError for an error response or an `error` event, or with an
   * AbortError when `signal` aborts. The server finishes and stores the turn even after an
   * abort or a broken stream; read it back with getAskThread.
   */
  askQuestion(threadId: string, question: string, options: AskQuestionOptions): Promise<AskTurn>;
  listAskThreads(query: ListAskThreadsQuery): Promise<AskThreadPage>;
  getAskThread(threadId: string): Promise<AskThreadDetail>;
  deleteAskThread(threadId: string): Promise<void>;
  getAskUsage(workspaceId: WorkspaceId): Promise<AskUsage>;

  createUpload(body: CreateUploadRequest, idempotencyKey: string): Promise<UploadSession>;
  uploadPart(uploadId: string, part: number, bytes: Blob): Promise<UploadPartReceipt>;
  completeUpload(uploadId: string, idempotencyKey: string): Promise<CompleteUploadResponse>;

  /** URL of an asset's bytes (`/assets/{id}/content`, Range requests), or null when there are none (fixtures). */
  assetContentUrl(assetId: string): string | null;

  /** Workspace event stream (SSE `/events`). Returns an unsubscribe function. */
  subscribe(workspaceId: WorkspaceId, onEvent: (event: ServerEvent) => void): () => void;
}
