// Creating a recording from one stored audio file: the path every upload takes, from the
// v2 resumable uploads (uploads.ts) and from the v1 adapters (`/api/ingest/shortcut`,
// `/api/lectures/ingest` in index.ts). The v1 pipeline processes it, so it is a lecture
// too; the recording gets what v1 never recorded, `recorded_at` from the client or the
// media metadata (ARCHITECTURE §6 "업로드 계약에 recorded_at 추가").

import { lectureAudioAssetId, lectureRecordingId, placeRecordingInWorkspace } from "@lectern/db";
import { createPendingLecture, db, mirrorRecordingToLecture, type LectureRecord } from "../../db.ts";
import { courseForFolder, transact } from "./store.ts";

/** Media `creation_time` from ffprobe, or null (no ffprobe, no tag, implausible value). */
export async function mediaCreationTime(path: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path], { stdout: "pipe", stderr: "ignore" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    const created = (JSON.parse(out) as { format?: { tags?: Record<string, string> } }).format?.tags?.creation_time;
    const t = created ? Date.parse(created) : Number.NaN;
    // Devices without a clock report the epoch; ignore anything implausible.
    return Number.isFinite(t) && t > Date.parse("2000-01-01T00:00:00Z") && t < Date.now() + 86_400_000 ? t : null;
  } catch {
    return null;
  }
}

export interface NewRecordingInput {
  lectureId: string;
  ownerId: string;
  audioPath: string;
  audioMime: string;
  audioSize: number;
  /** The v1 dedupe key (`audio_sha256`): the file digest, or a client's idempotency key. */
  dedupeKey: string;
  /** The file's real digest, when known (saves hashing it again later). */
  sha256?: string | null;
  title: string;
  /** v1 course name; ignored when `folderId` is given (the folder's name is used). */
  course?: string;
  folderId?: string | null;
  model: string;
  sourceClient: string;
  /** Client clock (ms); else media metadata, else the upload time. */
  recordedAt?: number | null;
  domain?: string;
  templateId?: string | null;
  language?: string | null;
  tagIds?: string[];
  /** A team workspace to put the recording in (P5-06); unset: the owner's personal workspace. */
  teamWorkspaceId?: string | null;
}

/** Creates the lecture and its recording in one transaction; the caller queues processing. */
export async function createRecordingForAudio(input: NewRecordingInput): Promise<LectureRecord> {
  const fromMedia = input.recordedAt ? null : await mediaCreationTime(input.audioPath);
  const recordedAt = input.recordedAt ?? fromMedia;
  const source = input.recordedAt ? "client" : fromMedia ? "media" : "upload";
  const course = input.folderId !== undefined && input.folderId !== null ? courseForFolder(input.folderId) : (input.course ?? courseForFolder(null));
  const team = input.teamWorkspaceId ?? null;
  const unfiled = courseForFolder(null);
  return transact(() => {
    const lecture = createPendingLecture({
      id: input.lectureId,
      ownerId: input.ownerId,
      title: input.title,
      // A team upload starts unfiled, so no course folder appears in the personal workspace;
      // the course follows once the recording sits in the team folder (below).
      course: team ? unfiled : course,
      audioPath: input.audioPath,
      audioMime: input.audioMime,
      audioSize: input.audioSize,
      audioSha256: input.dedupeKey,
      modelRequested: input.model,
      sourceClient: input.sourceClient,
    });
    const recordingId = lectureRecordingId(input.lectureId);
    // Before the folder and tags: those belong to the team workspace.
    if (team) placeRecordingInWorkspace(db, recordingId, team, "workspace");
    db.query(
      `UPDATE recording SET folder_id = COALESCE(?, folder_id), domain = ?, template_id = ?, language = ?,
         recorded_at = COALESCE(?, recorded_at), recorded_at_source = ? WHERE id = ?`
    ).run(input.folderId ?? null, input.domain ?? "lecture", input.templateId ?? null, input.language ?? null, recordedAt, source, recordingId);
    if (team && course !== unfiled) mirrorRecordingToLecture(input.lectureId, { course });
    if (input.sha256) db.query(`UPDATE asset SET sha256 = ? WHERE id = ?`).run(input.sha256, lectureAudioAssetId(input.lectureId));
    const now = Date.now();
    for (const tagId of input.tagIds ?? []) {
      db.query(
        `INSERT OR IGNORE INTO recording_tag (workspace_id, recording_id, tag_id, source, confidence, created_at)
         SELECT r.workspace_id, r.id, t.id, 'user', NULL, ? FROM recording r JOIN tag t ON t.workspace_id = r.workspace_id
         WHERE r.id = ? AND t.id = ?`
      ).run(now, recordingId, tagId);
    }
    return team ? (db.query(`SELECT * FROM lectures WHERE id = ?`).get(input.lectureId) as LectureRecord) : lecture;
  });
}
