// The data boundary of the web app. Screens and TanStack Query hooks only talk to this
// interface; its types are the packages/domain DTOs of /api/v2 (one method per route in
// packages/domain/src/api/routes.ts, named after the operationId; types via ./types.ts).
// Two implementations: the real /api/v2 client (./http/client.ts, production builds) and
// the in-memory fixtures (./fixture/client.ts, tests and `web:dev`). ./index.ts picks one
// at build time.

import type {
  AccessTokenPage,
  AccountDeletionInfo,
  CreateAccessTokenRequest,
  CreatedAccessToken,
  CreateExportRequest,
  DataExport,
  DataExportPage,
  IdentityPage,
  ActionItem,
  ActionItemPage,
  BatchRecordingsRequest,
  BatchRecordingsResponse,
  ListActionItemsQuery,
  AskStreamEvent,
  AskSuggestions,
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
  ListAskSuggestionsParams,
  ListAskThreadsQuery,
  ListRecordingsParams,
  ListSuggestionsParams,
  Me,
  MyWorkspacePage,
  QuestionPage,
  Recording,
  RecordingDetail,
  RecordingPage,
  ReprocessRequest,
  ReprocessResponse,
  AssetPages,
  CalendarFeedCreated,
  CalendarFeedInfo,
  IntegrationPage,
  Workspace,
  WorkspaceSettings,
  OcrAssetRequest,
  OcrAssetResponse,
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
  // --- account (P5: D-P5-2..5, D-P5-8, D-P5-9) -------------------------------------
  /** Personal access tokens, and the v1 API token as a row of its own (`tok_…`, not revocable here). */
  listAccessTokens(): Promise<AccessTokenPage>;
  /** The token and its secret; the secret is in this response only. */
  createAccessToken(body: CreateAccessTokenRequest): Promise<CreatedAccessToken>;
  revokeAccessToken(tokenId: string): Promise<void>;
  /** Google and Apple accounts the user can sign in with. */
  listIdentities(): Promise<IdentityPage>;
  /** 409 when it is the last way to sign in. */
  unlinkIdentity(identityId: string): Promise<void>;
  listExports(): Promise<DataExportPage>;
  /** Queues a workspace export zip (202). */
  createExport(body: CreateExportRequest): Promise<DataExport>;
  /** Where a ready export zip downloads from (`/me/exports/{id}/content`). */
  exportContentUrl(exportId: string): string;
  getAccountDeletion(): Promise<AccountDeletionInfo>;
  /** Schedules the deletion in 7 days. `password` for an account that has one. */
  requestAccountDeletion(password?: string): Promise<AccountDeletionInfo>;
  cancelAccountDeletion(): Promise<AccountDeletionInfo>;
  /**
   * Which "…로 계속하기" sign-ins the server offers. There is no route for it: the start
   * URL is probed (a redirect means on; 404 or 501 means off). Remembered for the session.
   */
  oauthProviders(): Promise<{ google: boolean; apple: boolean }>;

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

  // --- recording actions (D-P2-4) --------------------------------------------------
  /** Deletes only the recording's audio files; transcript and documents stay. */
  deleteRecordingAudio(recordingId: string): Promise<void>;
  /** `dry_run` returns only the estimate (`job: null`); otherwise the queued job. */
  reprocessRecording(recordingId: string, body: ReprocessRequest): Promise<ReprocessResponse>;
  /** The document's Markdown and the file name the server suggests. */
  exportDocument(documentId: string): Promise<{ filename: string; blob: Blob }>;
  /** Rule-built suggested questions for a scope (no model call). */
  listAskSuggestions(query: ListAskSuggestionsParams): Promise<AskSuggestions>;

  listCalendarSuggestions(query: ListSuggestionsParams): Promise<EventCandidatePage>;
  updateCalendarSuggestion(eventCandidateId: string, body: UpdateEventCandidateRequest): Promise<EventCandidate>;

  // --- calendar connections and reminders (P4, D-P4-2/3/7) -------------------------
  /** The caller's own integrations in the workspace. */
  listIntegrations(workspaceId: WorkspaceId): Promise<IntegrationPage>;
  /** Where to send the browser for Google consent; it comes back to `returnTo`. 501 while the feature is off. */
  startGoogleIntegration(workspaceId: WorkspaceId, returnTo: string): Promise<{ authorization_url: string }>;
  /** Revokes the tokens; events already in Google stay there. */
  disconnectIntegration(integrationId: string): Promise<void>;
  /** Whether an ICS subscription exists (its URL is never shown again). 501 while the feature is off. */
  getCalendarFeed(workspaceId: WorkspaceId): Promise<CalendarFeedInfo>;
  /** A new subscription URL, shown once; the previous one stops working. */
  createCalendarFeed(workspaceId: WorkspaceId): Promise<CalendarFeedCreated>;
  deleteCalendarFeed(workspaceId: WorkspaceId): Promise<void>;
  /** PATCH /workspaces/{id} with `{ settings }` (owner and admin). */
  updateWorkspaceSettings(workspaceId: WorkspaceId, settings: Partial<WorkspaceSettings>): Promise<Workspace>;

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
  /** A PDF asset's pages: page count, whether it is a scan, and which pages have text (D-P3-3). */
  listAssetPages(assetId: string): Promise<AssetPages>;
  /** OCR of a scanned PDF: `dry_run: true` only estimates; `false` queues the job (only after the user confirmed the estimate). */
  ocrAsset(assetId: string, body: OcrAssetRequest): Promise<OcrAssetResponse>;

  /** Workspace event stream (SSE `/events`). Returns an unsubscribe function. */
  subscribe(workspaceId: WorkspaceId, onEvent: (event: ServerEvent) => void): () => void;
}
