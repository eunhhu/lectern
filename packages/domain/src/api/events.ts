import { z } from "zod";
import { Job, Recording } from "../entities.ts";
import { StageName, StageRunState } from "../enums.ts";
import { DocumentId, EventCandidateId, ID_PATTERN, JobId, RecordingId, Timestamp, WorkspaceId } from "../primitives.ts";
import { named } from "../registry.ts";

// GET /api/v2/events (SSE). Each message is
//   id: <ServerEvent.id>
//   event: <ServerEvent.type>
//   data: <ServerEvent as JSON>
// The fields mirror the `job_events` table (AI_HARNESS §4.1). Reconnect with
// `Last-Event-ID` to replay what was missed. New event types may be added:
// ignore types you do not know.

export const EventId = named(
  "EventId",
  z.string().regex(ID_PATTERN).brand<"EventId">(),
  "Monotonic event id (`job_events.id`). Opaque: echo it back in `Last-Event-ID`.",
);
export type EventId = z.infer<typeof EventId>;

const envelope = {
  id: EventId,
  workspace_id: WorkspaceId,
  recording_id: RecordingId.nullable(),
  created_at: Timestamp,
};

export const RecordingCreatedEvent = named(
  "RecordingCreatedEvent",
  z.object({ ...envelope, type: z.literal("recording.created"), payload: z.object({ recording: Recording }) }),
);

export const RecordingUpdatedEvent = named(
  "RecordingUpdatedEvent",
  z.object({ ...envelope, type: z.literal("recording.updated"), payload: z.object({ recording: Recording }) }),
  "Any change to the recording row, including status.",
);

export const RecordingDeletedEvent = named(
  "RecordingDeletedEvent",
  z.object({ ...envelope, type: z.literal("recording.deleted"), payload: z.object({ recording_id: RecordingId }) }),
);

export const JobProgressEvent = named(
  "JobProgressEvent",
  z.object({
    ...envelope,
    type: z.literal("job.progress"),
    payload: z.object({
      job_id: JobId,
      stage: StageName,
      state: StageRunState,
      progress: z.number().min(0).max(1).nullable().describe("Fraction of the whole job, when known."),
      chunk_index: z.int().nonnegative().nullable(),
      chunk_count: z.int().min(1).nullable(),
    }),
  }),
  "A stage started, advanced or finished.",
);

export const JobUpdatedEvent = named(
  "JobUpdatedEvent",
  z.object({ ...envelope, type: z.literal("job.updated"), payload: z.object({ job: Job }) }),
  "The job row changed state (queued, running, succeeded, failed, canceled).",
);

export const TranscriptReadyEvent = named(
  "TranscriptReadyEvent",
  z.object({
    ...envelope,
    type: z.literal("transcript.ready"),
    payload: z.object({ segment_count: z.int().nonnegative() }),
  }),
  "The merged transcript is published; documents may still be in progress.",
);

export const DocumentUpdatedEvent = named(
  "DocumentUpdatedEvent",
  z.object({
    ...envelope,
    type: z.literal("document.updated"),
    payload: z.object({ document_id: DocumentId, version: z.int().min(1) }),
  }),
);

export const CalendarSuggestedEvent = named(
  "CalendarSuggestedEvent",
  z.object({
    ...envelope,
    type: z.literal("calendar.suggested"),
    payload: z.object({ event_candidate_ids: z.array(EventCandidateId).min(1) }),
  }),
  "New event candidates are waiting in the suggestion inbox.",
);

export const ServerEvent = named(
  "ServerEvent",
  z.discriminatedUnion("type", [
    RecordingCreatedEvent,
    RecordingUpdatedEvent,
    RecordingDeletedEvent,
    JobProgressEvent,
    JobUpdatedEvent,
    TranscriptReadyEvent,
    DocumentUpdatedEvent,
    CalendarSuggestedEvent,
  ]),
  "One SSE message. Open union on `type`: ignore unknown types.",
);
export type ServerEvent = z.infer<typeof ServerEvent>;
export type ServerEventType = ServerEvent["type"];
