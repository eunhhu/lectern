import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { extname, join } from "node:path";
import { config } from "@lectern/config";
import { lectureRecordingId, personalWorkspaceId, sha256Hex, uuidv7 } from "@lectern/db";
import { HEADER, partCount, type CreateUploadRequest, type UploadFile } from "@lectern/domain";
import { DEFAULT_GEMINI_MODEL } from "../../../../../packages/core/src/index.ts";
import {
  DATA_DIR,
  db,
  generateId,
  getLectureByAudioSha256,
  getLectureById,
  getUserStorageUsageBytes,
  resetLectureForRetry,
  type UserRecord,
} from "../../db.ts";
import { toLectureSummaryDto } from "../../dto.ts";
import { emitLectureEvent } from "../../events.ts";
import { ensurePrivateDir, makePrivate } from "../../fsperm.ts";
import { enqueueRecordingProcessing } from "../../process-job.ts";
import { logger } from "../../log.ts";
import { AUDIO_EXT_BY_MIME, AUDIO_MIME_BY_EXT } from "../../media-files.ts";
import { isLectureBusy } from "../../queue.ts";
import { quotaProblem } from "../../usage.ts";
import { callerIn, loadRecording, requireWorkspace } from "./access.ts";
import { createRecordingForAudio } from "./ingest.ts";
import { apiError, defineRouter, notFound, ok, type V2Request } from "./common.ts";
import { recordingDto, uploadSessionDto, type QueueJobRow, type RecordingRow, type UploadRow } from "./rows.ts";
import { getFolderRow, getRecordingRow, sha256OfFile, toJob, transact } from "./store.ts";

// Resumable chunked uploads (ARCHITECTURE §6 "업로드"): POST /uploads plans the parts,
// PUT /uploads/{id}/parts/{n} streams each part to disk (never buffered whole in memory,
// so the v1 250 MB request limit does not apply), POST /uploads/{id}/complete joins them
// and creates the recording. Parts are numbered from 1 across the files in order.
//
// A new recording is processed by the v1 pipeline, so it is also a lecture (packages/db
// legacy.ts keeps the two in step): exactly one audio file, the same type whitelist and
// permission checks as v1 ingest, and the same per-account dedupe by audio digest.

/** Bytes per part (the client sends parts of exactly this size, the last one shorter). */
export const PART_SIZE = 8 * 1024 * 1024;

/** With LECTERN_PDF=1 a lecture PDF is checked strictly (D-P3-2): size, type and its first bytes. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const PDF_MAGIC = "%PDF-";
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
/** Audio files one new recording may have (part 1, part 2, …), joined by the process job. */
const MAX_AUDIO_PARTS = 8;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const UPLOAD_ROOT = join(DATA_DIR, "uploads", "v2");
const FINAL_DIR = join(DATA_DIR, "uploads");

const DOC_TYPES: Record<string, { ext: string; mime: string }> = {
  pdf: { ext: ".pdf", mime: "application/pdf" },
};
const IMAGE_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

const partDir = (uploadId: string) => join(UPLOAD_ROOT, uploadId);
const partPath = (uploadId: string, part: number) => join(partDir(uploadId), `${part}.part`);

function getUpload(id: string): UploadRow | null {
  return db.query(`SELECT * FROM upload WHERE id = ?`).get(id) as UploadRow | null;
}

function receivedParts(uploadId: string): number[] {
  return (db.query(`SELECT part FROM upload_part WHERE upload_id = ? ORDER BY part`).all(uploadId) as Array<{ part: number }>).map((r) => r.part);
}

/** Deletes an upload's part files (account deletion removes the uploads of one user, P5-09). */
export function removeParts(uploadId: string): void {
  try {
    rmSync(partDir(uploadId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Marks open sessions past their expiry and drops their parts (run on every create). */
function sweepExpired(now = Date.now()): void {
  const expired = db.query(`SELECT id FROM upload WHERE status = 'open' AND expires_at < ?`).all(now) as Array<{ id: string }>;
  for (const { id } of expired) {
    db.query(`UPDATE upload SET status = 'expired' WHERE id = ?`).run(id);
    db.query(`DELETE FROM upload_part WHERE upload_id = ?`).run(id);
    removeParts(id);
  }
}

/** The caller's own session (anyone else's is "not found"), its expiry applied. */
function ownUpload(req: V2Request): UploadRow | Response {
  const upload = getUpload(String(req.params.upload_id));
  if (!upload || upload.user_id !== req.user!.id || !callerIn(req, upload.workspace_id).role) return notFound(req, "업로드");
  if (upload.status === "open" && upload.expires_at < Date.now()) {
    sweepExpired();
    return getUpload(upload.id)!;
  }
  return upload;
}

const session = (upload: UploadRow) => uploadSessionDto(upload, receivedParts(upload.id));

/** The storage extension of an upload file, or the reason it is refused. */
function storedExtension(file: { kind: string; filename: string; mime: string }): string | { error: string } {
  const ext = extname(file.filename).toLowerCase();
  const mime = file.mime.split(";")[0]!.trim().toLowerCase();
  if (file.kind === "audio") {
    if (ext && AUDIO_MIME_BY_EXT[ext]) return ext;
    if (ext) return { error: `지원하지 않는 오디오 확장자입니다: ${ext}` };
    return AUDIO_EXT_BY_MIME[mime] ?? { error: `오디오 파일만 업로드할 수 있습니다. (지원하지 않는 형식: ${mime})` };
  }
  if (file.kind === "pdf") return ext === ".pdf" || mime === "application/pdf" ? ".pdf" : { error: "PDF 파일만 올릴 수 있습니다." };
  if (file.kind === "image") return IMAGE_TYPES[mime] ?? { error: "PNG, JPEG, WebP 이미지만 올릴 수 있습니다." };
  return { error: "지원하지 않는 파일 종류입니다." };
}

/** v1 ingest rules (index.ts ingestPermissionError): viewers and restricted accounts cannot upload. */
function uploadDenied(req: V2Request, user: UserRecord): Response | null {
  if (user.can_ingest === 0 || user.role === "viewer") {
    return apiError(req.c, 403, "forbidden", "오디오 업로드 및 노트 생성 권한이 없는 계정(뷰어)입니다.");
  }
  if (user.can_use_server_key === 0) {
    return apiError(req.c, 403, "forbidden", "노트 자동 분석 권한이 제한된 계정입니다. 관리자에게 문의하세요.");
  }
  return null;
}

function requestKey(body: CreateUploadRequest): string {
  return JSON.stringify([body.workspace_id, body.recording_id ?? null, body.recorded_at ?? null, body.recording ?? null, body.files]);
}

/** Joins a file's parts into `target`; returns its digest. */
async function assemble(uploadId: string, file: UploadFile, target: string): Promise<string> {
  const partial = `${target}.part`;
  const fd = openSync(partial, "w", 0o600);
  try {
    for (let part = file.first_part; part < file.first_part + file.part_count; part += 1) {
      const bytes = new Uint8Array(await Bun.file(partPath(uploadId, part)).arrayBuffer());
      writeSync(fd, bytes);
    }
  } finally {
    closeSync(fd);
  }
  renameSync(partial, target);
  makePrivate(target);
  return sha256OfFile(target);
}

interface UploadResult {
  recording_id: string;
  job_id: string | null;
  deduplicated: boolean;
}

function completeResponse(req: V2Request, upload: UploadRow, result: UploadResult): Response {
  const recording = getRecordingRow(result.recording_id);
  if (!recording) return notFound(req, "녹음");
  const job = result.job_id ? (db.query(`SELECT * FROM job WHERE id = ?`).get(result.job_id) as QueueJobRow | null) : null;
  return ok(req, { upload: session(upload), recording: recordingDto(recording), job: job ? toJob(job) : null, deduplicated: result.deduplicated });
}

export const uploadsRouter = defineRouter({
  createUpload: (req) => {
    const body = req.body as CreateUploadRequest;
    const user = req.user!;
    const caller = requireWorkspace(req, body.workspace_id, "recording:create");
    if (caller instanceof Response) return caller;
    const denied = uploadDenied(req, user);
    if (denied) return denied;
    const idempotencyKey = req.headers[HEADER.idempotencyKey] as string | undefined;
    if (idempotencyKey) {
      const existing = db.query(`SELECT * FROM upload WHERE user_id = ? AND idempotency_key = ?`).get(user.id, idempotencyKey) as UploadRow | null;
      if (existing) {
        if (JSON.parse(existing.recording_json ?? "null")?.request !== requestKey(body)) {
          return apiError(req.c, 409, "idempotency_conflict", "같은 Idempotency-Key로 다른 업로드를 만들 수 없습니다.");
        }
        return ok(req, session(existing), { status: 201 });
      }
    }

    // Team workspaces take uploads with LECTERN_TEAMS=1 (D-P2-8, P5-06): the recording is put
    // in the team (packages/db placeRecordingInWorkspace). Otherwise only the personal one.
    if (body.workspace_id !== personalWorkspaceId(user.id) && !config().teams) {
      return apiError(req.c, 400, "bad_request", "지금은 개인 워크스페이스에만 업로드할 수 있습니다.");
    }
    const audio = body.files.filter((f) => f.kind === "audio");
    if (body.recording_id) {
      const recording = loadRecording(req, body.recording_id, "recording:update");
      if (recording instanceof Response) return recording;
      if (recording.workspace_id !== body.workspace_id) return notFound(req, "녹음");
      if (audio.length) return apiError(req.c, 400, "bad_request", "이미 있는 녹음에 오디오를 더 붙이는 것은 아직 지원하지 않습니다.");
    } else if (audio.length === 0 || (audio.length > 1 && config().pipeline !== "v2")) {
      // Several parts of one recording (D-P1-9) need the v2 pipeline, which joins them.
      return apiError(req.c, 400, "bad_request", "새 녹음에는 오디오 파일이 하나 있어야 합니다.");
    } else if (audio.length > MAX_AUDIO_PARTS) {
      return apiError(req.c, 400, "bad_request", `오디오는 최대 ${MAX_AUDIO_PARTS}개까지 올릴 수 있습니다.`);
    }
    for (const file of body.files) {
      // LECTERN_PDF=1 only: with the flag off a PDF goes through the checks below as before (D-0-3).
      if (config().pdf && file.kind === "pdf") {
        const mime = file.mime.split(";")[0]!.trim().toLowerCase();
        if (mime !== "application/pdf") return apiError(req.c, 415, "unsupported_media_type", "PDF 파일(application/pdf)만 올릴 수 있습니다.");
        if (file.bytes > MAX_PDF_BYTES) return apiError(req.c, 413, "payload_too_large", "PDF는 50MB까지 올릴 수 있습니다.");
      }
      const ext = storedExtension(file);
      if (typeof ext !== "string") return apiError(req.c, 415, "unsupported_media_type", ext.error);
      if (file.bytes > MAX_FILE_BYTES) return apiError(req.c, 413, "payload_too_large", "파일 하나는 4GB까지 올릴 수 있습니다.");
    }
    const hints = body.recording;
    if (hints?.folder_id && getFolderRow(hints.folder_id)?.workspace_id !== body.workspace_id) return notFound(req, "폴더");
    const total = body.files.reduce((sum, f) => sum + f.bytes, 0);
    if (user.quota_mb > 0 && getUserStorageUsageBytes(user.id) + total > user.quota_mb * 1024 * 1024) {
      return apiError(req.c, 403, "quota_exceeded", `계정 오디오 저장 용량 한도(${user.quota_mb}MB)를 초과했습니다.`);
    }
    // The workspace's limits (D-P5-7). No quota row: no limit, nothing is counted.
    const quota = quotaProblem(body.workspace_id, { bytes: total });
    if (quota) return apiError(req.c, 409, quota.code, quota.message, quota.details);

    const now = Date.now();
    sweepExpired(now);
    let next = 1;
    const files: UploadFile[] = body.files.map((f, index) => {
      const count = partCount(f.bytes, PART_SIZE);
      const planned = { ...f, index, first_part: next, part_count: count };
      next += count;
      return planned;
    });
    const id = uuidv7(now);
    db.query(
      `INSERT INTO upload (id, workspace_id, user_id, recording_id, status, recorded_at, part_size, files_json, recording_json,
         source_client, idempotency_key, result_json, created_at, expires_at, completed_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    ).run(
      id,
      body.workspace_id,
      user.id,
      body.recording_id ?? null,
      body.recorded_at ? Date.parse(body.recorded_at) : null,
      PART_SIZE,
      JSON.stringify(files),
      JSON.stringify({ hints: hints ?? null, request: requestKey(body) }),
      (req.c.req.header("x-client") || "web-v2").trim().slice(0, 64),
      idempotencyKey ?? null,
      now,
      now + SESSION_TTL_MS
    );
    ensurePrivateDir(UPLOAD_ROOT);
    return ok(req, session(getUpload(id)!), { status: 201 });
  },

  getUpload: (req) => {
    const upload = ownUpload(req);
    return upload instanceof Response ? upload : ok(req, session(upload));
  },

  // Idempotent per part: sending a part again replaces it.
  putUploadPart: async (req) => {
    const upload = ownUpload(req);
    if (upload instanceof Response) return upload;
    if (upload.status !== "open") return apiError(req.c, 409, "conflict", "이미 끝났거나 취소된 업로드입니다.");
    const part = Number(req.params.part);
    const files = JSON.parse(upload.files_json) as UploadFile[];
    const file = files.find((f) => part >= f.first_part && part < f.first_part + f.part_count);
    if (!file) return apiError(req.c, 400, "bad_request", "업로드 계획에 없는 파트 번호입니다.");
    const offset = (part - file.first_part) * upload.part_size;
    const expected = Math.min(upload.part_size, file.bytes - offset);

    ensurePrivateDir(UPLOAD_ROOT);
    ensurePrivateDir(partDir(upload.id));
    const target = partPath(upload.id, part);
    const partial = `${target}.${process.pid}.${Date.now()}.tmp`;
    const hasher = new Bun.CryptoHasher("sha256");
    let received = 0;
    const fd = openSync(partial, "w", 0o600);
    try {
      const stream = req.c.req.raw.body;
      if (stream) {
        for await (const chunk of stream) {
          received += chunk.byteLength;
          if (received > expected) break;
          hasher.update(chunk);
          writeSync(fd, chunk);
        }
      }
    } finally {
      closeSync(fd);
    }
    if (received !== expected) {
      unlinkSync(partial);
      return received > expected
        ? apiError(req.c, 413, "payload_too_large", `파트 ${part}는 ${expected}바이트여야 합니다.`, { expected_bytes: expected })
        : apiError(req.c, 400, "bad_request", `파트 ${part}는 ${expected}바이트여야 합니다.`, { expected_bytes: expected, received_bytes: received });
    }
    renameSync(partial, target);
    const sha256 = hasher.digest("hex");
    db.query(`INSERT OR REPLACE INTO upload_part (upload_id, part, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      upload.id,
      part,
      received,
      sha256,
      Date.now()
    );
    return ok(req, { part, bytes: received, sha256 });
  },

  completeUpload: async (req) => {
    const upload = ownUpload(req);
    if (upload instanceof Response) return upload;
    if (upload.status === "completed" && upload.result_json) return completeResponse(req, upload, JSON.parse(upload.result_json));
    if (upload.status !== "open") return apiError(req.c, 409, "conflict", "이미 끝났거나 취소된 업로드입니다.");
    const files = JSON.parse(upload.files_json) as UploadFile[];
    const have = new Set(receivedParts(upload.id));
    const missing: number[] = [];
    for (const f of files) for (let p = f.first_part; p < f.first_part + f.part_count; p += 1) if (!have.has(p)) missing.push(p);
    if (missing.length) {
      return apiError(req.c, 409, "upload_incomplete", "아직 받지 못한 파트가 있습니다.", { missing_parts: missing.slice(0, 100) });
    }

    const user = req.user!;
    const stored: Array<{ file: UploadFile; path: string; sha256: string }> = [];
    try {
      for (const file of files) {
        const ext = storedExtension(file) as string;
        const path = join(FINAL_DIR, `${file.kind === "audio" ? generateId("aud") : uuidv7()}${ext}`);
        const sha256 = await assemble(upload.id, file, path);
        stored.push({ file, path, sha256 });
        if (config().pdf && file.kind === "pdf") {
          const head = new TextDecoder().decode(new Uint8Array(await Bun.file(path).slice(0, PDF_MAGIC.length).arrayBuffer()));
          if (head !== PDF_MAGIC) {
            // The session stays open, so the right file can be sent again.
            for (const s of stored) rmSync(s.path, { force: true });
            return apiError(req.c, 400, "bad_request", `${file.filename}은(는) PDF 파일이 아닙니다.`, { file_index: file.index });
          }
        }
        if (file.sha256 && file.sha256 !== sha256) {
          for (const s of stored) rmSync(s.path, { force: true });
          return apiError(req.c, 400, "bad_request", `${file.filename}의 SHA-256이 보낸 값과 다릅니다. 다시 올려 주세요.`, {
            file_index: file.index,
          });
        }
      }
    } catch (err) {
      for (const s of stored) rmSync(s.path, { force: true });
      logger.error("could not assemble an upload", { upload_id: upload.id, err });
      return apiError(req.c, 500, "internal", "업로드한 파일을 합치지 못했습니다.");
    }

    const meta = JSON.parse(upload.recording_json ?? "{}") as { hints?: CreateUploadRequest["recording"] | null };
    const hints = meta.hints ?? {};
    // Parts in upload order (D-P1-9); the first is the lecture's audio, the rest are assets.
    const audios = stored.filter((s) => s.file.kind === "audio");
    const audio = audios[0];
    const team = upload.workspace_id !== personalWorkspaceId(user.id) ? upload.workspace_id : null;
    const fileKey = audios.length > 1 ? sha256Hex(audios.map((a) => a.sha256).join("\n")) : audio?.sha256;
    // The same audio in a team and in the personal workspace are two recordings: a team
    // upload dedupes within that team only.
    const dedupeKey = team && fileKey ? sha256Hex(`${team}\n${fileKey}`) : fileKey;
    const now = Date.now();
    let result: UploadResult;
    const announce: Array<() => void> = [];

    if (upload.recording_id) {
      const recording = getRecordingRow(upload.recording_id);
      if (!recording) return notFound(req, "녹음");
      transact(() => insertDocumentAssets(recording, stored, now));
      result = { recording_id: recording.id, job_id: null, deduplicated: false };
    } else {
      // Same dedupe as v1 ingest: this account already uploaded this audio.
      const existing = getLectureByAudioSha256(user.id, dedupeKey!);
      if (existing) {
        for (const a of audios) rmSync(a.path, { force: true });
        let jobId: string | null = null;
        if (existing.status === "error" && existing.audio_path && existsSync(existing.audio_path) && !isLectureBusy(existing.id)) {
          resetLectureForRetry(existing.id);
          jobId = enqueueRecordingProcessing(existing.id, user.id, {
            audioPath: existing.audio_path,
            course: existing.course,
            title: existing.title,
            model: existing.model_requested || DEFAULT_GEMINI_MODEL,
          }).jobId;
        }
        const recordingId = lectureRecordingId(existing.id);
        transact(() => insertDocumentAssets(getRecordingRow(recordingId)!, stored.filter((s) => s !== audio), now));
        result = { recording_id: recordingId, job_id: jobId, deduplicated: true };
      } else {
        const lectureId = generateId("lec");
        await createRecordingForAudio({
          lectureId,
          ownerId: user.id,
          audioPath: audio!.path,
          audioMime: AUDIO_MIME_BY_EXT[extname(audio!.path)] ?? "application/octet-stream",
          audioSize: audio!.file.bytes,
          dedupeKey: dedupeKey!,
          sha256: audio!.sha256,
          title: hints.title ?? "",
          folderId: hints.folder_id ?? null,
          model: DEFAULT_GEMINI_MODEL,
          sourceClient: upload.source_client ?? "web-v2",
          recordedAt: upload.recorded_at,
          domain: hints.domain,
          templateId: hints.template_id ?? null,
          language: hints.language ?? null,
          tagIds: hints.tag_ids,
          teamWorkspaceId: team,
        });
        const recordingRow = getRecordingRow(lectureRecordingId(lectureId))!;
        if (audios.length > 1) transact(() => insertAudioPartAssets(recordingRow, audios.slice(1), now));
        const extra = stored.filter((s) => s.file.kind !== "audio");
        if (extra.length) transact(() => insertDocumentAssets(recordingRow, extra, now));
        const course = getLectureById(lectureId)!.course;
        const lecture = getLectureById(lectureId)!;
        announce.push(() => emitLectureEvent(user.id, { type: "created", id: lectureId, lecture: toLectureSummaryDto(lecture) }));
        const { jobId } = enqueueRecordingProcessing(lectureId, user.id, {
          audioPath: audio!.path,
          course,
          title: hints.title ?? "",
          model: DEFAULT_GEMINI_MODEL,
        });
        result = { recording_id: lectureRecordingId(lectureId), job_id: jobId, deduplicated: false };
      }
    }

    db.query(`UPDATE upload SET status = 'completed', recording_id = ?, result_json = ?, completed_at = ? WHERE id = ?`).run(
      result.recording_id,
      JSON.stringify(result),
      now,
      upload.id
    );
    db.query(`DELETE FROM upload_part WHERE upload_id = ?`).run(upload.id);
    removeParts(upload.id);
    for (const fn of announce) fn();
    return completeResponse(req, getUpload(upload.id)!, result);
  },

  abortUpload: (req) => {
    const upload = ownUpload(req);
    if (upload instanceof Response) return upload;
    if (upload.status === "completed") return apiError(req.c, 409, "conflict", "이미 끝난 업로드는 취소할 수 없습니다.");
    db.query(`UPDATE upload SET status = 'aborted' WHERE id = ? AND status = 'open'`).run(upload.id);
    db.query(`DELETE FROM upload_part WHERE upload_id = ?`).run(upload.id);
    removeParts(upload.id);
    return req.c.body(null, 204);
  },
});

/**
 * Audio parts after the first (D-P1-9): `part_index` 1.. in upload order. Their durations
 * are filled by the process job when it joins them (concatAudio).
 */
function insertAudioPartAssets(recording: RecordingRow, parts: Array<{ file: UploadFile; path: string; sha256: string }>, now: number): void {
  parts.forEach((s, i) => {
    db.query(
      `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
       VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(
      uuidv7(now),
      recording.workspace_id,
      recording.id,
      i + 1,
      `file:${s.path}`,
      s.sha256,
      s.file.bytes,
      AUDIO_MIME_BY_EXT[extname(s.path)] ?? "application/octet-stream",
      JSON.stringify({ filename: s.file.filename, path: s.path }),
      now
    );
  });
}

/** PDF and image files of an upload become assets of the recording. */
function insertDocumentAssets(recording: RecordingRow, stored: Array<{ file: UploadFile; path: string; sha256: string }>, now: number): void {
  let index = (db.query(`SELECT COUNT(*) AS n FROM asset WHERE recording_id = ? AND kind = 'pdf'`).get(recording.id) as { n: number }).n;
  for (const s of stored) {
    if (s.file.kind === "audio") continue;
    const kind = s.file.kind === "pdf" ? "pdf" : "image";
    db.query(
      `INSERT INTO asset (id, workspace_id, recording_id, kind, part_index, blob_key, sha256, bytes, mime, duration_ms, page_count, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(
      uuidv7(now),
      recording.workspace_id,
      recording.id,
      kind,
      kind === "pdf" ? index++ : 0,
      `file:${s.path}`,
      s.sha256,
      s.file.bytes,
      kind === "pdf" ? DOC_TYPES.pdf!.mime : (Object.entries(IMAGE_TYPES).find(([, ext]) => s.path.endsWith(ext))?.[0] ?? "application/octet-stream"),
      JSON.stringify({ filename: s.file.filename, path: s.path }),
      now
    );
  }
}

/** Removes part directories no open session owns (crash leftovers); run at boot. */
export function sweepOrphanParts(): void {
  if (!existsSync(UPLOAD_ROOT)) return;
  const open = new Set((db.query(`SELECT id FROM upload WHERE status = 'open'`).all() as Array<{ id: string }>).map((r) => r.id));
  for (const name of readdirSync(UPLOAD_ROOT)) if (!open.has(name)) removeParts(name);
  mkdirSync(UPLOAD_ROOT, { recursive: true });
}
