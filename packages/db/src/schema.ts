// Drizzle schema for every table added from v2 on. The v1 tables (users, sessions,
// lectures, ...) are still created by the frozen bootstrap in apps/server/src/db.ts and
// are not declared here, so drizzle-kit never generates DROP/ALTER statements for them;
// a change to a v1 table is a hand-written migration (`drizzle-kit generate --custom`).
//
// Times are integer milliseconds since the epoch: the queue compares them in SQL.
// Every table carries `workspace_id` (nullable until P2 creates workspaces and backfills
// it from `owner_id`), per docs/v2/ARCHITECTURE.md §5.1.

import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** One unit of background work (a distillation, a compaction, later a harness pipeline). */
export const job = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    /** The recording/lecture the job works on, if any. */
    subjectId: text("subject_id"),
    state: text("state", { enum: ["queued", "running", "succeeded", "failed", "canceled"] })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(0),
    runAfter: integer("run_after").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    /** JSON input for the handler. Secrets never go here in clear (see sealed_secret). */
    payload: text("payload").notNull().default("{}"),
    /** AES-GCM sealed secret for this job only (e.g. a user-supplied model API key); cleared when the job ends. */
    sealedSecret: text("sealed_secret"),
    result: text("result"),
    error: text("error"),
    errorCode: text("error_code"),
    /** Unique among unfinished jobs: (kind, subject) dedupe is enforced in code. */
    idempotencyKey: text("idempotency_key"),
    budgetMicrousd: integer("budget_microusd"),
    spentMicrousd: integer("spent_microusd").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    /** Set by cancelJob (CONTRACTS D-P1-8); the running handler stops at its next check. */
    cancelRequestedAt: integer("cancel_requested_at"),
  },
  (t) => [
    index("idx_job_lease").on(t.state, t.runAfter, t.priority),
    index("idx_job_subject").on(t.subjectId, t.kind, t.state),
    index("idx_job_finished").on(t.finishedAt),
    uniqueIndex("idx_job_idempotency").on(t.idempotencyKey),
  ]
);

/** One execution of one pipeline stage (P1 harness). */
export const stageRun = sqliteTable(
  "stage_run",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    workspaceId: text("workspace_id"),
    stage: text("stage").notNull(),
    chunkIndex: integer("chunk_index"),
    state: text("state", { enum: ["running", "succeeded", "failed", "skipped"] }).notNull(),
    /** Memoization key: stage version, input hashes, prompt/template/model hashes. */
    stageKey: text("stage_key").notNull(),
    cacheHit: integer("cache_hit", { mode: "boolean" }).notNull().default(false),
    outputJson: text("output_json"),
    attempts: integer("attempts").notNull().default(1),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("idx_stage_run_job").on(t.jobId), index("idx_stage_run_key").on(t.stageKey, t.state)]
);

/** Content-addressed output of a stage, stored in the blob store. */
export const artifact = sqliteTable(
  "artifact",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    jobId: text("job_id"),
    stageRunId: text("stage_run_id"),
    kind: text("kind").notNull(),
    blobKey: text("blob_key").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_artifact_job").on(t.jobId), index("idx_artifact_sha").on(t.sha256)]
);

/** Ledger of every model/STT call: tokens, cost, latency. */
export const aiCall = sqliteTable(
  "ai_call",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    jobId: text("job_id"),
    stageRunId: text("stage_run_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    costMicrousd: integer("cost_microusd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    requestId: text("request_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_ai_call_job").on(t.jobId), index("idx_ai_call_created").on(t.createdAt)]
);

/**
 * Lecture/recording change events, written by whichever process made the change (API or
 * worker) and tailed by the API to feed SSE. Pruned after a day by maintenance.
 */
export const jobEvent = sqliteTable(
  "job_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id"),
    ownerId: text("owner_id").notNull(),
    subjectId: text("subject_id"),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    /** Process instance that wrote it, so that process does not deliver it twice. */
    origin: text("origin").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_job_event_created").on(t.createdAt)]
);

/** Small key/value store for process coordination (e.g. the release the API booted). */
export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Search index and "ask" (docs/adr/0009-ask-rag.md, ARCHITECTURE §12)
//
// These tables are derived from published transcripts and documents and can be rebuilt
// from them at any time. The FTS5 table `search_chunk_fts` is a contentless virtual table
// keyed by `search_chunk.seq`; drizzle cannot declare virtual tables, so it is created by
// a hand-written migration. Unlike the queue tables, `workspace_id` is required here.
// ---------------------------------------------------------------------------

/** One retrievable passage: a transcript window, a document block, or a PDF page. */
export const searchChunk = sqliteTable(
  "search_chunk",
  {
    /** rowid alias, never reused (AUTOINCREMENT): the FTS row of this chunk has the same rowid. */
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    /** Stable id derived from recording, locator and content: unchanged text keeps its id. */
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    kind: text("kind", { enum: ["transcript", "document", "pdf_page"] }).notNull(),
    /** Position key unique within the recording, e.g. `t:12-20`, `d:<block_id>`, `p:<asset_id>:3`. */
    locator: text("locator").notNull(),
    /** Reading order within the recording (documents first, then transcript, then PDF). */
    ordinal: integer("ordinal").notNull(),
    /** Section and block heading path, for display and the prompt header. */
    heading: text("heading"),
    /** Original text as shown to the model and the user (never the bigram form). */
    text: text("text").notNull(),
    contentSha256: text("content_sha256").notNull(),
    /** Estimated model tokens of `text`, for context budgeting. */
    tokens: integer("tokens").notNull(),
    chunkerVersion: integer("chunker_version").notNull(),
    // transcript windows: segment range and original-audio time
    startIdx: integer("start_idx"),
    endIdx: integer("end_idx"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    /** JSON [[idx, start_ms, end_ms, char_start, char_end], ...] for narrowing citations to segments. */
    spansJson: text("spans_json"),
    // document blocks (block_id is null for legacy Markdown documents)
    documentId: text("document_id"),
    documentVersion: integer("document_version"),
    blockId: text("block_id"),
    /** JSON SourceRef[] of the block, so a document citation can jump to the audio. */
    sourcesJson: text("sources_json"),
    // PDF pages
    assetId: text("asset_id"),
    page: integer("page"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_search_chunk_id").on(t.id),
    uniqueIndex("idx_search_chunk_locator").on(t.recordingId, t.kind, t.locator),
    index("idx_search_chunk_workspace").on(t.workspaceId, t.recordingId),
    index("idx_search_chunk_content").on(t.workspaceId, t.contentSha256),
  ]
);

/**
 * Embedding of a chunk text, keyed by content hash so unchanged text is never embedded
 * twice. Scoped by workspace like every harness memo (one tenant never reads another's).
 * `vector` holds int8 codes of the L2-normalized vector; value = code / scale.
 */
export const searchEmbedding = sqliteTable(
  "search_embedding",
  {
    workspaceId: text("workspace_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
    scale: real("scale").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.model, t.dim, t.contentSha256] })]
);

/** Bumped on every change to a workspace's chunks or embeddings; in-memory vector caches compare it. */
export const searchIndexState = sqliteTable("search_index_state", {
  workspaceId: text("workspace_id").primaryKey(),
  generation: integer("generation").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

/** A conversation with the notes. Private to the user who started it. */
export const askThread = sqliteTable(
  "ask_thread",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    scopeKind: text("scope_kind", { enum: ["recording", "folder", "workspace"] }).notNull(),
    /** The domain AskScope as JSON. */
    scopeJson: text("scope_json").notNull(),
    /** Set for recording scope, so the thread is deleted with the recording. */
    recordingId: text("recording_id"),
    folderId: text("folder_id"),
    title: text("title").notNull(),
    turnCount: integer("turn_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_ask_thread_user").on(t.workspaceId, t.userId, t.updatedAt),
    index("idx_ask_thread_recording").on(t.recordingId),
  ]
);

/** One question and its answer, with the evidence and cost behind it. */
export const askTurn = sqliteTable(
  "ask_turn",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    threadId: text("thread_id").notNull(),
    userId: text("user_id").notNull(),
    idx: integer("idx").notNull(),
    question: text("question").notNull(),
    /** Answer text with `[c1]` citation markers; null until it completes. */
    answer: text("answer"),
    /** JSON AskCitation[] as verified when the turn completed. */
    citationsJson: text("citations_json").notNull().default("[]"),
    status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
    outcome: text("outcome"),
    /** `full_note` (the whole note fit the budget) or `retrieval`. */
    mode: text("mode"),
    /** JSON of the passages given to the model (chunk ids, ranks, scores) for eval and debugging. */
    evidenceJson: text("evidence_json"),
    /** sha256 over the passages' chunk ids and content hashes. */
    evidenceHash: text("evidence_hash"),
    /** Answer cache key (question, scope, history, evidence, model, prompt). */
    cacheKey: text("cache_key"),
    cached: integer("cached", { mode: "boolean" }).notNull().default(false),
    provider: text("provider"),
    model: text("model"),
    llmCalls: integer("llm_calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Model and embedding cost of this turn; summed per month for the workspace quota. */
    costMicrousd: integer("cost_microusd").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    uniqueIndex("idx_ask_turn_thread").on(t.threadId, t.idx),
    uniqueIndex("idx_ask_turn_idempotency").on(t.threadId, t.idempotencyKey),
    index("idx_ask_turn_usage").on(t.workspaceId, t.createdAt),
    index("idx_ask_turn_cache").on(t.workspaceId, t.cacheKey),
  ]
);

// ---------------------------------------------------------------------------
// v2 entities (ARCHITECTURE §5.2, packages/domain entities.ts)
//
// One table per domain entity, with the domain's column names; `*_json` columns hold the
// fields the domain shows parsed (`settings_json` -> `settings`). Every row carries a
// required `workspace_id` except `workspace` itself. Times are integer ms like the rest of
// this schema; the API converts them to ISO-8601 UTC.
//
// v1 lectures are carried over (ARCHITECTURE §5.3) and kept in step with their lecture
// row while the v1 pipeline still writes `lectures` (apps/server/src/db.ts, legacy.ts in
// this package). `recording.lecture_id` links the two.
// ---------------------------------------------------------------------------

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["personal", "team"] }).notNull(),
    plan: text("plan").notNull().default("free"),
    settingsJson: text("settings_json").notNull().default("{}"),
    /** The user a personal workspace belongs to; null for team workspaces. */
    personalUserId: text("personal_user_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_workspace_personal").on(t.personalUserId)]
);

export const membership = sqliteTable(
  "membership",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("idx_membership_user").on(t.userId)]
);

export const folder = sqliteTable(
  "folder",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    sortKey: text("sort_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_folder_parent").on(t.workspaceId, t.parentId)]
);

export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_tag_workspace").on(t.workspaceId)]
);

export const recording = sqliteTable(
  "recording",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    folderId: text("folder_id"),
    title: text("title").notNull(),
    domain: text("domain").notNull().default("lecture"),
    templateId: text("template_id"),
    language: text("language"),
    recordedAt: integer("recorded_at").notNull(),
    recordedAtSource: text("recorded_at_source", { enum: ["client", "media", "upload"] }).notNull(),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(),
    createdBy: text("created_by").notNull(),
    visibility: text("visibility", { enum: ["private", "workspace"] }).notNull().default("private"),
    /** The v1 lecture this recording mirrors (equal to `id` for every migrated lecture). */
    lectureId: text("lecture_id"),
    /** Client that uploaded it (v1 `source_client`, `X-Client`). */
    sourceClient: text("source_client"),
    /** Why processing failed, shown to the user (domain RecordingDetail.failure). */
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_recording_workspace").on(t.workspaceId, t.recordedAt),
    index("idx_recording_folder").on(t.workspaceId, t.folderId),
    uniqueIndex("idx_recording_lecture").on(t.lectureId),
  ]
);

export const recordingTag = sqliteTable(
  "recording_tag",
  {
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    tagId: text("tag_id").notNull(),
    source: text("source", { enum: ["user", "ai"] }).notNull(),
    confidence: real("confidence"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.tagId] }), index("idx_recording_tag_tag").on(t.tagId)]
);

export const asset = sqliteTable(
  "asset",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    kind: text("kind").notNull(),
    partIndex: integer("part_index").notNull().default(0),
    /**
     * Where the bytes are: `lecture:<id>` for the audio of a v1 lecture (the file at
     * `lectures.audio_path`, which compaction may swap), `file:<path>` for an uploaded file.
     */
    blobKey: text("blob_key").notNull(),
    /** Null until computed for migrated audio whose v1 `audio_sha256` was a client key. */
    sha256: text("sha256"),
    bytes: integer("bytes").notNull(),
    mime: text("mime").notNull(),
    durationMs: integer("duration_ms"),
    pageCount: integer("page_count"),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_asset_recording").on(t.recordingId, t.kind, t.partIndex)]
);

/**
 * The text of each page of a lecture PDF asset (CONTRACTS §3, D-P3-2). `has_text_layer` is 0
 * for a page with under 20 characters (D-P3-3); `ocr_source` says where OCR text came from.
 */
export const pdfPage = sqliteTable(
  "pdf_page",
  {
    assetId: text("asset_id").notNull(),
    /** From 1. */
    pageNo: integer("page_no").notNull(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    /** 0 | 1 */
    hasTextLayer: integer("has_text_layer").notNull(),
    ocrSource: text("ocr_source", { enum: ["device", "model"] }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.pageNo] }), index("idx_pdf_page_recording").on(t.recordingId)]
);

export const transcriptSegment = sqliteTable(
  "transcript_segment",
  {
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speakerId: text("speaker_id"),
    text: text("text").notNull(),
    confidence: real("confidence"),
    sourceChunk: integer("source_chunk"),
    lang: text("lang"),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.idx] })]
);

/** Stretches of original audio without transcript (domain TranscriptGap). */
export const transcriptGap = sqliteTable(
  "transcript_gap",
  {
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    kind: text("kind").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
  },
  (t) => [index("idx_transcript_gap_recording").on(t.recordingId, t.startMs)]
);

export const speaker = sqliteTable(
  "speaker",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    label: text("label").notNull(),
    displayName: text("display_name"),
    confidence: real("confidence"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_speaker_recording").on(t.recordingId)]
);

export const document = sqliteTable(
  "document",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    currentVersion: integer("current_version").notNull(),
    userEdited: integer("user_edited", { mode: "boolean" }).notNull().default(false),
    /** The lecture archive Markdown file this document is mirrored to (v1 `md_source_path`). */
    mdSourcePath: text("md_source_path"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_document_recording").on(t.recordingId)]
);

export const documentVersion = sqliteTable(
  "document_version",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    documentId: text("document_id").notNull(),
    recordingId: text("recording_id").notNull(),
    version: integer("version").notNull(),
    baseVersion: integer("base_version"),
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    /** Null only for `legacy-markdown` versions, which have Markdown alone. */
    bodyJson: text("body_json"),
    renderedMd: text("rendered_md").notNull(),
    createdBy: text("created_by", { enum: ["ai", "user"] }).notNull(),
    authorId: text("author_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_document_version").on(t.documentId, t.version), index("idx_document_version_recording").on(t.recordingId)]
);

export const question = sqliteTable(
  "question",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    answer: text("answer"),
    sourcesJson: text("sources_json").notNull().default("[]"),
    difficulty: text("difficulty"),
    flagsJson: text("flags_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_question_recording").on(t.recordingId)]
);

export const eventCandidate = sqliteTable(
  "event_candidate",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at"),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    tz: text("tz").notNull(),
    rawExpression: text("raw_expression").notNull(),
    resolutionJson: text("resolution_json").notNull(),
    confidence: real("confidence").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    flagsJson: text("flags_json").notNull().default("[]"),
    status: text("status").notNull().default("suggested"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_event_candidate_workspace").on(t.workspaceId, t.status, t.startAt), index("idx_event_candidate_recording").on(t.recordingId)]
);

export const actionItem = sqliteTable(
  "action_item",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recordingId: text("recording_id").notNull(),
    text: text("text").notNull(),
    ownerName: text("owner_name"),
    dueAt: integer("due_at"),
    dueRaw: text("due_raw"),
    status: text("status").notNull().default("open"),
    evidenceJson: text("evidence_json").notNull(),
    flagsJson: text("flags_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_action_item_workspace").on(t.workspaceId, t.status, t.dueAt), index("idx_action_item_recording").on(t.recordingId)]
);

export const shareLink = sqliteTable(
  "share_link",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    targetType: text("target_type", { enum: ["recording", "document"] }).notNull(),
    targetId: text("target_id").notNull(),
    /** sha256 of the link token; a v1 lecture's link token is its `share_token`. */
    tokenHash: text("token_hash").notNull(),
    scopeJson: text("scope_json").notNull(),
    expiresAt: integer("expires_at"),
    passwordHash: text("password_hash"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [uniqueIndex("idx_share_link_token").on(t.tokenHash), index("idx_share_link_target").on(t.workspaceId, t.targetId)]
);

export const integration = sqliteTable(
  "integration",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    tokenEnc: text("token_enc").notNull(),
    calendarId: text("calendar_id"),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_integration_workspace").on(t.workspaceId)]
);

export const usageLedger = sqliteTable(
  "usage_ledger",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    period: text("period").notNull(),
    audioMs: integer("audio_ms").notNull().default(0),
    aiCostMicrousd: integer("ai_cost_microusd").notNull().default(0),
    storageBytes: integer("storage_bytes").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_usage_ledger_period").on(t.workspaceId, t.period)]
);

/** A saved library filter ("스마트 보기"). Private to the user who saved it. */
export const savedView = sqliteTable(
  "saved_view",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    sortKey: text("sort_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_saved_view_user").on(t.workspaceId, t.userId)]
);

/** A resumable chunked upload (domain UploadSession, ARCHITECTURE §6). */
export const upload = sqliteTable(
  "upload",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** Target recording: set at create (adding files) or on complete. */
    recordingId: text("recording_id"),
    status: text("status", { enum: ["open", "completed", "aborted", "expired"] }).notNull(),
    recordedAt: integer("recorded_at"),
    partSize: integer("part_size").notNull(),
    /** domain UploadFile[] (the part plan). */
    filesJson: text("files_json").notNull(),
    /** domain NewRecordingFields, or null. */
    recordingJson: text("recording_json"),
    sourceClient: text("source_client"),
    idempotencyKey: text("idempotency_key"),
    /** CompleteUploadResponse fields kept so a repeated complete answers the same. */
    resultJson: text("result_json"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [uniqueIndex("idx_upload_idempotency").on(t.userId, t.idempotencyKey), index("idx_upload_expires").on(t.status, t.expiresAt)]
);

export const uploadPart = sqliteTable(
  "upload_part",
  {
    uploadId: text("upload_id").notNull(),
    part: integer("part").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.uploadId, t.part] })]
);

/**
 * Lectures whose v2 rows may be stale: filled by triggers on `lectures` (created by
 * apps/server/src/db.ts, which owns that table) for writes that bypass db.ts, and drained
 * by the projection (legacy.ts).
 */
export const lectureSyncPending = sqliteTable("lecture_sync_pending", {
  lectureId: text("lecture_id").primaryKey(),
  markedAt: integer("marked_at").notNull(),
});
