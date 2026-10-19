import { z } from "zod";
import { named } from "./registry.ts";

// Enums shared by entities, API DTOs and harness outputs. Every enum here is
// open for additions (README "Freeze rule"): clients must tolerate values they
// do not know yet.

export const RecordingDomain = named(
  "RecordingDomain",
  z.enum(["lecture", "meeting", "seminar", "interview", "one_on_one", "call", "other"]),
  "What kind of spoken session the recording is.",
);
export type RecordingDomain = z.infer<typeof RecordingDomain>;

export const RecordedAtSource = named(
  "RecordedAtSource",
  z.enum(["client", "media", "upload"]),
  "Where `recorded_at` came from: the client, media metadata (`creation_time`), or the upload time as a last resort.",
);
export type RecordedAtSource = z.infer<typeof RecordedAtSource>;

export const RecordingStatus = named(
  "RecordingStatus",
  z.enum([
    "uploading", // upload session not completed yet
    "queued", // waiting for a worker
    "processing", // harness running; the transcript may already be published
    "ready", // every stage succeeded
    "partial", // published with gaps: missing chunks, dropped blocks or budget stop (AI_HARNESS §3.4, §4.5)
    "failed", // nothing usable was published
    "canceled", // the user canceled processing
  ]),
  "User-facing processing state of a recording.",
);
export type RecordingStatus = z.infer<typeof RecordingStatus>;

export const RecordingVisibility = named(
  "RecordingVisibility",
  z.enum(["private", "workspace"]),
  "`private`: creator only. `workspace`: every member. Public access goes through share links.",
);
export type RecordingVisibility = z.infer<typeof RecordingVisibility>;

export const AssetKind = named(
  "AssetKind",
  z.enum(["audio", "audio_normalized", "audio_compact", "pdf", "image"]),
);
export type AssetKind = z.infer<typeof AssetKind>;

export const GapKind = named(
  "GapKind",
  z.enum([
    "break", // long low-speech stretch cut by speech_map
    "tail", // noise or silence after the last utterance
    "missing_transcript", // chunk that failed transcription for good
  ]),
);
export type GapKind = z.infer<typeof GapKind>;

export const QuestionKind = named(
  "QuestionKind",
  z.enum(["recall", "issue", "discussion"]),
  "`recall`: active-recall card (lectures). `issue`: key issue Q&A (meetings). `discussion`: open prompt.",
);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const QuestionDifficulty = named("QuestionDifficulty", z.enum(["easy", "medium", "hard"]));
export type QuestionDifficulty = z.infer<typeof QuestionDifficulty>;

export const EventKind = named("EventKind", z.enum(["deadline", "exam", "meeting", "task", "other"]));
export type EventKind = z.infer<typeof EventKind>;

export const EventCandidateStatus = named(
  "EventCandidateStatus",
  z.enum(["suggested", "accepted", "dismissed", "synced"]),
);
export type EventCandidateStatus = z.infer<typeof EventCandidateStatus>;

export const ActionItemStatus = named("ActionItemStatus", z.enum(["open", "done", "dismissed"]));
export type ActionItemStatus = z.infer<typeof ActionItemStatus>;

export const MembershipRole = named(
  "MembershipRole",
  z.enum(["owner", "admin", "member", "viewer"]),
  "Workspace role. Separate from the system role on the user.",
);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const SystemRole = named(
  "SystemRole",
  z.enum(["owner", "admin", "member", "viewer"]),
  "Operator role on the whole service (today's `users.role`).",
);
export type SystemRole = z.infer<typeof SystemRole>;

export const TagSource = named("TagSource", z.enum(["user", "ai"]));
export type TagSource = z.infer<typeof TagSource>;

export const DocumentAuthor = named("DocumentAuthor", z.enum(["ai", "user"]));
export type DocumentAuthor = z.infer<typeof DocumentAuthor>;

export const JobKind = named(
  "JobKind",
  z.enum(["process", "regenerate", "compact", "calendar_sync", "reminder", "maintenance"]),
);
export type JobKind = z.infer<typeof JobKind>;

export const JobState = named("JobState", z.enum(["queued", "running", "succeeded", "failed", "canceled"]));
export type JobState = z.infer<typeof JobState>;

/** Harness stages (AI_HARNESS §2) plus the non-recording job stages. */
export const StageName = named(
  "StageName",
  z.enum([
    "legacy_distill", // P1 step 1: the v1 single-call pipeline wrapped as one stage
    "ingest",
    "normalize",
    "speech_map",
    "chunk",
    "transcribe",
    "merge",
    "speakers",
    "pdf_ingest",
    "align",
    "classify",
    "structure",
    "extract",
    "verify",
    "publish",
    "compact_audio",
    "calendar_sync",
    "reminder",
    "maintenance",
  ]),
);
export type StageName = z.infer<typeof StageName>;

export const StageRunState = named(
  "StageRunState",
  z.enum(["pending", "running", "succeeded", "failed", "skipped", "canceled"]),
);
export type StageRunState = z.infer<typeof StageRunState>;

export const FailureClass = named(
  "FailureClass",
  z.enum(["transient", "input", "output_validation", "config", "budget"]),
  "Failure classes from AI_HARNESS §4.5.",
);
export type FailureClass = z.infer<typeof FailureClass>;

export const AiCallStatus = named(
  "AiCallStatus",
  z.enum([
    "ok",
    "error",
    "refused", // the model refused
    "truncated", // hit max output tokens
    "empty", // HTTP 200 with zero output tokens (AI_HARNESS §3.4)
  ]),
);
export type AiCallStatus = z.infer<typeof AiCallStatus>;

export const ClientKind = named("ClientKind", z.enum(["web", "native"]));
export type ClientKind = z.infer<typeof ClientKind>;

export const AccessTokenScope = named("AccessTokenScope", z.enum(["recordings:read", "recordings:write"]));
export type AccessTokenScope = z.infer<typeof AccessTokenScope>;

export const IntegrationProvider = named("IntegrationProvider", z.enum(["google"]));
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const IntegrationStatus = named(
  "IntegrationStatus",
  z.enum(["active", "needs_reauth", "revoked", "error"]),
);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

export const ShareTargetType = named("ShareTargetType", z.enum(["recording", "document"]));
export type ShareTargetType = z.infer<typeof ShareTargetType>;

export const WorkspaceKind = named("WorkspaceKind", z.enum(["personal", "team"]));
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;
