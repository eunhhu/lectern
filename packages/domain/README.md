# @lectern/domain

The v2 schema single source of truth: zod schemas for every v2 entity, every `/api/v2` request and response, the SSE events, and the harness model outputs. `openapi.json` is generated from them.

Design background: [ARCHITECTURE §4–§6](../../docs/v2/ARCHITECTURE.md), [AI_HARNESS §3.8–§4.1, §7](../../docs/v2/AI_HARNESS.md), [ROADMAP "병렬화와 동결 지점"](../../docs/v2/ROADMAP.md#병렬화와-동결-지점).

## Rules for this package

- **The only runtime dependency is `zod`.** Nothing here imports another workspace package, Bun or Node APIs. Web, server, worker and native codegen all depend on it, so it has to stay the bottom of the graph. `test/package.test.ts` enforces this.
- **One workstream owns it.** No other branch edits `packages/domain` while it does (ROADMAP: the boundary file is owned by one stream).
- **No `.default()` or `.transform()` in published schemas.** Requests and responses must have the same JSON Schema. Servers apply defaults. A test compares the input and output JSON Schemas.
- **Do not use `.strict()`.** Unknown keys are stripped, never rejected, so additive changes do not break older parsers.

## Freeze rule

The package is frozen at the end of P0. From then on:

**Allowed without an ADR (backward-compatible additions):**
- A new endpoint, a new entity, or a new published schema.
- A new **optional** request field or query parameter.
- A new response field. Clients must ignore fields they do not know.
- A new value in an enum, or a new variant in a discriminated union. Every enum and union in this package is open. Clients fall back gracefully: unknown block types render as nothing, unknown SSE events and search hits are skipped, and unknown error codes are handled by HTTP status.
- Relaxing a request constraint, for example a larger `max` or a required request field becoming optional.
- Descriptions and docs.

**Breaking. Needs an ADR in `docs/adr/` before merging:**
- Removing or renaming a field, endpoint, enum value, union variant or component.
- Changing a field's type, format, unit or meaning. For example, transcript times must stay in original-audio milliseconds.
- Adding a required request field, or tightening request validation.
- Making a response field optional or nullable when it was always present.
- Changing the id format, the timestamp format, the error shape or the pagination shape.

**Workflow.** Edit the schemas, run `bun run domain:openapi`, and commit `openapi.json` in the same commit. `bun test` fails while the committed file is stale. Reviewers can read the `openapi.json` diff to judge whether a change is additive.

## Layout

| File | Contents |
|---|---|
| `src/primitives.ts` | Branded ids, `Timestamp` (UTC, `Z` only), local date and time, `SourceRef`, `Evidence`, `VerifyFlag` |
| `src/enums.ts` | Every shared enum (domains, statuses, roles, stage names, …) |
| `src/blocks.ts` | Document blocks: `TemplateBlock` (model output, `#12` tokens) and `DocumentBlock` (stored, verified `SourceRef`s); `DocumentBody` |
| `src/entities.ts` | One schema per v2 table, `ENTITY_SCHEMAS`, `WORKSPACE_SCOPE_EXCEPTIONS` |
| `src/harness.ts` | `TranscribeResult` (chunk-relative times), `TemplateDefinition`, `templateOutputSchema()`, `ExtractResult`, `extractResultSchema()` |
| `src/templates.ts` | Placeholder `lecture` and `meeting` templates that prove the definition shape |
| `src/api/common.ts` | `ApiError`, `ErrorCode`, `PageQuery`, `pageOf()`, header names, ETag helpers |
| `src/api/uploads.ts` | The resumable upload DTOs |
| `src/api/events.ts` | `ServerEvent`, the SSE union |
| `src/api/resources.ts` | Request and response DTOs for every other resource |
| `src/api/routes.ts` | `ROUTES`: the `/api/v2` route table with method, path, schemas and error statuses |
| `src/openapi.ts` | `buildOpenApiDocument()`, `serializeOpenApi()` |
| `scripts/openapi.ts` | Writes `openapi.json` (`bun run domain:openapi`) |

## Conventions

- **Ids** are opaque strings matching `[A-Za-z0-9_-]{1,64}` and branded per entity (`RecordingId`, …). New rows use UUIDv7. Rows migrated from v1 keep their ids (`usr_<uuid>`, `lec_<hex>`, UUIDv4). Never parse an id.
- **Timestamps** are ISO-8601 UTC with `Z`. Offsets are rejected. Local values (`LocalDate`, `LocalTime`) always come with a `TimeZone`.
- **Transcript times** (`transcript_segment`, `SourceRef`, gaps, search hits) are original-audio milliseconds. Only `TranscribeSegment`, the provider output, is chunk-relative cut-audio time. `merge` converts between them once.
- **`*_json` columns** in ARCHITECTURE §5.2 appear parsed and without the suffix: `settings_json` → `settings`, `body_json` → `body`, `evidence_json` → `evidence`.
- **Entities and DTOs.** Entities are table rows. An entity that is safe to expose is published under its own name (`Recording`). An entity that holds secrets or storage internals (`asset.blob_key`, `share_link.token_hash`, `auth_session`, `access_token`, `integration`) is not published. Its DTO is published instead under the entity's name: TS `AssetDto` → component `Asset`, `DeviceDto` → `Device`.
- **PATCH** bodies: an omitted field is unchanged, and `null` clears a nullable field.
- **Lists** return `{ items, next_cursor }` and take `?cursor=&limit=` (1–200, default 50). Workspace-scoped lists require `workspace_id`.
- **Errors** are always `{ error: { code, message, details? } }`. P0 stubs answer 501 with `not_implemented`.
- **Mutations** that create work (uploads, complete, reprocess, batch) accept `Idempotency-Key`. Saving a document version requires `If-Match: "<version>"`.
- **SSE**: each message has `id: <event.id>`, `event: <event.type>`, and `data: <ServerEvent JSON>`. Reconnect with `Last-Event-ID`.

## Using it

```ts
import { CreateUploadRequest, ROUTES, toHonoPath, templateOutputSchema, LECTURE_TEMPLATE } from "@lectern/domain";

CreateUploadRequest.parse(await c.req.json()); // server: validate a body
for (const r of ROUTES) app.on(r.method.toUpperCase(), toHonoPath(r.path), stub); // mount 501 stubs
z.toJSONSchema(templateOutputSchema(LECTURE_TEMPLATE)); // harness: provider response schema
```

Swift and Kotlin clients are generated from `openapi.json` (OpenAPI 3.1, `servers: /api/v2`).

## Open questions

The design docs left these open. Each choice below is the one that is easiest to extend additively later. Settle them before the P0 freeze, or confirm them as they are.

**Scoping**

1. `workspace` has no `workspace_id`. Its `id` is the `WorkspaceId`, and the workspace_id test exempts it by name.
2. User-owned rows carry a **required** `workspace_id`. On `auth_session` it is the workspace the session is acting in (initially the personal one). On `access_token` it is the only workspace the token may touch. On `integration` it is the workspace whose events it syncs. Required now can become optional later; the reverse would be breaking.
3. `job.workspace_id` and `stage_run.workspace_id` are nullable, for system jobs (`maintenance`) that belong to no workspace. The alternative is a system workspace row.
4. Workspace-scoped list endpoints and create bodies require an explicit `workspace_id` rather than defaulting to the session's workspace.

**Ids and keys**

5. Ids are opaque (`[A-Za-z0-9_-]{1,64}`), not `z.uuid()`, because v1 ids survive migration. If §5.3 re-keys everything to UUIDv7, tightening the pattern would be breaking, so decide before the freeze.
6. `transcript_segment` has no id. Its key is `(recording_id, idx)`, and sources point at `idx` ranges. Regenerating a transcript would invalidate those refs, so a transcript revision field may be needed later (an additive change).

**Documents and sources**

7. A stored source is `SourceRef = {kind:"transcript", start_idx, end_idx} | {kind:"pdf_page", asset_id, page}`. Model output keeps the doc's `#12` / `#40-#44` tokens plus context page numbers, and `verify` maps them.
8. `document_version.body` is `{ sections: [{ key, title, blocks }] }`. Blocks have ids, and `gap` blocks are written by code only. `body` is null only for `legacy-markdown` versions. `document` has no title of its own; the recording's title is used.
9. List items are objects `{ text, sources }`, not strings, so each bullet can carry evidence and gain fields later.
10. Extracted events and action items store `evidence: { sources, quote }`. Questions store `sources` and `flags` but have no confidence.
11. Decisions and glossary entries are extracted (§3.8), but no table holds them (§5.2 has none). They only end up rendered in the document.

**Time and dates**

12. `event_candidate.start_at` is required and stored in UTC. All-day events use local midnight in `tz`, converted to UTC, with an exclusive `end_at`. The alternative is separate local-date fields.
13. `model_resolution` adds `end_time` to the doc's `{date, time?, all_day}`.
14. A user editing `recorded_at` through PATCH sets `recorded_at_source` to `client`. There is no fourth `user` value.

**Enums and values the docs did not spell out**

15. `recording.status`: `uploading`, `queued`, `processing`, `ready`, `partial`, `failed`, `canceled`. `visibility`: `private`, `workspace`. v1 `is_public` becomes a share link.
16. `action_item.status`: `open`, `done`, `dismissed`. `question.difficulty`: `easy`, `medium`, `hard`. `stage_run.state` adds `pending`, `skipped` and `canceled`. `ai_call.status` adds `empty` and `truncated`.
17. `tag.color` is a design-token name, not a hex value. `source` (`user`/`ai`) lives on `recording_tag` (the assignment), not on `tag`.
18. Share-link scope is `{ transcript: bool, audio: bool }`, with the document always included, instead of an enum, so new flags can be added.
19. `workspace.plan` is a free slug, because billing is deferred (D10).
20. `usage_ledger` is a monthly rollup per workspace (`period` = `YYYY-MM` UTC), not an append-only ledger.
21. `auth_session` stores `token_hash`. v1 stores the raw session token.

**API surface**

22. Uploads: the server picks `part_size` and returns a part plan (`first_part`, `part_count` per file). §6 has the client send a part count instead. Audio files become assets with `part_index` in upload order. Upload sessions need a table that §5.2 does not list.
23. `GET /recordings/{id}/transcript` returns the whole transcript without pagination, because virtual scrolling and binary search need all segment times.
24. Documents are top-level (`/documents/{id}`, `/documents/{id}/versions`). The ETag is the version number in quotes.
25. `POST /recordings/{id}/reprocess` takes `mode: document | full` and `dry_run`, which returns the cost estimate shown before legacy reprocessing (§5.3).
26. Admin covers only jobs (with stage timeline and AI calls), retry, and usage. The v1 admin console keeps its v1 endpoints until it is ported.
27. Not modelled yet, all additive later: the ICS feed token, a template catalogue endpoint, workspace invitations, and the OAuth callback (a browser redirect). Bulk recording operations were added in P2 (below).
28. The cookie name in `securitySchemes` is the current `lectern_session`.

## P2 additions (2026-10-19)

Requested by the web app (`apps/web/README.md` "domain 요청") while the real API v2 was built. All of them are additive under the freeze rule. `openapi.json` was regenerated in the same commit.

New response fields are declared `.optional()` even though the server always sends them. That way the web app's fixtures and any parser written against the P0 contract keep working. Clients may rely on the server sending them.

| # | Change | Decision and reason |
|---|---|---|
| 2 | `SavedView` entity (`saved_view` table) and `GET/POST /views`, `PATCH/DELETE /views/{view_id}` | A view is private to the user who saved it (like ask threads). `query` is the `listRecordings` filter without paging, as JSON (`SavedViewQuery`), so the client can turn it back into query parameters. |
| 3 | `ListRecordingsQuery`: `include_subfolders`, `unfiled`, `tag_ids`, `q`, `recorded_after`, `recorded_before`, `sort` | Booleans are `true`/`false` strings and lists are comma-separated, because published schemas may not transform. `tag_ids` matches recordings with **every** tag. `q` is a title substring; full text goes through `/search`. |
| 4 | `POST /recordings/batch` (`move`, `add_tags`, `remove_tags`, `delete`) | Answers 200 with one `BatchRecordingResult` per id, in request order. A missing or forbidden recording fails on its own (`not_found`) and does not fail the batch. A missing target folder or tag fails the whole request (404). |
| 5 | `RecordingProgress` on `RecordingDetail.progress` and `RecordingListItem.progress` | The first render needs the stage and fraction without waiting for a `job.progress` event. v1 pipeline jobs report the stage `legacy_distill`. |
| 6 | `RecordingFailure` on `RecordingDetail.failure` | `{ code, message, job_id, failed_at }`. It is set while the recording is `failed` or `partial`. Migrated v1 failures have the code `legacy_error` and the v1 error message. |
| 7 | `edited` on stored document blocks | The server sets it on each block that differs from the base version when a user saves. Absent means false. The document-level `user_edited` stays. |
| 8 | `RecordingListItem`: `excerpt`, `audio_bytes`, `pdf_count`, `unverified_count` | `unverified_count` counts blocks whose sources carry a `VerifyFlag`. |
| 9 | `UpdateRecordingRequest.tag_ids` semantics | It replaces **all** tags, AI-attached ones included. A listed AI tag keeps `source: ai`. The user can remove an AI tag this way, which is what the web fixture already did. |
| 10 | `TranscriptSegment.lang` (optional, nullable) | Set only when it differs from the recording's language, so screen readers can switch (WCAG 3.1.2). |
| 11 | `deleteFolder` | The folder's recordings **and subfolders** move to its parent. Nothing is deleted with the folder. |
| 12 | 409 rules | Folders: a sibling (same parent) with the same name, compared trimmed and case-insensitively, or a move into the folder itself or one of its descendants. Tags: another tag in the workspace with the same name, compared the same way. These rules are written into the request schema descriptions. |
| 13 | `TagColorName` enum and `TAG_COLORS` (`red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `gray`) | `Tag.color` keeps its token-name pattern. Narrowing it to the enum would tighten request validation, which the freeze rule calls breaking. Clients offer the seven colours and render an unknown name as `gray`. A new colour is an enum addition. |
| 14 | `GET /action-items?workspace_id&status&due_after&due_before&recording_id` | Items with a due date come first (ascending), then the rest by creation. |
| 15 | `ListCalendarSuggestionsQuery`: `statuses`, `start_after`, `start_before` | `statuses` is comma-separated and overrides `status`. A month view sends `statuses=accepted,synced&start_after=…&start_before=…`. |
| — | `CreateDocumentVersionRequest.markdown` | A `legacy-markdown` document (every migrated v1 lecture, ARCHITECTURE §5.3) has no body, so its edit is Markdown. The request sends exactly one of `body` and `markdown`. The other one for that document's template is 400. Making `body` optional relaxes a request constraint. |
| — | `RecordingSearchHit` (`kind: "recording"`, title matches) and `SearchKind` `recording` | A new union variant. Older clients skip it. In a legacy-markdown document a `DocumentSearchHit.block_id` is `md-<n>`, the n-th blank-line-separated paragraph of `rendered_md`. |

Requests #16–21 (물어보기) are covered by `src/api/ask.ts` (ADR-0009). Request #1 (ids typed `unknown`) was fixed earlier in `primitives.ts`.
