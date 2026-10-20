// v1 lectures -> v2 rows (docs/v2/ARCHITECTURE.md §5.3).
//
// A lecture becomes a recording (domain `lecture`) in its owner's personal workspace, an
// audio asset, a `legacy-markdown` document whose versions hold the Markdown, a folder per
// course name, and a share link carrying the v1 share token and public flag. No transcript
// and no structured document are made up (option 1 of §5.3: "전사 없음 · 재처리 가능").
//
// While the v1 pipeline still writes `lectures` (the worker, compaction, the archive sync,
// the v1 routes), the v2 rows are a maintained projection of it:
//   - `projectLecture()` brings one lecture's v2 rows in line with its lecture row. db.ts
//     calls it after each of its lecture writes; it is idempotent and only writes diffs.
//   - triggers on `lectures` (created by db.ts, which owns that table) mark every written
//     lecture in `lecture_sync_pending`, so writes that bypass db.ts are projected by
//     `drainLectureSync()` before the next v2 read.
//   - v2 writes go the other way through db.ts (title, folder -> course, document version
//     -> markdown, share link -> is_public), after which projecting is a no-op.
// Writes run in IMMEDIATE transactions: the API and an external worker both project.
// `backfillLegacy()` is the migration itself (every lecture that has no recording yet),
// and `verifyLegacy()` checks lectures and v2 rows agree, row for row: the rehearsal
// against a copy of the production database (apps/server/scripts/rehearse-v2-migration.ts)
// and the deploy preflight both run it.

import type { Database } from "bun:sqlite";
import {
  courseFolderId,
  documentVersionId,
  lectureAudioAssetId,
  lectureDocumentId,
  lectureRecordingId,
  lectureShareLinkId,
  personalWorkspaceId,
  sha256Hex,
  uuidv7,
} from "./ids.ts";

export const LEGACY_TEMPLATE_ID = "legacy-markdown";
export const LEGACY_TEMPLATE_VERSION = 1;
/** v1 course name of a recording that is in no folder (v1 has no "no course"). */
export const UNFILED_COURSE = "미분류";
/** v1 share pages show the notes and play the audio, never a transcript. */
export const LEGACY_SHARE_SCOPE = { transcript: false, audio: true } as const;
export const PERSONAL_WORKSPACE_NAME = "내 노트";
/** `asset.blob_key` of a lecture's audio: the file at `lectures.audio_path`. */
export const lectureBlobKey = (lectureId: string) => `lecture:${lectureId}`;

/** The columns of a v1 `lectures` row this module reads. */
export interface LegacyLectureRow {
  id: string;
  owner_id: string;
  share_token: string;
  is_public: number;
  title: string;
  course: string;
  status: string;
  markdown: string;
  audio_path: string | null;
  audio_mime: string | null;
  audio_size: number;
  duration_sec: number;
  source_client: string;
  error_message: string | null;
  md_source_path: string | null;
  created_at: string;
  updated_at: string;
}

const LECTURE_COLUMNS =
  "id, owner_id, share_token, is_public, title, course, status, markdown, audio_path, audio_mime, audio_size, duration_sec, source_client, error_message, md_source_path, created_at, updated_at";

export interface ProjectOptions {
  /** Who wrote a changed Markdown: `ai` (the pipeline, the default) or `user` (an edit). */
  author?: "ai" | "user";
  authorId?: string | null;
  now?: number;
}

export type ProjectResult = "created" | "updated" | "deleted" | "unchanged" | "skipped";

/** v1 status -> domain RecordingStatus. */
export function recordingStatusOf(status: string): string {
  return status === "done" ? "ready" : status === "error" ? "failed" : "processing";
}

/** The v1 course of a folder name (null folder = unfiled). */
export function courseOf(folderName: string | null): string {
  return folderName ?? UNFILED_COURSE;
}

/** True when a v1 course means "no folder". */
export function isUnfiledCourse(course: string): boolean {
  return course.trim() === "" || course === UNFILED_COURSE;
}

function toMs(iso: string | null | undefined, fallback: number): number {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : fallback;
}

// ---------------------------------------------------------------------------
// Sort keys (folder.sort_key: siblings sort byte-wise)
// ---------------------------------------------------------------------------

const SORT_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A key that sorts after `key` (byte-wise), or the first key when there is none. */
export function sortKeyAfter(key: string | null): string {
  if (!key) return "m";
  const at = SORT_ALPHABET.indexOf(key[key.length - 1]!);
  if (at >= 0 && at < SORT_ALPHABET.length - 1) return key.slice(0, -1) + SORT_ALPHABET[at + 1];
  return `${key}0`;
}

/** The key that appends a new child under `parentId` (null: root) in the workspace. */
export function appendSortKey(sqlite: Database, workspaceId: string, parentId: string | null): string {
  const row = sqlite
    .query(`SELECT MAX(sort_key) AS k FROM folder WHERE workspace_id = ? AND parent_id IS ?`)
    .get(workspaceId, parentId) as { k: string | null };
  return sortKeyAfter(row.k);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/** Creates the user's personal workspace and owner membership if missing; returns its id. */
export function ensurePersonalWorkspace(sqlite: Database, userId: string, createdAt = Date.now()): string {
  const id = personalWorkspaceId(userId);
  sqlite
    .query(
      `INSERT OR IGNORE INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at)
       VALUES (?, ?, 'personal', 'free', '{}', ?, ?, ?)`
    )
    .run(id, PERSONAL_WORKSPACE_NAME, userId, createdAt, createdAt);
  sqlite
    .query(
      `INSERT OR IGNORE INTO membership (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)`
    )
    .run(id, userId, createdAt, createdAt);
  return id;
}

/** Deletes a workspace and every v2 row scoped to it (account deletion). */
export function deleteWorkspaceRows(sqlite: Database, workspaceId: string): void {
  sqlite.transaction(() => {
    for (const table of WORKSPACE_TABLES) {
      sqlite.query(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
    }
    sqlite.query(`DELETE FROM upload_part WHERE upload_id IN (SELECT id FROM upload WHERE workspace_id = ?)`).run(workspaceId);
    sqlite.query(`DELETE FROM upload WHERE workspace_id = ?`).run(workspaceId);
    sqlite.query(`DELETE FROM workspace WHERE id = ?`).run(workspaceId);
  }).immediate();
}

/** Every workspace-scoped entity table (upload/upload_part are handled separately). */
const WORKSPACE_TABLES = [
  "membership",
  "folder",
  "tag",
  "recording_tag",
  "asset",
  "transcript_segment",
  "transcript_gap",
  "speaker",
  "document_version",
  "document",
  "question",
  "event_candidate",
  "action_item",
  "share_link",
  "integration",
  "usage_ledger",
  "saved_view",
  "recording",
] as const;

/** Rows hanging off one recording, in deletion order. */
const RECORDING_CHILD_TABLES = [
  "recording_tag",
  "asset",
  "transcript_segment",
  "transcript_gap",
  "speaker",
  "document_version",
  "document",
  "question",
  "event_candidate",
  "action_item",
] as const;

/** Deletes a recording and every row that belongs to it (not the lecture, nor files). */
export function deleteRecordingRows(sqlite: Database, recordingId: string): void {
  sqlite.transaction(() => {
    sqlite
      .query(
        `DELETE FROM share_link WHERE target_id = ? OR target_id IN (SELECT id FROM document WHERE recording_id = ?)`
      )
      .run(recordingId, recordingId);
    for (const table of RECORDING_CHILD_TABLES) {
      sqlite.query(`DELETE FROM ${table} WHERE recording_id = ?`).run(recordingId);
    }
    sqlite.query(`UPDATE upload SET recording_id = NULL WHERE recording_id = ? AND status = 'open'`).run(recordingId);
    sqlite.query(`DELETE FROM recording WHERE id = ?`).run(recordingId);
  }).immediate();
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

/**
 * The folder a v1 course name means: an existing folder of that name (a root folder
 * first, then the oldest), else a new root folder. New folders get the id the 물어보기
 * bridge derived for the course while it is free. Null for "no course".
 */
export function folderForCourse(sqlite: Database, workspaceId: string, ownerId: string, course: string, now: number): string | null {
  if (isUnfiledCourse(course)) return null;
  const found = sqlite
    .query(
      `SELECT id FROM folder WHERE workspace_id = ? AND name = ?
       ORDER BY parent_id IS NOT NULL, created_at, id LIMIT 1`
    )
    .get(workspaceId, course) as { id: string } | null;
  if (found) return found.id;
  const derived = courseFolderId(ownerId, course);
  const taken = sqlite.query(`SELECT 1 FROM folder WHERE id = ?`).get(derived);
  const id = taken ? uuidv7(now) : derived;
  sqlite
    .query(
      `INSERT INTO folder (id, workspace_id, parent_id, name, sort_key, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(id, workspaceId, course, appendSortKey(sqlite, workspaceId, null), now, now);
  return id;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface RecordingRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  status: string;
  duration_ms: number | null;
  created_by: string;
  source_client: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: number;
  updated_at: number;
}

interface AssetRow {
  id: string;
  bytes: number;
  mime: string;
  sha256: string | null;
  duration_ms: number | null;
  meta_json: string;
}

interface DocumentRow {
  id: string;
  current_version: number;
  user_edited: number;
  md_source_path: string | null;
}

/** Re-scopes a recording's rows to another workspace (the lecture changed owner). */
function moveRecordingWorkspace(sqlite: Database, recordingId: string, workspaceId: string): void {
  for (const table of RECORDING_CHILD_TABLES) {
    sqlite.query(`UPDATE ${table} SET workspace_id = ? WHERE recording_id = ?`).run(workspaceId, recordingId);
  }
  sqlite.query(`DELETE FROM recording_tag WHERE recording_id = ?`).run(recordingId); // tags are per workspace
  sqlite.query(`UPDATE share_link SET workspace_id = ? WHERE target_id = ?`).run(workspaceId, recordingId);
  sqlite.query(`UPDATE recording SET workspace_id = ?, folder_id = NULL WHERE id = ?`).run(workspaceId, recordingId);
}

/** The new owner made the recording, as far as v2 is concerned (verifyLegacy compares it). */
function setRecordingOwner(sqlite: Database, recordingId: string, ownerId: string): void {
  sqlite.query(`UPDATE recording SET created_by = ? WHERE id = ?`).run(ownerId, recordingId);
  sqlite.query(`UPDATE share_link SET created_by = ? WHERE target_id = ?`).run(ownerId, recordingId);
}

/** Brings the v2 rows of one lecture in line with its lecture row (see the header). */
export function projectLecture(sqlite: Database, lectureId: string, options: ProjectOptions = {}): ProjectResult {
  return sqlite.transaction(() => projectLectureTx(sqlite, lectureId, options)).immediate();
}

function projectLectureTx(sqlite: Database, lectureId: string, options: ProjectOptions): ProjectResult {
  const now = options.now ?? Date.now();
  sqlite.query(`DELETE FROM lecture_sync_pending WHERE lecture_id = ?`).run(lectureId);
  const l = sqlite.query(`SELECT ${LECTURE_COLUMNS} FROM lectures WHERE id = ?`).get(lectureId) as LegacyLectureRow | null;
  let rec = sqlite.query(`SELECT * FROM recording WHERE lecture_id = ?`).get(lectureId) as RecordingRow | null;

  if (!l) {
    if (!rec) return "unchanged";
    deleteRecordingRows(sqlite, rec.id);
    return "deleted";
  }
  // Rows from before the owner existed are adopted at boot (ensureBootstrapOwner) and
  // projected then.
  if (!l.owner_id) return "skipped";

  const ownerExists = sqlite.query(`SELECT 1 FROM users WHERE id = ?`).get(l.owner_id);
  const workspaceId = ownerExists
    ? ensurePersonalWorkspace(sqlite, l.owner_id, now)
    : ensureOrphanWorkspace(sqlite, l.owner_id, now);
  const recordingId = rec?.id ?? lectureRecordingId(l.id);
  const createdMs = toMs(l.created_at, now);
  const updatedMs = toMs(l.updated_at, createdMs);
  const status = recordingStatusOf(l.status);
  const durationMs = l.duration_sec > 0 ? Math.round(l.duration_sec * 1000) : null;
  const failureCode = l.status === "error" ? "legacy_error" : null;
  const failureMessage = l.status === "error" ? l.error_message || "노트 생성에 실패했습니다." : null;
  let changed = false;

  if (rec && (rec.workspace_id !== workspaceId || rec.created_by !== l.owner_id)) {
    if (rec.workspace_id !== workspaceId) moveRecordingWorkspace(sqlite, rec.id, workspaceId);
    setRecordingOwner(sqlite, rec.id, l.owner_id);
    rec = sqlite.query(`SELECT * FROM recording WHERE id = ?`).get(rec.id) as RecordingRow;
    changed = true;
  }

  // Folder: keep the recording where v2 put it while its folder still has the course's
  // name (v2 can nest folders; v1 only knows the leaf name).
  let folderId: string | null;
  if (rec) {
    const current = rec.folder_id
      ? (sqlite.query(`SELECT id, name, parent_id FROM folder WHERE id = ?`).get(rec.folder_id) as FolderRow | null)
      : null;
    const consistent = current ? current.name === l.course : isUnfiledCourse(l.course);
    folderId = consistent ? (current?.id ?? null) : folderForCourse(sqlite, workspaceId, l.owner_id, l.course, now);
  } else {
    folderId = folderForCourse(sqlite, workspaceId, l.owner_id, l.course, now);
  }

  if (!rec) {
    sqlite
      .query(
        `INSERT INTO recording (id, workspace_id, folder_id, title, domain, template_id, language, recorded_at,
           recorded_at_source, duration_ms, status, created_by, visibility, lecture_id, source_client,
           failure_code, failure_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'lecture', NULL, NULL, ?, 'upload', ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        recordingId,
        workspaceId,
        folderId,
        l.title,
        createdMs,
        durationMs,
        status,
        l.owner_id,
        l.id,
        l.source_client || null,
        failureCode,
        failureMessage,
        createdMs,
        updatedMs
      );
  } else if (
    rec.folder_id !== folderId ||
    rec.title !== l.title ||
    rec.status !== status ||
    rec.duration_ms !== durationMs ||
    rec.failure_code !== failureCode ||
    rec.failure_message !== failureMessage ||
    rec.created_at !== createdMs
  ) {
    sqlite
      .query(
        `UPDATE recording SET folder_id = ?, title = ?, status = ?, duration_ms = ?, failure_code = ?,
           failure_message = ?, created_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(folderId, l.title, status, durationMs, failureCode, failureMessage, createdMs, Math.max(updatedMs, rec.updated_at), rec.id);
    changed = true;
  }

  changed = projectAudio(sqlite, l, workspaceId, recordingId, durationMs, createdMs) || changed;
  changed = projectDocument(sqlite, l, workspaceId, recordingId, options, now, createdMs) || changed;
  changed = projectShareLink(sqlite, l, workspaceId, recordingId, now, createdMs) || changed;

  return rec ? (changed ? "updated" : "unchanged") : "created";
}

/** A workspace for lectures whose owner no longer exists, so no row is lost (no member can open it). */
function ensureOrphanWorkspace(sqlite: Database, ownerId: string, now: number): string {
  const id = personalWorkspaceId(ownerId);
  sqlite
    .query(
      `INSERT OR IGNORE INTO workspace (id, name, kind, plan, settings_json, personal_user_id, created_at, updated_at)
       VALUES (?, ?, 'personal', 'free', '{}', ?, ?, ?)`
    )
    .run(id, PERSONAL_WORKSPACE_NAME, ownerId, now, now);
  return id;
}

function projectAudio(
  sqlite: Database,
  l: LegacyLectureRow,
  workspaceId: string,
  recordingId: string,
  durationMs: number | null,
  createdMs: number
): boolean {
  const id = lectureAudioAssetId(l.id);
  const existing = sqlite.query(`SELECT id, bytes, mime, sha256, duration_ms, meta_json FROM asset WHERE id = ?`).get(id) as AssetRow | null;
  if (!l.audio_path) {
    if (!existing) return false;
    sqlite.query(`DELETE FROM asset WHERE id = ?`).run(id);
    return true;
  }
  const mime = l.audio_mime || "application/octet-stream";
  if (!existing) {
    sqlite
      .query(
        `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms,
           page_count, meta_json, created_at)
         VALUES (?, ?, ?, 'audio', 0, ?, NULL, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, workspaceId, recordingId, lectureBlobKey(l.id), l.audio_size, mime, durationMs, JSON.stringify({ path: l.audio_path }), createdMs);
    return true;
  }
  // The digest belongs to one file: compaction or a re-upload swaps the path.
  const meta = parseObject(existing.meta_json);
  const samePath = meta.path === l.audio_path;
  if (samePath && existing.bytes === l.audio_size && existing.mime === mime && existing.duration_ms === durationMs) return false;
  sqlite
    .query(`UPDATE asset SET bytes = ?, mime = ?, duration_ms = ?, sha256 = ?, meta_json = ? WHERE id = ?`)
    .run(
      l.audio_size,
      mime,
      durationMs,
      samePath ? existing.sha256 : null,
      JSON.stringify({ ...meta, path: l.audio_path }),
      id
    );
  return true;
}

function projectDocument(
  sqlite: Database,
  l: LegacyLectureRow,
  workspaceId: string,
  recordingId: string,
  options: ProjectOptions,
  now: number,
  createdMs: number
): boolean {
  const id = lectureDocumentId(l.id);
  const doc = sqlite.query(`SELECT id, current_version, user_edited, md_source_path FROM document WHERE id = ?`).get(id) as DocumentRow | null;
  if (!doc) {
    if (l.markdown === "") return false;
    const author = options.author ?? "ai";
    const at = toMs(l.updated_at, createdMs);
    sqlite
      .query(
        `INSERT INTO document (id, workspace_id, recording_id, template_id, template_version, current_version, user_edited,
           md_source_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(id, workspaceId, recordingId, LEGACY_TEMPLATE_ID, LEGACY_TEMPLATE_VERSION, author === "user" ? 1 : 0, l.md_source_path, at, at);
    insertLegacyVersion(sqlite, { documentId: id, workspaceId, recordingId, version: 1, base: null, markdown: l.markdown, author, authorId: options.authorId ?? null, at });
    return true;
  }
  let changed = false;
  if (doc.md_source_path !== l.md_source_path) {
    sqlite.query(`UPDATE document SET md_source_path = ? WHERE id = ?`).run(l.md_source_path, id);
    changed = true;
  }
  const current = sqlite
    .query(`SELECT rendered_md FROM document_version WHERE document_id = ? AND version = ?`)
    .get(id, doc.current_version) as { rendered_md: string } | null;
  if (current && current.rendered_md === l.markdown) return changed;
  const author = options.author ?? "ai";
  const version = doc.current_version + 1;
  insertLegacyVersion(sqlite, {
    documentId: id,
    workspaceId,
    recordingId,
    version,
    base: author === "user" ? doc.current_version : null,
    markdown: l.markdown,
    author,
    authorId: author === "user" ? (options.authorId ?? null) : null,
    at: now,
  });
  sqlite
    .query(`UPDATE document SET current_version = ?, user_edited = ?, updated_at = ? WHERE id = ?`)
    .run(version, author === "user" || doc.user_edited ? 1 : 0, now, id);
  return true;
}

export function insertLegacyVersion(
  sqlite: Database,
  v: {
    documentId: string;
    workspaceId: string;
    recordingId: string;
    version: number;
    base: number | null;
    markdown: string;
    author: "ai" | "user";
    authorId: string | null;
    at: number;
  }
): void {
  sqlite
    .query(
      `INSERT INTO document_version (id, workspace_id, document_id, recording_id, version, base_version, template_id,
         template_version, body_json, rendered_md, created_by, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(
      documentVersionId(v.documentId, v.version),
      v.workspaceId,
      v.documentId,
      v.recordingId,
      v.version,
      v.base,
      LEGACY_TEMPLATE_ID,
      LEGACY_TEMPLATE_VERSION,
      v.markdown,
      v.author,
      v.authorId,
      v.at
    );
}

function projectShareLink(
  sqlite: Database,
  l: LegacyLectureRow,
  workspaceId: string,
  recordingId: string,
  now: number,
  createdMs: number
): boolean {
  const id = lectureShareLinkId(l.id);
  const tokenHash = sha256Hex(l.share_token);
  const existing = sqlite.query(`SELECT token_hash, revoked_at FROM share_link WHERE id = ?`).get(id) as
    | { token_hash: string; revoked_at: number | null }
    | null;
  const isPublic = l.is_public === 1;
  if (!existing) {
    sqlite
      .query(
        `INSERT INTO share_link (id, workspace_id, target_type, target_id, token_hash, scope_json, expires_at, password_hash,
           created_by, created_at, revoked_at)
         VALUES (?, ?, 'recording', ?, ?, ?, NULL, NULL, ?, ?, ?)`
      )
      .run(id, workspaceId, recordingId, tokenHash, JSON.stringify(LEGACY_SHARE_SCOPE), l.owner_id, createdMs, isPublic ? null : createdMs);
    return true;
  }
  const revokedAt = isPublic ? null : (existing.revoked_at ?? now);
  if (existing.token_hash === tokenHash && existing.revoked_at === revokedAt) return false;
  sqlite.query(`UPDATE share_link SET token_hash = ?, revoked_at = ? WHERE id = ?`).run(tokenHash, revokedAt, id);
  return true;
}

function parseObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Projects every lecture the triggers marked; returns how many. */
export function drainLectureSync(sqlite: Database, options: ProjectOptions = {}): number {
  let total = 0;
  for (;;) {
    const ids = (sqlite.query(`SELECT lecture_id FROM lecture_sync_pending ORDER BY marked_at LIMIT 200`).all() as Array<{ lecture_id: string }>).map(
      (r) => r.lecture_id
    );
    if (ids.length === 0) return total;
    for (const id of ids) projectLecture(sqlite, id, options);
    total += ids.length;
  }
}

/**
 * Marks every written lecture in `lecture_sync_pending`. `lectures` belongs to the v1
 * bootstrap in apps/server/src/db.ts, which installs these once that table exists.
 */
export function installLectureSyncTriggers(sqlite: Database): void {
  const mark = (ref: "NEW" | "OLD") =>
    `INSERT OR REPLACE INTO lecture_sync_pending (lecture_id, marked_at) VALUES (${ref}.id, CAST(strftime('%s', 'now') AS INTEGER) * 1000);`;
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS lectures_v2_sync_insert AFTER INSERT ON lectures BEGIN ${mark("NEW")} END;
    CREATE TRIGGER IF NOT EXISTS lectures_v2_sync_update AFTER UPDATE ON lectures BEGIN ${mark("NEW")} END;
    CREATE TRIGGER IF NOT EXISTS lectures_v2_sync_delete AFTER DELETE ON lectures BEGIN ${mark("OLD")} END;
  `);
}

/** True when some lecture write has not been projected yet (cheap: one indexed probe). */
export function hasPendingLectureSync(sqlite: Database): boolean {
  return Boolean(sqlite.query(`SELECT 1 FROM lecture_sync_pending LIMIT 1`).get());
}

// ---------------------------------------------------------------------------
// Backfill (the migration) and verification
// ---------------------------------------------------------------------------

export interface BackfillReport {
  workspaces: number;
  recordings: number;
  skipped: number;
}

/**
 * The §5.3 migration: a personal workspace for every user and v2 rows for every lecture
 * that has no recording yet. Idempotent; run at every boot. v1 tables are not modified.
 */
export function backfillLegacy(sqlite: Database, now = Date.now()): BackfillReport {
  return sqlite.transaction(() => {
    let workspaces = 0;
    const users = sqlite
      .query(
        `SELECT u.id, u.created_at FROM users u
         WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id AND m.workspace_id = 'wsp_' || u.id)`
      )
      .all() as Array<{ id: string; created_at: string }>;
    for (const u of users) {
      const id = personalWorkspaceId(u.id);
      const had = sqlite.query(`SELECT 1 FROM membership WHERE workspace_id = ? AND user_id = ?`).get(id, u.id);
      if (had) continue;
      ensurePersonalWorkspace(sqlite, u.id, toMs(u.created_at, now));
      workspaces += 1;
    }
    let recordings = 0;
    let skipped = 0;
    const lectures = sqlite
      .query(`SELECT l.id FROM lectures l WHERE NOT EXISTS (SELECT 1 FROM recording r WHERE r.lecture_id = l.id) ORDER BY l.created_at, l.id`)
      .all() as Array<{ id: string }>;
    for (const { id } of lectures) {
      const result = projectLectureTx(sqlite, id, { now });
      if (result === "created") recordings += 1;
      else if (result === "skipped") skipped += 1;
    }
    drainLectureSync(sqlite, { now });
    return { workspaces, recordings, skipped };
  }).immediate();
}

export interface CountCheck {
  v1: number;
  v2: number;
}

export interface LegacyVerifyReport {
  ok: boolean;
  counts: {
    users: CountCheck;
    lectures: CountCheck;
    documents: CountCheck;
    audio: CountCheck;
    courses: CountCheck;
    public_links: CountCheck;
  };
  /** sha256 over every lecture's comparable fields, from each side. Equal when lossless. */
  checksums: { v1: string; v2: string };
  /** Lectures whose fields differ (ids and field names only; at most 50). */
  mismatches: Array<{ lecture_id: string; fields: string[] }>;
  mismatch_count: number;
  /** Lectures with no owner yet (adopted by the bootstrap owner at server boot). */
  unowned_lectures: number;
}

const FIELDS = ["owner", "title", "course", "status", "markdown", "audio", "duration", "share_token", "public", "created_at", "archive"] as const;

/** Compares every lecture with its v2 rows (see the header). Reads only. */
export function verifyLegacy(sqlite: Database): LegacyVerifyReport {
  const lectures = sqlite.query(`SELECT ${LECTURE_COLUMNS} FROM lectures WHERE owner_id != '' ORDER BY id`).all() as LegacyLectureRow[];
  const unowned = (sqlite.query(`SELECT COUNT(*) AS n FROM lectures WHERE owner_id = ''`).get() as { n: number }).n;

  const v1Lines: string[] = [];
  const v2Lines: string[] = [];
  const mismatches: Array<{ lecture_id: string; fields: string[] }> = [];
  let mismatchCount = 0;

  const recordingOf = sqlite.query(
    `SELECT r.id, r.workspace_id, r.title, r.status, r.duration_ms, r.created_by, r.created_at, f.name AS folder_name
     FROM recording r LEFT JOIN folder f ON f.id = r.folder_id WHERE r.lecture_id = ?`
  );
  const documentOf = sqlite.query(
    `SELECT d.md_source_path, v.rendered_md FROM document d
     JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version WHERE d.id = ?`
  );
  const assetOf = sqlite.query(`SELECT bytes, meta_json FROM asset WHERE id = ?`);
  const linkOf = sqlite.query(`SELECT token_hash, revoked_at, target_id FROM share_link WHERE id = ?`);

  for (const l of lectures) {
    const v1 = {
      owner: personalWorkspaceId(l.owner_id) + "/" + l.owner_id,
      title: l.title,
      course: isUnfiledCourse(l.course) ? UNFILED_COURSE : l.course,
      status: recordingStatusOf(l.status),
      markdown: sha256Hex(l.markdown),
      audio: l.audio_path ? `${l.audio_size}:${l.audio_path}` : "-",
      duration: l.duration_sec > 0 ? String(Math.round(l.duration_sec * 1000)) : "-",
      share_token: sha256Hex(l.share_token),
      public: l.is_public === 1 ? "1" : "0",
      created_at: String(toMs(l.created_at, 0)),
      archive: l.markdown !== "" ? (l.md_source_path ?? "-") : "-",
    };
    const r = recordingOf.get(l.id) as
      | { id: string; workspace_id: string; title: string; status: string; duration_ms: number | null; created_by: string; created_at: number; folder_name: string | null }
      | null;
    const doc = documentOf.get(lectureDocumentId(l.id)) as { md_source_path: string | null; rendered_md: string } | null;
    const audio = assetOf.get(lectureAudioAssetId(l.id)) as { bytes: number; meta_json: string } | null;
    const link = linkOf.get(lectureShareLinkId(l.id)) as { token_hash: string; revoked_at: number | null; target_id: string } | null;
    const v2 = {
      owner: r ? `${r.workspace_id}/${r.created_by}` : "-",
      title: r?.title ?? "-",
      course: r ? courseOf(r.folder_name) : "-",
      status: r?.status ?? "-",
      markdown: sha256Hex(doc?.rendered_md ?? ""),
      audio: audio ? `${audio.bytes}:${String(parseObject(audio.meta_json).path ?? "")}` : "-",
      duration: r?.duration_ms != null ? String(r.duration_ms) : "-",
      share_token: link && r && link.target_id === r.id ? link.token_hash : "-",
      public: link ? (link.revoked_at === null ? "1" : "0") : "-",
      created_at: r ? String(r.created_at) : "-",
      // A legacy document whose current version is empty (a v1 edit cleared the notes)
      // stands for "no notes", like an empty lectures.markdown.
      archive: doc && doc.rendered_md !== "" ? (doc.md_source_path ?? "-") : "-",
    };
    v1Lines.push([l.id, ...FIELDS.map((f) => v1[f])].join("\t"));
    v2Lines.push([l.id, ...FIELDS.map((f) => v2[f])].join("\t"));
    const differing = FIELDS.filter((f) => v1[f] !== v2[f]);
    if (differing.length) {
      mismatchCount += 1;
      if (mismatches.length < 50) mismatches.push({ lecture_id: l.id, fields: differing });
    }
  }

  const n = (sql: string) => (sqlite.query(sql).get() as { n: number }).n;
  const counts = {
    users: {
      v1: n(`SELECT COUNT(*) AS n FROM users`),
      v2: n(
        `SELECT COUNT(*) AS n FROM membership m JOIN workspace w ON w.id = m.workspace_id
         WHERE w.kind = 'personal' AND w.personal_user_id = m.user_id AND m.role = 'owner'`
      ),
    },
    lectures: { v1: lectures.length, v2: n(`SELECT COUNT(*) AS n FROM recording WHERE lecture_id IS NOT NULL`) },
    documents: {
      v1: n(`SELECT COUNT(*) AS n FROM lectures WHERE owner_id != '' AND markdown != ''`),
      v2: n(
        `SELECT COUNT(*) AS n FROM document d JOIN recording r ON r.id = d.recording_id
         JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version
         WHERE r.lecture_id IS NOT NULL AND d.template_id = '${LEGACY_TEMPLATE_ID}' AND v.rendered_md != ''`
      ),
    },
    audio: {
      v1: n(`SELECT COUNT(*) AS n FROM lectures WHERE owner_id != '' AND audio_path IS NOT NULL`),
      v2: n(`SELECT COUNT(*) AS n FROM asset WHERE blob_key LIKE 'lecture:%'`),
    },
    courses: {
      v1: new Set(lectures.filter((l) => !isUnfiledCourse(l.course)).map((l) => `${l.owner_id}\n${l.course}`)).size,
      v2: n(
        `SELECT COUNT(*) AS n FROM (SELECT DISTINCT r.workspace_id, f.name FROM recording r JOIN folder f ON f.id = r.folder_id
         WHERE r.lecture_id IS NOT NULL)`
      ),
    },
    public_links: {
      v1: n(`SELECT COUNT(*) AS n FROM lectures WHERE owner_id != '' AND is_public = 1`),
      v2: n(`SELECT COUNT(*) AS n FROM share_link WHERE id LIKE 'shl\\_%' ESCAPE '\\' AND revoked_at IS NULL`),
    },
  };
  const checksums = { v1: sha256Hex(v1Lines.join("\n")), v2: sha256Hex(v2Lines.join("\n")) };
  const countsOk = Object.values(counts).every((c) => c.v1 === c.v2);
  return {
    ok: countsOk && mismatchCount === 0 && checksums.v1 === checksums.v2,
    counts,
    checksums,
    mismatches,
    mismatch_count: mismatchCount,
    unowned_lectures: unowned,
  };
}
