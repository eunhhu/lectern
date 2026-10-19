// v2 table reads and writes shared by the /api/v2 routers. The tables are packages/db's;
// migrated v1 lectures are kept in step with them (packages/db legacy.ts), so a recording
// with a `lecture_id` also has processing state and audio on its lecture row.

import { existsSync } from "node:fs";
import { courseOf, personalWorkspaceId, uuidv7 } from "@lectern/db";
import { db, getLectureById, mirrorRecordingToLecture, type LectureRecord } from "../../db.ts";
import { toLectureSummaryDto } from "../../dto.ts";
import { emitLectureEvent } from "../../events.ts";
import { logger } from "../../log.ts";
import { queuePosition } from "../../queue.ts";
import {
  assetDto,
  documentDto,
  jobDto,
  recordingDto,
  recordingTagDto,
  speakerDto,
  type AssetRow,
  type DocumentRow,
  type FolderRow,
  type QueueJobRow,
  type RecordingRow,
  type RecordingTagRow,
  type SpeakerRow,
} from "./rows.ts";

export { uuidv7 };

/** Runs `fn` in one IMMEDIATE transaction (the worker projects lectures concurrently). */
export function transact<T>(fn: () => T): T {
  return db.transaction(fn).immediate();
}

export function getRecordingRow(id: string): RecordingRow | null {
  return db.query(`SELECT * FROM recording WHERE id = ?`).get(id) as RecordingRow | null;
}

export function getFolderRow(id: string): FolderRow | null {
  return db.query(`SELECT * FROM folder WHERE id = ?`).get(id) as FolderRow | null;
}

export function foldersOf(workspaceId: string): FolderRow[] {
  return db.query(`SELECT * FROM folder WHERE workspace_id = ? ORDER BY sort_key, created_at, id`).all(workspaceId) as FolderRow[];
}

/** `folderId` and every folder below it. */
export function folderSubtree(workspaceId: string, folderId: string): string[] {
  const children = new Map<string, string[]>();
  for (const f of foldersOf(workspaceId)) {
    if (!f.parent_id) continue;
    children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f.id]);
  }
  const out: string[] = [];
  const stack = [folderId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Names compare trimmed and case-insensitively for the 409 rules (domain README #12). */
export const nameKey = (name: string) => name.trim().toLowerCase();

// ---------------------------------------------------------------------------
// v2 -> v1 mirror and events
// ---------------------------------------------------------------------------

/** The v1 course a recording in `folderId` has. */
export function courseForFolder(folderId: string | null): string {
  return courseOf(folderId ? (getFolderRow(folderId)?.name ?? null) : null);
}

/** Mirrors a recording's title/folder to its lecture (in the caller's transaction). */
export function mirrorRecording(recording: RecordingRow, fields: { title?: string; folderId?: string | null }): void {
  if (!recording.lecture_id) return;
  mirrorRecordingToLecture(recording.lecture_id, {
    title: fields.title,
    course: fields.folderId !== undefined ? courseForFolder(fields.folderId) : undefined,
  });
}

/** Tells v1 clients (and the v2 event stream) that these lectures changed. */
export function announceLectures(lectureIds: Iterable<string>): void {
  for (const id of lectureIds) {
    try {
      const lecture = getLectureById(id);
      if (lecture) emitLectureEvent(lecture.owner_id, { type: "updated", id, lecture: toLectureSummaryDto(lecture) });
    } catch (err) {
      logger.error("could not announce a lecture change", { lecture_id: id, err });
    }
  }
}

export function announceDeleted(ownerId: string, lectureIds: string[]): void {
  if (lectureIds.length) emitLectureEvent(ownerId, { type: "deleted", id: lectureIds[0], ids: lectureIds });
}

// ---------------------------------------------------------------------------
// Recording detail parts
// ---------------------------------------------------------------------------

export function tagRowsOf(recordingId: string): RecordingTagRow[] {
  return db.query(`SELECT * FROM recording_tag WHERE recording_id = ? ORDER BY created_at, tag_id`).all(recordingId) as RecordingTagRow[];
}

export function tagIdsByRecording(recordingIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!recordingIds.length) return out;
  const rows = db
    .query(`SELECT recording_id, tag_id FROM recording_tag WHERE recording_id IN (${recordingIds.map(() => "?").join(",")}) ORDER BY created_at, tag_id`)
    .all(...recordingIds) as Array<{ recording_id: string; tag_id: string }>;
  for (const r of rows) out.set(r.recording_id, [...(out.get(r.recording_id) ?? []), r.tag_id]);
  return out;
}

export function documentsOf(recordingId: string): DocumentRow[] {
  return db.query(`SELECT * FROM document WHERE recording_id = ? ORDER BY created_at, id`).all(recordingId) as DocumentRow[];
}

export function speakersOf(recordingId: string): SpeakerRow[] {
  return db.query(`SELECT * FROM speaker WHERE recording_id = ? ORDER BY label, id`).all(recordingId) as SpeakerRow[];
}

/** The file holding an asset's bytes, or null when it is gone. */
export function assetPath(asset: Pick<AssetRow, "blob_key">): string | null {
  const key = asset.blob_key;
  let path: string | null = null;
  if (key.startsWith("lecture:")) path = getLectureById(key.slice("lecture:".length))?.audio_path ?? null;
  else if (key.startsWith("file:")) path = key.slice("file:".length);
  return path && existsSync(path) ? path : null;
}

export async function sha256OfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/**
 * Fills in the digest of an asset migrated without one (a v1 `audio_sha256` may be a
 * client key, not a file hash). Null when the file is gone.
 */
export async function ensureAssetDigest(asset: AssetRow): Promise<AssetRow | null> {
  const path = assetPath(asset);
  if (!path) return null;
  if (asset.sha256) return asset;
  const sha256 = await sha256OfFile(path);
  // Only for the file it was computed from: compaction may have swapped it meanwhile.
  const meta = JSON.parse(asset.meta_json || "{}") as Record<string, unknown>;
  if (meta.path !== undefined && meta.path !== path) return null;
  db.query(`UPDATE asset SET sha256 = ?, meta_json = ? WHERE id = ? AND sha256 IS NULL`).run(sha256, JSON.stringify({ ...meta, path }), asset.id);
  return { ...asset, sha256 };
}

/** The recording's assets that have bytes on disk, digests computed. */
export async function assetsOf(recordingId: string): Promise<AssetRow[]> {
  const rows = db.query(`SELECT * FROM asset WHERE recording_id = ? ORDER BY kind, part_index, created_at`).all(recordingId) as AssetRow[];
  const out: AssetRow[] = [];
  for (const row of rows) {
    const ready = await ensureAssetDigest(row);
    if (ready) out.push(ready);
  }
  return out;
}

let digestRunning = false;

/** Computes missing asset digests in the background, oldest first (API process only). */
export async function digestPendingAssets(limit = 20): Promise<number> {
  if (digestRunning) return 0;
  digestRunning = true;
  let done = 0;
  try {
    const rows = db.query(`SELECT * FROM asset WHERE sha256 IS NULL ORDER BY created_at LIMIT ?`).all(limit) as AssetRow[];
    for (const row of rows) {
      try {
        if (await ensureAssetDigest(row)) done += 1;
      } catch (err) {
        logger.warn("could not hash an asset", { asset_id: row.id, err });
      }
    }
  } finally {
    digestRunning = false;
  }
  return done;
}

// ---------------------------------------------------------------------------
// Jobs and progress
// ---------------------------------------------------------------------------

/** Queue kinds that process a recording (the others index or compact it in the background). */
const PROCESSING_KINDS = ["distill", "process", "regenerate"];

export function recordingIdOfSubject(subjectId: string | null): string | null {
  if (!subjectId) return null;
  const row = db.query(`SELECT id FROM recording WHERE lecture_id = ? OR id = ? LIMIT 1`).get(subjectId, subjectId) as { id: string } | null;
  return row?.id ?? null;
}

export function toJob(row: QueueJobRow) {
  const workspaceId = row.workspace_id ?? (row.kind === "maintenance" ? null : personalWorkspaceId(row.owner_id));
  return jobDto(row, recordingIdOfSubject(row.subject_id), workspaceId);
}

export function activeJobRow(recording: RecordingRow): QueueJobRow | null {
  const subject = recording.lecture_id ?? recording.id;
  return (
    (db
      .query(
        `SELECT * FROM job WHERE subject_id = ? AND state IN ('queued', 'running') AND kind IN (${PROCESSING_KINDS.map(() => "?").join(",")})
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(subject, ...PROCESSING_KINDS) as QueueJobRow | null) ?? null
  );
}

export function progressOf(recording: RecordingRow, job: QueueJobRow | null, lecture: LectureRecord | null) {
  if (!job) return null;
  return {
    job_id: job.id,
    state: job.state === "running" ? ("running" as const) : ("queued" as const),
    stage: "legacy_distill",
    stage_state: job.state === "running" ? "running" : "pending",
    progress: lecture ? Math.min(1, Math.max(0, lecture.progress / 100)) : null,
    message: lecture?.stage_message || null,
    queue_position: job.state === "queued" ? safeQueuePosition(job.id) : null,
  };
}

function safeQueuePosition(jobId: string): number | null {
  try {
    return queuePosition(jobId);
  } catch {
    return null;
  }
}

export function failureOf(recording: RecordingRow) {
  if (recording.status !== "failed" && recording.status !== "partial") return null;
  if (!recording.failure_code) return null;
  const job = db
    .query(`SELECT id, finished_at FROM job WHERE subject_id = ? AND state = 'failed' ORDER BY finished_at DESC LIMIT 1`)
    .get(recording.lecture_id ?? recording.id) as { id: string; finished_at: number | null } | null;
  return {
    code: recording.failure_code,
    message: recording.failure_message ?? "처리에 실패했습니다.",
    job_id: job?.id ?? null,
    failed_at: job?.finished_at ? new Date(job.finished_at).toISOString() : new Date(recording.updated_at).toISOString(),
  };
}

export async function recordingDetail(recording: RecordingRow) {
  const job = activeJobRow(recording);
  const lecture = recording.lecture_id ? getLectureById(recording.lecture_id) : null;
  return {
    recording: recordingDto(recording),
    tags: tagRowsOf(recording.id).map(recordingTagDto),
    assets: (await assetsOf(recording.id)).map(assetDto),
    speakers: speakersOf(recording.id).map(speakerDto),
    documents: documentsOf(recording.id).map(documentDto),
    active_job: job ? toJob(job) : null,
    progress: progressOf(recording, job, lecture),
    failure: failureOf(recording),
  };
}

