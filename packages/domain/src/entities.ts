import { z } from "zod";
import { DocumentBody, SpeakerLabel } from "./blocks.ts";
import {
  AccessTokenScope,
  ActionItemStatus,
  AiCallStatus,
  AssetKind,
  ClientKind,
  DocumentAuthor,
  EventCandidateStatus,
  EventKind,
  FailureClass,
  IntegrationProvider,
  IntegrationStatus,
  JobKind,
  JobState,
  MembershipRole,
  QuestionDifficulty,
  QuestionKind,
  RecordedAtSource,
  RecordingDomain,
  RecordingStatus,
  RecordingVisibility,
  ShareTargetType,
  StageName,
  StageRunState,
  TagSource,
  WorkspaceKind,
} from "./enums.ts";
import {
  AccessTokenId,
  ActionItemId,
  AiCallId,
  ArtifactId,
  AssetId,
  AuthSessionId,
  Confidence,
  DocumentId,
  DocumentVersionId,
  EventCandidateId,
  Evidence,
  FolderId,
  IntegrationId,
  JobId,
  JsonObject,
  LanguageTag,
  MicroUsd,
  Milliseconds,
  MimeType,
  Period,
  QuestionId,
  RecordingId,
  Sha256,
  ShareLinkId,
  Slug,
  SourceRef,
  SpeakerId,
  StageRunId,
  TagId,
  TemplateId,
  Timestamp,
  TimeZone,
  UsageLedgerId,
  UserId,
  VerifyFlag,
  WorkspaceId,
} from "./primitives.ts";
import { named } from "./registry.ts";

// v2 entities (ARCHITECTURE §5.2, AI_HARNESS §4.1). One schema per table row,
// in domain terms: `*_json` columns appear here parsed and without the suffix
// (`settings_json` -> `settings`). Every row carries `workspace_id`
// (ARCHITECTURE §5.1); see ENTITY_SCHEMAS below for the two exceptions.
//
// Rows that hold secrets or storage internals (hashes, encrypted tokens, blob
// keys) are not published as API components; their public DTOs live in
// api/resources.ts.

const Name = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Workspaces and organisation
// ---------------------------------------------------------------------------

export const WorkspaceSettings = named(
  "WorkspaceSettings",
  z.object({
    calendar_auto_add: z
      .object({ enabled: z.boolean(), min_confidence: Confidence })
      .optional()
      .describe("Auto-register explicit-date events at or above `min_confidence` (ARCHITECTURE §11). Off when absent."),
    default_language: LanguageTag.optional(),
  }),
  "Workspace settings. Every field is optional; the server applies defaults.",
);
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const Workspace = named(
  "Workspace",
  z.object({
    id: WorkspaceId,
    name: Name,
    kind: WorkspaceKind,
    plan: Slug.describe("Plan slug set by an operator (no billing yet, ROADMAP D10), e.g. `free`."),
    settings: WorkspaceSettings,
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Workspace = z.infer<typeof Workspace>;

export const Membership = named(
  "Membership",
  z.object({
    workspace_id: WorkspaceId,
    user_id: UserId,
    role: MembershipRole,
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Membership = z.infer<typeof Membership>;

export const Folder = named(
  "Folder",
  z.object({
    id: FolderId,
    workspace_id: WorkspaceId,
    parent_id: FolderId.nullable(),
    name: Name,
    sort_key: z.string().min(1).max(64).describe("Fractional index; siblings sort by this byte-wise."),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Folder = z.infer<typeof Folder>;

export const Tag = named(
  "Tag",
  z.object({
    id: TagId,
    workspace_id: WorkspaceId,
    name: z.string().min(1).max(64),
    color: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .describe("Design-token colour name (e.g. `blue`), never a raw colour value."),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Tag = z.infer<typeof Tag>;

export const RecordingTag = named(
  "RecordingTag",
  z.object({
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    tag_id: TagId,
    source: TagSource.describe("`ai` when the classify stage attached the tag."),
    confidence: Confidence.nullable().describe("Classifier confidence for `ai` tags, else null."),
    created_at: Timestamp,
  }),
);
export type RecordingTag = z.infer<typeof RecordingTag>;

// ---------------------------------------------------------------------------
// Recordings and their media
// ---------------------------------------------------------------------------

export const Recording = named(
  "Recording",
  z.object({
    id: RecordingId,
    workspace_id: WorkspaceId,
    folder_id: FolderId.nullable(),
    title: Name,
    domain: RecordingDomain,
    template_id: TemplateId.nullable().describe("Template for new documents; null lets classify decide."),
    language: LanguageTag.nullable(),
    recorded_at: Timestamp.describe("When recording started. Relative dates in events are resolved against it."),
    recorded_at_source: RecordedAtSource,
    duration_ms: Milliseconds.nullable(),
    status: RecordingStatus,
    created_by: UserId,
    visibility: RecordingVisibility,
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Recording = z.infer<typeof Recording>;

export const Asset = z.object({
  id: AssetId,
  workspace_id: WorkspaceId,
  recording_id: RecordingId,
  kind: AssetKind,
  part_index: z.int().nonnegative().describe("Order of audio parts within the recording (0-based)."),
  blob_key: z.string().min(1).describe("Content-addressed blob key. Internal: never sent to clients."),
  sha256: Sha256,
  bytes: z.int().nonnegative(),
  mime: MimeType,
  duration_ms: Milliseconds.nullable(),
  page_count: z.int().min(1).nullable(),
  meta: JsonObject,
  created_at: Timestamp,
});
export type Asset = z.infer<typeof Asset>;

export const TranscriptSegment = named(
  "TranscriptSegment",
  z
    .object({
      workspace_id: WorkspaceId,
      recording_id: RecordingId,
      idx: z.int().nonnegative().describe("Position in the transcript; `#idx` in prompts and SourceRefs."),
      start_ms: Milliseconds.describe("Original-audio time (never cut-audio or chunk time)."),
      end_ms: Milliseconds.describe("Original-audio time (never cut-audio or chunk time)."),
      speaker_id: SpeakerId.nullable(),
      text: z.string(),
      confidence: Confidence.nullable(),
      source_chunk: z.int().nonnegative().nullable().describe("Index of the chunk that produced the segment."),
    })
    .refine((seg) => seg.end_ms >= seg.start_ms, { message: "end_ms must be >= start_ms", path: ["end_ms"] }),
  "Merged transcript segment. Times are original-audio ms (AI_HARNESS §3.2 invariant). Keyed by (recording_id, idx).",
);
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Speaker = named(
  "Speaker",
  z.object({
    id: SpeakerId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    label: SpeakerLabel,
    display_name: z.string().min(1).max(100).nullable().describe("User-given name; shown instead of the label."),
    confidence: Confidence.nullable(),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Speaker = z.infer<typeof Speaker>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const Document = named(
  "Document",
  z.object({
    id: DocumentId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    template_id: TemplateId,
    template_version: z.int().min(1),
    current_version: z.int().min(1).describe("Latest `document_version.version`; send it back in `If-Match`."),
    user_edited: z.boolean().describe("A user edited the document (incl. the P1 bridge Markdown)."),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Document = z.infer<typeof Document>;

export const DocumentVersion = named(
  "DocumentVersion",
  z.object({
    id: DocumentVersionId,
    workspace_id: WorkspaceId,
    document_id: DocumentId,
    recording_id: RecordingId,
    version: z.int().min(1),
    base_version: z.int().min(1).nullable().describe("Version this one was edited from; null for generated ones."),
    template_id: TemplateId,
    template_version: z.int().min(1),
    body: DocumentBody.nullable().describe("Null only for `legacy-markdown` versions, which have Markdown alone."),
    rendered_md: z.string(),
    created_by: DocumentAuthor,
    author_id: UserId.nullable().describe("Editing user when `created_by` is `user`."),
    created_at: Timestamp,
  }),
);
export type DocumentVersion = z.infer<typeof DocumentVersion>;

// ---------------------------------------------------------------------------
// Extracted items
// ---------------------------------------------------------------------------

export const Question = named(
  "Question",
  z.object({
    id: QuestionId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    kind: QuestionKind,
    prompt: z.string().min(1),
    answer: z.string().nullable(),
    sources: z.array(SourceRef),
    difficulty: QuestionDifficulty.nullable(),
    flags: z.array(VerifyFlag),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
  "A generated review question. Deprecated (ADR-0009): new recordings get none unless a template turns `extract.questions` on; kept for existing data and clients.",
);
export type Question = z.infer<typeof Question>;

export const DateResolution = named(
  "DateResolution",
  z.object({
    method: z.enum(["parser", "model"]).describe("`parser`: the deterministic Korean date parser resolved it."),
    rule: z.string().nullable().describe("Parser rule that matched, e.g. `next_week_weekday`."),
  }),
  "How `start_at` was derived from `raw_expression` (AI_HARNESS §3.9.1).",
);

export const EventCandidate = named(
  "EventCandidate",
  z.object({
    id: EventCandidateId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    kind: EventKind,
    title: z.string().min(1).max(200),
    start_at: Timestamp.describe("UTC. For all-day events: local midnight in `tz`, converted to UTC."),
    end_at: Timestamp.nullable().describe("UTC, exclusive. For all-day events: local midnight after the last day."),
    all_day: z.boolean(),
    tz: TimeZone.describe("Zone the event was resolved in (the user's zone at extraction time)."),
    raw_expression: z.string().min(1).describe("Date phrase as spoken, e.g. `다음 주 화요일 수업 전까지`."),
    resolution: DateResolution,
    confidence: Confidence,
    evidence: Evidence,
    flags: z.array(VerifyFlag),
    status: EventCandidateStatus,
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type EventCandidate = z.infer<typeof EventCandidate>;

export const ActionItem = named(
  "ActionItem",
  z.object({
    id: ActionItemId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId,
    text: z.string().min(1),
    owner_name: z.string().min(1).max(100).nullable(),
    due_at: Timestamp.nullable(),
    due_raw: z.string().min(1).nullable().describe("Due phrase as spoken, if any."),
    status: ActionItemStatus,
    evidence: Evidence,
    flags: z.array(VerifyFlag),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type ActionItem = z.infer<typeof ActionItem>;

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const ShareScope = named(
  "ShareScope",
  z.object({
    transcript: z.boolean().describe("Include the transcript."),
    audio: z.boolean().describe("Include audio playback."),
  }),
  "What a share link exposes besides the document (ARCHITECTURE §10). New flags default to false.",
);
export type ShareScope = z.infer<typeof ShareScope>;

export const ShareLink = z.object({
  id: ShareLinkId,
  workspace_id: WorkspaceId,
  target_type: ShareTargetType,
  target_id: z.union([RecordingId, DocumentId]),
  token_hash: Sha256.describe("Hash of the link token; the token itself is shown once."),
  scope: ShareScope,
  expires_at: Timestamp.nullable(),
  password_hash: z.string().min(1).nullable(),
  created_by: UserId,
  created_at: Timestamp,
  revoked_at: Timestamp.nullable(),
});
export type ShareLink = z.infer<typeof ShareLink>;

// ---------------------------------------------------------------------------
// Harness state and cost ledger (AI_HARNESS §4.1)
// ---------------------------------------------------------------------------

export const StageError = named(
  "StageError",
  z.object({
    class: FailureClass,
    code: z.string().min(1).max(64),
    message: z.string(),
  }),
);

export const Job = named(
  "Job",
  z.object({
    id: JobId,
    workspace_id: WorkspaceId.nullable().describe("Null only for system jobs (`maintenance`)."),
    recording_id: RecordingId.nullable(),
    kind: JobKind,
    state: JobState,
    priority: z.int(),
    run_after: Timestamp,
    attempts: z.int().nonnegative(),
    lease_owner: z.string().min(1).nullable(),
    lease_until: Timestamp.nullable(),
    budget_microusd: MicroUsd.nullable(),
    spent_microusd: MicroUsd,
    idempotency_key: z.string().min(1).max(255).nullable(),
    error_code: z.string().min(1).max(64).nullable(),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export type Job = z.infer<typeof Job>;

export const StageRun = named(
  "StageRun",
  z.object({
    id: StageRunId,
    workspace_id: WorkspaceId.nullable().describe("Same as the job's."),
    job_id: JobId,
    stage: StageName,
    chunk_index: z.int().nonnegative().nullable(),
    state: StageRunState,
    input_hash: Sha256.describe("Memoisation key (AI_HARNESS §4.4)."),
    output_artifact_ids: z.array(ArtifactId),
    cache_hit: z.boolean(),
    attempts: z.int().nonnegative(),
    started_at: Timestamp.nullable(),
    finished_at: Timestamp.nullable(),
    error: StageError.nullable(),
    created_at: Timestamp,
  }),
);
export type StageRun = z.infer<typeof StageRun>;

export const Artifact = z.object({
  id: ArtifactId,
  workspace_id: WorkspaceId,
  kind: Slug.describe("Artifact kind, e.g. `chunk_manifest`, `verify_report`."),
  blob_key: z.string().min(1),
  sha256: Sha256,
  bytes: z.int().nonnegative(),
  produced_by_stage_run: StageRunId.nullable(),
  created_at: Timestamp,
  expires_at: Timestamp.nullable().describe("Intermediate artifacts are cleaned up 7 days after publish."),
});
export type Artifact = z.infer<typeof Artifact>;

export const AiCall = named(
  "AiCall",
  z.object({
    id: AiCallId,
    workspace_id: WorkspaceId,
    stage_run_id: StageRunId,
    recording_id: RecordingId.nullable(),
    provider: Slug.describe("Adapter id, e.g. `gemini`."),
    model: z.string().min(1).describe("Pinned model id requested (never a `-latest` alias)."),
    model_version: z.string().min(1).nullable().describe("Model version the provider reported back."),
    input_tokens: z.int().nonnegative(),
    cached_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
    audio_seconds: z.number().nonnegative(),
    cost_microusd: MicroUsd,
    latency_ms: Milliseconds,
    status: AiCallStatus,
    request_id: z.string().min(1).nullable(),
    error_code: z.string().min(1).max(64).nullable(),
    created_at: Timestamp,
  }),
);
export type AiCall = z.infer<typeof AiCall>;

// ---------------------------------------------------------------------------
// Accounts, devices, tokens, integrations, usage
// ---------------------------------------------------------------------------

export const AuthSession = z.object({
  id: AuthSessionId,
  workspace_id: WorkspaceId.describe("Workspace the session is acting in; starts as the user's personal workspace."),
  user_id: UserId,
  client: ClientKind,
  token_hash: Sha256,
  refresh_hash: Sha256.nullable().describe("Native clients only: hash of the current rotating refresh token."),
  device_name: z.string().min(1).max(100).nullable(),
  user_agent: z.string().max(512).nullable(),
  ip_hash: Sha256.nullable(),
  created_at: Timestamp,
  last_seen_at: Timestamp,
  expires_at: Timestamp,
  revoked_at: Timestamp.nullable(),
});
export type AuthSession = z.infer<typeof AuthSession>;

export const AccessToken = z.object({
  id: AccessTokenId,
  workspace_id: WorkspaceId.describe("The only workspace the token can act on."),
  user_id: UserId,
  name: z.string().min(1).max(100),
  prefix: z.string().min(4).max(16).describe("First characters of the token, shown to tell tokens apart."),
  token_hash: Sha256,
  scopes: z.array(AccessTokenScope).min(1),
  expires_at: Timestamp.nullable(),
  last_used_at: Timestamp.nullable(),
  created_at: Timestamp,
  revoked_at: Timestamp.nullable(),
});
export type AccessToken = z.infer<typeof AccessToken>;

export const Integration = z.object({
  id: IntegrationId,
  workspace_id: WorkspaceId.describe("Workspace whose events this integration syncs."),
  user_id: UserId,
  provider: IntegrationProvider,
  scopes: z.array(z.string().min(1)).describe("OAuth scopes granted, e.g. `calendar.app.created`."),
  token_enc: z.string().min(1).describe("AES-GCM encrypted OAuth tokens. Internal: never sent to clients."),
  calendar_id: z.string().min(1).nullable().describe("The app-created \"Lectern\" calendar."),
  status: IntegrationStatus,
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Integration = z.infer<typeof Integration>;

export const UsageLedger = named(
  "UsageLedger",
  z.object({
    id: UsageLedgerId,
    workspace_id: WorkspaceId,
    period: Period,
    audio_ms: Milliseconds,
    ai_cost_microusd: MicroUsd,
    storage_bytes: z.int().nonnegative(),
    updated_at: Timestamp,
  }),
  "Per-workspace usage for one month, used to enforce quotas.",
);
export type UsageLedger = z.infer<typeof UsageLedger>;

// ---------------------------------------------------------------------------
// Registry of every v2 entity
// ---------------------------------------------------------------------------

/** Every v2 table row, keyed by table name. */
export const ENTITY_SCHEMAS = {
  workspace: Workspace,
  membership: Membership,
  folder: Folder,
  tag: Tag,
  recording_tag: RecordingTag,
  recording: Recording,
  asset: Asset,
  transcript_segment: TranscriptSegment,
  speaker: Speaker,
  document: Document,
  document_version: DocumentVersion,
  question: Question,
  event_candidate: EventCandidate,
  action_item: ActionItem,
  share_link: ShareLink,
  job: Job,
  stage_run: StageRun,
  artifact: Artifact,
  ai_call: AiCall,
  auth_session: AuthSession,
  access_token: AccessToken,
  integration: Integration,
  usage_ledger: UsageLedger,
} as const;
export type EntityName = keyof typeof ENTITY_SCHEMAS;

/**
 * Exceptions to "every row has a non-null `workspace_id`":
 * - `workspace` is the scope itself; its `id` is the WorkspaceId.
 * - `job` / `stage_run` allow null for system jobs that belong to no workspace.
 */
export const WORKSPACE_SCOPE_EXCEPTIONS = {
  selfScoped: ["workspace"],
  nullableWorkspace: ["job", "stage_run"],
} as const satisfies Record<string, readonly EntityName[]>;
