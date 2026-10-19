// Recording storage management: compaction of finished lectures' audio into speech-tuned
// mono AAC, orphan-file collection (via a trash folder, never deleted outright), retention
// policies, and the numbers behind the admin storage view.
//
// Only files under DATA_DIR/uploads are ever rewritten or removed here. Lecture audio that
// lives in the lecture archive (LECTURES_ROOT, e.g. local-sync imports and the `_원본`
// hard links) is the owner's lossless original and is left alone.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { probeAudioDuration } from "../../../packages/core/src/index.ts";
import type { AdminSettingsDto, AdminStorageDto } from "./admin-api.ts";
import {
  DATA_DIR,
  db,
  deleteLectureAudioOnly,
  deleteLectureById,
  generateId,
  getLectureById,
  type LectureRecord,
} from "./db.ts";

export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");
export const TRASH_DIR = resolve(DATA_DIR, "trash");

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** Unreferenced uploads younger than this may belong to an upload still in flight. */
const ORPHAN_MIN_AGE_MS = HOUR_MS;
const TEMP_FILE_MIN_AGE_MS = 6 * HOUR_MS;
export const TRASH_RETENTION_DAYS = Math.max(
  1,
  Math.floor(Number(process.env.LECTERN_TRASH_DAYS ?? 7)) || 7
);
/** A compacted copy is kept only if it is at most this fraction of the original. */
const COMPACT_KEEP_RATIO = 0.85;

// Names this server writes into uploads/: `aud_<uuid>.<ext>`, plus `.part` while a
// compaction is being written. Anything else in the folder is never touched.
const UPLOAD_NAME_RE = /^aud_[0-9a-f-]{36}\.[a-z0-9]{2,5}(\.part)?$/;
// prepareAudio()'s ffmpeg output for Gemini, normally deleted right after use.
const PREPARE_TEMP_RE = /^lectern_\d+_[a-z0-9]{1,8}\.m4a$/;

let ffmpegAvailable: boolean | null = null;

export function isFfmpegAvailable(): boolean {
  if (ffmpegAvailable === null) {
    try {
      const res = Bun.spawnSync(["ffmpeg", "-hide_banner", "-version"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      ffmpegAvailable = res.exitCode === 0;
    } catch {
      ffmpegAvailable = false;
    }
    if (!ffmpegAvailable) {
      console.warn("ffmpeg not found on PATH: audio compaction is disabled.");
    }
  }
  return ffmpegAvailable;
}

export function isUnderUploads(filePath: string | null | undefined): boolean {
  return Boolean(filePath) && resolve(filePath!).startsWith(UPLOADS_DIR + sep);
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function removeQuietly(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // already gone
  }
}

// MARK: - Compaction

function sampleRateFor(kbps: number): number {
  if (kbps >= 64) return 44100;
  if (kbps >= 48) return 32000;
  return 24000;
}

/** Expected size of a compacted file: bitrate × duration plus a little container overhead. */
export function estimateCompactedBytes(
  durationSec: number,
  sizeBytes: number,
  kbps: number
): number {
  if (!durationSec || durationSec <= 0) return sizeBytes;
  return Math.min(sizeBytes, Math.round(((durationSec * kbps * 1000) / 8) * 1.03));
}

export interface CompactResult {
  ok: boolean;
  state: "compacted" | "skipped" | "unchanged";
  savedBytes: number;
  error?: string;
}

async function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["ffmpeg", ...args], { stdout: "ignore", stderr: "pipe" });
  // Read stderr while ffmpeg runs so a chatty error can never fill the pipe and stall it.
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

function markCompactSkipped(id: string, originalSize: number): void {
  db.query(
    `UPDATE lectures SET audio_compact_state = 'skipped', audio_original_size = ?,
       audio_compacted_at = ? WHERE id = ?`
  ).run(originalSize, new Date().toISOString(), id);
}

/**
 * Re-encodes a finished lecture's uploaded audio to mono AAC at `bitrateKbps` and swaps
 * it in if it is meaningfully smaller and as long as the original. The original upload
 * is removed only after the row points at the new file; `audio_sha256` (the upload
 * idempotency key) is kept so re-uploads of the same recording still deduplicate.
 */
export async function compactLectureAudio(
  lectureId: string,
  bitrateKbps: number
): Promise<CompactResult> {
  const rec = getLectureById(lectureId);
  if (!rec) return { ok: false, state: "unchanged", savedBytes: 0, error: "강의를 찾을 수 없습니다." };
  if (rec.status !== "done") {
    return { ok: false, state: "unchanged", savedBytes: 0, error: "완료된 강의만 압축할 수 있습니다." };
  }
  if (rec.audio_compact_state) return { ok: true, state: "unchanged", savedBytes: 0 };
  const source = rec.audio_path;
  if (!source || !isUnderUploads(source) || !existsSync(source)) {
    return { ok: false, state: "unchanged", savedBytes: 0, error: "압축할 업로드 오디오가 없습니다." };
  }
  if (!isFfmpegAvailable()) {
    return { ok: false, state: "unchanged", savedBytes: 0, error: "ffmpeg를 사용할 수 없습니다." };
  }

  const originalSize = fileSize(source);
  const target = join(UPLOADS_DIR, `${generateId("aud")}.m4a`);
  const partial = `${target}.part`;
  const { code, stderr } = await runFfmpeg([
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vn",
    "-map_metadata",
    "-1",
    "-ac",
    "1",
    "-ar",
    String(sampleRateFor(bitrateKbps)),
    "-c:a",
    "aac",
    "-b:a",
    `${bitrateKbps}k`,
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    partial,
  ]);
  if (code !== 0 || !existsSync(partial)) {
    removeQuietly(partial);
    return {
      ok: false,
      state: "unchanged",
      savedBytes: 0,
      error: `ffmpeg 압축 실패: ${stderr.trim().slice(-300) || `exit ${code}`}`,
    };
  }

  const compactedSize = fileSize(partial);
  const sourceDuration = rec.duration_sec > 0 ? rec.duration_sec : await probeAudioDuration(source);
  const compactedDuration = await probeAudioDuration(partial);
  const durationOk =
    compactedDuration > 0 &&
    (sourceDuration <= 0 ||
      Math.abs(compactedDuration - sourceDuration) <= Math.max(2, sourceDuration * 0.02));
  if (!durationOk) {
    removeQuietly(partial);
    return {
      ok: false,
      state: "unchanged",
      savedBytes: 0,
      error: `압축본 길이가 원본과 다릅니다 (원본 ${sourceDuration}s, 압축본 ${compactedDuration}s).`,
    };
  }
  if (compactedSize <= 0 || compactedSize > originalSize * COMPACT_KEEP_RATIO) {
    removeQuietly(partial);
    markCompactSkipped(lectureId, originalSize);
    return { ok: true, state: "skipped", savedBytes: 0 };
  }

  renameSync(partial, target);
  const res = db
    .query(
      `UPDATE lectures
         SET audio_path = ?, audio_mime = 'audio/mp4', audio_size = ?,
             audio_original_size = ?, audio_compact_state = 'compacted', audio_compacted_at = ?
       WHERE id = ? AND audio_path = ? AND status = 'done'`
    )
    .run(target, compactedSize, originalSize, new Date().toISOString(), lectureId, source);
  if (res.changes === 0) {
    // Deleted, re-run or had its audio removed while we were encoding.
    removeQuietly(target);
    return { ok: false, state: "unchanged", savedBytes: 0, error: "압축 중 강의가 변경되었습니다." };
  }
  // The archive copy (if any) is a hard link to the original, so it survives this.
  removeQuietly(source);
  return { ok: true, state: "compacted", savedBytes: Math.max(0, originalSize - compactedSize) };
}

const uploadsPrefixSql = `substr(audio_path, 1, length(?)) = ?`;

/** Finished lectures whose uploaded audio has not been through compaction yet. */
export function listCompactionCandidates(
  ids?: string[]
): Array<{ id: string; owner_id: string; audio_size: number; duration_sec: number }> {
  const prefix = UPLOADS_DIR + sep;
  const rows = db
    .query(
      `SELECT id, owner_id, audio_size, duration_sec FROM lectures
       WHERE status = 'done' AND audio_path IS NOT NULL AND audio_compact_state IS NULL
         AND ${uploadsPrefixSql}
       ORDER BY audio_size DESC`
    )
    .all(prefix, prefix) as Array<{
    id: string;
    owner_id: string;
    audio_size: number;
    duration_sec: number;
  }>;
  if (!ids) return rows;
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.id));
}

// MARK: - Orphans, trash and temp files

export interface FileEntry {
  name: string;
  path: string;
  bytes: number;
}

/** Files this server wrote into uploads/ that no lecture row references any more. */
export function scanOrphanUploads(now = Date.now()): FileEntry[] {
  if (!existsSync(UPLOADS_DIR)) return [];
  const referenced = new Set(
    (
      db.query(`SELECT audio_path FROM lectures WHERE audio_path IS NOT NULL`).all() as Array<{
        audio_path: string;
      }>
    ).map((r) => resolve(r.audio_path))
  );
  const orphans: FileEntry[] = [];
  for (const name of readdirSync(UPLOADS_DIR)) {
    if (!UPLOAD_NAME_RE.test(name)) continue;
    const path = join(UPLOADS_DIR, name);
    if (referenced.has(path)) continue;
    try {
      const st = statSync(path);
      if (!st.isFile() || now - st.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      orphans.push({ name, path, bytes: st.size });
    } catch {
      // vanished meanwhile
    }
  }
  return orphans;
}

/** Moves files into the trash folder; they are deleted after TRASH_RETENTION_DAYS. */
export function moveToTrash(files: FileEntry[]): number {
  if (files.length === 0) return 0;
  mkdirSync(TRASH_DIR, { recursive: true });
  const now = new Date();
  let moved = 0;
  for (const file of files) {
    try {
      const dest = join(TRASH_DIR, file.name);
      renameSync(file.path, dest);
      // The trash clock starts when the file is moved, not when it was uploaded.
      utimesSync(dest, now, now);
      moved++;
    } catch (err) {
      console.error(`Could not move ${file.name} to trash:`, err);
    }
  }
  return moved;
}

function listDir(dir: string): Array<FileEntry & { mtimeMs: number }> {
  if (!existsSync(dir)) return [];
  const out: Array<FileEntry & { mtimeMs: number }> = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isFile()) out.push({ name, path, bytes: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // vanished meanwhile
    }
  }
  return out;
}

export function trashStats(): { count: number; bytes: number } {
  const files = listDir(TRASH_DIR);
  return { count: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) };
}

export function purgeTrash(now = Date.now()): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const file of listDir(TRASH_DIR)) {
    if (now - file.mtimeMs < TRASH_RETENTION_DAYS * DAY_MS) continue;
    removeQuietly(file.path);
    count++;
    bytes += file.bytes;
  }
  return { count, bytes };
}

/** Leftover Gemini-prep transcodes from a crash mid-distillation. */
export function purgeStaleTempFiles(now = Date.now()): { count: number; bytes: number } {
  const dir = process.env.TMPDIR || tmpdir();
  let count = 0;
  let bytes = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { count, bytes };
  }
  // The temp dir is shared with everything else on the host: match names before stat().
  for (const name of names) {
    if (!PREPARE_TEMP_RE.test(name)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile() || now - st.mtimeMs < TEMP_FILE_MIN_AGE_MS) continue;
      removeQuietly(path);
      count++;
      bytes += st.size;
    } catch {
      // vanished meanwhile
    }
  }
  return { count, bytes };
}

// MARK: - Retention

export interface RetentionCandidate {
  id: string;
  owner_id: string;
  audio_size: number;
}

/** Done lectures older than `days` whose uploaded audio would be removed (notes stay). */
export function findAudioRetentionCandidates(days: number, now = Date.now()): RetentionCandidate[] {
  if (!days || days <= 0) return [];
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const prefix = UPLOADS_DIR + sep;
  return db
    .query(
      `SELECT id, owner_id, audio_size FROM lectures
       WHERE status = 'done' AND audio_path IS NOT NULL AND created_at < ?
         AND ${uploadsPrefixSql}`
    )
    .all(cutoff, prefix, prefix) as RetentionCandidate[];
}

/** Failed lectures (no notes) untouched for `days`; they are deleted with their audio. */
export function findFailedRetentionCandidates(days: number, now = Date.now()): RetentionCandidate[] {
  if (!days || days <= 0) return [];
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  return db
    .query(
      `SELECT id, owner_id, CASE WHEN audio_path IS NULL THEN 0 ELSE audio_size END AS audio_size
       FROM lectures WHERE status = 'error' AND updated_at < ?`
    )
    .all(cutoff) as RetentionCandidate[];
}

export interface RetentionOutcome {
  retention: { days: number; count: number; bytes: number };
  failedRetention: { days: number; count: number; bytes: number };
  /** For SSE: lectures that lost their audio, and lectures that were deleted. */
  audioRemoved: Array<{ id: string; owner_id: string; lecture: LectureRecord | null }>;
  deleted: Array<{ id: string; owner_id: string }>;
}

export function applyRetentionPolicies(
  settings: Pick<AdminSettingsDto, "audio_retention_days" | "failed_audio_retention_days">,
  options: { dryRun: boolean; isBusy: (lectureId: string) => boolean; now?: number }
): RetentionOutcome {
  const now = options.now ?? Date.now();
  const audio = findAudioRetentionCandidates(settings.audio_retention_days, now).filter(
    (c) => !options.isBusy(c.id)
  );
  const failed = findFailedRetentionCandidates(settings.failed_audio_retention_days, now).filter(
    (c) => !options.isBusy(c.id)
  );
  const outcome: RetentionOutcome = {
    retention: {
      days: settings.audio_retention_days,
      count: audio.length,
      bytes: audio.reduce((s, c) => s + (c.audio_size || 0), 0),
    },
    failedRetention: {
      days: settings.failed_audio_retention_days,
      count: failed.length,
      bytes: failed.reduce((s, c) => s + (c.audio_size || 0), 0),
    },
    audioRemoved: [],
    deleted: [],
  };
  if (options.dryRun) return outcome;
  for (const c of audio) {
    const res = deleteLectureAudioOnly(c.id);
    if (res.ok) outcome.audioRemoved.push({ id: c.id, owner_id: c.owner_id, lecture: res.lecture });
  }
  for (const c of failed) {
    if (deleteLectureById(c.id)) outcome.deleted.push({ id: c.id, owner_id: c.owner_id });
  }
  return outcome;
}

// MARK: - Stats for the admin storage view

export function buildStorageStats(input: {
  settings: AdminSettingsDto;
  jobs: { queued: number; running: number };
}): AdminStorageDto {
  const { settings } = input;
  const kbps = settings.storage_compact_bitrate_kbps;

  const totals = db
    .query(
      `SELECT COUNT(*) AS lectures,
         SUM(CASE WHEN audio_path IS NOT NULL THEN 1 ELSE 0 END) AS with_audio,
         COALESCE(SUM(audio_size), 0) AS audio_bytes
       FROM lectures`
    )
    .get() as { lectures: number; with_audio: number | null; audio_bytes: number };

  const uploads = listDir(UPLOADS_DIR);

  const formatMap = new Map<string, { count: number; bytes: number }>();
  for (const row of db
    .query(`SELECT audio_path, audio_size FROM lectures WHERE audio_path IS NOT NULL`)
    .all() as Array<{ audio_path: string; audio_size: number }>) {
    const ext = (extname(row.audio_path) || "(none)").toLowerCase();
    const entry = formatMap.get(ext) || { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += row.audio_size || 0;
    formatMap.set(ext, entry);
  }

  const byStatus = db
    .query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(audio_size), 0) AS audioBytes
       FROM lectures GROUP BY status ORDER BY audioBytes DESC`
    )
    .all() as AdminStorageDto["byStatus"];

  const byUser = (
    db
      .query(
        `SELECT u.id AS userId, u.email, u.display_name AS displayName, u.quota_mb AS quotaMb,
           COUNT(l.id) AS lectureCount, COALESCE(SUM(l.audio_size), 0) AS audioBytes
         FROM users u LEFT JOIN lectures l ON l.owner_id = u.id
         GROUP BY u.id ORDER BY audioBytes DESC LIMIT 50`
      )
      .all() as Array<Omit<AdminStorageDto["byUser"][number], "usedPct">>
  ).map((u) => ({
    ...u,
    usedPct:
      u.quotaMb > 0 ? Math.round((u.audioBytes / (u.quotaMb * 1024 * 1024)) * 1000) / 10 : null,
  }));

  const candidates = listCompactionCandidates();
  const candidateBytes = candidates.reduce((s, c) => s + (c.audio_size || 0), 0);
  const estimatedSavedBytes = candidates.reduce(
    (s, c) => s + Math.max(0, c.audio_size - estimateCompactedBytes(c.duration_sec, c.audio_size, kbps)),
    0
  );
  const compacted = db
    .query(
      `SELECT COUNT(*) AS count,
         COALESCE(SUM(MAX(audio_original_size - audio_size, 0)), 0) AS saved
       FROM lectures WHERE audio_compact_state = 'compacted' AND audio_path IS NOT NULL`
    )
    .get() as { count: number; saved: number };

  const failedAudio = db
    .query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(audio_size), 0) AS bytes
       FROM lectures WHERE status = 'error' AND audio_path IS NOT NULL`
    )
    .get() as { count: number; bytes: number };
  const retention = findAudioRetentionCandidates(settings.audio_retention_days);
  const orphans = scanOrphanUploads();

  const largest = (
    db
      .query(
        `SELECT l.id, l.title, l.course, COALESCE(u.email, '') AS ownerEmail,
           l.audio_size AS audioBytes, l.duration_sec AS durationSec, l.audio_path,
           l.audio_compact_state, l.created_at AS createdAt
         FROM lectures l LEFT JOIN users u ON u.id = l.owner_id
         WHERE l.audio_path IS NOT NULL
         ORDER BY l.audio_size DESC LIMIT 20`
      )
      .all() as Array<{
      id: string;
      title: string;
      course: string;
      ownerEmail: string;
      audioBytes: number;
      durationSec: number;
      audio_path: string;
      audio_compact_state: string | null;
      createdAt: string;
    }>
  ).map(({ audio_path, audio_compact_state, ...row }) => ({
    ...row,
    ext: (extname(audio_path) || "").toLowerCase(),
    compacted: audio_compact_state === "compacted",
  }));

  return {
    ok: true,
    settings,
    totals: {
      lectures: totals.lectures,
      withAudio: totals.with_audio || 0,
      audioBytes: totals.audio_bytes,
      uploadsBytes: uploads.reduce((s, f) => s + f.bytes, 0),
      uploadsFiles: uploads.length,
    },
    byFormat: Array.from(formatMap, ([ext, v]) => ({ ext, ...v })).sort((a, b) => b.bytes - a.bytes),
    byStatus,
    byUser,
    compaction: {
      enabled: settings.storage_auto_compact,
      ffmpegAvailable: isFfmpegAvailable(),
      bitrateKbps: kbps,
      candidates: candidates.length,
      candidateBytes,
      estimatedSavedBytes,
      compactedCount: compacted.count,
      savedBytesTotal: compacted.saved,
      queued: input.jobs.queued,
      running: input.jobs.running,
    },
    reclaimable: {
      failedAudio,
      retention: {
        days: settings.audio_retention_days,
        count: retention.length,
        bytes: retention.reduce((s, c) => s + (c.audio_size || 0), 0),
      },
      orphans: { count: orphans.length, bytes: orphans.reduce((s, f) => s + f.bytes, 0) },
    },
    trash: { ...trashStats(), retentionDays: TRASH_RETENTION_DAYS },
    largest,
  };
}
