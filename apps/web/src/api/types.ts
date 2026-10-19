// packages/domain types as the web app uses them.
//
// Workaround (apps/web/README.md "domain 요청" #1): in packages/domain every id schema
// built by `idSchema()` is typed `ZodType<unknown, unknown>` (the generic brand collapses),
// so `z.infer`/`z.input` give `unknown` for every id and even drop the `null` of nullable
// ids. The schema *structure* is intact, though: `Out<S>` infers from the zod wrappers
// (object, nullable, optional, array, union) and maps the collapsed id leaves to
// `string`. When the domain exports real branded types, replace `Out<>` with `z.infer<>`.

import type * as D from "@lectern/domain";
import type { z } from "zod";

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type IsOptional<S> = S extends z.ZodOptional<z.ZodType> ? true : false;
type ObjOut<Shape> = Simplify<
  { [K in keyof Shape as IsOptional<Shape[K]> extends true ? K : never]?: Out<Shape[K]> } & {
    [K in keyof Shape as IsOptional<Shape[K]> extends true ? never : K]: Out<Shape[K]>;
  }
>;

/** Output type of a domain schema, with collapsed (unknown) id leaves as `string`. */
export type Out<S> =
  S extends z.ZodNullable<infer I>
    ? Out<I> | null
    : S extends z.ZodOptional<infer I>
      ? Out<I> | undefined
      : S extends z.ZodObject<infer Shape, any>
        ? ObjOut<Shape>
        : S extends z.ZodArray<infer E>
          ? Out<E>[]
          : S extends z.ZodDiscriminatedUnion<infer O, any>
            ? Out<O[number]>
            : S extends z.ZodUnion<infer O>
              ? Out<O[number]>
              : S extends z.ZodType<infer O>
                ? unknown extends O
                  ? string
                  : O
                : never;
type In<S> = Out<S>;

// Ids
export type WorkspaceId = string;
export type UserId = string;
export type FolderId = string;
export type TagId = string;
export type RecordingId = string;
export type AssetId = string;
export type SpeakerId = string;
export type DocumentId = string;
export type DocumentVersionId = string;
export type BlockId = string;
export type QuestionId = string;
export type EventCandidateId = string;
export type ActionItemId = string;
export type JobId = string;
export type UploadId = string;
export type TemplateId = string;

// Entities and DTOs
export type Me = In<typeof D.Me>;
export type Workspace = In<typeof D.Workspace>;
export type MyWorkspace = In<typeof D.MyWorkspace>;
export type Folder = In<typeof D.Folder>;
export type Tag = In<typeof D.Tag>;
export type RecordingTag = In<typeof D.RecordingTag>;
export type Recording = In<typeof D.Recording>;
export type RecordingListItem = In<typeof D.RecordingListItem>;
export type AssetDto = In<typeof D.AssetDto>;
export type Speaker = In<typeof D.Speaker>;
export type TranscriptSegment = In<typeof D.TranscriptSegment>;
export type TranscriptGap = In<typeof D.TranscriptGap>;
export type Transcript = In<typeof D.Transcript>;
export type Document = In<typeof D.Document>;
export type DocumentVersion = In<typeof D.DocumentVersion>;
export type DocumentWithVersion = In<typeof D.DocumentWithVersion>;
export type DocumentBody = In<typeof D.DocumentBody>;
export type DocumentSection = In<typeof D.DocumentSection>;
export type DocumentBlock = In<typeof D.DocumentBlock>;
export type SourceRef = In<typeof D.SourceRef>;
export type Question = In<typeof D.Question>;
export type EventCandidate = In<typeof D.EventCandidate>;
export type ActionItem = In<typeof D.ActionItem>;
export type Job = In<typeof D.Job>;
export type RecordingDetail = In<typeof D.RecordingDetail>;
export type ServerEvent = In<typeof D.ServerEvent>;
export type SearchHit = In<typeof D.SearchHit>;
export type UploadSession = In<typeof D.UploadSession>;
export type UploadPartReceipt = In<typeof D.UploadPartReceipt>;
export type CompleteUploadResponse = In<typeof D.CompleteUploadResponse>;

export type Device = In<typeof D.DeviceDto>;
export type WorkspaceMember = In<typeof D.WorkspaceMember>;

// Requests
export type UpdateMeRequest = In<typeof D.UpdateMeRequest>;
export type UpdateActionItemRequest = In<typeof D.UpdateActionItemRequest>;
export type CreateFolderRequest = In<typeof D.CreateFolderRequest>;
export type UpdateFolderRequest = In<typeof D.UpdateFolderRequest>;
export type CreateTagRequest = In<typeof D.CreateTagRequest>;
export type UpdateTagRequest = In<typeof D.UpdateTagRequest>;
export type UpdateRecordingRequest = In<typeof D.UpdateRecordingRequest>;
export type UpdateEventCandidateRequest = In<typeof D.UpdateEventCandidateRequest>;
export type CreateUploadRequest = In<typeof D.CreateUploadRequest>;
export type UploadFileSpec = In<typeof D.UploadFileSpec>;
export type ListRecordingsParams = In<typeof D.ListRecordingsQuery>;
export type ListSuggestionsParams = In<typeof D.ListCalendarSuggestionsQuery>;
export type SearchParams = In<typeof D.SearchQuery>;

// Pages
type Page<T> = { items: T[]; next_cursor: string | null };
export type MyWorkspacePage = Page<MyWorkspace>;
export type FolderPage = Page<Folder>;
export type TagPage = Page<Tag>;
export type RecordingPage = Page<RecordingListItem>;
export type QuestionPage = Page<Question>;
export type EventCandidatePage = Page<EventCandidate>;
export type ActionItemPage = Page<ActionItem>;
export type SearchHitPage = Page<SearchHit>;
export type DevicePage = Page<Device>;
export type WorkspaceMemberPage = Page<WorkspaceMember>;

// Enums are typed correctly in the domain; only ids need the workaround.
export type {
  ActionItemStatus,
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
