import { z } from "zod";
import { Job, Recording } from "../entities.ts";
import { RecordingDomain } from "../enums.ts";
import {
  FolderId,
  LanguageTag,
  MimeType,
  RecordingId,
  Sha256,
  TagId,
  TemplateId,
  Timestamp,
  UploadId,
  WorkspaceId,
} from "../primitives.ts";
import { named } from "../registry.ts";

// Resumable chunked upload (ARCHITECTURE §6 "업로드"):
//   POST /uploads              -> UploadSession with a part plan
//   PUT  /uploads/:id/parts/:n -> UploadPartReceipt (raw bytes, idempotent per part)
//   GET  /uploads/:id          -> UploadSession (which parts arrived; resume from here)
//   POST /uploads/:id/complete -> CompleteUploadResponse
//
// One session can carry several files (audio parts and PDFs). "Parts" are the
// byte ranges of the upload, numbered from 1 across all files in order; they
// are unrelated to `asset.part_index`, which orders audio files.

export const UploadFileKind = named("UploadFileKind", z.enum(["audio", "pdf", "image"]));
export type UploadFileKind = z.infer<typeof UploadFileKind>;

export const UploadFileSpec = named(
  "UploadFileSpec",
  z.object({
    kind: UploadFileKind,
    filename: z.string().min(1).max(255),
    mime: MimeType,
    bytes: z.int().min(1),
    sha256: Sha256.optional().describe("Whole-file digest; checked on complete when given."),
  }),
);
export type UploadFileSpec = z.infer<typeof UploadFileSpec>;

export const NewRecordingFields = named(
  "NewRecordingFields",
  z.object({
    title: z.string().min(1).max(200).optional(),
    folder_id: FolderId.nullable().optional(),
    domain: RecordingDomain.optional().describe("When set, classify keeps it and only suggests title and folder."),
    template_id: TemplateId.optional(),
    language: LanguageTag.optional(),
    tag_ids: z.array(TagId).optional(),
  }),
  "User hints for the recording an upload creates. Everything else is classified.",
);
export type NewRecordingFields = z.infer<typeof NewRecordingFields>;

export const CreateUploadRequest = named(
  "CreateUploadRequest",
  z
    .object({
      workspace_id: WorkspaceId,
      recording_id: RecordingId.optional().describe("Add the files to this recording instead of creating one."),
      recording: NewRecordingFields.optional().describe("Hints for the new recording. Not allowed with `recording_id`."),
      recorded_at: Timestamp.optional().describe(
        "When recording started, from the client clock. Omit if unknown: the server falls back to media metadata, then upload time, and records which in `recorded_at_source`.",
      ),
      files: z.array(UploadFileSpec).min(1).max(20),
    })
    .refine((req) => !(req.recording_id && req.recording), {
      message: "recording and recording_id are mutually exclusive",
      path: ["recording"],
    })
    .refine((req) => req.recording_id !== undefined || req.files.some((file) => file.kind === "audio"), {
      message: "a new recording needs at least one audio file",
      path: ["files"],
    }),
);
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export const UploadStatus = named("UploadStatus", z.enum(["open", "completed", "aborted", "expired"]));
export type UploadStatus = z.infer<typeof UploadStatus>;

export const UploadFile = named(
  "UploadFile",
  UploadFileSpec.extend({
    index: z.int().nonnegative(),
    first_part: z.int().min(1).describe("Number of this file's first part."),
    part_count: z.int().min(1),
  }),
);
export type UploadFile = z.infer<typeof UploadFile>;

export const UploadSession = named(
  "UploadSession",
  z.object({
    id: UploadId,
    workspace_id: WorkspaceId,
    recording_id: RecordingId.nullable().describe("Target recording; set at create or on complete."),
    status: UploadStatus,
    recorded_at: Timestamp.nullable(),
    part_size: z.int().min(1).describe("Bytes per part; a file's last part may be shorter."),
    files: z.array(UploadFile),
    received_parts: z.array(z.int().min(1)).describe("Part numbers stored so far, ascending."),
    created_at: Timestamp,
    expires_at: Timestamp,
  }),
);
export type UploadSession = z.infer<typeof UploadSession>;

export const UploadPartReceipt = named(
  "UploadPartReceipt",
  z.object({
    part: z.int().min(1),
    bytes: z.int().min(1),
    sha256: Sha256.describe("Digest of the bytes the server stored, for the client to compare."),
  }),
);
export type UploadPartReceipt = z.infer<typeof UploadPartReceipt>;

export const CompleteUploadResponse = named(
  "CompleteUploadResponse",
  z.object({
    upload: UploadSession,
    recording: Recording,
    job: Job.nullable().describe("Processing job, unless the upload was a duplicate."),
    deduplicated: z.boolean().describe("The audio matched an existing recording in the workspace (by sha256)."),
  }),
);
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponse>;

/** Number of parts a file of `bytes` needs. */
export function partCount(bytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(bytes / partSize));
}
