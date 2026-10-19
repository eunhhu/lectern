// The data boundary of the web app. Screens and TanStack Query hooks only talk to this
// interface; its types are the packages/domain DTOs of /api/v2 (one method per route in
// packages/domain/src/api/routes.ts, named after the operationId; types via ./types.ts). Today it is backed by
// fixtures (./fixture/client.ts); the real /api/v2 client replaces it in ./index.ts.

import type {
  AskMessage,
  AskRequest,
  AskScope,
  AskStreamEvent,
  AskThreadDetail,
  AskThreadPage,
  ActionItem,
  ActionItemPage,
  UpdateActionItemRequest,
  CreateFolderRequest,
  CreateTagRequest,
  DevicePage,
  Folder,
  Tag,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateTagRequest,
  WorkspaceMemberPage,
  CompleteUploadResponse,
  CreateUploadRequest,
  DocumentWithVersion,
  EventCandidate,
  EventCandidatePage,
  FolderPage,
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
  TagPage,
  Transcript,
  UpdateEventCandidateRequest,
  UpdateRecordingRequest,
  UploadPartReceipt,
  UploadSession,
  WorkspaceId,
} from "./types.ts";

/** Error thrown by every ApiClient method: the domain's `{ error: { code, message } }`. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClient {
  /** "fixture" shows the preview banner and runs the silent media clock. */
  readonly mode: "fixture" | "http";

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
  getTranscript(recordingId: string): Promise<Transcript>;
  listQuestions(recordingId: string): Promise<QuestionPage>;
  listRecordingEvents(recordingId: string): Promise<EventCandidatePage>;
  listActionItems(recordingId: string): Promise<ActionItemPage>;
  updateActionItem(actionItemId: string, body: UpdateActionItemRequest): Promise<ActionItem>;
  getDocument(documentId: string): Promise<DocumentWithVersion>;

  listCalendarSuggestions(query: ListSuggestionsParams): Promise<EventCandidatePage>;
  updateCalendarSuggestion(eventCandidateId: string, body: UpdateEventCandidateRequest): Promise<EventCandidate>;

  search(query: SearchParams): Promise<SearchHitPage>;

  /**
   * 물어보기: answers a question from the notes in scope, streaming events as it goes
   * (retrieval, then text deltas, then done). Resolves with the answer; rejects with an
   * ApiClientError (network, validation) or an AbortError when `signal` aborts. Not in
   * the domain contract yet (README "domain 요청").
   */
  ask(body: AskRequest, options: { signal?: AbortSignal; onEvent: (event: AskStreamEvent) => void }): Promise<AskMessage>;
  listAskThreads(workspaceId: WorkspaceId): Promise<AskThreadPage>;
  getAskThread(threadId: string): Promise<AskThreadDetail>;
  /** Questions worth asking about the scope (chips under the composer). */
  listAskSuggestions(workspaceId: WorkspaceId, scope: AskScope): Promise<string[]>;

  createUpload(body: CreateUploadRequest, idempotencyKey: string): Promise<UploadSession>;
  uploadPart(uploadId: string, part: number, bytes: Blob): Promise<UploadPartReceipt>;
  completeUpload(uploadId: string, idempotencyKey: string): Promise<CompleteUploadResponse>;

  /** URL of an asset's bytes (`/assets/{id}/content`), or null when there are none (fixtures). */
  assetContentUrl(assetId: string): string | null;

  /** Workspace event stream (SSE `/events`). Returns an unsubscribe function. */
  subscribe(workspaceId: WorkspaceId, onEvent: (event: ServerEvent) => void): () => void;
}
