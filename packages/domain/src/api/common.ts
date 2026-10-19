import { z } from "zod";
import { JsonObject, WorkspaceId } from "../primitives.ts";
import { named } from "../registry.ts";

// Conventions shared by every /api/v2 endpoint (ARCHITECTURE §6).

export const ErrorCode = named(
  "ErrorCode",
  z.enum([
    "bad_request",
    "validation_failed", // details.issues: [{ path, message }]
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "precondition_failed", // If-Match does not match the current document version
    "precondition_required", // If-Match missing where it is required
    "payload_too_large",
    "unsupported_media_type",
    "rate_limited",
    "quota_exceeded",
    "budget_exceeded",
    "idempotency_conflict", // same Idempotency-Key reused with a different request
    "upload_incomplete", // complete called before every part arrived
    "not_implemented", // P0 stubs answer 501 with this code
    "unavailable",
    "internal",
  ]),
  "Machine-readable error code. Open enum: fall back to the HTTP status for codes you do not know.",
);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = named(
  "ApiError",
  z.object({
    error: z.object({
      code: ErrorCode,
      message: z.string().describe("Human-readable message, safe to show to the user."),
      details: JsonObject.optional().describe("Code-specific data, e.g. `issues` for `validation_failed`."),
    }),
  }),
  "The only error body shape the API returns.",
);
export type ApiError = z.infer<typeof ApiError>;

/** `details` of a `validation_failed` error. */
export const ValidationErrorDetails = z.object({
  issues: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.int()])),
      message: z.string(),
    }),
  ),
});
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetails>;

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export const PageQuery = z.object({
  cursor: z.string().min(1).max(512).optional().describe("Opaque `next_cursor` from the previous page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .optional()
    .describe(`Page size, ${DEFAULT_PAGE_LIMIT} when omitted.`),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Most lists are scoped to one workspace, named explicitly. */
export const WorkspaceScopedPageQuery = PageQuery.extend({ workspace_id: WorkspaceId });

/** `{ items, next_cursor }` for `item`, published as component `id`. */
export function pageOf<T extends z.ZodType>(id: string, item: T) {
  return named(
    id,
    z.object({
      items: z.array(item),
      next_cursor: z.string().min(1).nullable().describe("Pass as `cursor` for the next page; null on the last page."),
    }),
  );
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export const HEADER = {
  idempotencyKey: "Idempotency-Key",
  ifMatch: "If-Match",
  etag: "ETag",
  lastEventId: "Last-Event-ID",
} as const;

export const IdempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .describe("Client-chosen key; repeating a mutation with the same key returns the first result.");

/** Strong ETag of a document version: the version number in quotes, e.g. `"3"`. */
export const VersionETag = z.string().regex(/^"\d+"$/).describe('Document version as a strong ETag, e.g. `"3"`.');

export function versionETag(version: number): string {
  return `"${version}"`;
}

export function parseVersionETag(value: string): number | null {
  const match = /^"(\d+)"$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}
