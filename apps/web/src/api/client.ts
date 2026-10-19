// The data boundary of the web app. Screens and TanStack Query hooks only talk to this
// interface; its types are the packages/domain DTOs of /api/v2 (one method per route in
// packages/domain/src/api/routes.ts, named after the operationId; types via ./types.ts). Today it is backed by
// fixtures (./fixture/client.ts); the real /api/v2 client replaces it in ./index.ts.

import type {
  ActionItemPage,
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
  listWorkspaces(): Promise<MyWorkspacePage>;
  listFolders(workspaceId: WorkspaceId): Promise<FolderPage>;
  listTags(workspaceId: WorkspaceId): Promise<TagPage>;

  listRecordings(query: ListRecordingsParams): Promise<RecordingPage>;
  getRecording(recordingId: string): Promise<RecordingDetail>;
  updateRecording(recordingId: string, body: UpdateRecordingRequest): Promise<Recording>;
  deleteRecording(recordingId: string): Promise<void>;
  getTranscript(recordingId: string): Promise<Transcript>;
  listQuestions(recordingId: string): Promise<QuestionPage>;
  listRecordingEvents(recordingId: string): Promise<EventCandidatePage>;
  listActionItems(recordingId: string): Promise<ActionItemPage>;
  getDocument(documentId: string): Promise<DocumentWithVersion>;

  listCalendarSuggestions(query: ListSuggestionsParams): Promise<EventCandidatePage>;
  updateCalendarSuggestion(eventCandidateId: string, body: UpdateEventCandidateRequest): Promise<EventCandidate>;

  search(query: SearchParams): Promise<SearchHitPage>;

  createUpload(body: CreateUploadRequest, idempotencyKey: string): Promise<UploadSession>;
  uploadPart(uploadId: string, part: number, bytes: Blob): Promise<UploadPartReceipt>;
  completeUpload(uploadId: string, idempotencyKey: string): Promise<CompleteUploadResponse>;

  /** URL of an asset's bytes (`/assets/{id}/content`), or null when there are none (fixtures). */
  assetContentUrl(assetId: string): string | null;

  /** Workspace event stream (SSE `/events`). Returns an unsubscribe function. */
  subscribe(workspaceId: WorkspaceId, onEvent: (event: ServerEvent) => void): () => void;
}
