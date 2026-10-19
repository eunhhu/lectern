import { existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  distillLectureAudio,
  renderMarkdownToHtml,
  DEFAULT_GEMINI_MODEL,
} from "../../../packages/core/src/index.ts";
import {
  DATA_DIR,
  db,
  searchLecturesForAdmin,
  type LectureRecord,
  type UserRecord,
  cleanupLecturesForUser,
  completeLectureRecord,
  createEmailVerificationCode,
  createPendingLecture,
  createSession,
  createUser,
  deleteAllUserSessions,
  deleteLectureAudioOnly,
  deleteLectureById,
  deleteSession,
  deleteUserAndData,
  ensureBootstrapOwner,
  failLectureRecord,
  formatKstTimestamp,
  generateId,
  getLectureByAudioSha256,
  getLectureById,
  getLectureByShareToken,
  getSystemSettings,
  getUserByEmail,
  getUserById,
  getUserBySessionOrApiToken,
  getUserStorageUsageBytes,
  hashPassword,
  isUserRole,
  isUserStatus,
  listAllLecturesForAdmin,
  listAuditLogs,
  listInterruptedLectures,
  listLecturesForUser,
  listUsersCrmSummary,
  recordAuditLog,
  resetLectureForRetry,
  rotateUserApiToken,
  setLectureVisibility,
  syncLocalLecturesDir,
  touchUserLastLogin,
  updateLectureMarkdown,
  updateLectureProgress,
  updateSystemSettings,
  updateUserByAdmin,
  updateUserPassword,
  updateUserProfile,
  verifyEmailVerificationCode,
  verifyPassword,
} from "./db.ts";
import {
  renderAdminPageHtml,
  renderAppHtml,
  renderSharePageHtml,
} from "./ui.ts";
import type {
  AdminLectureDto,
  AdminLectureListDto,
  AdminOpsDto,
  CompactRequest,
  CompactResponse,
  GcResponse,
  JobDto,
  LectureSummaryDto,
  RetentionResponse,
} from "./admin-api.ts";
import {
  countJobs,
  drainJobs,
  enqueueJob,
  getLectureJobState,
  isLectureBusy,
  snapshotJobs,
  type JobInfo,
  type JobOutcome,
} from "./jobs.ts";
import {
  applyRetentionPolicies,
  buildStorageStats,
  compactLectureAudio,
  estimateCompactedBytes,
  isFfmpegAvailable,
  listCompactionCandidates,
  moveToTrash,
  scanOrphanUploads,
  type RetentionOutcome,
} from "./storage.ts";
import {
  BOOT_AT,
  MAINTENANCE_INTERVAL_MIN,
  backupStats,
  databaseIsHealthy,
  databaseStats,
  deployStatus,
  diskStats,
  maintenanceStatus,
  pullLatestRelease,
  recordRequestOutcome,
  redactUrlForLog,
  requestStats,
  resolveGitSha,
  runMaintenance,
} from "./ops.ts";

const PORT = Number(process.env.PORT || 18775);
const PUBLIC_BASE_URL =
  process.env.LECTERN_BASE_URL || "https://lectern.qucord.com";

const BOOT_GIT_SHA = resolveGitSha();

const bootstrapOwner = ensureBootstrapOwner();
await syncLocalLecturesDir(bootstrapOwner.id);

// The archive sync walks and reads every Markdown file under LECTURES_ROOT, so lecture
// list requests run it at most once per interval rather than on every request. Newly
// found files always belong to the workspace owner, whichever admin triggered the sync.
const LOCAL_SYNC_MIN_INTERVAL_MS = 60_000;
let lastLocalSyncAt = Date.now();
let localSyncInFlight: Promise<void> | null = null;

export async function syncLocalLecturesIfStale(now = Date.now()): Promise<boolean> {
  if (localSyncInFlight) {
    await localSyncInFlight;
    return false;
  }
  if (now - lastLocalSyncAt < LOCAL_SYNC_MIN_INTERVAL_MS) return false;
  lastLocalSyncAt = now;
  localSyncInFlight = syncLocalLecturesDir(bootstrapOwner.id)
    .catch((err) => console.error("Local lecture sync failed:", err))
    .finally(() => {
      localSyncInFlight = null;
    });
  await localSyncInFlight;
  return true;
}

type SSEController = ReadableStreamDefaultController<Uint8Array>;
const sseClientsByOwner = new Map<string, Set<SSEController>>();
const sseEncoder = new TextEncoder();

export function toLectureSummaryDto(l: LectureRecord): LectureSummaryDto {
  const displayDateLabel =
    l.date_label && l.date_label.length > 10
      ? l.date_label
      : formatKstTimestamp(l.created_at).fullLabel;
  return {
    id: l.id,
    share_token: l.share_token,
    is_public: Boolean(l.is_public),
    title: l.title,
    course: l.course,
    date_label: displayDateLabel,
    status: l.status,
    stage: l.stage,
    stage_message: l.stage_message,
    progress: l.progress,
    excerpt: l.excerpt,
    duration_sec: l.duration_sec,
    audio_size: l.audio_size,
    model_used: l.model_used,
    has_audio: Boolean(l.audio_path && existsSync(l.audio_path)),
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

export function broadcastLectureEvent(
  ownerId: string,
  payload: {
    type: "created" | "progress" | "completed" | "error" | "updated" | "deleted";
    id?: string;
    ids?: string[];
    lecture?: ReturnType<typeof toLectureSummaryDto>;
    stage?: string;
    stage_message?: string;
    progress?: number;
    error_message?: string | null;
  }
): void {
  const clients = sseClientsByOwner.get(ownerId);
  if (!clients || clients.size === 0) return;

  const chunk = sseEncoder.encode(
    `event: lecture_update\ndata: ${JSON.stringify(payload)}\n\n`
  );
  for (const ctrl of Array.from(clients)) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      clients.delete(ctrl);
    }
  }
}

// Set by the entry point to a graceful shutdown; a process supervisor (systemd) restarts us.
let restartHandler: ((reason: string) => void) | null = null;

function scheduleRestart(reason: string): void {
  setTimeout(() => {
    if (restartHandler) restartHandler(reason);
    else process.exit(0);
  }, 350);
}

/** Tells every SSE client the server is going away; browsers reconnect on their own. */
function closeAllSseStreams(): void {
  const bye = sseEncoder.encode(`event: shutdown\ndata: {}\n\n`);
  for (const clients of sseClientsByOwner.values()) {
    for (const ctrl of clients) {
      try {
        ctrl.enqueue(bye);
        ctrl.close();
      } catch {
        // already closed
      }
    }
    clients.clear();
  }
}

interface DistillInput {
  audioPath: string;
  course: string;
  title: string;
  model: string;
  apiKey?: string;
}

function broadcastProgress(ownerId: string, updated: LectureRecord | null): void {
  if (!updated) return;
  broadcastLectureEvent(ownerId, {
    type: "progress",
    id: updated.id,
    stage: updated.stage,
    stage_message: updated.stage_message,
    progress: updated.progress,
    lecture: toLectureSummaryDto(updated),
  });
}

/**
 * Queues the distillation of a lecture whose row is already 'processing'. The job queue
 * bounds how many run at once, and a lecture that already has a distillation queued or
 * running is not queued twice: the existing job's completion is returned instead.
 */
function enqueueDistillation(
  id: string,
  ownerId: string,
  input: DistillInput
): Promise<JobOutcome> {
  const { done, deduplicated, position } = enqueueJob("distill", id, () =>
    runDistillation(id, ownerId, input)
  );
  if (!deduplicated && position > 0) {
    broadcastProgress(
      ownerId,
      updateLectureProgress(
        id,
        "queued",
        `분석 대기열 ${position}번째 — 앞선 작업이 끝나면 자동으로 시작됩니다.`,
        5
      )
    );
  }
  return done;
}

const LECTURE_GONE_MESSAGE = "강의가 삭제되어 작업을 중단했습니다.";

/**
 * Only transient failures are worth another attempt: network errors, timeouts, 429 and
 * 5xx from Gemini. Configuration problems, silent recordings, unreadable audio and other
 * 4xx answers fail the same way every time, so retrying them only burns a job slot.
 */
export function isRetryableDistillError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  if (
    msg.includes("GEMINI_API_KEY is not configured") ||
    msg.includes("음성 신호가 감지되지 않았습니다") ||
    msg.includes("Audio file not found") ||
    msg.includes("ffmpeg transcoding failed")
  ) {
    return false;
  }
  const status = msg.match(/\((\d{3})\)/);
  if (status) {
    const code = Number(status[1]);
    return code === 408 || code === 429 || code >= 500;
  }
  return true;
}

async function runDistillation(
  id: string,
  ownerId: string,
  input: DistillInput
): Promise<JobOutcome> {
  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
    try {
      if (attempt > 1) {
        broadcastProgress(
          ownerId,
          updateLectureProgress(
            id,
            "retrying",
            `일시적 네트워크/API 오류 자동 재시도 중 (${attempt}/${maxAttempts})...`,
            15
          )
        );
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }

      const res = await distillLectureAudio({
        audioPath: input.audioPath,
        courseName: input.course,
        title: input.title,
        model: input.model,
        apiKey: input.apiKey,
        onProgress: (ev) => {
          broadcastProgress(
            ownerId,
            updateLectureProgress(id, ev.stage, ev.message, ev.progress ?? 50)
          );
        },
      });
      // Deleted while Gemini was working: don't write notes (or archive files) for it.
      if (!getLectureById(id)) return { ok: false, error: LECTURE_GONE_MESSAGE };
      const done = completeLectureRecord(id, res);
      broadcastLectureEvent(ownerId, {
        type: "completed",
        id,
        lecture: toLectureSummaryDto(done),
      });
      if (getSystemSettings().storage_auto_compact) {
        scheduleCompaction(id, ownerId);
      }
      return { ok: true };
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableDistillError(err)) break;
    }
  }

  const errMsg = lastErr?.message || String(lastErr);
  const failed = failLectureRecord(id, errMsg);
  broadcastLectureEvent(ownerId, {
    type: "error",
    id,
    error_message: errMsg,
    lecture: failed ? toLectureSummaryDto(failed) : undefined,
  });
  return { ok: false, error: errMsg };
}

/**
 * Queues re-encoding of a finished lecture's audio (see storage.ts). Returns false when
 * compaction is unavailable (no ffmpeg) or the lecture already has one queued/running.
 */
function scheduleCompaction(id: string, ownerId: string): boolean {
  if (!isFfmpegAvailable()) return false;
  const { deduplicated } = enqueueJob("compact", id, async () => {
    if (isLectureBusy(id, "distill")) {
      return { ok: false, error: "분석 작업이 진행 중인 강의입니다." };
    }
    const res = await compactLectureAudio(id, getSystemSettings().storage_compact_bitrate_kbps);
    if (res.state === "compacted") {
      const updated = getLectureById(id);
      if (updated) {
        broadcastLectureEvent(ownerId, {
          type: "updated",
          id,
          lecture: toLectureSummaryDto(updated),
        });
      }
    }
    return { ok: res.ok, error: res.error ?? null, savedBytes: res.savedBytes };
  });
  return !deduplicated;
}

function broadcastRetentionOutcome(outcome: RetentionOutcome): void {
  for (const item of outcome.audioRemoved) {
    if (item.lecture) {
      broadcastLectureEvent(item.owner_id, {
        type: "updated",
        id: item.id,
        lecture: toLectureSummaryDto(item.lecture),
      });
    }
  }
  for (const item of outcome.deleted) {
    broadcastLectureEvent(item.owner_id, { type: "deleted", id: item.id, ids: [item.id] });
  }
}

const LECTURE_BUSY_MESSAGE = "이미 분석 또는 압축 작업이 진행 중인 강의입니다.";

/** Whether distillation may fall back to the server's own GEMINI_API_KEY for this account. */
function canUseServerKey(user: UserRecord | null): boolean {
  return Boolean(
    user && user.can_use_server_key !== 0 && (user.status || "active") === "active"
  );
}

const SERVER_KEY_RESTRICTED_MESSAGE =
  "노트 자동 분석 권한이 제한된 계정입니다. 관리자에게 문의하세요.";

// Auto-resume lectures interrupted mid-processing (e.g., server restart). A user-supplied
// Gemini key is never persisted, so a resume always runs on the server key: owners who may
// not use it get the lecture marked failed instead, so it can be retried with their own key.
export function resumeInterruptedLectures(
  items: LectureRecord[] = listInterruptedLectures()
): { resumed: string[]; failed: string[] } {
  const resumed: string[] = [];
  const failed: string[] = [];
  for (const item of items) {
    if (
      !item.audio_path ||
      !existsSync(item.audio_path) ||
      item.source_client === "bun-test" ||
      item.id.startsWith("test_") ||
      item.id.startsWith("unauth_")
    ) {
      continue;
    }
    if (!canUseServerKey(getUserById(item.owner_id))) {
      failLectureRecord(
        item.id,
        "서버 재시작으로 분석이 중단되었습니다. 서버 분석 키 사용이 제한된 계정이라 자동으로 재개하지 않았습니다. 개인 API 키로 다시 시도해주세요."
      );
      failed.push(item.id);
      continue;
    }
    void enqueueDistillation(item.id, item.owner_id, {
      audioPath: item.audio_path,
      course: item.course,
      title: item.title,
      model: item.model_requested || DEFAULT_GEMINI_MODEL,
    });
    resumed.push(item.id);
  }
  return { resumed, failed };
}

resumeInterruptedLectures();

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Lectern-Token, X-Idempotency-Key, X-Course, X-Title, X-Model, X-Gemini-Key, X-Lectern-Deploy-Token",
      ...extraHeaders,
    },
  });
}

// The pages ship inline <script>/<style> and on* handlers, plus the Pretendard webfont
// from jsDelivr; anything else (remote scripts, framing, plugins) is refused.
const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function applySecurityHeaders(res: Response): Response {
  const headers = res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  if ((headers.get("content-type") || "").toLowerCase().startsWith("text/html")) {
    headers.set("Content-Security-Policy", HTML_CONTENT_SECURITY_POLICY);
    headers.set("X-Frame-Options", "DENY");
  }
  return res;
}

// The server only listens on 127.0.0.1 behind a reverse proxy, and each trusted proxy
// appends the address it accepted the connection from to X-Forwarded-For. Entries to the
// left of those are whatever the client sent and cannot be trusted.
const TRUSTED_PROXY_HOPS = Math.max(
  0,
  Math.floor(Number(process.env.LECTERN_TRUSTED_PROXY_HOPS ?? 1)) || 0
);

let warnedMissingForwardedFor = false;

/**
 * The client address reported by the trusted proxy, or null when there is none. Callers
 * then skip per-IP limits (per-email limits still apply) rather than lumping every client
 * into one shared bucket that a single abuser could exhaust for everyone.
 */
export function getClientIp(req: Request): string | null {
  if (TRUSTED_PROXY_HOPS === 0) return null;
  const hops = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length > 0) {
    return hops[Math.max(0, hops.length - TRUSTED_PROXY_HOPS)];
  }
  if (!warnedMissingForwardedFor) {
    warnedMissingForwardedFor = true;
    console.warn(
      "No X-Forwarded-For on an auth request: per-IP rate limits are inactive until the proxy sets it."
    );
  }
  return null;
}

/** In-memory fixed-window counter; fine for this single-process server. */
class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private static readonly MAX_KEYS = 50_000;

  constructor(readonly limit: number, readonly windowMs: number) {}

  /** Seconds until `key` may try again, or 0 when it is under the limit. */
  retryAfterSec(key: string, now = Date.now()): number {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now || w.count < this.limit) return 0;
    return Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  }

  hit(key: string, now = Date.now()): void {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= RateLimiter.MAX_KEYS) this.prune(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
  }

  clear(): void {
    this.windows.clear();
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
    // Still full of live windows: drop the oldest so memory stays bounded.
    for (const key of this.windows.keys()) {
      if (this.windows.size < RateLimiter.MAX_KEYS) break;
      this.windows.delete(key);
    }
  }
}

const MINUTE_MS = 60_000;
const authRateLimits = {
  // Failed password attempts only, so normal sign-ins on many devices never trip it.
  loginEmail: new RateLimiter(10, 15 * MINUTE_MS),
  loginIp: new RateLimiter(30, 15 * MINUTE_MS),
  // Every send-code request: each one mails a code.
  sendCodeEmail: new RateLimiter(5, 15 * MINUTE_MS),
  sendCodeIp: new RateLimiter(20, 60 * MINUTE_MS),
  resetEmail: new RateLimiter(10, 15 * MINUTE_MS),
  resetIp: new RateLimiter(30, 15 * MINUTE_MS),
};

export function resetAuthRateLimits(): void {
  for (const limiter of Object.values(authRateLimits)) limiter.clear();
}

// A null key (no known client IP) is skipped.
type RateLimitCheck = [RateLimiter, string | null];

function firstRateLimitWait(checks: RateLimitCheck[]): number {
  for (const [limiter, key] of checks) {
    if (key === null) continue;
    const wait = limiter.retryAfterSec(key);
    if (wait > 0) return wait;
  }
  return 0;
}

function recordRateLimitHits(checks: RateLimitCheck[]): void {
  for (const [limiter, key] of checks) {
    if (key !== null) limiter.hit(key);
  }
}

function tooManyRequestsResponse(retryAfterSec: number): Response {
  return jsonResponse(
    {
      error: `요청이 너무 많습니다. ${Math.ceil(retryAfterSec / 60)}분 후 다시 시도해주세요.`,
    },
    429,
    { "Retry-After": String(retryAfterSec) }
  );
}

// Compared against when the account does not exist, so a login takes as long for an
// unknown email as for a wrong password.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString("hex"));

const RESET_CODE_SENT_MESSAGE =
  "가입된 계정이라면 이메일로 6자리 인증번호가 발송됩니다. (10분간 유효)";
const INVALID_CODE_MESSAGE = "인증번호가 올바르지 않거나 만료되었습니다.";

async function sendResendVerificationEmail(
  toEmail: string,
  code: string,
  purpose: "signup" | "reset"
): Promise<{ sent: boolean; id?: string }> {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (
    process.env.RESEND_FROM_EMAIL || "Lectern <noreply@qucord.com>"
  ).trim();
  if (!apiKey) {
    return { sent: false };
  }

  const subject =
    purpose === "reset"
      ? `[Lectern] 비밀번호 재설정 인증번호 (${code})`
      : `[Lectern] 회원가입 이메일 인증번호 (${code})`;
  const titleText =
    purpose === "reset"
      ? "비밀번호 재설정 인증번호"
      : "회원가입 이메일 인증번호";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 28px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; color: #111827;">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #111827;">Lectern</div>
      <div style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 20px;">${titleText}</div>
      <p style="font-size: 14px; line-height: 22px; color: #4b5563; margin: 0 0 20px;">
        아래 6자리 인증번호를 입력 화면에 입력해주세요. 인증번호는 10분간 유효합니다.
      </p>
      <div style="padding: 18px 24px; background: #f3f4f6; border-radius: 12px; text-align: center; font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827; margin-bottom: 20px;">
        ${code}
      </div>
      <p style="font-size: 12px; color: #9ca3af; margin: 0;">
        본인이 요청하지 않은 경우 이 메일을 무시하셔도 안전합니다.
      </p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`이메일 발송 실패 (${res.status}): ${errText}`);
  }
  const data: any = await res.json();
  return { sent: true, id: data?.id };
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...v] = part.trim().split("=");
    if (k === "lectern_session") {
      return decodeURIComponent(v.join("=").trim());
    }
  }
  return null;
}

export function extractAuthToken(req: Request, url: URL): string | null {
  const authHeader = (req.headers.get("authorization") || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const tok = authHeader.slice(7).trim();
    if (tok) return tok;
  }
  const xTok = (req.headers.get("x-lectern-token") || "").trim();
  if (xTok) return xTok;
  const qTok = (url.searchParams.get("token") || "").trim();
  if (qTok) return qTok;
  return parseSessionCookie(req.headers.get("cookie"));
}

/** Resolves a session or API token to a user allowed to act (not suspended or pending). */
function resolveActiveUser(token: string | null | undefined): UserRecord | null {
  if (!token) return null;
  const user = getUserBySessionOrApiToken(token);
  if (!user) return null;
  if (user.status === "suspended" || user.status === "pending") {
    return null;
  }
  return user;
}

export function authenticateRequest(req: Request): UserRecord | null {
  return resolveActiveUser(extractAuthToken(req, new URL(req.url)));
}

export function isAdminUser(user: UserRecord | null): boolean {
  if (!user) return false;
  return (
    user.is_admin === 1 || user.role === "owner" || user.role === "admin"
  );
}

export function toUserDto(user: UserRecord) {
  const role = user.role || (user.is_admin === 1 ? "owner" : "member");
  const isAdmin =
    user.is_admin === 1 || role === "owner" || role === "admin";
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    apiToken: user.api_token,
    isAdmin,
    role,
    status: user.status || "active",
    canIngest: user.can_ingest !== 0 && role !== "viewer",
    canShare: user.can_share !== 0 && role !== "viewer",
    canUseServerKey: user.can_use_server_key !== 0,
    quotaMb: typeof user.quota_mb === "number" ? user.quota_mb : 2048,
    memo: user.memo || "",
    lastLoginAt: user.last_login_at || null,
    createdAt: user.created_at,
  };
}

/** Public sharing (`is_public`) is reserved for admins and members with `can_share`. */
function canSharePublicly(user: UserRecord | null): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return user.can_share !== 0 && user.role !== "viewer";
}

const SHARE_RESTRICTED_MESSAGE = "외부 공유 링크 공개 권한이 제한된 계정입니다.";

// Only a deployment explicitly served over plain http (local dev) drops `Secure`.
const SESSION_COOKIE_SECURE = !PUBLIC_BASE_URL.toLowerCase().startsWith("http://");

function makeSessionCookieHeader(sessionToken: string, maxAgeSec = 30 * 86400): string {
  return `lectern_session=${encodeURIComponent(
    sessionToken
  )}; Path=/; HttpOnly;${SESSION_COOKIE_SECURE ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAgeSec}`;
}

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".3gp": "audio/3gpp",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

// Declared upload types we recognise, mapped to the extension the file is stored under.
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/x-aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/vnd.wave": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/3gpp": ".3gp",
  "audio/aiff": ".aiff",
  "audio/x-aiff": ".aiff",
  "video/mp4": ".m4a",
  "video/webm": ".webm",
  "video/ogg": ".ogg",
  "video/3gpp": ".3gp",
};

/** Content-Type for a stored audio file, derived from its extension alone. */
function audioMimeForPath(filePath: string): string | null {
  return AUDIO_MIME_BY_EXT[extname(filePath).toLowerCase()] ?? null;
}

/**
 * Picks the storage extension for an upload. Only audio extensions are accepted and a
 * declared type must be audio (or generic binary). The stored and served MIME type is
 * then derived from that extension and never echoed back from the client.
 */
function resolveUploadAudioExt(fileName: string, declaredType: string): string {
  const mime = declaredType.split(";")[0].trim().toLowerCase();
  const isGenericBinary = !mime || mime === "application/octet-stream";
  if (!isGenericBinary && !AUDIO_EXT_BY_MIME[mime] && !mime.startsWith("audio/")) {
    throw new Error(`오디오 파일만 업로드할 수 있습니다. (지원하지 않는 형식: ${mime})`);
  }
  const ext = extname(fileName).toLowerCase();
  if (ext) {
    if (!AUDIO_MIME_BY_EXT[ext]) {
      throw new Error(`지원하지 않는 오디오 확장자입니다: ${ext}`);
    }
    return ext;
  }
  return AUDIO_EXT_BY_MIME[mime] ?? ".m4a";
}

interface IncomingAudio {
  /** The upload body as a Blob: written to disk without another copy in JS memory. */
  data: Blob;
  ext: string;
  audioMime: string;
  audioSize: number;
  audioSha256: string;
  course: string;
  title: string;
  model: string;
  sourceClient: string;
  apiKey?: string;
}

async function sha256OfBlob(blob: Blob): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of blob.stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Reads and validates an upload in memory. Nothing is written to disk here. */
async function readIncomingAudio(
  req: Request,
  parsedForm?: FormData
): Promise<IncomingAudio> {
  const contentType = req.headers.get("content-type") || "";
  let course =
    decodeURIComponent(req.headers.get("x-course") || "").trim() ||
    "대학교 전공 강의";
  let title = decodeURIComponent(req.headers.get("x-title") || "").trim();
  let model =
    (req.headers.get("x-model") || "").trim() || DEFAULT_GEMINI_MODEL;
  let sourceClient = (req.headers.get("x-client") || "api").trim();
  const apiKey = (req.headers.get("x-gemini-key") || "").trim() || undefined;
  let idempotencyKey = (req.headers.get("x-idempotency-key") || "").trim();

  let ext: string;
  let data: Blob;
  if (contentType.includes("multipart/form-data")) {
    const form = parsedForm || (await req.formData());
    const fileField = (form.get("audio") || form.get("file")) as File | null;
    if (!fileField || typeof fileField === "string") {
      throw new Error("multipart form에 'audio' 또는 'file' 필드가 없습니다.");
    }
    if (form.get("course")) course = String(form.get("course")).trim() || course;
    if (form.get("title")) title = String(form.get("title")).trim() || title;
    if (form.get("model")) model = String(form.get("model")).trim() || model;
    if (form.get("source")) {
      sourceClient = String(form.get("source")).trim() || sourceClient;
    }
    if (form.get("idempotency_key")) {
      idempotencyKey = String(form.get("idempotency_key")).trim() || idempotencyKey;
    }

    ext = resolveUploadAudioExt(fileField.name || "", fileField.type || "");
    data = fileField;
    if (!data.size) {
      throw new Error("빈 오디오 파일입니다.");
    }
  } else {
    // Raw binary body (e.g. direct iOS Shortcut / native stream)
    ext = resolveUploadAudioExt("", contentType);
    data = await req.blob();
    if (!data.size) {
      throw new Error("빈 오디오 데이터입니다.");
    }
  }

  const sha256 = idempotencyKey || (await sha256OfBlob(data));

  return {
    data,
    ext,
    audioMime: AUDIO_MIME_BY_EXT[ext],
    audioSize: data.size,
    audioSha256: sha256,
    course,
    title: title || "",
    model,
    sourceClient,
    apiKey,
  };
}

async function storeIncomingAudio(incoming: IncomingAudio): Promise<string> {
  const audioPath = join(DATA_DIR, "uploads", `${generateId("aud")}${incoming.ext}`);
  await Bun.write(audioPath, incoming.data);
  return audioPath;
}

function ingestPermissionError(
  user: UserRecord,
  apiKey: string | undefined
): Response | null {
  if (user.can_ingest === 0 || user.role === "viewer") {
    return jsonResponse(
      { error: "오디오 업로드 및 노트 생성 권한이 없는 계정(뷰어)입니다." },
      403
    );
  }
  if (!apiKey && !canUseServerKey(user)) {
    return jsonResponse({ error: SERVER_KEY_RESTRICTED_MESSAGE }, 403);
  }
  return null;
}

/**
 * Authorizes an ingest request before anything is stored. Header and cookie credentials
 * are checked first, so a non-multipart upload without them is refused unread. The
 * multipart `token` field is only consulted when no header credential resolved, and it
 * goes through the same active-account check.
 */
async function acceptIngestUpload(
  req: Request,
  unauthorizedMessage: string
): Promise<{ user: UserRecord; incoming: IncomingAudio } | { response: Response }> {
  const headerApiKey = (req.headers.get("x-gemini-key") || "").trim() || undefined;
  let user = authenticateRequest(req);
  let form: FormData | undefined;

  if (user) {
    const denied = ingestPermissionError(user, headerApiKey);
    if (denied) return { response: denied };
  } else {
    const isMultipart = (req.headers.get("content-type") || "").includes(
      "multipart/form-data"
    );
    if (!isMultipart) {
      return { response: jsonResponse({ error: unauthorizedMessage }, 401) };
    }
    form = await req.formData();
    user = resolveActiveUser(String(form.get("token") || "").trim());
    if (!user) {
      return { response: jsonResponse({ error: unauthorizedMessage }, 401) };
    }
    const denied = ingestPermissionError(user, headerApiKey);
    if (denied) return { response: denied };
  }

  const incoming = await readIncomingAudio(req, form);
  if (user.quota_mb > 0) {
    const usedBytes = getUserStorageUsageBytes(user.id);
    if (usedBytes + incoming.audioSize > user.quota_mb * 1024 * 1024) {
      return {
        response: jsonResponse(
          {
            error: `계정 오디오 저장 용량 한도(${user.quota_mb}MB)를 초과했습니다.`,
          },
          403
        ),
      };
    }
  }
  return { user, incoming };
}

function serveAudioWithRange(req: Request, filePath: string): Response {
  const st = statSync(filePath);
  const total = st.size;
  const range = req.headers.get("range");
  const bunFile = Bun.file(filePath);
  // The type comes from the stored file's extension, never from the uploader; anything
  // that is not a known audio file is offered as a download instead of being rendered.
  const mimeType = audioMimeForPath(filePath);
  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeType ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  if (!mimeType) baseHeaders["Content-Disposition"] = "attachment";

  const m = range ? range.match(/bytes=(\d*)-(\d*)/) : null;
  if (!m) {
    return new Response(bunFile, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  }
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  return new Response(bunFile.slice(start, end + 1), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

function toJobDto(job: JobInfo): JobDto {
  const lecture = getLectureById(job.lectureId);
  const owner = lecture ? getUserById(lecture.owner_id) : null;
  return {
    id: job.id,
    kind: job.kind,
    lectureId: job.lectureId,
    lectureTitle: lecture?.title || "(삭제된 강의)",
    ownerEmail: owner?.email || "",
    state: job.state,
    stage: job.kind === "distill" ? lecture?.stage || "" : job.state === "running" ? "compacting" : "queued",
    progress: job.kind === "distill" ? lecture?.progress ?? 0 : 0,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
  };
}

function buildOpsDto(): AdminOpsDto {
  const jobs = snapshotJobs();
  const mem = process.memoryUsage();
  return {
    ok: true,
    server: {
      gitSha: BOOT_GIT_SHA,
      bootAt: BOOT_AT.toISOString(),
      uptimeSec: Math.round((Date.now() - BOOT_AT.getTime()) / 1000),
      bunVersion: Bun.version,
      pid: process.pid,
      platform: `${process.platform}-${process.arch}`,
      memory: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
      ffmpegAvailable: isFfmpegAvailable(),
      requests: requestStats(),
    },
    jobs: {
      concurrency: jobs.concurrency,
      running: jobs.running.map(toJobDto),
      queued: jobs.queued.map(toJobDto),
      recent: jobs.recent.map((j) => {
        const lecture = getLectureById(j.lectureId);
        const owner = lecture ? getUserById(lecture.owner_id) : null;
        return {
          ...j,
          lectureTitle: lecture?.title || "(삭제된 강의)",
          ownerEmail: owner?.email || "",
        };
      }),
      last24h: jobs.last24h,
    },
    disk: diskStats(),
    database: databaseStats(),
    backups: backupStats(),
    maintenance: maintenanceStatus(),
    deploy: deployStatus(),
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  let res: Response;
  try {
    res = applySecurityHeaders(await routeRequest(req));
  } catch (err) {
    console.error("Unhandled request error:", err);
    res = applySecurityHeaders(
      jsonResponse({ error: "서버 내부 오류가 발생했습니다." }, 500)
    );
  }
  recordRequestOutcome(res.status);
  return res;
}

async function routeRequest(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // 1. Web App Root & Admin Page
    if (req.method === "GET" && path === "/") {
      return new Response(renderAppHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (req.method === "GET" && path === "/admin") {
      return new Response(renderAdminPageHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // 2. PWA Manifest
    if (req.method === "GET" && path === "/manifest.json") {
      return jsonResponse({
        name: "Lectern — Academic Audio Distillation",
        short_name: "Lectern",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0c0e",
        theme_color: "#0b0c0e",
        icons: [],
      });
    }

    // 3. Public Share View: /s/:token (Requires lecture.is_public === 1 OR authenticated owner)
    if (req.method === "GET" && path.startsWith("/s/")) {
      const token = decodeURIComponent(path.slice(3));
      const lecture = getLectureByShareToken(token);
      if (!lecture) {
        return new Response("공유된 강의 노트를 찾을 수 없습니다.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const viewer = authenticateRequest(req);
      const isOwner = Boolean(viewer && viewer.id === lecture.owner_id);
      if (!lecture.is_public && !isOwner) {
        return new Response(
          "비공개로 설정된 강의 노트입니다. 소유자가 '공개'로 전환한 노트만 공유 링크로 열람할 수 있습니다.",
          {
            status: 403,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }
        );
      }
      return new Response(renderSharePageHtml(lecture), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 3b. Real-Time Server-Sent Events Stream: GET /api/events
    if (req.method === "GET" && path === "/api/events") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }

      let ctrlRef: SSEController | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ctrlRef = controller;
          let set = sseClientsByOwner.get(user.id);
          if (!set) {
            set = new Set();
            sseClientsByOwner.set(user.id, set);
          }
          set.add(controller);

          controller.enqueue(
            sseEncoder.encode(
              `event: connected\ndata: ${JSON.stringify({ ok: true, userId: user.id })}\n\n`
            )
          );

          heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(sseEncoder.encode(`: heartbeat ${Date.now()}\n\n`));
            } catch {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              if (ctrlRef) sseClientsByOwner.get(user.id)?.delete(ctrlRef);
            }
          }, 15000);
        },
        cancel() {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (ctrlRef) {
            sseClientsByOwner.get(user.id)?.delete(ctrlRef);
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 4. Health check (no private lecture count exposed)
    if (req.method === "GET" && path === "/api/health") {
      const dbOk = databaseIsHealthy();
      const disk = diskStats();
      return jsonResponse(
        {
          status: dbOk ? "ok" : "error",
          service: "lectern",
          version: "1.0.0",
          authRequired: true,
          gitSha: BOOT_GIT_SHA,
          runtime: `Bun ${Bun.version}`,
          uptimeSec: Math.round((Date.now() - BOOT_AT.getTime()) / 1000),
          checks: {
            database: dbOk ? "ok" : "error",
            disk: disk ? (disk.low ? "low" : "ok") : "unknown",
          },
        },
        dbOk ? 200 : 503
      );
    }

    // 4b. Continuous Deployment Webhook: POST /api/cd/deploy
    if (req.method === "POST" && path === "/api/cd/deploy") {
      const configuredSecret = (process.env.LECTERN_DEPLOY_TOKEN || "").trim();
      const providedSecret = (
        req.headers.get("x-lectern-deploy-token") || ""
      ).trim();

      if (!configuredSecret || !safeTokenCompare(configuredSecret, providedSecret)) {
        return jsonResponse({ error: "Unauthorized CD request" }, 401);
      }

      const result = await pullLatestRelease();
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error, newSha: result.sha },
          result.busy ? 409 : 500
        );
      }
      recordAuditLog({
        actorId: "system",
        actorEmail: "cd-webhook",
        action: "ops.deploy",
        detail: `${result.previousSha.slice(0, 7)} → ${result.sha.slice(0, 7)}`,
      });
      scheduleRestart("deploy");
      return jsonResponse({
        ok: true,
        deployedSha: result.sha,
        previousSha: result.previousSha,
        restarting: true,
      });
    }

    // 5. Auth Routes: /api/auth/{login,register,logout,me,password,profile,rotate-token}
    if (req.method === "POST" && path === "/api/auth/login") {
      try {
        const clientIp = getClientIp(req);
        const ipWait = firstRateLimitWait([[authRateLimits.loginIp, clientIp]]);
        if (ipWait) return tooManyRequestsResponse(ipWait);

        const body: any = await req.json();
        let rawId = String(body.email || body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        const ownerAliases = (process.env.LECTERN_OWNER_ALIASES || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (ownerAliases.includes(rawId) && process.env.LECTERN_OWNER_EMAIL) {
          rawId = process.env.LECTERN_OWNER_EMAIL.trim().toLowerCase();
        }
        const emailWait = firstRateLimitWait([[authRateLimits.loginEmail, rawId]]);
        if (emailWait) return tooManyRequestsResponse(emailWait);

        const user = getUserByEmail(rawId);
        const passwordOk = verifyPassword(
          password,
          user ? user.password_hash : DUMMY_PASSWORD_HASH
        );
        if (!user || !passwordOk) {
          recordRateLimitHits([
            [authRateLimits.loginIp, clientIp],
            [authRateLimits.loginEmail, rawId],
          ]);
          return jsonResponse(
            { error: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." },
            401
          );
        }
        if (user.status === "suspended") {
          return jsonResponse(
            { error: "이용이 정지된 계정입니다. 관리자에게 문의하세요." },
            403
          );
        }
        if (user.status === "pending") {
          return jsonResponse(
            { error: "관리자 가입 승인 대기 중인 계정입니다." },
            403
          );
        }

        touchUserLastLogin(user.id);
        const freshUser = getUserById(user.id) || user;
        const sessionToken = createSession(freshUser.id);
        recordAuditLog({
          actorId: freshUser.id,
          actorEmail: freshUser.email,
          action: "auth.login",
          detail: "로그인 성공",
        });

        return jsonResponse(
          {
            ok: true,
            token: sessionToken,
            user: toUserDto(freshUser),
          },
          200,
          { "Set-Cookie": makeSessionCookieHeader(sessionToken) }
        );
      } catch (err: any) {
        return jsonResponse({ error: err?.message || "로그인 실패" }, 400);
      }
    }

    if (req.method === "POST" && path === "/api/auth/send-code") {
      try {
        const clientIp = getClientIp(req);
        const ipWait = firstRateLimitWait([[authRateLimits.sendCodeIp, clientIp]]);
        if (ipWait) return tooManyRequestsResponse(ipWait);

        const body: any = await req.json();
        const email = String(body.email || "").trim().toLowerCase();
        const purpose = body.purpose === "reset" ? "reset" : "signup";

        if (!email || !email.includes("@") || email.length < 5) {
          return jsonResponse(
            { error: "유효한 이메일 주소를 입력해주세요." },
            400
          );
        }

        const emailWait = firstRateLimitWait([[authRateLimits.sendCodeEmail, email]]);
        if (emailWait) return tooManyRequestsResponse(emailWait);
        recordRateLimitHits([
          [authRateLimits.sendCodeIp, clientIp],
          [authRateLimits.sendCodeEmail, email],
        ]);

        if (purpose === "reset") {
          // Same answer, and no awaited mail send, whether or not the account exists,
          // so this endpoint cannot be used to discover who is registered.
          const resetUser = getUserByEmail(email);
          if (resetUser) {
            const code = createEmailVerificationCode(email, "reset", 10);
            sendResendVerificationEmail(email, code, "reset").catch((err) =>
              console.error("Password reset email failed:", err)
            );
            recordAuditLog({
              actorId: "anonymous",
              actorEmail: email,
              action: "auth.send_code.reset",
              detail: "이메일 인증번호 발송 요청",
            });
          }
          return jsonResponse({ ok: true, message: RESET_CODE_SENT_MESSAGE });
        }

        const settings = getSystemSettings();
        if (!settings.allow_public_signup) {
          return jsonResponse(
            {
              error:
                "현재 공개 회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.",
            },
            403
          );
        }
        if (getUserByEmail(email)) {
          return jsonResponse(
            { error: "이미 가입된 이메일 주소입니다." },
            400
          );
        }

        const code = createEmailVerificationCode(email, purpose, 10);
        await sendResendVerificationEmail(email, code, purpose);
        recordAuditLog({
          actorId: "anonymous",
          actorEmail: email,
          action: `auth.send_code.${purpose}`,
          detail: "이메일 인증번호 발송 완료",
        });

        return jsonResponse({
          ok: true,
          message: "이메일로 6자리 인증번호를 발송했습니다. (10분간 유효)",
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err?.message || "인증번호 발송에 실패했습니다." },
          400
        );
      }
    }

    if (req.method === "POST" && path === "/api/auth/reset-password") {
      try {
        const clientIp = getClientIp(req);
        const ipWait = firstRateLimitWait([[authRateLimits.resetIp, clientIp]]);
        if (ipWait) return tooManyRequestsResponse(ipWait);

        const body: any = await req.json();
        const email = String(body.email || "").trim().toLowerCase();
        const verificationCode = String(
          body.verificationCode || body.code || ""
        ).trim();
        const newPassword = String(body.newPassword || "");

        if (!email || !verificationCode) {
          return jsonResponse(
            { error: "이메일과 6자리 인증번호를 입력해주세요." },
            400
          );
        }
        if (!newPassword || newPassword.length < 6) {
          return jsonResponse(
            { error: "새 비밀번호는 최소 6자 이상이어야 합니다." },
            400
          );
        }

        const emailWait = firstRateLimitWait([[authRateLimits.resetEmail, email]]);
        if (emailWait) return tooManyRequestsResponse(emailWait);
        recordRateLimitHits([
          [authRateLimits.resetIp, clientIp],
          [authRateLimits.resetEmail, email],
        ]);

        // Unknown accounts get the same answer as a wrong code.
        const user = getUserByEmail(email);
        if (
          !user ||
          !verifyEmailVerificationCode(email, verificationCode, "reset", true)
        ) {
          return jsonResponse({ error: INVALID_CODE_MESSAGE }, 400);
        }

        updateUserPassword(user.id, newPassword);
        deleteAllUserSessions(user.id);
        recordAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: "account.password_reset",
          targetId: user.id,
          detail: "이메일 인증을 통한 비밀번호 재설정 완료",
        });

        return jsonResponse({
          ok: true,
          message: "비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.",
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err?.message || "비밀번호 재설정 실패" },
          400
        );
      }
    }

    if (req.method === "POST" && path === "/api/auth/register") {
      try {
        const settings = getSystemSettings();
        if (!settings.allow_public_signup) {
          return jsonResponse(
            {
              error:
                "현재 공개 회원가입이 비활성화되어 있습니다. 관리자에게 계정 생성을 요청하세요.",
            },
            403
          );
        }

        const body: any = await req.json();
        const email = String(body.email || "").trim().toLowerCase();
        const displayName = String(body.displayName || body.name || "").trim();
        const password = String(body.password || "");
        const verificationCode = String(
          body.verificationCode || body.code || ""
        ).trim();

        if (!email || !email.includes("@") || email.length < 5) {
          return jsonResponse({ error: "유효한 이메일 주소를 입력해주세요." }, 400);
        }
        if (!password || password.length < 6) {
          return jsonResponse(
            { error: "비밀번호는 최소 6자 이상이어야 합니다." },
            400
          );
        }

        const mustVerifyEmail =
          Boolean(process.env.RESEND_API_KEY) || Boolean(verificationCode);
        if (mustVerifyEmail) {
          if (!verificationCode) {
            return jsonResponse(
              { error: "이메일로 발송된 6자리 인증번호를 입력해주세요." },
              400
            );
          }
          if (
            !verifyEmailVerificationCode(email, verificationCode, "signup", true)
          ) {
            return jsonResponse(
              { error: "이메일 인증번호가 올바르지 않거나 만료되었습니다." },
              400
            );
          }
        }

        const initStatus = settings.default_require_approval
          ? "pending"
          : "active";
        const user = createUser({
          email,
          displayName: displayName || email.split("@")[0],
          password,
          role: settings.default_user_role,
          status: initStatus,
          canIngest: settings.default_user_role !== "viewer",
          canShare: settings.default_user_role !== "viewer",
          canUseServerKey: settings.default_can_use_server_key,
          quotaMb: settings.default_quota_mb,
        });

        recordAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.register",
          detail: `신규 가입 (역할: ${user.role}, 상태: ${user.status})`,
        });

        if (initStatus === "pending") {
          return jsonResponse(
            {
              ok: true,
              pendingApproval: true,
              message:
                "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
            },
            201
          );
        }

        touchUserLastLogin(user.id);
        const sessionToken = createSession(user.id);
        return jsonResponse(
          {
            ok: true,
            token: sessionToken,
            user: toUserDto(user),
          },
          201,
          { "Set-Cookie": makeSessionCookieHeader(sessionToken) }
        );
      } catch (err: any) {
        return jsonResponse({ error: err?.message || "회원가입 실패" }, 400);
      }
    }

    if (req.method === "POST" && path === "/api/auth/logout") {
      const tok = extractAuthToken(req, url);
      if (tok && tok.startsWith("ses_")) {
        deleteSession(tok);
      }
      return jsonResponse(
        { ok: true },
        200,
        { "Set-Cookie": makeSessionCookieHeader("", 0) }
      );
    }

    if (req.method === "GET" && path === "/api/auth/me") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      return jsonResponse({
        user: toUserDto(user),
      });
    }

    if (req.method === "POST" && path === "/api/auth/password") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      try {
        const body: any = await req.json();
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");

        if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
          return jsonResponse(
            { error: "현재 비밀번호가 일치하지 않습니다." },
            400
          );
        }
        if (!newPassword || newPassword.length < 6) {
          return jsonResponse(
            { error: "새 비밀번호는 최소 6자 이상이어야 합니다." },
            400
          );
        }
        if (currentPassword === newPassword) {
          return jsonResponse(
            { error: "기존 비밀번호와 다른 새 비밀번호를 입력해주세요." },
            400
          );
        }

        updateUserPassword(user.id, newPassword);
        const currentToken = extractAuthToken(req, url) || undefined;
        deleteAllUserSessions(
          user.id,
          currentToken?.startsWith("ses_") ? currentToken : undefined
        );
        recordAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: "account.password_change",
          targetId: user.id,
          detail: "본인 비밀번호 변경 완료 (타 기기 세션 만료 처리)",
        });
        return jsonResponse({
          ok: true,
          message: "비밀번호가 안전하게 변경되었습니다.",
        });
      } catch (err: any) {
        return jsonResponse(
          { error: err?.message || "비밀번호 변경 실패" },
          400
        );
      }
    }

    if (
      (req.method === "PATCH" || req.method === "POST") &&
      path === "/api/auth/profile"
    ) {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      try {
        const body: any = await req.json();
        const displayName = String(body.displayName || "").trim();
        if (!displayName) {
          return jsonResponse({ error: "표시할 이름을 입력해주세요." }, 400);
        }
        const updated = updateUserProfile(user.id, { displayName });
        recordAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: "account.profile_update",
          targetId: user.id,
          detail: `이름 변경: ${displayName}`,
        });
        return jsonResponse({
          ok: true,
          user: toUserDto(updated || user),
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || "프로필 수정 실패" }, 400);
      }
    }

    if (req.method === "POST" && path === "/api/auth/rotate-token") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      const apiToken = rotateUserApiToken(user.id);
      recordAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        action: "account.rotate_token",
        targetId: user.id,
        detail: "개인 API 토큰 재발급",
      });
      return jsonResponse({ ok: true, apiToken });
    }

    // 5b. Admin & CRM Console Routes: /api/admin/{overview,users,users/:id,settings}
    if (path.startsWith("/api/admin/")) {
      const adminUser = authenticateRequest(req);
      if (!adminUser) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      if (!isAdminUser(adminUser)) {
        return jsonResponse(
          { error: "관리자(Owner/Admin) 권한이 필요한 기능입니다." },
          403
        );
      }

      if (req.method === "GET" && path === "/api/admin/overview") {
        const users = listUsersCrmSummary();
        const settings = getSystemSettings();
        const recentLectures = listAllLecturesForAdmin(50).map((l) => ({
          ...toLectureSummaryDto(l),
          owner_id: l.owner_id,
          owner_email: l.owner_email,
          owner_name: l.owner_name,
        }));
        const auditLogs = listAuditLogs(60);

        const metrics = {
          totalUsers: users.length,
          activeUsers: users.filter((u) => u.status === "active").length,
          pendingUsers: users.filter((u) => u.status === "pending").length,
          suspendedUsers: users.filter((u) => u.status === "suspended").length,
          totalLectures: users.reduce((s, u) => s + u.lecture_count, 0),
          publicLectures: users.reduce((s, u) => s + u.public_count, 0),
          errorLectures: users.reduce((s, u) => s + u.error_count, 0),
          totalAudioBytes: users.reduce((s, u) => s + u.audio_bytes, 0),
        };

        return jsonResponse({
          ok: true,
          metrics,
          settings,
          users,
          recentLectures,
          auditLogs,
        });
      }

      if (req.method === "POST" && path === "/api/admin/users") {
        try {
          const body: any = await req.json();
          const email = String(body.email || "").trim().toLowerCase();
          const displayName = String(body.displayName || "").trim();
          const password = String(body.password || "");
          const role = body.role || "member";
          const status = body.status || "active";
          if (!isUserRole(role)) {
            return jsonResponse({ error: "유효하지 않은 역할입니다." }, 400);
          }
          if (!isUserStatus(status)) {
            return jsonResponse({ error: "유효하지 않은 계정 상태입니다." }, 400);
          }

          if (!email || email.length < 3) {
            return jsonResponse({ error: "아이디 또는 이메일을 입력해주세요." }, 400);
          }
          if (!password || password.length < 6) {
            return jsonResponse(
              { error: "초기 비밀번호는 6자 이상이어야 합니다." },
              400
            );
          }
          if (role === "owner" && adminUser.role !== "owner") {
            return jsonResponse(
              { error: "Owner 역할 부여는 Owner 계정만 수행할 수 있습니다." },
              403
            );
          }

          const created = createUser({
            email,
            displayName: displayName || email.split("@")[0],
            password,
            role,
            status,
            canIngest:
              typeof body.canIngest === "boolean"
                ? body.canIngest
                : role !== "viewer",
            canShare:
              typeof body.canShare === "boolean"
                ? body.canShare
                : role !== "viewer",
            canUseServerKey:
              typeof body.canUseServerKey === "boolean"
                ? body.canUseServerKey
                : true,
            quotaMb:
              typeof body.quotaMb === "number" ? body.quotaMb : 2048,
            memo: String(body.memo || ""),
          });

          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "admin.user_create",
            targetId: created.id,
            detail: `회원 생성: ${created.email} (역할: ${created.role})`,
          });

          return jsonResponse(
            { ok: true, user: toUserDto(created) },
            201
          );
        } catch (err: any) {
          return jsonResponse({ error: err?.message || "회원 생성 실패" }, 400);
        }
      }

      if (req.method === "PATCH" && path === "/api/admin/settings") {
        try {
          const body: any = await req.json();
          const updated = updateSystemSettings({
            allow_public_signup: body.allow_public_signup,
            default_user_role: body.default_user_role,
            default_require_approval: body.default_require_approval,
            default_can_use_server_key: body.default_can_use_server_key,
            default_quota_mb:
              typeof body.default_quota_mb === "number"
                ? body.default_quota_mb
                : undefined,
            storage_auto_compact: body.storage_auto_compact,
            storage_compact_bitrate_kbps: body.storage_compact_bitrate_kbps,
            audio_retention_days: body.audio_retention_days,
            failed_audio_retention_days: body.failed_audio_retention_days,
            audit_retention_days: body.audit_retention_days,
          });
          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "admin.settings_update",
            detail: `가입허용=${updated.allow_public_signup}, 기본역할=${updated.default_user_role}, 승인제=${updated.default_require_approval}, 기본쿼터=${updated.default_quota_mb}MB, 자동압축=${updated.storage_auto_compact}(${updated.storage_compact_bitrate_kbps}kbps), 오디오보존=${updated.audio_retention_days}일, 실패오디오보존=${updated.failed_audio_retention_days}일, 감사로그보존=${updated.audit_retention_days}일`,
          });
          return jsonResponse({ ok: true, settings: updated });
        } catch (err: any) {
          return jsonResponse({ error: err?.message || "정책 저장 실패" }, 400);
        }
      }

      if (req.method === "GET" && path === "/api/admin/ops") {
        return jsonResponse(buildOpsDto());
      }

      if (req.method === "GET" && path === "/api/admin/storage") {
        return jsonResponse(
          buildStorageStats({ settings: getSystemSettings(), jobs: countJobs("compact") })
        );
      }

      if (req.method === "GET" && path === "/api/admin/lectures") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const { total, rows } = searchLecturesForAdmin({
          status: url.searchParams.get("status") || undefined,
          q: url.searchParams.get("q") || undefined,
          ownerId: url.searchParams.get("owner") || undefined,
          limit,
          offset,
        });
        const lectures: AdminLectureDto[] = rows.map((l) => ({
          ...toLectureSummaryDto(l),
          owner_id: l.owner_id,
          owner_email: l.owner_email,
          owner_name: l.owner_name,
          audio_ext: l.audio_path ? extname(l.audio_path).toLowerCase() : "",
          compacted: l.audio_compact_state === "compacted",
          audio_original_size:
            l.audio_compact_state === "compacted" && l.audio_original_size
              ? l.audio_original_size
              : l.audio_size,
          error_message: l.error_message,
          source_client: l.source_client,
          job_state: getLectureJobState(l.id),
        }));
        const body: AdminLectureListDto = { ok: true, total, limit, offset, lectures };
        return jsonResponse(body);
      }

      if (req.method === "POST" && path === "/api/admin/storage/compact") {
        const body = ((await req.json().catch(() => ({}))) || {}) as CompactRequest;
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((x): x is string => typeof x === "string")
          : undefined;
        if (!body.all && !ids?.length) {
          return jsonResponse({ error: "압축할 강의(ids) 또는 all:true 를 지정해주세요." }, 400);
        }
        const settings = getSystemSettings();
        const candidates = listCompactionCandidates(body.all ? undefined : ids).filter(
          (c) => !isLectureBusy(c.id)
        );
        const candidateBytes = candidates.reduce((s, c) => s + (c.audio_size || 0), 0);
        const estimatedSavedBytes = candidates.reduce(
          (s, c) =>
            s +
            Math.max(
              0,
              c.audio_size -
                estimateCompactedBytes(
                  c.duration_sec,
                  c.audio_size,
                  settings.storage_compact_bitrate_kbps
                )
            ),
          0
        );
        const dryRun = Boolean(body.dryRun);
        let queued = 0;
        if (!dryRun) {
          if (!isFfmpegAvailable()) {
            return jsonResponse({ error: "서버에 ffmpeg가 없어 압축할 수 없습니다." }, 503);
          }
          for (const c of candidates) {
            if (scheduleCompaction(c.id, c.owner_id)) queued++;
          }
          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "storage.compact",
            detail: `오디오 압축 ${queued}건 대기열 추가 (${settings.storage_compact_bitrate_kbps}kbps, 예상 절감 ${Math.round(estimatedSavedBytes / 1048576)}MB)`,
          });
        }
        const response: CompactResponse = {
          ok: true,
          dryRun,
          candidates: candidates.length,
          queued,
          candidateBytes,
          estimatedSavedBytes,
        };
        return jsonResponse(response);
      }

      if (req.method === "POST" && path === "/api/admin/storage/gc") {
        const body: any = (await req.json().catch(() => ({}))) || {};
        const dryRun = Boolean(body.dryRun);
        const orphans = scanOrphanUploads();
        const bytes = orphans.reduce((s, f) => s + f.bytes, 0);
        const movedToTrash = dryRun ? 0 : moveToTrash(orphans);
        if (!dryRun) {
          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "storage.gc",
            detail: `고아 업로드 파일 ${movedToTrash}개 휴지통 이동 (${Math.round(bytes / 1048576)}MB)`,
          });
        }
        const response: GcResponse = {
          ok: true,
          dryRun,
          orphans: { count: orphans.length, bytes, files: orphans.slice(0, 50).map((f) => f.name) },
          movedToTrash,
        };
        return jsonResponse(response);
      }

      if (req.method === "POST" && path === "/api/admin/storage/retention") {
        const body: any = (await req.json().catch(() => ({}))) || {};
        const dryRun = Boolean(body.dryRun);
        const outcome = applyRetentionPolicies(getSystemSettings(), {
          dryRun,
          isBusy: (lectureId) => isLectureBusy(lectureId),
        });
        if (!dryRun) {
          broadcastRetentionOutcome(outcome);
          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "storage.retention",
            detail: `보존 정책 적용: 오디오 삭제 ${outcome.audioRemoved.length}건, 실패 강의 삭제 ${outcome.deleted.length}건`,
          });
        }
        const response: RetentionResponse = {
          ok: true,
          dryRun,
          retention: outcome.retention,
          failedRetention: outcome.failedRetention,
        };
        return jsonResponse(response);
      }

      if (req.method === "POST" && path === "/api/admin/maintenance/run") {
        const result = await runMaintenance({
          forceBackup: true,
          isBusy: (lectureId) => isLectureBusy(lectureId),
          onRetention: broadcastRetentionOutcome,
        });
        recordAuditLog({
          actorId: adminUser.id,
          actorEmail: adminUser.email,
          action: "ops.maintenance",
          detail: `수동 유지보수 실행 (세션 ${result.expiredSessions}, 고아 ${result.orphanFiles.count}, 백업 ${result.backup ? result.backup.file : "없음"}, 오류 ${result.errors.length})`,
        });
        return jsonResponse({ ok: true, result });
      }

      const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserMatch) {
        const targetId = decodeURIComponent(adminUserMatch[1]);
        const targetUser = getUserById(targetId);
        if (!targetUser) {
          return jsonResponse({ error: "대상 계정을 찾을 수 없습니다." }, 404);
        }

        if (req.method === "PATCH") {
          try {
            const body: any = await req.json();
            const nextRole = body.role || undefined;
            const nextStatus = body.status || undefined;
            if (nextRole !== undefined && !isUserRole(nextRole)) {
              return jsonResponse({ error: "유효하지 않은 역할입니다." }, 400);
            }
            if (nextStatus !== undefined && !isUserStatus(nextStatus)) {
              return jsonResponse({ error: "유효하지 않은 계정 상태입니다." }, 400);
            }
            // Only an owner may grant the owner role or touch an owner account
            // (which covers taking the role away).
            if (
              targetUser.role === "owner" &&
              adminUser.role !== "owner"
            ) {
              return jsonResponse(
                { error: "Owner 계정은 다른 Owner만 수정할 수 있습니다." },
                403
              );
            }
            if (nextRole === "owner" && adminUser.role !== "owner") {
              return jsonResponse(
                { error: "Owner 역할 부여는 Owner 계정만 수행할 수 있습니다." },
                403
              );
            }
            if (
              targetUser.id === adminUser.id &&
              ((nextStatus !== undefined && nextStatus !== "active") ||
                (nextRole !== undefined && nextRole !== targetUser.role))
            ) {
              return jsonResponse(
                {
                  error:
                    "본인 계정의 역할을 변경하거나 정지시킬 수 없습니다.",
                },
                400
              );
            }

            const updated = updateUserByAdmin(targetId, {
              displayName: body.displayName,
              role: nextRole,
              status: nextStatus,
              canIngest: body.canIngest,
              canShare: body.canShare,
              canUseServerKey: body.canUseServerKey,
              quotaMb:
                typeof body.quotaMb === "number" ? body.quotaMb : undefined,
              memo: body.memo,
              newPassword: body.newPassword,
              revokeSessions: body.revokeSessions,
            });

            recordAuditLog({
              actorId: adminUser.id,
              actorEmail: adminUser.email,
              action: "admin.user_update",
              targetId,
              detail: `${targetUser.email} 권한/CRM 수정 (role=${updated?.role}, status=${updated?.status}, ingest=${updated?.can_ingest}, share=${updated?.can_share}${body.newPassword ? ", 비번초기화" : ""})`,
            });

            return jsonResponse({
              ok: true,
              user: updated ? toUserDto(updated) : null,
            });
          } catch (err: any) {
            return jsonResponse({ error: err?.message || "회원 수정 실패" }, 400);
          }
        }

        if (req.method === "DELETE") {
          if (targetUser.id === adminUser.id) {
            return jsonResponse(
              { error: "본인 계정은 삭제할 수 없습니다." },
              400
            );
          }
          if (targetUser.role === "owner") {
            return jsonResponse(
              { error: "Owner 계정은 삭제할 수 없습니다." },
              400
            );
          }
          deleteUserAndData(targetId);
          recordAuditLog({
            actorId: adminUser.id,
            actorEmail: adminUser.email,
            action: "admin.user_delete",
            targetId,
            detail: `회원 및 소유 강의 삭제: ${targetUser.email}`,
          });
          return jsonResponse({ ok: true, deletedId: targetId });
        }
      }
    }

    // 6. iOS Shortcut Recipe Download
    if (req.method === "GET" && path === "/api/clients/ios-shortcut") {
      const user = authenticateRequest(req);
      return jsonResponse({
        name: "Lectern 강의 녹음 요약",
        endpoint: `${PUBLIC_BASE_URL}/api/ingest/shortcut`,
        method: "POST",
        headers: {
          "X-Lectern-Token": user ? user.api_token : "<내_계정_API_토큰>",
          "X-Course": "정보보호개론",
        },
        formField: "audio",
        openUrlOnComplete: `${PUBLIC_BASE_URL}/?lecture={{id}}`,
        instructions: [
          "1. iOS '단축어(Shortcuts)' 앱에서 새 단축어 생성",
          "2. '오디오 녹음' 또는 공유 시트에서 '오디오 파일' 입력 받기 추가",
          "3. 'URL 내용 가져오기' 액션 추가 → URL: https://lectern.qucord.com/api/ingest/shortcut, 메소드: POST, 헤더에 X-Lectern-Token 추가, 요청 본문: 폼(Form), 필드명 'audio'에 녹음 파일 연결",
          "4. '사전 값 가져오기'로 'url' 추출 후 'URL 열기' 액션 연결 → 내 계정에 노트가 저장되고 즉시 열립니다.",
        ],
      });
    }

    // 7. List Lectures (Requires Authentication; Strictly Scoped to User's Account)
    if (req.method === "GET" && path === "/api/lectures") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      if (isAdminUser(user)) {
        await syncLocalLecturesIfStale();
      }
      const course = url.searchParams.get("course") || undefined;
      const q = url.searchParams.get("q") || undefined;
      const all = listLecturesForUser(user.id);
      const courses = Array.from(new Set(all.map((l) => l.course)));
      const filtered = listLecturesForUser(user.id, course, q).map(toLectureSummaryDto);
      return jsonResponse({ lectures: filtered, courses });
    }

    // 7b. Batch Cleanup & Organization: POST /api/lectures/cleanup
    if (req.method === "POST" && path === "/api/lectures/cleanup") {
      const user = authenticateRequest(req);
      if (!user) {
        return jsonResponse({ error: "로그인이 필요합니다." }, 401);
      }
      const body: any = await req.json();
      const mode = body.mode;
      if (
        mode === "batch_visibility" &&
        body.isPublic === true &&
        !canSharePublicly(user)
      ) {
        return jsonResponse({ error: SHARE_RESTRICTED_MESSAGE }, 403);
      }
      const result = cleanupLecturesForUser(user.id, {
        mode,
        ids: body.ids,
        targetCourse: body.targetCourse,
        isPublic: body.isPublic,
      });

      if (
        mode === "failed" ||
        mode === "short_fragments" ||
        mode === "batch_delete"
      ) {
        if (result.affectedIds.length > 0) {
          broadcastLectureEvent(user.id, {
            type: "deleted",
            ids: result.affectedIds,
          });
        }
      } else {
        for (const id of result.affectedIds) {
          const updated = getLectureById(id);
          if (updated) {
            broadcastLectureEvent(user.id, {
              type: "updated",
              id,
              lecture: toLectureSummaryDto(updated),
            });
          }
        }
      }

      return jsonResponse({
        ok: true,
        affectedCount: result.affectedIds.length,
        affectedIds: result.affectedIds,
        reclaimedBytes: result.reclaimedBytes,
      });
    }

    // 8. Single Lecture Detail / Edit / Visibility / Retry / Delete / Audio / Markdown Download
    const lecMatch = path.match(
      /^\/api\/lectures\/([^/]+)(?:\/(audio|markdown|visibility|retry))?$/
    );
    if (
      lecMatch &&
      lecMatch[1] !== "ingest" &&
      lecMatch[1] !== "cleanup"
    ) {
      const id = decodeURIComponent(lecMatch[1]);
      const sub = lecMatch[2];
      const rec = getLectureById(id);
      if (!rec) {
        return jsonResponse({ error: "Lecture not found" }, 404);
      }

      const user = authenticateRequest(req);
      const shareParam = (url.searchParams.get("share") || "").trim();
      const hasValidShareToken =
        Boolean(shareParam) &&
        shareParam === rec.share_token &&
        rec.is_public === 1;
      const isOwner = Boolean(
        user && (user.id === rec.owner_id || isAdminUser(user))
      );

      if (
        !isOwner &&
        !(hasValidShareToken && (sub === "audio" || sub === "markdown"))
      ) {
        return jsonResponse(
          {
            error: user
              ? "접근 권한이 없는 강의 노트입니다."
              : "로그인이 필요합니다.",
          },
          user ? 403 : 401
        );
      }

      if (req.method === "GET" && !sub) {
        const rendered = renderMarkdownToHtml(rec.markdown || "");
        const displayDateLabel =
          rec.date_label && rec.date_label.length > 10
            ? rec.date_label
            : formatKstTimestamp(rec.created_at).fullLabel;
        return jsonResponse({
          lecture: {
            ...rec,
            date_label: displayDateLabel,
            is_public: Boolean(rec.is_public),
            has_audio: Boolean(rec.audio_path && existsSync(rec.audio_path)),
          },
          rendered,
        });
      }

      if (req.method === "GET" && sub === "markdown") {
        const safeName = `${rec.course}_${rec.date_label}.md`.replace(
          /[^\w가-힣._-]/g,
          "_"
        );
        return new Response(rec.markdown + "\n", {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
              safeName
            )}`,
          },
        });
      }

      if (req.method === "GET" && sub === "audio") {
        if (!rec.audio_path || !existsSync(rec.audio_path)) {
          return jsonResponse({ error: "Audio file not found" }, 404);
        }
        return serveAudioWithRange(req, rec.audio_path);
      }

      if (req.method === "DELETE" && sub === "audio") {
        if (!isOwner) {
          return jsonResponse({ error: "권한이 없습니다." }, 403);
        }
        const res = deleteLectureAudioOnly(id);
        if (res.lecture) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(res.lecture),
          });
        }
        return jsonResponse({
          ok: res.ok,
          reclaimedBytes: res.reclaimedBytes,
          lecture: res.lecture
            ? {
                ...res.lecture,
                is_public: Boolean(res.lecture.is_public),
                has_audio: false,
              }
            : null,
        });
      }

      if (req.method === "POST" && sub === "retry") {
        if (!isOwner) {
          return jsonResponse({ error: "재분석 권한이 없습니다." }, 403);
        }
        if (isLectureBusy(id)) {
          return jsonResponse({ error: LECTURE_BUSY_MESSAGE }, 409);
        }
        if (!rec.audio_path || !existsSync(rec.audio_path)) {
          return jsonResponse(
            { error: "서버에 보존된 원본 오디오 파일이 없어 재분석할 수 없습니다." },
            400
          );
        }
        // Without a caller-supplied key the retry runs on the server key, which both the
        // requester and the lecture's owner must be allowed to use.
        const retryApiKey =
          (req.headers.get("x-gemini-key") || "").trim() || undefined;
        if (
          !retryApiKey &&
          (!canUseServerKey(user) || !canUseServerKey(getUserById(rec.owner_id)))
        ) {
          return jsonResponse({ error: SERVER_KEY_RESTRICTED_MESSAGE }, 403);
        }
        const reset = resetLectureForRetry(id);
        if (reset) {
          broadcastLectureEvent(rec.owner_id, {
            type: "progress",
            id,
            stage: reset.stage,
            stage_message: reset.stage_message,
            progress: reset.progress,
            lecture: toLectureSummaryDto(reset),
          });
        }
        void enqueueDistillation(id, rec.owner_id, {
          audioPath: rec.audio_path,
          course: rec.course,
          title: rec.title,
          model: rec.model_requested || DEFAULT_GEMINI_MODEL,
          apiKey: retryApiKey,
        });
        return jsonResponse({
          ok: true,
          lecture: reset ? toLectureSummaryDto(reset) : null,
        });
      }

      if ((req.method === "PATCH" || req.method === "POST") && sub === "visibility") {
        if (!isOwner && !isAdminUser(user)) {
          return jsonResponse({ error: "수정 권한이 없습니다." }, 403);
        }
        const body: any = await req.json();
        const nextPublic =
          typeof body.is_public === "boolean"
            ? body.is_public
            : !Boolean(rec.is_public);
        if (nextPublic && !canSharePublicly(user)) {
          return jsonResponse({ error: SHARE_RESTRICTED_MESSAGE }, 403);
        }
        const updated = setLectureVisibility(
          id,
          nextPublic,
          Boolean(body.rotate_token)
        );
        if (updated) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(updated),
          });
        }
        return jsonResponse({
          ok: true,
          lecture: updated
            ? {
                ...updated,
                is_public: Boolean(updated.is_public),
                has_audio: Boolean(
                  updated.audio_path && existsSync(updated.audio_path)
                ),
              }
            : null,
        });
      }

      if (req.method === "PUT" && !sub) {
        if (!isOwner) {
          return jsonResponse({ error: "수정 권한이 없습니다." }, 403);
        }
        const body: any = await req.json();
        if (body.is_public === true && !canSharePublicly(user)) {
          return jsonResponse({ error: SHARE_RESTRICTED_MESSAGE }, 403);
        }
        const updated = updateLectureMarkdown(
          id,
          String(body.title || rec.title),
          String(body.course || rec.course),
          String(body.markdown ?? rec.markdown),
          typeof body.is_public === "boolean" ? body.is_public : undefined
        );
        if (updated) {
          broadcastLectureEvent(rec.owner_id, {
            type: "updated",
            id,
            lecture: toLectureSummaryDto(updated),
          });
        }
        return jsonResponse({
          lecture: updated
            ? {
                ...updated,
                is_public: Boolean(updated.is_public),
                has_audio: Boolean(
                  updated.audio_path && existsSync(updated.audio_path)
                ),
              }
            : null,
        });
      }

      if (req.method === "DELETE" && !sub) {
        if (!isOwner) {
          return jsonResponse({ error: "삭제 권한이 없습니다." }, 403);
        }
        deleteLectureById(id);
        broadcastLectureEvent(rec.owner_id, {
          type: "deleted",
          id,
          ids: [id],
        });
        return jsonResponse({ ok: true, deletedId: id });
      }
    }

    // 9. Async Web/Native Ingest: POST /api/lectures/ingest
    if (req.method === "POST" && path === "/api/lectures/ingest") {
      try {
        const accepted = await acceptIngestUpload(req, "로그인이 필요합니다.");
        if ("response" in accepted) return accepted.response;
        const { user, incoming } = accepted;

        // Idempotent Upload Deduplication: if this exact audio was already uploaded by this user
        const existing = getLectureByAudioSha256(user.id, incoming.audioSha256);
        if (existing) {
          if (
            existing.status === "error" &&
            existing.audio_path &&
            existsSync(existing.audio_path) &&
            !isLectureBusy(existing.id)
          ) {
            const retried = resetLectureForRetry(existing.id);
            void enqueueDistillation(existing.id, user.id, {
              audioPath: existing.audio_path,
              course: existing.course,
              title: existing.title,
              model: incoming.model || existing.model_requested,
              apiKey: incoming.apiKey,
            });
            return jsonResponse({
              ok: true,
              deduplicated: true,
              retried: true,
              lecture: toLectureSummaryDto(retried || existing),
              url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
              shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            });
          }
          return jsonResponse({
            ok: true,
            deduplicated: true,
            lecture: toLectureSummaryDto(existing),
            url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
          });
        }

        const audioPath = await storeIncomingAudio(incoming);
        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          ownerId: user.id,
          title: incoming.title,
          course: incoming.course,
          audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          audioSha256: incoming.audioSha256,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient,
        });

        broadcastLectureEvent(user.id, {
          type: "created",
          id,
          lecture: toLectureSummaryDto(pending),
        });

        void enqueueDistillation(id, user.id, {
          audioPath,
          course: incoming.course,
          title: incoming.title,
          model: incoming.model,
          apiKey: incoming.apiKey,
        });

        return jsonResponse({
          ok: true,
          lecture: toLectureSummaryDto(pending),
          url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
          shareUrl: `${PUBLIC_BASE_URL}/s/${pending.share_token}`,
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || String(err) }, 400);
      }
    }

    // 10. Quick-Action / iOS Shortcut / Menu Bar / Android Tile Ingest: POST /api/ingest/shortcut
    if (req.method === "POST" && path === "/api/ingest/shortcut") {
      try {
        const waitComplete = url.searchParams.get("wait") !== "false";
        const accepted = await acceptIngestUpload(
          req,
          "인증 토큰(X-Lectern-Token 또는 로그인 세션)이 필요합니다."
        );
        if ("response" in accepted) return accepted.response;
        const { user, incoming } = accepted;

        const existing = getLectureByAudioSha256(user.id, incoming.audioSha256);
        if (existing) {
          if (
            existing.status === "error" &&
            existing.audio_path &&
            existsSync(existing.audio_path) &&
            !isLectureBusy(existing.id)
          ) {
            const retried = resetLectureForRetry(existing.id);
            void enqueueDistillation(existing.id, user.id, {
              audioPath: existing.audio_path,
              course: existing.course,
              title: existing.title,
              model: incoming.model || existing.model_requested,
              apiKey: incoming.apiKey,
            });
            return jsonResponse({
              ok: true,
              deduplicated: true,
              retried: true,
              id: existing.id,
              status: "processing",
              lecture: toLectureSummaryDto(retried || existing),
              url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
              shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            });
          }
          return jsonResponse({
            ok: true,
            deduplicated: true,
            id: existing.id,
            status: existing.status,
            lecture: toLectureSummaryDto(existing),
            url: `${PUBLIC_BASE_URL}/?lecture=${existing.id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${existing.share_token}`,
            markdown: existing.markdown,
          });
        }

        const audioPath = await storeIncomingAudio(incoming);
        const id = generateId("lec");
        const pending = createPendingLecture({
          id,
          ownerId: user.id,
          title: incoming.title,
          course: incoming.course,
          audioPath,
          audioMime: incoming.audioMime,
          audioSize: incoming.audioSize,
          audioSha256: incoming.audioSha256,
          modelRequested: incoming.model,
          sourceClient: incoming.sourceClient || "shortcut",
        });

        broadcastLectureEvent(user.id, {
          type: "created",
          id,
          lecture: toLectureSummaryDto(pending),
        });

        if (!waitComplete) {
          void enqueueDistillation(id, user.id, {
            audioPath,
            course: incoming.course,
            title: incoming.title,
            model: incoming.model,
            apiKey: incoming.apiKey,
          });

          return jsonResponse({
            ok: true,
            id,
            status: "processing",
            lecture: toLectureSummaryDto(pending),
            url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
            shareUrl: `${PUBLIC_BASE_URL}/s/${pending.share_token}`,
          });
        }

        // Same queue as every other distillation, so blocking clients cannot exceed the
        // concurrency limit; the job itself records success/failure and emits SSE events.
        const outcome = await enqueueDistillation(id, user.id, {
          audioPath,
          course: incoming.course,
          title: incoming.title,
          model: incoming.model,
          apiKey: incoming.apiKey,
        });
        const done = getLectureById(id);
        if (!outcome.ok || !done || done.status !== "done") {
          return jsonResponse(
            {
              ok: false,
              id,
              status: done?.status ?? "error",
              error: outcome.error || done?.error_message || "노트 생성에 실패했습니다.",
              url: `${PUBLIC_BASE_URL}/?lecture=${id}`,
            },
            502
          );
        }

        return jsonResponse({
          ok: true,
          id: done.id,
          title: done.title,
          course: done.course,
          modelUsed: done.model_used,
          excerpt: done.excerpt,
          url: `${PUBLIC_BASE_URL}/?lecture=${done.id}`,
          shareUrl: `${PUBLIC_BASE_URL}/s/${done.share_token}`,
          markdown: done.markdown,
        });
      } catch (err: any) {
        return jsonResponse({ error: err?.message || String(err) }, 400);
      }
    }

    return jsonResponse({ error: "Not Found" }, 404);
}

if (import.meta.main) {
  const logRequests = process.env.LECTERN_LOG_REQUESTS !== "0";
  const shutdownGraceMs =
    Math.max(0, Number(process.env.LECTERN_SHUTDOWN_GRACE_SEC ?? 20) || 0) * 1000;

  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    maxRequestBodySize: 250 * 1024 * 1024, // 250 MB
    idleTimeout: 255,
    async fetch(req) {
      const started = performance.now();
      const res = await handleRequest(req);
      if (logRequests) {
        const url = new URL(req.url);
        // Health probes run every few seconds during deploys; only log them when unhealthy.
        if (url.pathname !== "/api/health" || res.status !== 200) {
          const ms = Math.round(performance.now() - started);
          console.log(`${res.status} ${req.method} ${redactUrlForLog(url)} ${ms}ms`);
        }
      }
      return res;
    },
  });

  isFfmpegAvailable(); // logs a warning at boot when compaction cannot run

  const runScheduledMaintenance = () => {
    runMaintenance({
      isBusy: (lectureId) => isLectureBusy(lectureId),
      onRetention: broadcastRetentionOutcome,
    })
      .then((r) => {
        if (r.errors.length || r.orphanFiles.count || r.backup || r.retention.count || r.failedRetention.count) {
          console.log(
            `Maintenance: sessions -${r.expiredSessions}, codes -${r.expiredCodes}, audit -${r.prunedAuditLogs}, orphans→trash ${r.orphanFiles.count}, retention ${r.retention.count}/${r.failedRetention.count}, backup ${r.backup?.file ?? "-"}, errors ${r.errors.length}`
          );
        }
      })
      .catch((err) => console.error("Maintenance failed:", err));
  };
  setTimeout(runScheduledMaintenance, 2 * 60_000).unref();
  setInterval(runScheduledMaintenance, MAINTENANCE_INTERVAL_MIN * 60_000).unref();

  // Graceful shutdown (SIGTERM from systemd, Ctrl-C, or a CD deploy): keep serving while
  // running jobs get a grace period (new jobs are not started; their rows stay
  // 'processing' and are resumed on the next boot), then close SSE streams and exit.
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutting down (${reason})...`);
    const drained = await drainJobs(shutdownGraceMs);
    if (!drained) {
      console.warn("Jobs still running at shutdown; they will be resumed on the next boot.");
    }
    closeAllSseStreams();
    await Promise.race([server.stop(), new Promise((r) => setTimeout(r, 5000))]);
    try {
      db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
    } catch {
      // ignore
    }
    process.exit(0);
  };
  restartHandler = (reason) => void shutdown(reason);
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(
    `🚀 Lectern Bun Server listening on http://127.0.0.1:${server.port} (sha ${BOOT_GIT_SHA.slice(0, 7)})`
  );
}
