// Admin API contract shared by the server (index.ts) and the /admin dashboard (ui.ts).
// The dashboard's client JS is not type-checked, so this file is also its reference:
// every admin endpoint, its request body and its response shape are listed here.
//
// All endpoints below require an owner/admin session (HttpOnly `lectern_session` cookie,
// same-origin) and answer 401 (not signed in) / 403 (not an admin) otherwise.
//
// Existing endpoints the dashboard also uses (shapes unchanged):
//   GET    /api/auth/me                      → { user: UserDto }
//   POST   /api/auth/logout                  → { ok: true }
//   GET    /api/admin/overview               → { ok, metrics, settings: AdminSettingsDto, users: UserCrmRow[], recentLectures, auditLogs }
//   POST   /api/admin/users                  body { email, displayName?, password, role?, status?, canIngest?, canShare?, canUseServerKey?, quotaMb?, memo? } → 201 { ok, user }
//   PATCH  /api/admin/users/:id              body { displayName?, role?, status?, canIngest?, canShare?, canUseServerKey?, quotaMb?, memo?, newPassword?, revokeSessions? } → { ok, user }
//   DELETE /api/admin/users/:id              → { ok, deletedId }
//   PATCH  /api/admin/settings               body Partial<AdminSettingsDto> → { ok, settings: AdminSettingsDto }
//   POST   /api/lectures/:id/retry           → { ok, lecture } | 409 when already queued/running
//   DELETE /api/lectures/:id                 → { ok, deletedId }
//   DELETE /api/lectures/:id/audio           → { ok, reclaimedBytes, lecture }
//
// New endpoints:
//   GET    /api/admin/ops                    → AdminOpsDto
//   GET    /api/admin/storage                → AdminStorageDto
//   GET    /api/admin/lectures?status=&q=&owner=&limit=&offset=  → AdminLectureListDto
//   GET    /api/admin/lectures/:id           → { ok: true, lecture: AdminLectureDetailDto } | 404
//   GET    /api/admin/audit?q=&action=&cursor=&limit=          → AdminAuditListDto
//   POST   /api/admin/storage/compact        body CompactRequest   → CompactResponse
//   POST   /api/admin/storage/gc             body { dryRun?: boolean } → GcResponse
//   POST   /api/admin/storage/retention      body { dryRun?: boolean } → RetentionResponse
//   POST   /api/admin/maintenance/run        → { ok: true, result: MaintenanceResultDto }

import type {
  AuditActionPrefix,
  AuditCounts,
  AuditLogRecord,
  LectureRecord,
  LectureStatusCounts,
  SystemSettings,
} from "./db.ts";

export type { AuditActionPrefix, AuditLogRecord };

/** Lecture list row as returned by /api/lectures and embedded in SSE events. */
export interface LectureSummaryDto {
  id: string;
  share_token: string;
  is_public: boolean;
  title: string;
  course: string;
  date_label: string;
  status: LectureRecord["status"];
  stage: string;
  stage_message: string;
  progress: number;
  excerpt: string;
  duration_sec: number;
  audio_size: number;
  model_used: string;
  has_audio: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Workspace policy. The signup/role/quota keys predate this file; the storage and
 * retention keys are new. Retention values are days, and 0 always means "off".
 */
export interface AdminSettingsDto extends SystemSettings {}

// MARK: - Jobs (GET /api/admin/ops → jobs)

export type JobKind = "distill" | "compact";

export interface JobDto {
  id: string;
  kind: JobKind;
  lectureId: string;
  lectureTitle: string;
  ownerEmail: string;
  state: "queued" | "running";
  /** Lecture stage/progress for distill jobs ("preparing", "uploading", "analyzing", ...). */
  stage: string;
  progress: number;
  enqueuedAt: string;
  startedAt: string | null;
}

export interface FinishedJobDto {
  id: string;
  kind: JobKind;
  lectureId: string;
  lectureTitle: string;
  ownerEmail: string;
  ok: boolean;
  error: string | null;
  /** Compact jobs: bytes saved (0 when the compacted file was not kept). */
  savedBytes: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface MaintenanceResultDto {
  startedAt: string;
  finishedAt: string;
  expiredSessions: number;
  expiredCodes: number;
  prunedAuditLogs: number;
  orphanFiles: { count: number; bytes: number };
  tempFiles: { count: number; bytes: number };
  retention: { count: number; bytes: number };
  failedRetention: { count: number; bytes: number };
  backup: { file: string; sizeBytes: number } | null;
  walCheckpointed: boolean;
  errors: string[];
}

export interface AdminOpsDto {
  ok: true;
  server: {
    gitSha: string;
    bootAt: string;
    uptimeSec: number;
    bunVersion: string;
    pid: number;
    platform: string;
    memory: { rssBytes: number; heapUsedBytes: number };
    ffmpegAvailable: boolean;
    /** Requests served since boot, and how many ended in a 5xx. */
    requests: { total: number; errors5xx: number };
  };
  jobs: {
    concurrency: { distill: number; compact: number };
    running: JobDto[];
    queued: JobDto[];
    /** Most recent first, at most 50. */
    recent: FinishedJobDto[];
    last24h: { completed: number; failed: number; avgDurationMs: number };
  };
  /** Filesystem holding DATA_DIR; null when it cannot be measured. */
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedPct: number;
    /** True below 10% or 2 GB free. */
    low: boolean;
  } | null;
  database: {
    sizeBytes: number;
    walBytes: number;
    users: number;
    lectures: number;
    sessions: number;
    auditLogs: number;
  };
  backups: {
    keep: number;
    count: number;
    totalBytes: number;
    latest: { file: string; sizeBytes: number; createdAt: string } | null;
  };
  maintenance: {
    intervalMin: number;
    running: boolean;
    lastRunAt: string | null;
    lastResult: MaintenanceResultDto | null;
  };
  deploy: {
    inProgress: boolean;
    lastResult: { ok: boolean; sha: string; error: string | null; at: string } | null;
  };
}

// MARK: - Storage (GET /api/admin/storage)

export interface AdminStorageDto {
  ok: true;
  settings: AdminSettingsDto;
  totals: {
    lectures: number;
    withAudio: number;
    /** Sum of lectures.audio_size (what quotas count). */
    audioBytes: number;
    /** Actual bytes in DATA_DIR/uploads, including orphans. */
    uploadsBytes: number;
    uploadsFiles: number;
  };
  /** By stored file extension, largest first. */
  byFormat: Array<{ ext: string; count: number; bytes: number }>;
  byStatus: Array<{ status: LectureRecord["status"]; count: number; audioBytes: number }>;
  /** Largest first, at most 50. quotaMb 0 = unlimited (usedPct null). */
  byUser: Array<{
    userId: string;
    email: string;
    displayName: string;
    lectureCount: number;
    audioBytes: number;
    quotaMb: number;
    usedPct: number | null;
  }>;
  compaction: {
    enabled: boolean;
    ffmpegAvailable: boolean;
    bitrateKbps: number;
    /** Finished lectures with audio that have not been compacted yet. */
    candidates: number;
    candidateBytes: number;
    estimatedSavedBytes: number;
    compactedCount: number;
    /** Sum over compacted lectures of (original size − current size). */
    savedBytesTotal: number;
    queued: number;
    running: number;
  };
  reclaimable: {
    failedAudio: { count: number; bytes: number };
    /** Done lectures older than audio_retention_days (0 when the policy is off). */
    retention: { days: number; count: number; bytes: number };
    /** Files in DATA_DIR/uploads that no lecture references (older than 1 hour). */
    orphans: { count: number; bytes: number };
  };
  /**
   * Orphans are never deleted outright: GC (and the hourly maintenance) moves them to
   * DATA_DIR/trash, and files there are deleted after `retentionDays`.
   */
  trash: { count: number; bytes: number; retentionDays: number };
  /** Largest stored recordings, at most 20. */
  largest: Array<{
    id: string;
    title: string;
    course: string;
    ownerEmail: string;
    audioBytes: number;
    durationSec: number;
    ext: string;
    compacted: boolean;
    createdAt: string;
  }>;
}

export interface CompactRequest {
  /** Specific lectures; omitted with all:true for every candidate. */
  ids?: string[];
  all?: boolean;
  /** Only report what would be queued. */
  dryRun?: boolean;
}

export interface CompactResponse {
  ok: true;
  dryRun: boolean;
  candidates: number;
  queued: number;
  candidateBytes: number;
  estimatedSavedBytes: number;
}

export interface GcResponse {
  ok: true;
  dryRun: boolean;
  /** `files` lists at most 50 basenames. */
  orphans: { count: number; bytes: number; files: string[] };
  /** Orphans moved to the trash folder by this call (0 on a dry run). */
  movedToTrash: number;
}

/**
 * retention: done lectures older than audio_retention_days lose their audio (notes stay).
 * failedRetention: failed lectures (no notes) untouched for failed_audio_retention_days
 * are deleted together with their audio.
 */
export interface RetentionResponse {
  ok: true;
  dryRun: boolean;
  retention: { days: number; count: number; bytes: number };
  failedRetention: { days: number; count: number; bytes: number };
}

// MARK: - Lectures (GET /api/admin/lectures)

export interface AdminLectureDto extends LectureSummaryDto {
  owner_id: string;
  owner_email: string;
  owner_name: string;
  audio_ext: string;
  compacted: boolean;
  /** Pre-compaction size when compacted, else equal to audio_size. */
  audio_original_size: number;
  error_message: string | null;
  source_client: string;
  job_state: "queued" | "running" | null;
  job_kind: JobKind | null;
}

export interface AdminLectureListDto {
  ok: true;
  /** Rows matching every filter, including status. */
  total: number;
  /** Per-status totals for the q/owner filter, ignoring status (one per status tab). */
  counts: LectureStatusCounts;
  limit: number;
  offset: number;
  lectures: AdminLectureDto[];
}

/** One lecture for the admin peek panel: everything but the note itself. */
export interface AdminLectureDetailDto extends AdminLectureDto {
  model_requested: string;
  audio_mime: string | null;
  audio_compact_state: "compacted" | "skipped" | null;
  audio_compacted_at: string | null;
  /** Length of the note Markdown in characters (the note is not sent). */
  markdown_chars: number;
  /** The note is also written to the lecture archive (LECTURES_ROOT). */
  archived: boolean;
  /** The audio lives in DATA_DIR/uploads, so compaction and retention apply to it. */
  audio_in_uploads: boolean;
}

// MARK: - Audit (GET /api/admin/audit)

/**
 * `action` is one of AUDIT_ACTION_PREFIXES ("auth" | "account" | "admin" | "storage" | "ops").
 * Pages are newest first; pass `nextCursor` back as `cursor` for the next page.
 */
export interface AdminAuditListDto {
  ok: true;
  logs: AuditLogRecord[];
  nextCursor: string | null;
  /** Rows matching q and action. */
  total: number;
  /** Totals for q per action prefix, plus `all` (one per filter chip). */
  counts: AuditCounts;
}
