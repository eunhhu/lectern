import { z } from "zod";
import { DocumentBody, TranscriptGap } from "../blocks.ts";
import {
  AccessToken,
  ActionItem,
  AiCall,
  Asset,
  AuthSession,
  Document,
  DocumentVersion,
  EventCandidate,
  Folder,
  Integration,
  Job,
  Membership,
  Question,
  Recording,
  RecordingTag,
  ShareLink,
  ShareScope,
  Speaker,
  StageRun,
  Tag,
  TranscriptSegment,
  UsageLedger,
  Workspace,
  WorkspaceSettings,
} from "../entities.ts";
import {
  AccessTokenScope,
  ActionItemStatus,
  EventCandidateStatus,
  EventKind,
  JobKind,
  JobState,
  MembershipRole,
  QuestionKind,
  RecordingDomain,
  RecordingStatus,
  RecordingVisibility,
  ShareTargetType,
  SystemRole,
} from "../enums.ts";
import {
  AccessTokenId,
  ActionItemId,
  AssetId,
  AuthSessionId,
  BlockId,
  DocumentId,
  EventCandidateId,
  FolderId,
  IntegrationId,
  JobId,
  LanguageTag,
  MicroUsd,
  Milliseconds,
  Period,
  RecordingId,
  ShareLinkId,
  SpeakerId,
  TagId,
  TemplateId,
  Timestamp,
  TimeZone,
  UserId,
  WorkspaceId,
} from "../primitives.ts";
import { named } from "../registry.ts";
import { pageOf, PageQuery, WorkspaceScopedPageQuery } from "./common.ts";

// Request/response DTOs for the /api/v2 resources in ARCHITECTURE §6.
// Entities that are safe to expose are returned as-is; the rest get a DTO
// here that drops hashes, encrypted tokens and blob keys.
//
// PATCH bodies: an omitted field is left unchanged; `null` clears a nullable field.

const Name = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

export const Me = named(
  "Me",
  z.object({
    id: UserId,
    email: z.email(),
    display_name: z.string().min(1).max(100),
    timezone: TimeZone.describe("Used to resolve relative dates and to show times. Default `Asia/Seoul`."),
    system_role: SystemRole,
    personal_workspace_id: WorkspaceId,
  }),
  "The signed-in user.",
);
export type Me = z.infer<typeof Me>;

export const UpdateMeRequest = named(
  "UpdateMeRequest",
  z.object({
    display_name: z.string().min(1).max(100).optional(),
    timezone: TimeZone.optional(),
  }),
);
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

export const DeviceDto = named(
  "Device",
  AuthSession.omit({ token_hash: true, refresh_hash: true, ip_hash: true }).extend({
    current: z.boolean().describe("This is the session making the request."),
  }),
  "A signed-in browser or app (one auth session).",
);
export type DeviceDto = z.infer<typeof DeviceDto>;
export const DevicePage = pageOf("DevicePage", DeviceDto);
export const DeviceParams = z.object({ device_id: AuthSessionId });

export const AccessTokenDto = named(
  "AccessToken",
  AccessToken.omit({ token_hash: true }),
  "Personal access token metadata. The secret is only returned once, on create.",
);
export type AccessTokenDto = z.infer<typeof AccessTokenDto>;
export const AccessTokenPage = pageOf("AccessTokenPage", AccessTokenDto);
export const AccessTokenParams = z.object({ token_id: AccessTokenId });

export const CreateAccessTokenRequest = named(
  "CreateAccessTokenRequest",
  z.object({
    workspace_id: WorkspaceId,
    name: z.string().min(1).max(100),
    scopes: z.array(AccessTokenScope).min(1),
    expires_at: Timestamp.nullable().optional().describe("Omit or null for no expiry."),
  }),
);
export type CreateAccessTokenRequest = z.infer<typeof CreateAccessTokenRequest>;

export const CreatedAccessToken = named(
  "CreatedAccessToken",
  z.object({
    token: AccessTokenDto,
    secret: z.string().min(16).describe("The token itself. Shown only in this response."),
  }),
);
export type CreatedAccessToken = z.infer<typeof CreatedAccessToken>;

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

export const WorkspaceParams = z.object({ workspace_id: WorkspaceId });

export const MyWorkspace = named(
  "MyWorkspace",
  z.object({ workspace: Workspace, role: MembershipRole }),
  "A workspace the caller belongs to, with the caller's role.",
);
export const MyWorkspacePage = pageOf("MyWorkspacePage", MyWorkspace);

export const CreateWorkspaceRequest = named(
  "CreateWorkspaceRequest",
  z.object({ name: Name }),
  "Creates a team workspace owned by the caller. Personal workspaces are created automatically.",
);
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const UpdateWorkspaceRequest = named(
  "UpdateWorkspaceRequest",
  z.object({ name: Name.optional(), settings: WorkspaceSettings.optional().describe("Replaces the settings object.") }),
);
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

export const WorkspaceMember = named(
  "WorkspaceMember",
  Membership.extend({ display_name: z.string(), email: z.email() }),
);
export const WorkspaceMemberPage = pageOf("WorkspaceMemberPage", WorkspaceMember);

// ---------------------------------------------------------------------------
// folders, tags
// ---------------------------------------------------------------------------

export const FolderParams = z.object({ folder_id: FolderId });
export const FolderPage = pageOf("FolderPage", Folder);

export const CreateFolderRequest = named(
  "CreateFolderRequest",
  z.object({
    workspace_id: WorkspaceId,
    parent_id: FolderId.nullable().optional(),
    name: Name,
    sort_key: z.string().min(1).max(64).optional().describe("Omit to append after the last sibling."),
  }),
);
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const UpdateFolderRequest = named(
  "UpdateFolderRequest",
  z.object({
    parent_id: FolderId.nullable().optional(),
    name: Name.optional(),
    sort_key: z.string().min(1).max(64).optional(),
  }),
);
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequest>;

export const TagParams = z.object({ tag_id: TagId });
export const TagPage = pageOf("TagPage", Tag);

const TagColor = Tag.shape.color;

export const CreateTagRequest = named(
  "CreateTagRequest",
  z.object({ workspace_id: WorkspaceId, name: z.string().min(1).max(64), color: TagColor }),
);
export type CreateTagRequest = z.infer<typeof CreateTagRequest>;

export const UpdateTagRequest = named(
  "UpdateTagRequest",
  z.object({ name: z.string().min(1).max(64).optional(), color: TagColor.optional() }),
);
export type UpdateTagRequest = z.infer<typeof UpdateTagRequest>;

// ---------------------------------------------------------------------------
// recordings
// ---------------------------------------------------------------------------

export const RecordingParams = z.object({ recording_id: RecordingId });

export const ListRecordingsQuery = WorkspaceScopedPageQuery.extend({
  folder_id: FolderId.optional(),
  tag_id: TagId.optional(),
  domain: RecordingDomain.optional(),
  status: RecordingStatus.optional(),
});
export type ListRecordingsQuery = z.infer<typeof ListRecordingsQuery>;

export const RecordingListItem = named(
  "RecordingListItem",
  Recording.extend({ tag_ids: z.array(TagId) }),
  "A recording as shown in library lists.",
);
export type RecordingListItem = z.infer<typeof RecordingListItem>;
export const RecordingPage = pageOf("RecordingPage", RecordingListItem);

export const AssetDto = named(
  "Asset",
  Asset.omit({ blob_key: true }),
  "A file of a recording. Fetch the bytes from `/assets/{asset_id}/content`.",
);
export type AssetDto = z.infer<typeof AssetDto>;
export const AssetParams = z.object({ asset_id: AssetId });

export const RecordingDetail = named(
  "RecordingDetail",
  z.object({
    recording: Recording,
    tags: z.array(RecordingTag),
    assets: z.array(AssetDto),
    speakers: z.array(Speaker),
    documents: z.array(Document),
    active_job: Job.nullable().describe("The queued or running job, if any."),
  }),
);
export type RecordingDetail = z.infer<typeof RecordingDetail>;

export const UpdateRecordingRequest = named(
  "UpdateRecordingRequest",
  z.object({
    title: Name.optional(),
    folder_id: FolderId.nullable().optional(),
    domain: RecordingDomain.optional(),
    template_id: TemplateId.nullable().optional(),
    language: LanguageTag.nullable().optional(),
    recorded_at: Timestamp.optional().describe("Sets `recorded_at_source` to `client`."),
    visibility: RecordingVisibility.optional(),
    tag_ids: z.array(TagId).optional().describe("Replaces the user-assigned tags."),
  }),
);
export type UpdateRecordingRequest = z.infer<typeof UpdateRecordingRequest>;

export const Transcript = named(
  "Transcript",
  z.object({
    recording_id: RecordingId,
    segments: z.array(TranscriptSegment).describe("Every segment, ordered by `idx`. Not paginated."),
    speakers: z.array(Speaker),
    gaps: z.array(TranscriptGap),
  }),
  "The whole transcript of a recording. Times are original-audio ms.",
);
export type Transcript = z.infer<typeof Transcript>;

export const SpeakerParams = RecordingParams.extend({ speaker_id: SpeakerId });

export const UpdateSpeakerRequest = named(
  "UpdateSpeakerRequest",
  z.object({ display_name: z.string().min(1).max(100).nullable() }),
);
export type UpdateSpeakerRequest = z.infer<typeof UpdateSpeakerRequest>;

export const ReprocessRequest = named(
  "ReprocessRequest",
  z.object({
    mode: z
      .enum(["document", "full"])
      .describe("`document`: classify/structure onward, no re-transcription. `full`: every stage, transcription included."),
    template_id: TemplateId.optional().describe("Template for the new document; default is the recording's."),
    dry_run: z.boolean().optional().describe("Only return the cost estimate."),
  }),
);
export type ReprocessRequest = z.infer<typeof ReprocessRequest>;

export const CostEstimate = named(
  "CostEstimate",
  z.object({
    estimated_microusd: MicroUsd,
    audio_ms: Milliseconds.describe("Audio that would be transcribed (0 for `document` mode)."),
    within_quota: z.boolean(),
  }),
);
export type CostEstimate = z.infer<typeof CostEstimate>;

export const ReprocessResponse = named(
  "ReprocessResponse",
  z.object({ estimate: CostEstimate, job: Job.nullable().describe("Null for dry runs.") }),
);
export type ReprocessResponse = z.infer<typeof ReprocessResponse>;

export const JobParams = z.object({ job_id: JobId });

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export const DocumentParams = z.object({ document_id: DocumentId });
export const DocumentVersionParams = DocumentParams.extend({ version: z.coerce.number().int().min(1) });
export const DocumentPage = pageOf("DocumentPage", Document);

export const DocumentWithVersion = named(
  "DocumentWithVersion",
  z.object({ document: Document, version: DocumentVersion }),
  "A document with its current version. The response `ETag` is the version.",
);
export type DocumentWithVersion = z.infer<typeof DocumentWithVersion>;

export const DocumentVersionSummary = named(
  "DocumentVersionSummary",
  DocumentVersion.omit({ body: true, rendered_md: true }),
);
export const DocumentVersionPage = pageOf("DocumentVersionPage", DocumentVersionSummary);

export const CreateDocumentVersionRequest = named(
  "CreateDocumentVersionRequest",
  z.object({ body: DocumentBody }),
  "A user edit. Send the version it was based on in `If-Match`; the server renders Markdown.",
);
export type CreateDocumentVersionRequest = z.infer<typeof CreateDocumentVersionRequest>;

// ---------------------------------------------------------------------------
// questions, events, action items
// ---------------------------------------------------------------------------

export const ListQuestionsQuery = PageQuery.extend({ kind: QuestionKind.optional() });
export const QuestionPage = pageOf("QuestionPage", Question);

export const EventCandidatePage = pageOf("EventCandidatePage", EventCandidate);

export const ActionItemParams = z.object({ action_item_id: ActionItemId });
export const ActionItemPage = pageOf("ActionItemPage", ActionItem);

export const UpdateActionItemRequest = named(
  "UpdateActionItemRequest",
  z.object({
    text: z.string().min(1).optional(),
    owner_name: z.string().min(1).max(100).nullable().optional(),
    due_at: Timestamp.nullable().optional(),
    status: ActionItemStatus.optional(),
  }),
);
export type UpdateActionItemRequest = z.infer<typeof UpdateActionItemRequest>;

// ---------------------------------------------------------------------------
// calendar suggestions
// ---------------------------------------------------------------------------

export const ListCalendarSuggestionsQuery = WorkspaceScopedPageQuery.extend({
  status: EventCandidateStatus.optional().describe("Default: `suggested`."),
});
export type ListCalendarSuggestionsQuery = z.infer<typeof ListCalendarSuggestionsQuery>;

export const EventCandidateParams = z.object({ event_candidate_id: EventCandidateId });

export const UpdateEventCandidateRequest = named(
  "UpdateEventCandidateRequest",
  z.object({
    status: z.enum(["accepted", "dismissed"]).optional(),
    title: z.string().min(1).max(200).optional(),
    kind: EventKind.optional(),
    start_at: Timestamp.optional(),
    end_at: Timestamp.nullable().optional(),
    all_day: z.boolean().optional(),
  }),
  "Edit or decide one suggestion. `synced` is set by the server only.",
);
export type UpdateEventCandidateRequest = z.infer<typeof UpdateEventCandidateRequest>;

export const BatchEventCandidatesRequest = named(
  "BatchEventCandidatesRequest",
  z.object({
    event_candidate_ids: z.array(EventCandidateId).min(1).max(100),
    action: z.enum(["accept", "dismiss"]),
  }),
  "Accept or dismiss many suggestions at once.",
);
export type BatchEventCandidatesRequest = z.infer<typeof BatchEventCandidatesRequest>;

export const EventCandidateList = named("EventCandidateList", z.object({ items: z.array(EventCandidate) }));

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const SearchKind = named("SearchKind", z.enum(["transcript", "document", "pdf_page"]));

export const SearchQuery = WorkspaceScopedPageQuery.extend({
  q: z.string().min(1).max(200),
  kind: SearchKind.optional(),
  recording_id: RecordingId.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SnippetPart = named(
  "SnippetPart",
  z.object({ text: z.string(), highlight: z.boolean() }),
  "A run of snippet text; `highlight` marks matched text. Concatenate the runs to get the snippet.",
);

const hitBase = { recording_id: RecordingId, recording_title: z.string(), snippet: z.array(SnippetPart) };

export const TranscriptSearchHit = named(
  "TranscriptSearchHit",
  z.object({ kind: z.literal("transcript"), ...hitBase, segment_idx: z.int().nonnegative(), start_ms: Milliseconds }),
);
export const DocumentSearchHit = named(
  "DocumentSearchHit",
  z.object({ kind: z.literal("document"), ...hitBase, document_id: DocumentId, block_id: BlockId }),
);
export const PdfPageSearchHit = named(
  "PdfPageSearchHit",
  z.object({ kind: z.literal("pdf_page"), ...hitBase, asset_id: AssetId, page: z.int().min(1) }),
);

export const SearchHit = named(
  "SearchHit",
  z.discriminatedUnion("kind", [TranscriptSearchHit, DocumentSearchHit, PdfPageSearchHit]),
  "Open union on `kind`: skip unknown kinds.",
);
export type SearchHit = z.infer<typeof SearchHit>;
export const SearchHitPage = pageOf("SearchHitPage", SearchHit);

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------

export const IntegrationDto = named(
  "Integration",
  Integration.omit({ token_enc: true }),
  "A connected external account. OAuth tokens never leave the server.",
);
export type IntegrationDto = z.infer<typeof IntegrationDto>;
export const IntegrationPage = pageOf("IntegrationPage", IntegrationDto);
export const IntegrationParams = z.object({ integration_id: IntegrationId });

export const StartGoogleIntegrationRequest = named(
  "StartGoogleIntegrationRequest",
  z.object({
    workspace_id: WorkspaceId,
    return_to: z
      .string()
      .regex(/^\/[^/\\]/)
      .max(512)
      .optional()
      .describe("App path to return to after consent, e.g. `/settings/integrations`."),
  }),
);
export type StartGoogleIntegrationRequest = z.infer<typeof StartGoogleIntegrationRequest>;

export const StartGoogleIntegrationResponse = named(
  "StartGoogleIntegrationResponse",
  z.object({ authorization_url: z.url().describe("Send the browser here to grant `calendar.app.created`.") }),
);
export type StartGoogleIntegrationResponse = z.infer<typeof StartGoogleIntegrationResponse>;

// ---------------------------------------------------------------------------
// share links
// ---------------------------------------------------------------------------

export const ShareLinkDto = named(
  "ShareLink",
  ShareLink.omit({ token_hash: true, password_hash: true }).extend({ has_password: z.boolean() }),
  "A share link. The URL with its token is only returned once, on create.",
);
export type ShareLinkDto = z.infer<typeof ShareLinkDto>;
export const ShareLinkPage = pageOf("ShareLinkPage", ShareLinkDto);
export const ShareLinkParams = z.object({ share_link_id: ShareLinkId });

export const ListShareLinksQuery = WorkspaceScopedPageQuery.extend({
  target_id: z.union([RecordingId, DocumentId]).optional(),
});

const SharePassword = z.string().min(8).max(128);

export const CreateShareLinkRequest = named(
  "CreateShareLinkRequest",
  z.object({
    target_type: ShareTargetType,
    target_id: z.union([RecordingId, DocumentId]),
    scope: ShareScope,
    expires_at: Timestamp.nullable().optional(),
    password: SharePassword.nullable().optional(),
  }),
);
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequest>;

export const CreatedShareLink = named(
  "CreatedShareLink",
  z.object({ link: ShareLinkDto, url: z.url().describe("Public URL with the token. Shown only in this response.") }),
);
export type CreatedShareLink = z.infer<typeof CreatedShareLink>;

export const UpdateShareLinkRequest = named(
  "UpdateShareLinkRequest",
  z.object({
    scope: ShareScope.optional(),
    expires_at: Timestamp.nullable().optional(),
    password: SharePassword.nullable().optional().describe("null removes the password."),
  }),
);
export type UpdateShareLinkRequest = z.infer<typeof UpdateShareLinkRequest>;

// ---------------------------------------------------------------------------
// admin (operators only)
// ---------------------------------------------------------------------------

export const AdminListJobsQuery = PageQuery.extend({
  state: JobState.optional(),
  kind: JobKind.optional(),
  workspace_id: WorkspaceId.optional(),
});
export const JobPage = pageOf("JobPage", Job);

export const JobDetail = named(
  "JobDetail",
  z.object({ job: Job, stage_runs: z.array(StageRun), ai_calls: z.array(AiCall) }),
  "A job with its stage timeline and model calls (AI_HARNESS §9).",
);
export type JobDetail = z.infer<typeof JobDetail>;

export const AdminUsageQuery = PageQuery.extend({ period: Period.optional() });
export const UsageLedgerPage = pageOf("UsageLedgerPage", UsageLedger);
