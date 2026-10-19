import { z } from "zod";
import {
  AskThreadId,
  AskTurnId,
  AssetId,
  BlockId,
  ChunkId,
  DocumentId,
  FolderId,
  MicroUsd,
  Milliseconds,
  Period,
  RecordingId,
  SourceRef,
  Timestamp,
  UserId,
  WorkspaceId,
} from "../primitives.ts";
import { named } from "../registry.ts";
import { ErrorCode, pageOf, WorkspaceScopedPageQuery } from "./common.ts";

// Ask (물어보기): questions answered from the user's own notes, with citations the
// server has checked against the passages it retrieved (docs/adr/0009-ask-rag.md).
//
// A thread has a fixed scope: one recording ("이 노트에 물어보기"), a folder, or the
// whole workspace ("전반적으로 물어보기"). Each question is a turn. Asking streams the
// answer as SSE from `POST /ask/threads/{thread_id}/turns`; EventSource cannot POST,
// so clients read the stream from fetch(). Threads are private to the user who
// started them.

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export const AskRecordingScope = named(
  "AskRecordingScope",
  z.object({ kind: z.literal("recording"), recording_id: RecordingId }),
  "One recording (이 노트에 물어보기).",
);

export const AskFolderScope = named(
  "AskFolderScope",
  z.object({
    kind: z.literal("folder"),
    folder_id: FolderId,
    include_subfolders: z.boolean().describe("Also search recordings in descendant folders."),
  }),
  "The recordings in a folder.",
);

export const AskWorkspaceScope = named(
  "AskWorkspaceScope",
  z.object({ kind: z.literal("workspace") }),
  "Every recording in the workspace the user can see (전반적으로 물어보기).",
);

export const AskScope = named(
  "AskScope",
  z.discriminatedUnion("kind", [AskRecordingScope, AskFolderScope, AskWorkspaceScope]),
  "What a thread searches. Fixed when the thread is created. Open union: new kinds (tags, date ranges) may be added; show unknown kinds generically.",
);
export type AskScope = z.infer<typeof AskScope>;

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

export const AskCitationSupport = named(
  "AskCitationSupport",
  z.enum(["supported", "weak"]),
  "Deterministic check of a citation: `supported` when the citing sentence shares enough wording with the passage, `weak` when it does not (show a warning). Open enum.",
);
export type AskCitationSupport = z.infer<typeof AskCitationSupport>;

const citationBase = {
  label: z
    .string()
    .regex(/^c\d{1,3}$/)
    .describe("Marker in the answer text: `c3` is written `[c3]`. Unique within the turn."),
  chunk_id: ChunkId,
  recording_id: RecordingId,
  recording_title: z.string(),
  snippet: z.string().describe("Short plain-text excerpt of the cited passage. Empty when `available` is false."),
  support: AskCitationSupport.nullable().describe("Null while the answer is streaming; set when the turn completes."),
  available: z
    .boolean()
    .describe("False when the source was deleted or is no longer visible to the user. Do not link it then."),
};

export const AskTranscriptCitation = named(
  "AskTranscriptCitation",
  z.object({
    kind: z.literal("transcript"),
    ...citationBase,
    start_idx: z.int().nonnegative().describe("First transcript segment the claim rests on (narrowed within the passage)."),
    end_idx: z.int().nonnegative(),
    start_ms: Milliseconds.describe("Original-audio time of `start_idx`."),
    end_ms: Milliseconds,
  }),
);

export const AskDocumentCitation = named(
  "AskDocumentCitation",
  z.object({
    kind: z.literal("document"),
    ...citationBase,
    document_id: DocumentId,
    document_version: z.int().min(1),
    block_id: BlockId.nullable().describe("Null for legacy Markdown documents, which have no blocks."),
    section_title: z.string().nullable(),
    start_ms: Milliseconds.nullable().describe("Where the block's first transcript source starts, or a legacy `[MM:SS]` mark."),
    sources: z.array(SourceRef).describe("The block's own sources, to jump from the document to the transcript or PDF."),
  }),
);

export const AskPdfPageCitation = named(
  "AskPdfPageCitation",
  z.object({ kind: z.literal("pdf_page"), ...citationBase, asset_id: AssetId, page: z.int().min(1) }),
);

export const AskCitation = named(
  "AskCitation",
  z.discriminatedUnion("kind", [AskTranscriptCitation, AskDocumentCitation, AskPdfPageCitation]),
  "A passage the answer cites, already checked to be one of the passages retrieved for this turn and inside the thread's scope. Open union on `kind`: render unknown kinds as a plain label.",
);
export type AskCitation = z.infer<typeof AskCitation>;

// ---------------------------------------------------------------------------
// Threads and turns
// ---------------------------------------------------------------------------

export const AskTurnStatus = named("AskTurnStatus", z.enum(["running", "completed", "failed"]));
export type AskTurnStatus = z.infer<typeof AskTurnStatus>;

export const AskOutcome = named(
  "AskOutcome",
  z.enum(["answered", "no_answer", "unsupported"]),
  "`answered`: at least one valid citation. `no_answer`: the notes do not contain the answer (모름), possibly decided without calling a model. `unsupported`: the model answered without any valid citation; show the text collapsed with a warning. Open enum.",
);
export type AskOutcome = z.infer<typeof AskOutcome>;

export const AskContextMode = named(
  "AskContextMode",
  z.enum(["full_note", "retrieval"]),
  "`full_note`: the whole note fit the context budget. `retrieval`: only the best-matching passages were used.",
);
export type AskContextMode = z.infer<typeof AskContextMode>;

export const AskTurnError = named(
  "AskTurnError",
  z.object({ code: ErrorCode, message: z.string() }),
  "Why a turn failed, e.g. `quota_exceeded`, `budget_exceeded`, `unavailable`.",
);

export const AskTurn = named(
  "AskTurn",
  z.object({
    id: AskTurnId,
    thread_id: AskThreadId,
    workspace_id: WorkspaceId,
    idx: z.int().nonnegative().describe("Position in the thread, from 0."),
    question: z.string().min(1),
    answer: z
      .string()
      .nullable()
      .describe("Plain text with light Markdown (paragraphs, `-` lists, `**bold**`) and `[c1]` citation markers. Null while running or when failed."),
    citations: z.array(AskCitation),
    status: AskTurnStatus,
    outcome: AskOutcome.nullable().describe("Null until completed."),
    mode: AskContextMode.nullable(),
    cached: z.boolean().describe("The answer was reused from an earlier identical question over identical passages (no model call)."),
    cost_microusd: MicroUsd.describe("Model and embedding cost of this turn."),
    error: AskTurnError.nullable(),
    created_at: Timestamp,
    completed_at: Timestamp.nullable(),
  }),
);
export type AskTurn = z.infer<typeof AskTurn>;

export const AskThread = named(
  "AskThread",
  z.object({
    id: AskThreadId,
    workspace_id: WorkspaceId,
    user_id: UserId,
    scope: AskScope,
    title: z.string().min(1).max(200).describe("The first question, shortened."),
    turn_count: z.int().nonnegative(),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
  "A conversation with the notes. Only the user who started it can see it.",
);
export type AskThread = z.infer<typeof AskThread>;

export const AskThreadPage = pageOf("AskThreadPage", AskThread);

export const AskThreadDetail = named(
  "AskThreadDetail",
  z.object({ thread: AskThread, turns: z.array(AskTurn).describe("Every turn, oldest first.") }),
);
export type AskThreadDetail = z.infer<typeof AskThreadDetail>;

export const AskThreadParams = z.object({ thread_id: AskThreadId });

export const ListAskThreadsQuery = WorkspaceScopedPageQuery.extend({
  recording_id: RecordingId.optional().describe("Only threads scoped to this recording (the note's ask panel)."),
});
export type ListAskThreadsQuery = z.infer<typeof ListAskThreadsQuery>;

export const CreateAskThreadRequest = named(
  "CreateAskThreadRequest",
  z.object({ workspace_id: WorkspaceId, scope: AskScope }),
  "Start a thread. No model is called; ask the first question with POST /ask/threads/{thread_id}/turns.",
);
export type CreateAskThreadRequest = z.infer<typeof CreateAskThreadRequest>;

export const ASK_QUESTION_MAX_CHARS = 2000;

export const AskQuestionRequest = named(
  "AskQuestionRequest",
  z.object({ question: z.string().min(1).max(ASK_QUESTION_MAX_CHARS) }),
);
export type AskQuestionRequest = z.infer<typeof AskQuestionRequest>;

export const AskUsage = named(
  "AskUsage",
  z.object({
    workspace_id: WorkspaceId,
    period: Period,
    turn_count: z.int().nonnegative(),
    spent_microusd: MicroUsd,
    limit_microusd: MicroUsd.nullable().describe("Monthly ask budget of the workspace; null when unlimited."),
    per_turn_cap_microusd: MicroUsd.describe("No single question may cost more than this."),
  }),
  "This month's ask spending, for the quota display.",
);
export type AskUsage = z.infer<typeof AskUsage>;

// ---------------------------------------------------------------------------
// Stream (POST /ask/threads/{thread_id}/turns, text/event-stream)
//
// Each SSE message is `event: <type>` and `data: <AskStreamEvent JSON>`. The stream
// is not resumable: after a disconnect, GET /ask/threads/{thread_id} returns the turn
// once it completes (the server finishes it regardless). Errors before the stream
// starts (400, 403, 404, 409, 429) are ordinary ApiError responses.
// ---------------------------------------------------------------------------

export const AskTurnStartedEvent = named(
  "AskTurnStartedEvent",
  z.object({
    type: z.literal("turn.started"),
    thread_id: AskThreadId,
    turn_id: AskTurnId,
    idx: z.int().nonnegative(),
    created_at: Timestamp,
  }),
);

export const AskRetrievalEvent = named(
  "AskRetrievalEvent",
  z.object({
    type: z.literal("retrieval"),
    mode: AskContextMode,
    passage_count: z.int().nonnegative(),
    recording_count: z.int().nonnegative(),
  }),
  "Passages were selected. With `passage_count` 0 a `no_answer` turn follows without a model call.",
);

export const AskToolEvent = named(
  "AskToolEvent",
  z.object({
    type: z.literal("tool"),
    name: z.string().min(1).describe("Tool the model asked for, e.g. `search_notes`. Open set."),
    state: z.enum(["started", "finished"]),
  }),
  "Progress of an extra lookup in the agent loop (global scopes only).",
);

export const AskAnswerDeltaEvent = named(
  "AskAnswerDeltaEvent",
  z.object({ type: z.literal("answer.delta"), text: z.string() }),
  "Next piece of the answer. Markers for passages that were not provided are already removed.",
);

export const AskCitationEvent = named(
  "AskCitationEvent",
  z.object({ type: z.literal("citation"), citation: AskCitation }),
  "A marker appeared for the first time; resolve `[label]` in the text with it. `support` is null here.",
);

export const AskTurnCompletedEvent = named(
  "AskTurnCompletedEvent",
  z.object({ type: z.literal("turn.completed"), turn: AskTurn }),
  "The final turn. Replace the streamed text with `turn.answer` and the citations with `turn.citations`.",
);

export const AskErrorEvent = named(
  "AskErrorEvent",
  z.object({ type: z.literal("error"), error: AskTurnError }),
  "The turn failed after the stream started. The stream ends after this event.",
);

export const AskStreamEvent = named(
  "AskStreamEvent",
  z.discriminatedUnion("type", [
    AskTurnStartedEvent,
    AskRetrievalEvent,
    AskToolEvent,
    AskAnswerDeltaEvent,
    AskCitationEvent,
    AskTurnCompletedEvent,
    AskErrorEvent,
  ]),
  "One message of the ask stream. Open union on `type`: ignore unknown types.",
);
export type AskStreamEvent = z.infer<typeof AskStreamEvent>;
