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
  SavedView,
  SavedViewQuery,
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
  StageName,
  StageRunState,
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
  SavedViewId,
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
import { ErrorCode, pageOf, PageQuery, WorkspaceScopedPageQuery } from "./common.ts";

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

const FOLDER_CONFLICTS =
  "409 `conflict` when a sibling (same parent) already has this name, compared trimmed and case-insensitively, or when `parent_id` is the folder itself or one of its descendants.";

export const CreateFolderRequest = named(
  "CreateFolderRequest",
  z.object({
    workspace_id: WorkspaceId,
    parent_id: FolderId.nullable().optional(),
    name: Name,
    sort_key: z.string().min(1).max(64).optional().describe("Omit to append after the last sibling."),
  }),
  FOLDER_CONFLICTS,
);
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const UpdateFolderRequest = named(
  "UpdateFolderRequest",
  z.object({
    parent_id: FolderId.nullable().optional(),
    name: Name.optional(),
    sort_key: z.string().min(1).max(64).optional(),
  }),
  FOLDER_CONFLICTS,
);
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequest>;

export const TagParams = z.object({ tag_id: TagId });
export const TagPage = pageOf("TagPage", Tag);

const TagColor = Tag.shape.color;

const TAG_CONFLICTS =
  "409 `conflict` when another tag in the workspace has this name, compared trimmed and case-insensitively. Offer the `TagColorName` colours.";

export const CreateTagRequest = named(
  "CreateTagRequest",
  z.object({ workspace_id: WorkspaceId, name: z.string().min(1).max(64), color: TagColor }),
  TAG_CONFLICTS,
);
export type CreateTagRequest = z.infer<typeof CreateTagRequest>;

export const UpdateTagRequest = named(
  "UpdateTagRequest",
  z.object({ name: z.string().min(1).max(64).optional(), color: TagColor.optional() }),
  TAG_CONFLICTS,
);
export type UpdateTagRequest = z.infer<typeof UpdateTagRequest>;

// ---------------------------------------------------------------------------
// recordings
// ---------------------------------------------------------------------------

export const RecordingParams = z.object({ recording_id: RecordingId });

/** `true`/`false` in a query string (no transform: requests and responses share JSON Schema). */
const QueryBool = z.enum(["true", "false"]);
/** Comma-separated ids in a query string, e.g. `tag_ids=a,b`. */
const IdList = z.string().regex(/^[A-Za-z0-9_-]{1,64}(?:,[A-Za-z0-9_-]{1,64}){0,49}$/);

export const RecordingSort = named(
  "RecordingSort",
  z.enum(["recorded_at_desc", "recorded_at_asc", "title_asc", "updated_at_desc"]),
  "List order. Default `recorded_at_desc`.",
);

export const ListRecordingsQuery = WorkspaceScopedPageQuery.extend({
  folder_id: FolderId.optional(),
  include_subfolders: QueryBool.optional().describe("With `folder_id`: also recordings in its subfolders."),
  unfiled: QueryBool.optional().describe("`true`: only recordings in no folder."),
  tag_id: TagId.optional(),
  tag_ids: IdList.optional().describe("Comma-separated tag ids: recordings with every one of them."),
  domain: RecordingDomain.optional(),
  status: RecordingStatus.optional(),
  q: z.string().min(1).max(200).optional().describe("Case-insensitive substring of the title."),
  recorded_after: Timestamp.optional().describe("`recorded_at` at or after this time."),
  recorded_before: Timestamp.optional().describe("`recorded_at` before this time."),
  sort: RecordingSort.optional(),
});
export type ListRecordingsQuery = z.infer<typeof ListRecordingsQuery>;

export const RecordingProgress = named(
  "RecordingProgress",
  z.object({
    job_id: JobId,
    state: z.enum(["queued", "running"]),
    stage: StageName.describe("Current stage; v1 pipeline jobs report `legacy_distill`."),
    stage_state: StageRunState,
    progress: z.number().min(0).max(1).nullable().describe("Fraction of the whole job, when known."),
    message: z.string().nullable().describe("Short status line for the user, e.g. `노트 정리 중...`."),
    queue_position: z.int().nonnegative().nullable().describe("Place in the queue while `queued` (1 = next)."),
  }),
  "Processing progress of a recording, for the first render; `job.progress` events update it.",
);
export type RecordingProgress = z.infer<typeof RecordingProgress>;

export const RecordingFailure = named(
  "RecordingFailure",
  z.object({
    code: z.string().min(1).max(64).describe("Machine-readable reason, e.g. `legacy_error`, `input_silent`."),
    message: z.string().describe("Why processing failed, safe to show to the user."),
    job_id: JobId.nullable(),
    failed_at: Timestamp.nullable(),
  }),
  "Why the last processing attempt of a `failed` or `partial` recording failed.",
);
export type RecordingFailure = z.infer<typeof RecordingFailure>;

export const RecordingListItem = named(
  "RecordingListItem",
  Recording.extend({
    tag_ids: z.array(TagId),
    excerpt: z.string().nullable().optional().describe("A few words from the current document, for previews."),
    audio_bytes: z.int().nonnegative().optional().describe("Bytes of audio stored for the recording."),
    pdf_count: z.int().nonnegative().optional(),
    unverified_count: z
      .int()
      .nonnegative()
      .optional()
      .describe("Document blocks flagged for checking (\"출처 확인 필요\")."),
    progress: RecordingProgress.nullable().optional().describe("Set while a job is queued or running."),
  }),
  "A recording as shown in library lists. The optional fields are always sent by the server.",
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
    progress: RecordingProgress.nullable().optional().describe("Progress of `active_job`. Always sent by the server."),
    failure: RecordingFailure.nullable()
      .optional()
      .describe("Set when the recording is `failed` (or `partial`). Always sent by the server."),
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
    tag_ids: z
      .array(TagId)
      .optional()
      .describe(
        "Replaces the recording's tags: every listed tag is attached, every other tag is removed, AI-attached ones included. Listed AI tags keep `source: ai`.",
      ),
  }),
);
export type UpdateRecordingRequest = z.infer<typeof UpdateRecordingRequest>;

export const BatchRecordingsRequest = named(
  "BatchRecordingsRequest",
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("move"),
      recording_ids: z.array(RecordingId).min(1).max(200),
      folder_id: FolderId.nullable().describe("Target folder; null takes the recordings out of every folder."),
    }),
    z.object({ action: z.literal("add_tags"), recording_ids: z.array(RecordingId).min(1).max(200), tag_ids: z.array(TagId).min(1).max(50) }),
    z.object({ action: z.literal("remove_tags"), recording_ids: z.array(RecordingId).min(1).max(200), tag_ids: z.array(TagId).min(1).max(50) }),
    z.object({ action: z.literal("delete"), recording_ids: z.array(RecordingId).min(1).max(200) }),
  ]),
  "One action on many recordings. Each recording succeeds or fails on its own.",
);
export type BatchRecordingsRequest = z.infer<typeof BatchRecordingsRequest>;

export const BatchRecordingResult = named(
  "BatchRecordingResult",
  z.object({
    recording_id: RecordingId,
    ok: z.boolean(),
    error: z.object({ code: ErrorCode, message: z.string() }).nullable().describe("Why this recording was skipped."),
  }),
);

export const BatchRecordingsResponse = named(
  "BatchRecordingsResponse",
  z.object({ results: z.array(BatchRecordingResult).describe("One result per requested id, in request order.") }),
);
export type BatchRecordingsResponse = z.infer<typeof BatchRecordingsResponse>;

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
export const ExportDocumentQuery = z.object({ format: z.literal("md") });
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
  z
    .object({
      body: DocumentBody.optional().describe("The edited structured document; the server renders Markdown."),
      markdown: z
        .string()
        .max(1_000_000)
        .optional()
        .describe("The edited Markdown of a `legacy-markdown` document, which has no body."),
    })
    .refine((req) => (req.body === undefined) !== (req.markdown === undefined), {
      message: "send exactly one of body and markdown",
      path: ["body"],
    }),
  "A user edit: `body` for structured documents, `markdown` for `legacy-markdown` ones (400 otherwise). Send the version it was based on in `If-Match`.",
);
export type CreateDocumentVersionRequest = z.infer<typeof CreateDocumentVersionRequest>;

// ---------------------------------------------------------------------------
// questions, events, action items
// ---------------------------------------------------------------------------

export const ListQuestionsQuery = PageQuery.extend({ kind: QuestionKind.optional() });
export const QuestionPage = pageOf("QuestionPage", Question);

export const EventCandidatePage = pageOf("EventCandidatePage", EventCandidate);

export const ActionItemParams = z.object({ action_item_id: ActionItemId });

export const ListActionItemsQuery = WorkspaceScopedPageQuery.extend({
  status: ActionItemStatus.optional(),
  due_after: Timestamp.optional().describe("`due_at` at or after this time (items without a due date are left out)."),
  due_before: Timestamp.optional().describe("`due_at` before this time (items without a due date are left out)."),
  recording_id: RecordingId.optional(),
});
export type ListActionItemsQuery = z.infer<typeof ListActionItemsQuery>;
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
  status: EventCandidateStatus.optional().describe("Default: `suggested`. Ignored when `statuses` is sent."),
  statuses: z
    .string()
    .regex(/^(?:suggested|accepted|dismissed|synced)(?:,(?:suggested|accepted|dismissed|synced)){0,3}$/)
    .optional()
    .describe("Comma-separated statuses, e.g. `accepted,synced` for a calendar view."),
  start_after: Timestamp.optional().describe("`start_at` at or after this time."),
  start_before: Timestamp.optional().describe("`start_at` before this time."),
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

export const SearchKind = named("SearchKind", z.enum(["transcript", "document", "pdf_page", "recording"]));

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
  "A document block matched. In a `legacy-markdown` document, which has no blocks, `block_id` is `md-<n>`: the n-th (0-based) blank-line-separated paragraph of `rendered_md`.",
);
export const PdfPageSearchHit = named(
  "PdfPageSearchHit",
  z.object({ kind: z.literal("pdf_page"), ...hitBase, asset_id: AssetId, page: z.int().min(1) }),
);

export const RecordingSearchHit = named(
  "RecordingSearchHit",
  z.object({ kind: z.literal("recording"), ...hitBase }),
  "The recording's title matched.",
);

export const SearchHit = named(
  "SearchHit",
  z.discriminatedUnion("kind", [TranscriptSearchHit, DocumentSearchHit, PdfPageSearchHit, RecordingSearchHit]),
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

// ---------------------------------------------------------------------------
// saved views ("스마트 보기")
// ---------------------------------------------------------------------------

export const SavedViewParams = z.object({ view_id: SavedViewId });
export const SavedViewPage = pageOf("SavedViewPage", SavedView);

export const CreateSavedViewRequest = named(
  "CreateSavedViewRequest",
  z.object({
    workspace_id: WorkspaceId,
    name: Name,
    query: SavedViewQuery,
    sort_key: z.string().min(1).max(64).optional().describe("Omit to append after the caller's last view."),
  }),
);
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequest>;

export const UpdateSavedViewRequest = named(
  "UpdateSavedViewRequest",
  z.object({ name: Name.optional(), query: SavedViewQuery.optional().describe("Replaces the query."), sort_key: z.string().min(1).max(64).optional() }),
);
export type UpdateSavedViewRequest = z.infer<typeof UpdateSavedViewRequest>;
