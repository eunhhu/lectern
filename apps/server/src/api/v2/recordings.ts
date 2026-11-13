import { existsSync } from "node:fs";
import { deleteRecordingIndex, deleteRecordingThreads } from "@lectern/ask";
import { deleteRecordingRows } from "@lectern/db";
import { costMicrousd, DEFAULT_PRICING, priceFor } from "@lectern/harness";
import type { ErrorCode } from "@lectern/domain";
import { DEFAULT_GEMINI_MODEL } from "../../../../../packages/core/src/index.ts";
import { db, deleteLectureById, getLectureById, getUserById, resetLectureForRetry } from "../../db.ts";
import { toLectureSummaryDto } from "../../dto.ts";
import { emitLectureEvent } from "../../events.ts";
import { enqueueRecordingProcessing } from "../../process-job.ts";
import { enqueueRegenerate } from "../../regenerate-job.ts";
import { isLectureBusy } from "../../queue.ts";
import { callerIn, can, loadRecording, requireWorkspace, VISIBLE_RECORDING_SQL } from "./access.ts";
import { apiError, defineRouter, notFound, ok, okPage, pageBounds, pageFrom, type Handler, type V2Request } from "./common.ts";
import {
  actionItemDto,
  eventCandidateDto,
  gapDto,
  parseJson,
  questionDto,
  recordingDto,
  segmentDto,
  speakerDto,
  documentDto,
  type ActionItemRow,
  type EventCandidateRow,
  type GapRow,
  type QuestionRow,
  type RecordingRow,
  type SegmentRow,
  type SpeakerRow,
} from "./rows.ts";
import {
  activeJobRow,
  announceDeleted,
  announceLectures,
  documentsOf,
  folderSubtree,
  getFolderRow,
  mirrorRecording,
  progressOf,
  recordingDetail,
  speakersOf,
  tagIdsByRecording,
  toJob,
  transact,
} from "./store.ts";

/** A handler for `/recordings/{recording_id}/...` that 404s on recordings the caller cannot see. */
function withRecording(handler: (req: V2Request, recording: RecordingRow) => Response | Promise<Response>, action: Parameters<typeof loadRecording>[2] = "recording:read"): Handler {
  return (req) => {
    const recording = loadRecording(req, req.params.recording_id, action);
    return recording instanceof Response ? recording : handler(req, recording);
  };
}

const ORDER: Record<string, string> = {
  recorded_at_desc: "r.recorded_at DESC, r.id DESC",
  recorded_at_asc: "r.recorded_at ASC, r.id ASC",
  title_asc: "r.title COLLATE NOCASE ASC, r.id ASC",
  updated_at_desc: "r.updated_at DESC, r.id DESC",
};

interface ListQuery {
  workspace_id: string;
  folder_id?: string;
  include_subfolders?: "true" | "false";
  unfiled?: "true" | "false";
  tag_id?: string;
  tag_ids?: string;
  domain?: string;
  status?: string;
  q?: string;
  recorded_after?: string;
  recorded_before?: string;
  sort?: string;
}

/** List-item summary fields (domain README #8), for one page of recordings. */
function summaries(rows: RecordingRow[]) {
  const ids = rows.map((r) => r.id);
  const tags = tagIdsByRecording(ids);
  const marks = ids.map(() => "?").join(",");
  const assetStats = new Map<string, { audio: number; pdf: number }>();
  if (ids.length) {
    for (const a of db
      .query(
        `SELECT recording_id, SUM(CASE WHEN kind LIKE 'audio%' THEN bytes ELSE 0 END) AS audio,
                SUM(CASE WHEN kind = 'pdf' THEN 1 ELSE 0 END) AS pdf
         FROM asset WHERE recording_id IN (${marks}) GROUP BY recording_id`
      )
      .all(...ids) as Array<{ recording_id: string; audio: number; pdf: number }>) {
      assetStats.set(a.recording_id, { audio: a.audio ?? 0, pdf: a.pdf ?? 0 });
    }
  }
  return rows.map((r) => {
    const lecture = r.lecture_id ? getLectureById(r.lecture_id) : null;
    const job = r.status === "processing" || r.status === "queued" ? activeJobRow(r) : null;
    const stats = assetStats.get(r.id);
    return {
      ...recordingDto(r),
      tag_ids: tags.get(r.id) ?? [],
      excerpt: lecture ? lecture.excerpt || null : null,
      audio_bytes: stats?.audio ?? 0,
      pdf_count: stats?.pdf ?? 0,
      unverified_count: unverifiedBlocks(r.id),
      progress: progressOf(r, job, lecture),
    };
  });
}

/** Blocks of the recording's current structured documents that cite no source. */
function unverifiedBlocks(recordingId: string): number {
  const bodies = db
    .query(
      `SELECT v.body_json FROM document d JOIN document_version v ON v.document_id = d.id AND v.version = d.current_version
       WHERE d.recording_id = ? AND v.body_json IS NOT NULL`
    )
    .all(recordingId) as Array<{ body_json: string }>;
  let count = 0;
  for (const { body_json } of bodies) {
    const body = parseJson<{ sections?: Array<{ blocks?: Array<{ type?: string; sources?: unknown[] }> }> }>(body_json, {});
    for (const section of body.sections ?? []) {
      for (const block of section.blocks ?? []) if (block.type !== "gap" && (block.sources ?? []).length === 0) count += 1;
    }
  }
  return count;
}

function folderInWorkspace(folderId: string, workspaceId: string): boolean {
  const folder = getFolderRow(folderId);
  return Boolean(folder && folder.workspace_id === workspaceId);
}

function missingTags(tagIds: string[], workspaceId: string): boolean {
  if (!tagIds.length) return false;
  const found = db
    .query(`SELECT COUNT(*) AS n FROM tag WHERE workspace_id = ? AND id IN (${tagIds.map(() => "?").join(",")})`)
    .get(workspaceId, ...tagIds) as { n: number };
  return found.n !== new Set(tagIds).size;
}

function addTags(recording: RecordingRow, tagIds: string[], now: number): void {
  for (const tagId of tagIds) {
    db.query(
      `INSERT OR IGNORE INTO recording_tag (workspace_id, recording_id, tag_id, source, confidence, created_at) VALUES (?, ?, ?, 'user', NULL, ?)`
    ).run(recording.workspace_id, recording.id, tagId, now);
  }
}

/** Deletes a recording: its lecture (files, archive, search index, threads) or just the v2 rows. */
function deleteRecording(recording: RecordingRow): void {
  if (recording.lecture_id && getLectureById(recording.lecture_id)) {
    const owner = getLectureById(recording.lecture_id)!.owner_id;
    deleteLectureById(recording.lecture_id); // projects the deletion onto the v2 rows
    announceDeleted(owner, [recording.lecture_id]);
    return;
  }
  deleteRecordingIndex(db, recording.workspace_id, recording.id);
  deleteRecordingThreads(db, recording.workspace_id, recording.id);
  deleteRecordingRows(db, recording.id);
}

type BatchBody =
  | { action: "move"; recording_ids: string[]; folder_id: string | null }
  | { action: "add_tags" | "remove_tags"; recording_ids: string[]; tag_ids: string[] }
  | { action: "delete"; recording_ids: string[] };

/** Rough AI cost of re-running the v1 pipeline (one Gemini Flash call, AI_HARNESS §6.3: ~$0.12 per hour). */
const LEGACY_MICROUSD_PER_HOUR = 120_000;

export const recordingsRouter = defineRouter({
  listRecordings: (req) => {
    const q = req.query as unknown as ListQuery;
    const caller = requireWorkspace(req, q.workspace_id);
    if (caller instanceof Response) return caller;
    const bounds = pageBounds(req);
    if (bounds instanceof Response) return bounds;

    const where = [`r.workspace_id = ?`, VISIBLE_RECORDING_SQL];
    const params: Array<string | number> = [q.workspace_id, req.user!.id];
    if (q.unfiled === "true") where.push(`r.folder_id IS NULL`);
    if (q.folder_id !== undefined) {
      const ids = q.include_subfolders === "true" ? folderSubtree(q.workspace_id, q.folder_id) : [q.folder_id];
      where.push(`r.folder_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
    const tagIds = [...(q.tag_id ? [q.tag_id] : []), ...(q.tag_ids ? q.tag_ids.split(",") : [])];
    for (const tagId of new Set(tagIds)) {
      where.push(`EXISTS (SELECT 1 FROM recording_tag t WHERE t.recording_id = r.id AND t.tag_id = ?)`);
      params.push(tagId);
    }
    if (q.domain) (where.push(`r.domain = ?`), params.push(q.domain));
    if (q.status) (where.push(`r.status = ?`), params.push(q.status));
    if (q.q) (where.push(`instr(lower(r.title), lower(?)) > 0`), params.push(q.q));
    if (q.recorded_after) (where.push(`r.recorded_at >= ?`), params.push(Date.parse(q.recorded_after)));
    if (q.recorded_before) (where.push(`r.recorded_at < ?`), params.push(Date.parse(q.recorded_before)));

    const rows = db
      .query(`SELECT r.* FROM recording r WHERE ${where.join(" AND ")} ORDER BY ${ORDER[q.sort ?? "recorded_at_desc"]} LIMIT ? OFFSET ?`)
      .all(...params, bounds.limit + 1, bounds.offset) as RecordingRow[];
    const result = pageFrom(rows, bounds);
    return ok(req, { items: summaries(result.items), next_cursor: result.next_cursor });
  },

  batchRecordings: (req) => {
    const body = req.body as BatchBody;
    const ids = body.recording_ids;
    // Target folder and tags must exist in the workspace of the recordings: checked per
    // recording below; a target that exists nowhere fails the whole request.
    if (body.action === "move" && body.folder_id && !getFolderRow(body.folder_id)) return notFound(req, "폴더");
    if ((body.action === "add_tags" || body.action === "remove_tags") && missingTagsAnywhere(body.tag_ids)) return notFound(req, "태그");

    const results: Array<{ recording_id: string; ok: boolean; error: { code: ErrorCode; message: string } | null }> = [];
    const touched: string[] = [];
    for (const id of ids) {
      const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(id) as RecordingRow | null;
      const caller = recording ? callerIn(req, recording.workspace_id) : null;
      const action = body.action === "delete" ? "recording:delete" : "recording:update";
      if (!recording || !caller || !can(caller, "recording:read", recording)) {
        results.push({ recording_id: id, ok: false, error: { code: "not_found", message: "녹음을 찾을 수 없습니다." } });
        continue;
      }
      if (!can(caller, action, recording)) {
        results.push({ recording_id: id, ok: false, error: { code: "forbidden", message: "이 녹음을 바꿀 권한이 없습니다." } });
        continue;
      }
      if (body.action === "move" && body.folder_id && !folderInWorkspace(body.folder_id, recording.workspace_id)) {
        results.push({ recording_id: id, ok: false, error: { code: "not_found", message: "폴더를 찾을 수 없습니다." } });
        continue;
      }
      if ((body.action === "add_tags" || body.action === "remove_tags") && missingTags(body.tag_ids, recording.workspace_id)) {
        results.push({ recording_id: id, ok: false, error: { code: "not_found", message: "태그를 찾을 수 없습니다." } });
        continue;
      }
      const now = Date.now();
      if (body.action === "delete") {
        deleteRecording(recording);
      } else {
        transact(() => {
          if (body.action === "move") {
            db.query(`UPDATE recording SET folder_id = ?, updated_at = ? WHERE id = ?`).run(body.folder_id, now, recording.id);
            mirrorRecording(recording, { folderId: body.folder_id });
          } else if (body.action === "add_tags") {
            addTags(recording, body.tag_ids, now);
          } else {
            db.query(
              `DELETE FROM recording_tag WHERE recording_id = ? AND tag_id IN (${body.tag_ids.map(() => "?").join(",")})`
            ).run(recording.id, ...body.tag_ids);
          }
        });
        if (recording.lecture_id && body.action === "move") touched.push(recording.lecture_id);
      }
      results.push({ recording_id: id, ok: true, error: null });
    }
    announceLectures(touched);
    return ok(req, { results });
  },

  getRecording: withRecording(async (req, recording) => ok(req, await recordingDetail(recording))),

  updateRecording: withRecording((req, recording) => {
    const body = req.body as {
      title?: string;
      folder_id?: string | null;
      domain?: string;
      template_id?: string | null;
      language?: string | null;
      recorded_at?: string;
      visibility?: "private" | "workspace";
      tag_ids?: string[];
    };
    if (body.folder_id && !folderInWorkspace(body.folder_id, recording.workspace_id)) return notFound(req, "폴더");
    if (body.tag_ids && missingTags(body.tag_ids, recording.workspace_id)) return notFound(req, "태그");
    const title = body.title?.trim();
    if (body.title !== undefined && !title) return apiError(req.c, 400, "bad_request", "제목을 입력하세요.");
    const now = Date.now();
    transact(() => {
      const next = {
        title: title ?? recording.title,
        folder_id: body.folder_id === undefined ? recording.folder_id : body.folder_id,
        domain: body.domain ?? recording.domain,
        template_id: body.template_id === undefined ? recording.template_id : body.template_id,
        language: body.language === undefined ? recording.language : body.language,
        recorded_at: body.recorded_at === undefined ? recording.recorded_at : Date.parse(body.recorded_at),
        recorded_at_source: body.recorded_at === undefined ? recording.recorded_at_source : "client",
        visibility: body.visibility ?? recording.visibility,
      };
      db.query(
        `UPDATE recording SET title = ?, folder_id = ?, domain = ?, template_id = ?, language = ?, recorded_at = ?,
           recorded_at_source = ?, visibility = ?, updated_at = ? WHERE id = ?`
      ).run(
        next.title,
        next.folder_id,
        next.domain,
        next.template_id,
        next.language,
        next.recorded_at,
        next.recorded_at_source,
        next.visibility,
        now,
        recording.id
      );
      if (body.tag_ids) {
        // Replaces every tag, AI ones included; listed tags keep their source (domain README #9).
        const keep = new Set(body.tag_ids);
        const existing = db.query(`SELECT tag_id FROM recording_tag WHERE recording_id = ?`).all(recording.id) as Array<{ tag_id: string }>;
        for (const { tag_id } of existing) if (!keep.has(tag_id)) db.query(`DELETE FROM recording_tag WHERE recording_id = ? AND tag_id = ?`).run(recording.id, tag_id);
        addTags(recording, body.tag_ids, now);
      }
      mirrorRecording(recording, {
        title: next.title !== recording.title ? next.title : undefined,
        folderId: next.folder_id !== recording.folder_id ? next.folder_id : undefined,
      });
    });
    if (recording.lecture_id) announceLectures([recording.lecture_id]);
    return ok(req, recordingDto(db.query(`SELECT * FROM recording WHERE id = ?`).get(recording.id) as RecordingRow));
  }, "recording:update"),

  deleteRecording: withRecording((req, recording) => {
    deleteRecording(recording);
    return req.c.body(null, 204);
  }, "recording:delete"),

  getTranscript: withRecording((req, recording) => {
    const segments = db.query(`SELECT * FROM transcript_segment WHERE recording_id = ? ORDER BY idx`).all(recording.id) as SegmentRow[];
    const gaps = db.query(`SELECT kind, start_ms, end_ms FROM transcript_gap WHERE recording_id = ? ORDER BY start_ms`).all(recording.id) as GapRow[];
    return ok(req, {
      recording_id: recording.id,
      segments: segments.map(segmentDto),
      speakers: speakersOf(recording.id).map(speakerDto),
      gaps: gaps.map(gapDto),
    });
  }),

  updateSpeaker: withRecording((req, recording) => {
    const speaker = db.query(`SELECT * FROM speaker WHERE id = ? AND recording_id = ?`).get(String(req.params.speaker_id), recording.id) as SpeakerRow | null;
    if (!speaker) return notFound(req, "화자");
    const { display_name } = req.body as { display_name: string | null };
    db.query(`UPDATE speaker SET display_name = ?, updated_at = ? WHERE id = ?`).run(display_name?.trim() || null, Date.now(), speaker.id);
    return ok(req, speakerDto(db.query(`SELECT * FROM speaker WHERE id = ?`).get(speaker.id) as SpeakerRow));
  }, "recording:update"),

  listRecordingDocuments: withRecording((req, recording) => okPage(req, documentsOf(recording.id).map(documentDto))),

  listRecordingQuestions: withRecording((req, recording) => {
    const { kind } = req.query as { kind?: string };
    const rows = db
      .query(`SELECT * FROM question WHERE recording_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY created_at, id`)
      .all(...(kind ? [recording.id, kind] : [recording.id])) as QuestionRow[];
    return okPage(req, rows.map(questionDto));
  }),

  listRecordingEvents: withRecording((req, recording) => {
    const rows = db.query(`SELECT * FROM event_candidate WHERE recording_id = ? ORDER BY start_at, id`).all(recording.id) as EventCandidateRow[];
    return okPage(req, rows.map(eventCandidateDto));
  }),

  listRecordingActionItems: withRecording((req, recording) => {
    const rows = db.query(`SELECT * FROM action_item WHERE recording_id = ? ORDER BY created_at, id`).all(recording.id) as ActionItemRow[];
    return okPage(req, rows.map(actionItemDto));
  }),

  // `full`: the whole pipeline again on the stored audio (`process` under LECTERN_PIPELINE=v2,
  // else the v1 distillation). `document`: only the notes stages again on the published
  // transcript (`regenerate`, a new document version); migrated lectures have no transcript
  // (ARCHITECTURE §5.3 option 1), so for them only `full` works. Both after the user saw the
  // estimate (`dry_run`).
  reprocessRecording: withRecording((req, recording) => {
    const body = req.body as { mode: "document" | "full"; dry_run?: boolean };
    if (body.mode === "document") return regenerateDocument(req, recording, body.dry_run === true);
    const audioMs = recording.duration_ms ?? 0;
    const estimate = {
      estimated_microusd: Math.ceil((audioMs / 3_600_000) * LEGACY_MICROUSD_PER_HOUR),
      audio_ms: audioMs,
      within_quota: true, // no AI cost quota yet (ROADMAP D10); ask has its own monthly limit
    };
    if (body.dry_run) return ok(req, { estimate, job: null });
    const lecture = recording.lecture_id ? getLectureById(recording.lecture_id) : null;
    if (!lecture) return apiError(req.c, 409, "conflict", "아직 다시 처리할 수 없는 녹음입니다.");
    if (isLectureBusy(lecture.id)) return apiError(req.c, 409, "conflict", "이미 처리 중인 녹음입니다.");
    if (!lecture.audio_path || !existsSync(lecture.audio_path)) {
      return apiError(req.c, 409, "conflict", "서버에 원본 오디오가 없어 다시 처리할 수 없습니다.");
    }
    const owner = getUserById(lecture.owner_id);
    if (!canUseServerKey(req.user!) || !canUseServerKey(owner)) {
      return apiError(req.c, 403, "forbidden", "서버 AI 키 사용 권한이 없는 계정입니다.");
    }
    const reset = resetLectureForRetry(lecture.id);
    if (reset) {
      emitLectureEvent(lecture.owner_id, {
        type: "progress",
        id: lecture.id,
        stage: reset.stage,
        stage_message: reset.stage_message,
        progress: reset.progress,
        lecture: toLectureSummaryDto(reset),
      });
    }
    const { jobId } = enqueueRecordingProcessing(lecture.id, lecture.owner_id, {
      audioPath: lecture.audio_path,
      course: lecture.course,
      title: lecture.title,
      model: lecture.model_requested || DEFAULT_GEMINI_MODEL,
    });
    const job = db.query(`SELECT * FROM job WHERE id = ?`).get(jobId) as Parameters<typeof toJob>[0] | null;
    return ok(req, { estimate, job: job ? toJob(job) : null }, { status: 202 });
  }, "recording:update"),
});

/**
 * Estimated notes cost of a `document` reprocess: the transcript as input (about two
 * characters per token for Korean) plus prompts, one document's worth of output, at the
 * structure model's price. The classify call is small and left out.
 */
function regenerateEstimate(recordingId: string) {
  const chars = (db.query(`SELECT COALESCE(SUM(LENGTH(text)), 0) AS n FROM transcript_segment WHERE recording_id = ?`).get(recordingId) as { n: number })
    .n;
  const price = priceFor(DEFAULT_PRICING, "gemini", "gemini-3.8-flash", Date.now());
  const usage = { inputTokens: Math.ceil(chars / 2) + 4_000, cachedTokens: 0, outputTokens: 6_000 };
  return { estimated_microusd: price ? costMicrousd(usage, price) : 0, audio_ms: 0, within_quota: true };
}

function regenerateDocument(req: V2Request, recording: RecordingRow, dryRun: boolean): Response {
  const hasTranscript = Boolean(db.query(`SELECT 1 FROM transcript_segment WHERE recording_id = ? LIMIT 1`).get(recording.id));
  if (!hasTranscript) {
    return apiError(req.c, 409, "conflict", "전사가 없는 녹음이라 문서만 다시 만들 수 없습니다. 전체 재처리를 선택하세요.");
  }
  const estimate = regenerateEstimate(recording.id);
  if (dryRun) return ok(req, { estimate, job: null });
  const lecture = recording.lecture_id ? getLectureById(recording.lecture_id) : null;
  if (!lecture) return apiError(req.c, 409, "conflict", "아직 다시 처리할 수 없는 녹음입니다.");
  if (isLectureBusy(lecture.id)) return apiError(req.c, 409, "conflict", "이미 처리 중인 녹음입니다.");
  if (!canUseServerKey(req.user!) || !canUseServerKey(getUserById(lecture.owner_id))) {
    return apiError(req.c, 403, "forbidden", "서버 AI 키 사용 권한이 없는 계정입니다.");
  }
  // The recording keeps its current notes while this runs (no reset): the new version replaces them.
  const { jobId } = enqueueRegenerate(lecture.id, lecture.owner_id, estimate.estimated_microusd * 3 + 200_000);
  const job = db.query(`SELECT * FROM job WHERE id = ?`).get(jobId) as Parameters<typeof toJob>[0];
  return ok(req, { estimate, job: toJob(job) }, { status: 202 });
}

/** Same rule as the v1 retry route: the server's Gemini key, for the caller and the owner. */
function canUseServerKey(user: { can_use_server_key: number; status?: string } | null): boolean {
  return Boolean(user && user.can_use_server_key !== 0 && (user.status || "active") === "active");
}

function missingTagsAnywhere(tagIds: string[]): boolean {
  const found = db.query(`SELECT COUNT(*) AS n FROM tag WHERE id IN (${tagIds.map(() => "?").join(",")})`).get(...tagIds) as { n: number };
  return found.n !== new Set(tagIds).size;
}
