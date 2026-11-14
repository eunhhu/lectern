// packages/domain types as the web app uses them: `z.infer` of the domain schemas, so ids
// are the domain's branded strings (a RecordingId is not a FolderId). Strings that come
// from outside the API (URL params, remembered choices, fixture generators) become ids
// through `asId` at that boundary; everything the API returns already has the brand.

import type * as D from "@lectern/domain";
import type { z } from "zod";

// Ids
export type {
  ActionItemId,
  AskThreadId,
  AskTurnId,
  AssetId,
  BlockId,
  ChunkId,
  DocumentId,
  DocumentVersionId,
  EventCandidateId,
  FolderId,
  JobId,
  QuestionId,
  RecordingId,
  SpeakerId,
  TagId,
  TemplateId,
  UploadId,
  UserId,
  WorkspaceId,
} from "@lectern/domain";

/**
 * A string from outside the API (a URL param, a remembered choice, a fixture) as a domain
 * id. The brand only exists in the type system; the server validates the value.
 */
export function asId<T extends string>(value: string): T {
  return value as T;
}

// Entities and DTOs
export type Me = z.infer<typeof D.Me>;
export type Workspace = z.infer<typeof D.Workspace>;
export type MyWorkspace = z.infer<typeof D.MyWorkspace>;
export type Folder = z.infer<typeof D.Folder>;
export type Tag = z.infer<typeof D.Tag>;
export type RecordingTag = z.infer<typeof D.RecordingTag>;
export type Recording = z.infer<typeof D.Recording>;
export type RecordingListItem = z.infer<typeof D.RecordingListItem>;
export type AssetDto = z.infer<typeof D.AssetDto>;
export type Speaker = z.infer<typeof D.Speaker>;
export type TranscriptSegment = z.infer<typeof D.TranscriptSegment>;
export type TranscriptGap = z.infer<typeof D.TranscriptGap>;
export type Transcript = z.infer<typeof D.Transcript>;
export type Document = z.infer<typeof D.Document>;
export type DocumentVersion = z.infer<typeof D.DocumentVersion>;
export type DocumentWithVersion = z.infer<typeof D.DocumentWithVersion>;
export type DocumentBody = z.infer<typeof D.DocumentBody>;
export type DocumentSection = z.infer<typeof D.DocumentSection>;
export type DocumentBlock = z.infer<typeof D.DocumentBlock>;
export type SourceRef = z.infer<typeof D.SourceRef>;
export type Question = z.infer<typeof D.Question>;
export type EventCandidate = z.infer<typeof D.EventCandidate>;
export type ActionItem = z.infer<typeof D.ActionItem>;
export type Job = z.infer<typeof D.Job>;
export type RecordingDetail = z.infer<typeof D.RecordingDetail>;
export type RecordingProgress = z.infer<typeof D.RecordingProgress>;
export type RecordingFailure = z.infer<typeof D.RecordingFailure>;
export type BatchRecordingsRequest = z.infer<typeof D.BatchRecordingsRequest>;
export type BatchRecordingsResponse = z.infer<typeof D.BatchRecordingsResponse>;
export type ServerEvent = z.infer<typeof D.ServerEvent>;
export type SearchHit = z.infer<typeof D.SearchHit>;
export type UploadSession = z.infer<typeof D.UploadSession>;
export type UploadPartReceipt = z.infer<typeof D.UploadPartReceipt>;
export type CompleteUploadResponse = z.infer<typeof D.CompleteUploadResponse>;

export type Device = z.infer<typeof D.DeviceDto>;
export type WorkspaceMember = z.infer<typeof D.WorkspaceMember>;
export type ShareLinkDto = z.infer<typeof D.ShareLinkDto>;
export type CreatedShareLink = z.infer<typeof D.CreatedShareLink>;
export type ShareScope = z.infer<typeof D.ShareScope>;
export type WorkspaceSettings = z.infer<typeof D.WorkspaceSettings>;
export type Integration = z.infer<typeof D.IntegrationDto>;
export type CalendarFeedInfo = z.infer<typeof D.CalendarFeedInfo>;
export type CalendarFeedCreated = z.infer<typeof D.CalendarFeedCreated>;
// Account (P5): tokens, sign-in identities, exports, deletion.
export type AccessToken = z.infer<typeof D.AccessTokenDto>;
export type AccessTokenScope = z.infer<typeof D.AccessTokenScope>;
export type CreatedAccessToken = z.infer<typeof D.CreatedAccessToken>;
export type Identity = z.infer<typeof D.IdentityDto>;
export type DataExport = z.infer<typeof D.DataExportDto>;
export type AccountDeletionInfo = z.infer<typeof D.AccountDeletionInfo>;
// Team workspaces (P5-06/07): invitations and usage.
export type Invite = z.infer<typeof D.InviteDto>;
export type AcceptInviteResponse = z.infer<typeof D.AcceptInviteResponse>;
export type WorkspaceUsage = z.infer<typeof D.WorkspaceUsage>;
export type WorkspaceQuota = z.infer<typeof D.WorkspaceQuota>;

// Requests
export type UpdateMeRequest = z.infer<typeof D.UpdateMeRequest>;
export type UpdateActionItemRequest = z.infer<typeof D.UpdateActionItemRequest>;
export type CreateFolderRequest = z.infer<typeof D.CreateFolderRequest>;
export type UpdateFolderRequest = z.infer<typeof D.UpdateFolderRequest>;
export type CreateTagRequest = z.infer<typeof D.CreateTagRequest>;
export type UpdateTagRequest = z.infer<typeof D.UpdateTagRequest>;
export type UpdateRecordingRequest = z.infer<typeof D.UpdateRecordingRequest>;
export type UpdateEventCandidateRequest = z.infer<typeof D.UpdateEventCandidateRequest>;
export type CreateUploadRequest = z.infer<typeof D.CreateUploadRequest>;
export type UploadFileSpec = z.infer<typeof D.UploadFileSpec>;
export type CreateDocumentVersionRequest = z.infer<typeof D.CreateDocumentVersionRequest>;
export type CreateShareLinkRequest = z.infer<typeof D.CreateShareLinkRequest>;
export type ReprocessRequest = z.infer<typeof D.ReprocessRequest>;
export type CreateAccessTokenRequest = z.infer<typeof D.CreateAccessTokenRequest>;
export type CreateExportRequest = z.infer<typeof D.CreateExportRequest>;
export type CreateInviteRequest = z.infer<typeof D.CreateInviteRequest>;
export type ReprocessResponse = z.infer<typeof D.ReprocessResponse>;
export type AssetPages = z.infer<typeof D.AssetPages>;
export type OcrAssetRequest = z.infer<typeof D.OcrAssetRequest>;
export type OcrAssetResponse = z.infer<typeof D.OcrAssetResponse>;
export type AskSuggestions = z.infer<typeof D.AskSuggestions>;
export type ListAskSuggestionsParams = z.infer<typeof D.ListAskSuggestionsQuery>;
export type ListRecordingsParams = z.infer<typeof D.ListRecordingsQuery>;
export type ListSuggestionsParams = z.infer<typeof D.ListCalendarSuggestionsQuery>;
export type ListActionItemsQuery = z.infer<typeof D.ListActionItemsQuery>;
export type SearchParams = z.infer<typeof D.SearchQuery>;
export type SearchKind = z.infer<typeof D.SearchKind>;

// 물어보기 (docs/adr/0009-ask-rag.md, packages/domain/src/api/ask.ts)
export type AskScope = z.infer<typeof D.AskScope>;
export type AskCitation = z.infer<typeof D.AskCitation>;
export type AskTranscriptCitation = z.infer<typeof D.AskTranscriptCitation>;
export type AskDocumentCitation = z.infer<typeof D.AskDocumentCitation>;
export type AskPdfPageCitation = z.infer<typeof D.AskPdfPageCitation>;
export type AskTurn = z.infer<typeof D.AskTurn>;
export type AskThread = z.infer<typeof D.AskThread>;
export type AskThreadDetail = z.infer<typeof D.AskThreadDetail>;
export type AskUsage = z.infer<typeof D.AskUsage>;
export type AskStreamEvent = z.infer<typeof D.AskStreamEvent>;
export type CreateAskThreadRequest = z.infer<typeof D.CreateAskThreadRequest>;
export type ListAskThreadsQuery = z.infer<typeof D.ListAskThreadsQuery>;

// Pages
type Page<T> = { items: T[]; next_cursor: string | null };
export type MyWorkspacePage = Page<MyWorkspace>;
export type FolderPage = Page<Folder>;
export type TagPage = Page<Tag>;
export type RecordingPage = Page<RecordingListItem>;
export type QuestionPage = Page<Question>;
export type EventCandidatePage = Page<EventCandidate>;
export type ActionItemPage = Page<ActionItem>;
export type ShareLinkPage = Page<ShareLinkDto>;
export type SearchHitPage = Page<SearchHit>;
export type DevicePage = Page<Device>;
export type WorkspaceMemberPage = Page<WorkspaceMember>;
export type AskThreadPage = Page<AskThread>;
export type IntegrationPage = Page<Integration>;
export type AccessTokenPage = Page<AccessToken>;
export type IdentityPage = Page<Identity>;
export type DataExportPage = Page<DataExport>;
export type InvitePage = Page<Invite>;

export type {
  ActionItemStatus,
  AskCitationSupport,
  AskContextMode,
  AskOutcome,
  AskTurnStatus,
  EventCandidateStatus,
  EventKind,
  GapKind,
  JobState,
  MembershipRole,
  QuestionKind,
  RecordingDomain,
  RecordingStatus,
  StageName,
  StageRunState,
  TagSource,
  VerifyFlag,
} from "@lectern/domain";
