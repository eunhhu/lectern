import { z } from "zod";
import { named } from "./registry.ts";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Ids are opaque. New v2 rows use UUIDv7 (ARCHITECTURE §5.1), but rows carried
 * over from v1 keep their ids (`usr_<uuid>`, `lec_<hex>`, bare UUIDv4), so the
 * pattern only fixes the alphabet and length.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// One fresh z.string() per brand: `.brand()` returns the same instance, so a
// shared base would make every id the same registry entry.
//
// The return type is spelled out: `.brand<B>()` is a conditional type
// (`PropertyKey extends B ? this : $ZodBranded<...>`) that stays unresolved for
// a generic B, and TS 7 then infers every id as `unknown`.
type IdSchema<B extends string> = z.core.$ZodBranded<z.ZodString, B, "out">;

function idSchema<const B extends string>(brand: B, what: string): IdSchema<B> {
  return named(
    brand,
    z.string().regex(ID_PATTERN).brand<B>() as IdSchema<B>,
    `Opaque id of a ${what}. New rows use UUIDv7; rows migrated from v1 keep their old id. Never parse it.`,
  );
}

export const WorkspaceId = idSchema("WorkspaceId", "workspace");
export type WorkspaceId = z.infer<typeof WorkspaceId>;
export const UserId = idSchema("UserId", "user");
export type UserId = z.infer<typeof UserId>;
export const FolderId = idSchema("FolderId", "folder");
export type FolderId = z.infer<typeof FolderId>;
export const TagId = idSchema("TagId", "tag");
export type TagId = z.infer<typeof TagId>;
export const RecordingId = idSchema("RecordingId", "recording");
export type RecordingId = z.infer<typeof RecordingId>;
export const AssetId = idSchema("AssetId", "asset (audio part, PDF or image)");
export type AssetId = z.infer<typeof AssetId>;
export const SpeakerId = idSchema("SpeakerId", "speaker");
export type SpeakerId = z.infer<typeof SpeakerId>;
export const DocumentId = idSchema("DocumentId", "document");
export type DocumentId = z.infer<typeof DocumentId>;
export const DocumentVersionId = idSchema("DocumentVersionId", "document version");
export type DocumentVersionId = z.infer<typeof DocumentVersionId>;
export const BlockId = idSchema("BlockId", "document block, unique within its document version");
export type BlockId = z.infer<typeof BlockId>;
export const QuestionId = idSchema("QuestionId", "question");
export type QuestionId = z.infer<typeof QuestionId>;
export const EventCandidateId = idSchema("EventCandidateId", "calendar event candidate");
export type EventCandidateId = z.infer<typeof EventCandidateId>;
export const ActionItemId = idSchema("ActionItemId", "action item");
export type ActionItemId = z.infer<typeof ActionItemId>;
export const ShareLinkId = idSchema("ShareLinkId", "share link");
export type ShareLinkId = z.infer<typeof ShareLinkId>;
export const JobId = idSchema("JobId", "job");
export type JobId = z.infer<typeof JobId>;
export const StageRunId = idSchema("StageRunId", "stage run");
export type StageRunId = z.infer<typeof StageRunId>;
export const ArtifactId = idSchema("ArtifactId", "stage artifact");
export type ArtifactId = z.infer<typeof ArtifactId>;
export const AiCallId = idSchema("AiCallId", "model call ledger entry");
export type AiCallId = z.infer<typeof AiCallId>;
export const AuthSessionId = idSchema("AuthSessionId", "login session (device)");
export type AuthSessionId = z.infer<typeof AuthSessionId>;
export const AccessTokenId = idSchema("AccessTokenId", "personal access token");
export type AccessTokenId = z.infer<typeof AccessTokenId>;
export const IntegrationId = idSchema("IntegrationId", "integration");
export type IntegrationId = z.infer<typeof IntegrationId>;
export const UsageLedgerId = idSchema("UsageLedgerId", "usage ledger row");
export type UsageLedgerId = z.infer<typeof UsageLedgerId>;
export const UploadId = idSchema("UploadId", "resumable upload session");
export type UploadId = z.infer<typeof UploadId>;

/** Template ids are slugs (`lecture`, `meeting`, `legacy-markdown`), not row ids. */
export const TemplateId = named(
  "TemplateId",
  z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).brand<"TemplateId">(),
  "Template slug, e.g. `lecture`, `meeting`, `legacy-markdown`. Paired with an integer template version.",
);
export type TemplateId = z.infer<typeof TemplateId>;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const Timestamp = named(
  "Timestamp",
  z.iso.datetime(),
  "ISO-8601 date-time in UTC with a `Z` suffix, e.g. `2026-10-19T05:30:00.000Z`. Offsets are rejected; the user's zone lives in `timezone` fields.",
);
export type Timestamp = z.infer<typeof Timestamp>;

export const LocalDate = named(
  "LocalDate",
  z.iso.date(),
  "Calendar date `YYYY-MM-DD` in a stated time zone (not UTC).",
);
export type LocalDate = z.infer<typeof LocalDate>;

export const LocalTime = named(
  "LocalTime",
  z.iso.time({ precision: -1 }),
  "Wall-clock time `HH:MM` (24h) in a stated time zone.",
);
export type LocalTime = z.infer<typeof LocalTime>;

export const TimeZone = named(
  "TimeZone",
  z.string().regex(/^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/),
  "IANA time zone name, e.g. `Asia/Seoul`.",
);
export type TimeZone = z.infer<typeof TimeZone>;

/** Non-negative millisecond offset or duration. */
export const Milliseconds = z.int().nonnegative();

/**
 * A month bucket `YYYY-MM` (UTC). Used by the usage ledger.
 */
export const Period = named("Period", z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/), "Calendar month `YYYY-MM` in UTC.");

// ---------------------------------------------------------------------------
// Misc scalars
// ---------------------------------------------------------------------------

export const Sha256 = named("Sha256", z.string().regex(/^[0-9a-f]{64}$/), "Lowercase hex SHA-256 digest.");
export type Sha256 = z.infer<typeof Sha256>;

export const Confidence = named("Confidence", z.number().min(0).max(1), "Score from 0 (none) to 1 (certain).");

export const LanguageTag = named(
  "LanguageTag",
  z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  "BCP 47 language tag, e.g. `ko`, `en-US`.",
);

export const MicroUsd = named("MicroUsd", z.int().nonnegative(), "Money in millionths of a US dollar.");

export const MimeType = z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i);

/** Lowercase slug used for open-ended keys (section keys, artifact kinds, providers). */
export const Slug = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

/** Arbitrary JSON object stored as `*_json` columns. */
export const JsonObject = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Sources and evidence (persisted, already verified)
// ---------------------------------------------------------------------------

export const TranscriptSourceRef = z
  .object({
    kind: z.literal("transcript"),
    start_idx: z.int().nonnegative().describe("First `transcript_segment.idx` of the range."),
    end_idx: z.int().nonnegative().describe("Last `transcript_segment.idx` of the range (inclusive)."),
  })
  .refine((ref) => ref.end_idx >= ref.start_idx, { message: "end_idx must be >= start_idx", path: ["end_idx"] });

export const PdfPageSourceRef = z.object({
  kind: z.literal("pdf_page"),
  asset_id: AssetId,
  page: z.int().min(1).describe("1-based page number in that PDF asset."),
});

/**
 * Where a claim came from. Model output uses `#12` / `#40-#44` tokens
 * (`SourceToken` in harness.ts); the verifier turns them into these refs.
 * New `kind`s may be added; clients skip kinds they do not know.
 */
export const SourceRef = named(
  "SourceRef",
  z.discriminatedUnion("kind", [TranscriptSourceRef, PdfPageSourceRef]),
  "A verified pointer to a transcript segment range (original-audio time) or a PDF page. Open union: skip unknown `kind`s.",
);
export type SourceRef = z.infer<typeof SourceRef>;

export const Evidence = named(
  "Evidence",
  z.object({
    sources: z.array(SourceRef),
    quote: z.string().nullable().describe("Verbatim phrase the item was extracted from, if the model gave one."),
  }),
  "Why an extracted item exists: the source ranges and the quoted phrase.",
);
export type Evidence = z.infer<typeof Evidence>;

/**
 * Flags the deterministic verifier (AI_HARNESS §3.9) leaves on extracted items.
 */
export const VerifyFlag = named(
  "VerifyFlag",
  z.enum([
    "low_confidence", // quote or sources did not match the transcript well enough (§3.9 step 3)
    "date_corrected", // the date parser disagreed with the model; the parser's value is used (step 4)
    "needs_review", // the parser could not resolve the expression; the model's value is used (step 4)
    "recorded_at_estimated", // relative date resolved against an upload-time `recorded_at` (step 4)
  ]),
  "Verifier flags. Open enum: new flags may be added.",
);
export type VerifyFlag = z.infer<typeof VerifyFlag>;
