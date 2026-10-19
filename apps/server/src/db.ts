import { Database } from "bun:sqlite";
import {
  copyFileSync,
  linkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  extractExcerpt,
  probeAudioDuration,
} from "../../../packages/core/src/index.ts";
import { config, readSecret } from "@lectern/config";
import { runMigrations } from "@lectern/db";
import { BlobStore, deleteArtifactsForJobs } from "@lectern/harness";
import { ensurePrivateDir, hardenPrivateTree, makePrivate } from "./fsperm.ts";
import { logger } from "./log.ts";

export const USER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export const USER_STATUSES = ["active", "pending", "suspended"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (USER_ROLES as readonly unknown[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return (USER_STATUSES as readonly unknown[]).includes(value);
}

function assertValidRoleAndStatus(role: unknown, status: unknown): void {
  if (role !== undefined && !isUserRole(role)) {
    throw new Error(`유효하지 않은 역할입니다: ${String(role)}`);
  }
  if (status !== undefined && !isUserStatus(status)) {
    throw new Error(`유효하지 않은 계정 상태입니다: ${String(status)}`);
  }
}

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  api_token: string;
  is_admin: number;
  role: UserRole;
  status: UserStatus;
  can_ingest: number;
  can_share: number;
  can_use_server_key: number;
  quota_mb: number;
  memo: string;
  last_login_at: string | null;
  created_at: string;
}

export interface SystemSettings {
  allow_public_signup: boolean;
  default_user_role: "member" | "viewer";
  default_require_approval: boolean;
  default_can_use_server_key: boolean;
  default_quota_mb: number;
  /** Re-encode finished lectures' audio to speech-tuned mono AAC (.m4a). */
  storage_auto_compact: boolean;
  storage_compact_bitrate_kbps: number;
  /** Days after which done lectures lose their audio (notes are kept). 0 = off. */
  audio_retention_days: number;
  /** Days after which failed lectures (no notes) are deleted with their audio. 0 = off. */
  failed_audio_retention_days: number;
  /** Days of audit log history kept. 0 = forever. */
  audit_retention_days: number;
}

export const COMPACT_BITRATE_MIN_KBPS = 24;
export const COMPACT_BITRATE_MAX_KBPS = 96;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readDays(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export interface AuditLogRecord {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_id: string;
  detail: string;
  created_at: string;
}

export interface UserCrmRow {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  role: "owner" | "admin" | "member" | "viewer";
  status: "active" | "pending" | "suspended";
  can_ingest: boolean;
  can_share: boolean;
  can_use_server_key: boolean;
  quota_mb: number;
  memo: string;
  last_login_at: string | null;
  created_at: string;
  lecture_count: number;
  public_count: number;
  error_count: number;
  audio_bytes: number;
  session_count: number;
}

export interface LectureRecord {
  id: string;
  owner_id: string;
  share_token: string;
  is_public: number;
  title: string;
  course: string;
  date_label: string;
  status: "processing" | "done" | "error";
  stage: string;
  stage_message: string;
  progress: number;
  markdown: string;
  excerpt: string;
  audio_path: string | null;
  audio_mime: string | null;
  audio_size: number;
  audio_sha256?: string | null;
  /** Size of the upload before compaction (0 until the lecture is compacted). */
  audio_original_size?: number;
  /** null = not processed yet, 'compacted' = re-encoded copy kept, 'skipped' = not worth it. */
  audio_compact_state?: "compacted" | "skipped" | null;
  audio_compacted_at?: string | null;
  duration_sec: number;
  model_requested: string;
  model_used: string;
  source_client: string;
  error_message: string | null;
  md_source_path: string | null;
  created_at: string;
  updated_at: string;
}

// Both are absolute (see @lectern/config), so stored audio paths and the uploads/ prefix
// checks in storage.ts agree. Production sets them explicitly in the systemd unit.
const DATA_DIR = config().dataDir;
const LECTURES_ROOT = config().lecturesDir;
/** packages/harness blob store: stage artifacts, i.e. copies of audio, transcripts and notes. */
export const HARNESS_BLOB_DIR = join(DATA_DIR, "blobs");
const harnessBlobs = new BlobStore(HARNESS_BLOB_DIR); // creates its directories on first write

// Owner-only from the first write (see fsperm.ts); files left readable by older releases
// are fixed here, before the database and its -wal/-shm files are opened.
ensurePrivateDir(DATA_DIR);
ensurePrivateDir(join(DATA_DIR, "uploads"));
const tightened = hardenPrivateTree(DATA_DIR);
if (tightened.changed || tightened.failed) {
  logger.info("restricted data dir permissions to the owner", { path: DATA_DIR, ...tightened });
}

const dbPath = join(DATA_DIR, "lectern.sqlite");
export const db = new Database(dbPath, { create: true });
// A new database file gets the process umask; SQLite then gives -wal/-shm the same mode.
makePrivate(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    api_token TEXT UNIQUE NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deleted_sources (
    md_source_path TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lectures (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL DEFAULT '',
    share_token TEXT UNIQUE NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    date_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'done',
    stage TEXT NOT NULL DEFAULT 'done',
    stage_message TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 100,
    markdown TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    audio_path TEXT,
    audio_mime TEXT,
    audio_size INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    model_requested TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    model_used TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    source_client TEXT NOT NULL DEFAULT 'web',
    error_message TEXT,
    md_source_path TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lectures_course ON lectures(course);
  CREATE INDEX IF NOT EXISTS idx_lectures_created ON lectures(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lectures_share ON lectures(share_token);
`);

// Schema migrations for existing users & lectures tables
try {
  const userCols = db.query(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "role")) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`);
  }
  if (!userCols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!userCols.some((c) => c.name === "can_ingest")) {
    db.exec(`ALTER TABLE users ADD COLUMN can_ingest INTEGER NOT NULL DEFAULT 1`);
  }
  if (!userCols.some((c) => c.name === "can_share")) {
    db.exec(`ALTER TABLE users ADD COLUMN can_share INTEGER NOT NULL DEFAULT 1`);
  }
  if (!userCols.some((c) => c.name === "can_use_server_key")) {
    db.exec(`ALTER TABLE users ADD COLUMN can_use_server_key INTEGER NOT NULL DEFAULT 1`);
  }
  if (!userCols.some((c) => c.name === "quota_mb")) {
    db.exec(`ALTER TABLE users ADD COLUMN quota_mb INTEGER NOT NULL DEFAULT 2048`);
  }
  if (!userCols.some((c) => c.name === "memo")) {
    db.exec(`ALTER TABLE users ADD COLUMN memo TEXT NOT NULL DEFAULT ''`);
  }
  if (!userCols.some((c) => c.name === "last_login_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS email_verifications (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'signup',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (email, purpose)
    );
  `);

  const verificationCols = db
    .query(`PRAGMA table_info(email_verifications)`)
    .all() as Array<{ name: string }>;
  if (!verificationCols.some((c) => c.name === "attempts")) {
    db.exec(
      `ALTER TABLE email_verifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`
    );
  }

  const cols = db.query(`PRAGMA table_info(lectures)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "owner_id")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "is_public")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "audio_sha256")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN audio_sha256 TEXT`);
  }
  if (!cols.some((c) => c.name === "audio_original_size")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN audio_original_size INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "audio_compact_state")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN audio_compact_state TEXT`);
  }
  if (!cols.some((c) => c.name === "audio_compacted_at")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN audio_compacted_at TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lectures_owner ON lectures(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lectures_sha256 ON lectures(owner_id, audio_sha256)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lectures_status ON lectures(status, updated_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
} catch (err) {
  // Every step above is idempotent, so a failure here is a real schema problem: say so
  // instead of booting silently against a half-migrated database.
  logger.error("database migration failed", { err });
}

// v2 schema: versioned Drizzle migrations (packages/db). A failure throws and aborts the
// boot, so the CD preflight, which migrates a copy of the live database, catches it before
// the running server is restarted.
{
  const migration = runMigrations(db, { backupDir: join(DATA_DIR, "backups") });
  if (migration.applied.length) {
    logger.info("applied migrations", { applied: migration.applied, backup: migration.backup });
  }
}

export function formatKstTimestamp(input?: string | Date): {
  fullLabel: string;
  shortLabel: string;
  fileStamp: string;
} {
  const d = input ? new Date(input) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const kstMs = valid.getTime() + 9 * 60 * 60 * 1000;
  const kstIso = new Date(kstMs).toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ in KST
  const yyyyMmDd = kstIso.slice(0, 10);
  const hhMmSs = kstIso.slice(11, 19);
  const mmDd = yyyyMmDd.slice(5).replace("-", "/");
  return {
    fullLabel: `${yyyyMmDd} ${hhMmSs}`,
    shortLabel: `${mmDd} ${hhMmSs}`,
    fileStamp: `${yyyyMmDd.replace(/-/g, "")}_${hhMmSs.replace(/:/g, "")}`,
  };
}

export function generateId(prefix = "lec"): string {
  const uuid = randomUUID();
  return prefix === "lec" ? uuid : `${prefix}_${uuid}`;
}

export function generateShareToken(seed?: string): string {
  if (seed) {
    return createHash("sha256").update(seed).digest("base64url").slice(0, 14);
  }
  return randomBytes(12).toString("base64url");
}

export function generateApiToken(): string {
  return `lct_${randomBytes(20).toString("base64url")}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derivedBuf = scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return timingSafeEqual(keyBuf, derivedBuf);
}

// MARK: - User & Session Management

export function getUserByEmail(email: string): UserRecord | null {
  const norm = email.trim().toLowerCase();
  return db
    .query(`SELECT * FROM users WHERE lower(email) = ?`)
    .get(norm) as UserRecord | null;
}

export function getUserById(id: string): UserRecord | null {
  return db.query(`SELECT * FROM users WHERE id = ?`).get(id) as UserRecord | null;
}

export function getUserByApiToken(apiToken: string): UserRecord | null {
  if (!apiToken) return null;
  return db
    .query(`SELECT * FROM users WHERE api_token = ?`)
    .get(apiToken.trim()) as UserRecord | null;
}

export function createUser(input: {
  email: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
  role?: UserRole;
  status?: UserStatus;
  canIngest?: boolean;
  canShare?: boolean;
  canUseServerKey?: boolean;
  quotaMb?: number;
  memo?: string;
  fixedApiToken?: string;
}): UserRecord {
  assertValidRoleAndStatus(input.role || undefined, input.status || undefined);
  const normEmail = input.email.trim().toLowerCase();
  const existing = getUserByEmail(normEmail);
  if (existing) {
    throw new Error("이미 등록된 이메일(아이디)입니다.");
  }

  const id = generateId("usr");
  const now = new Date().toISOString();
  const passwordHash = hashPassword(input.password);
  const apiToken = input.fixedApiToken || generateApiToken();
  const role = input.role || (input.isAdmin ? "admin" : "member");
  const isAdmin = input.isAdmin || role === "owner" || role === "admin" ? 1 : 0;
  const status = input.status || "active";
  const canIngest =
    typeof input.canIngest === "boolean"
      ? input.canIngest
        ? 1
        : 0
      : role === "viewer"
      ? 0
      : 1;
  const canShare =
    typeof input.canShare === "boolean"
      ? input.canShare
        ? 1
        : 0
      : role === "viewer"
      ? 0
      : 1;
  const canUseServerKey =
    typeof input.canUseServerKey === "boolean"
      ? input.canUseServerKey
        ? 1
        : 0
      : 1;
  const quotaMb = typeof input.quotaMb === "number" ? input.quotaMb : 2048;
  const memo = (input.memo || "").trim();

  db.query(
    `INSERT INTO users (
      id, email, display_name, password_hash, api_token, is_admin,
      role, status, can_ingest, can_share, can_use_server_key, quota_mb, memo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normEmail,
    input.displayName.trim() || normEmail.split("@")[0],
    passwordHash,
    apiToken,
    isAdmin,
    role,
    status,
    canIngest,
    canShare,
    canUseServerKey,
    quotaMb,
    memo,
    now
  );

  return getUserById(id)!;
}

export function updateUserPassword(userId: string, newPassword: string): void {
  const passwordHash = hashPassword(newPassword);
  db.query(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    passwordHash,
    userId
  );
}

export function updateUserProfile(
  userId: string,
  input: { displayName?: string }
): UserRecord | null {
  if (typeof input.displayName === "string" && input.displayName.trim()) {
    db.query(`UPDATE users SET display_name = ? WHERE id = ?`).run(
      input.displayName.trim(),
      userId
    );
  }
  return getUserById(userId);
}

export function touchUserLastLogin(userId: string): void {
  db.query(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    userId
  );
}

export function deleteAllUserSessions(
  userId: string,
  exceptToken?: string
): void {
  if (exceptToken) {
    db.query(`DELETE FROM sessions WHERE user_id = ? AND token != ?`).run(
      userId,
      exceptToken
    );
  } else {
    db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }
}

export function rotateUserApiToken(userId: string): string {
  const newToken = generateApiToken();
  db.query(`UPDATE users SET api_token = ? WHERE id = ?`).run(newToken, userId);
  return newToken;
}

export function getSystemSettings(): SystemSettings {
  const rows = db
    .query(`SELECT key, value FROM system_settings`)
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    allow_public_signup: map.get("allow_public_signup") !== "0",
    default_user_role:
      map.get("default_user_role") === "viewer" ? "viewer" : "member",
    default_require_approval: map.get("default_require_approval") === "1",
    default_can_use_server_key: map.get("default_can_use_server_key") !== "0",
    default_quota_mb: Number(map.get("default_quota_mb") ?? "2048") || 2048,
    storage_auto_compact: map.get("storage_auto_compact") !== "0",
    storage_compact_bitrate_kbps: clampInt(
      Number(map.get("storage_compact_bitrate_kbps") ?? 40) || 40,
      COMPACT_BITRATE_MIN_KBPS,
      COMPACT_BITRATE_MAX_KBPS
    ),
    audio_retention_days: readDays(map.get("audio_retention_days"), 0),
    failed_audio_retention_days: readDays(map.get("failed_audio_retention_days"), 0),
    audit_retention_days: readDays(map.get("audit_retention_days"), 180),
  };
}

function nextDays(value: unknown, current: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(36500, Math.round(value))
    : current;
}

export function updateSystemSettings(
  patch: Partial<SystemSettings>
): SystemSettings {
  const cur = getSystemSettings();
  const next: SystemSettings = {
    allow_public_signup:
      typeof patch.allow_public_signup === "boolean"
        ? patch.allow_public_signup
        : cur.allow_public_signup,
    default_user_role:
      patch.default_user_role === "viewer" ||
      patch.default_user_role === "member"
        ? patch.default_user_role
        : cur.default_user_role,
    default_require_approval:
      typeof patch.default_require_approval === "boolean"
        ? patch.default_require_approval
        : cur.default_require_approval,
    default_can_use_server_key:
      typeof patch.default_can_use_server_key === "boolean"
        ? patch.default_can_use_server_key
        : cur.default_can_use_server_key,
    default_quota_mb:
      typeof patch.default_quota_mb === "number" && patch.default_quota_mb >= 0
        ? Math.round(patch.default_quota_mb)
        : cur.default_quota_mb,
    storage_auto_compact:
      typeof patch.storage_auto_compact === "boolean"
        ? patch.storage_auto_compact
        : cur.storage_auto_compact,
    storage_compact_bitrate_kbps:
      typeof patch.storage_compact_bitrate_kbps === "number" &&
      Number.isFinite(patch.storage_compact_bitrate_kbps)
        ? clampInt(
            patch.storage_compact_bitrate_kbps,
            COMPACT_BITRATE_MIN_KBPS,
            COMPACT_BITRATE_MAX_KBPS
          )
        : cur.storage_compact_bitrate_kbps,
    audio_retention_days: nextDays(patch.audio_retention_days, cur.audio_retention_days),
    failed_audio_retention_days: nextDays(
      patch.failed_audio_retention_days,
      cur.failed_audio_retention_days
    ),
    audit_retention_days: nextDays(patch.audit_retention_days, cur.audit_retention_days),
  };
  const now = new Date().toISOString();
  const upsert = db.query(
    `INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`
  );
  upsert.run("allow_public_signup", next.allow_public_signup ? "1" : "0", now);
  upsert.run("default_user_role", next.default_user_role, now);
  upsert.run(
    "default_require_approval",
    next.default_require_approval ? "1" : "0",
    now
  );
  upsert.run(
    "default_can_use_server_key",
    next.default_can_use_server_key ? "1" : "0",
    now
  );
  upsert.run("default_quota_mb", String(next.default_quota_mb), now);
  upsert.run("storage_auto_compact", next.storage_auto_compact ? "1" : "0", now);
  upsert.run(
    "storage_compact_bitrate_kbps",
    String(next.storage_compact_bitrate_kbps),
    now
  );
  upsert.run("audio_retention_days", String(next.audio_retention_days), now);
  upsert.run(
    "failed_audio_retention_days",
    String(next.failed_audio_retention_days),
    now
  );
  upsert.run("audit_retention_days", String(next.audit_retention_days), now);
  return getSystemSettings();
}

export function recordAuditLog(input: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  detail?: string;
}): void {
  db.query(
    `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId("audlog"),
    input.actorId,
    input.actorEmail,
    input.action,
    input.targetId || "",
    input.detail || "",
    new Date().toISOString()
  );
}

export function listAuditLogs(limit = 50): AuditLogRecord[] {
  return db
    .query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AuditLogRecord[];
}

export function getUserStorageUsageBytes(userId: string): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(audio_size), 0) AS total_bytes FROM lectures WHERE owner_id = ?`
    )
    .get(userId) as { total_bytes: number } | null;
  return row?.total_bytes || 0;
}

export function listUsersCrmSummary(): UserCrmRow[] {
  // One pass over lectures and sessions instead of two queries per user.
  const users = db
    .query(
      `SELECT u.*,
         COALESCE(l.lecture_count, 0) AS lecture_count,
         COALESCE(l.public_count, 0) AS public_count,
         COALESCE(l.error_count, 0) AS error_count,
         COALESCE(l.audio_bytes, 0) AS audio_bytes,
         COALESCE(s.session_count, 0) AS session_count
       FROM users u
       LEFT JOIN (
         SELECT owner_id,
           COUNT(*) AS lecture_count,
           SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS public_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
           SUM(audio_size) AS audio_bytes
         FROM lectures GROUP BY owner_id
       ) l ON l.owner_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS session_count
         FROM sessions WHERE expires_at > ? GROUP BY user_id
       ) s ON s.user_id = u.id
       ORDER BY u.is_admin DESC, u.created_at ASC`
    )
    .all(new Date().toISOString()) as Array<
    UserRecord & {
      lecture_count: number;
      public_count: number;
      error_count: number;
      audio_bytes: number;
      session_count: number;
    }
  >;
  return users.map((u) => {
    const role = (u.role || (u.is_admin ? "owner" : "member")) as UserRole;
    const status = (u.status || "active") as UserStatus;
    return {
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      is_admin: Boolean(u.is_admin || role === "owner" || role === "admin"),
      role,
      status,
      can_ingest: u.can_ingest !== 0,
      can_share: u.can_share !== 0,
      can_use_server_key: u.can_use_server_key !== 0,
      quota_mb: typeof u.quota_mb === "number" ? u.quota_mb : 2048,
      memo: u.memo || "",
      last_login_at: u.last_login_at || null,
      created_at: u.created_at,
      lecture_count: u.lecture_count,
      public_count: u.public_count,
      error_count: u.error_count,
      audio_bytes: u.audio_bytes,
      session_count: u.session_count,
    };
  });
}

export function updateUserByAdmin(
  targetUserId: string,
  patch: {
    displayName?: string;
    role?: UserRole;
    status?: UserStatus;
    canIngest?: boolean;
    canShare?: boolean;
    canUseServerKey?: boolean;
    quotaMb?: number;
    memo?: string;
    newPassword?: string;
    revokeSessions?: boolean;
  }
): UserRecord | null {
  assertValidRoleAndStatus(patch.role || undefined, patch.status || undefined);
  const cur = getUserById(targetUserId);
  if (!cur) return null;

  const nextRole = patch.role || cur.role || (cur.is_admin ? "owner" : "member");
  const nextIsAdmin = nextRole === "owner" || nextRole === "admin" ? 1 : 0;
  const nextStatus = patch.status || cur.status || "active";
  const isBeingDeactivated =
    (nextStatus === "suspended" || nextStatus === "pending") &&
    nextStatus !== cur.status;
  const nextDisplayName =
    typeof patch.displayName === "string" && patch.displayName.trim()
      ? patch.displayName.trim()
      : cur.display_name;
  const nextCanIngest =
    typeof patch.canIngest === "boolean"
      ? patch.canIngest
        ? 1
        : 0
      : cur.can_ingest ?? 1;
  const nextCanShare =
    typeof patch.canShare === "boolean"
      ? patch.canShare
        ? 1
        : 0
      : cur.can_share ?? 1;
  const nextCanUseServerKey =
    typeof patch.canUseServerKey === "boolean"
      ? patch.canUseServerKey
        ? 1
        : 0
      : cur.can_use_server_key ?? 1;
  const nextQuotaMb =
    typeof patch.quotaMb === "number" && patch.quotaMb >= 0
      ? Math.round(patch.quotaMb)
      : cur.quota_mb ?? 2048;
  const nextMemo =
    typeof patch.memo === "string" ? patch.memo.trim() : cur.memo || "";

  db.query(
    `UPDATE users
     SET display_name = ?, is_admin = ?, role = ?, status = ?,
         can_ingest = ?, can_share = ?, can_use_server_key = ?, quota_mb = ?, memo = ?
     WHERE id = ?`
  ).run(
    nextDisplayName,
    nextIsAdmin,
    nextRole,
    nextStatus,
    nextCanIngest,
    nextCanShare,
    nextCanUseServerKey,
    nextQuotaMb,
    nextMemo,
    targetUserId
  );

  if (typeof patch.newPassword === "string" && patch.newPassword.length >= 6) {
    updateUserPassword(targetUserId, patch.newPassword);
  }
  if (patch.revokeSessions || nextStatus === "suspended" || isBeingDeactivated) {
    deleteAllUserSessions(targetUserId);
  }
  if (isBeingDeactivated) {
    // A leaked or device-stored API token must not come back to life on reactivation.
    rotateUserApiToken(targetUserId);
  }

  return getUserById(targetUserId);
}

export function deleteUserAndData(targetUserId: string): boolean {
  const cur = getUserById(targetUserId);
  if (!cur) return false;
  const lectures = listLecturesForUser(targetUserId);
  for (const lec of lectures) {
    deleteLectureById(lec.id);
  }
  deleteAllUserSessions(targetUserId);
  const res = db.query(`DELETE FROM users WHERE id = ?`).run(targetUserId);
  return res.changes > 0;
}

export function createSession(userId: string, ttlDays = 30): string {
  const token = `ses_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400 * 1000);
  db.query(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, expires.toISOString(), now.toISOString());
  return token;
}

export function deleteSession(token: string): void {
  db.query(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function getUserBySessionOrApiToken(rawToken: string): UserRecord | null {
  const token = rawToken.trim();
  if (!token) return null;

  if (token.startsWith("lct_")) {
    return getUserByApiToken(token);
  }

  const row = db
    .query(`SELECT user_id, expires_at FROM sessions WHERE token = ?`)
    .get(token) as { user_id: string; expires_at: string } | null;

  if (!row) {
    return getUserByApiToken(token);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  return getUserById(row.user_id);
}

export function createEmailVerificationCode(
  rawEmail: string,
  purpose: "signup" | "reset" = "signup",
  ttlMinutes = 10
): string {
  const email = rawEmail.trim().toLowerCase();
  const num = 100000 + (randomBytes(4).readUInt32BE(0) % 900000);
  const code = String(num);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  db.query(
    `INSERT OR REPLACE INTO email_verifications (email, code, purpose, expires_at, created_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(email, code, purpose, expiresAt, now.toISOString());
  return code;
}

/** Wrong guesses allowed per issued code before it is invalidated. */
export const MAX_VERIFICATION_CODE_ATTEMPTS = 5;

export function verifyEmailVerificationCode(
  rawEmail: string,
  rawCode: string,
  purpose: "signup" | "reset" = "signup",
  consume = true
): boolean {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();
  if (!email || !code) return false;
  const row = db
    .query(
      `SELECT code, expires_at, attempts FROM email_verifications WHERE email = ? AND purpose = ?`
    )
    .get(email, purpose) as { code: string; expires_at: string; attempts: number } | null;
  if (!row) return false;
  const discard = () =>
    db.query(
      `DELETE FROM email_verifications WHERE email = ? AND purpose = ?`
    ).run(email, purpose);
  const attempts = row.attempts || 0;
  if (
    new Date(row.expires_at).getTime() < Date.now() ||
    attempts >= MAX_VERIFICATION_CODE_ATTEMPTS
  ) {
    discard();
    return false;
  }
  const expected = Buffer.from(row.code);
  const given = Buffer.from(code);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    if (attempts + 1 >= MAX_VERIFICATION_CODE_ATTEMPTS) {
      discard();
    } else {
      db.query(
        `UPDATE email_verifications SET attempts = ? WHERE email = ? AND purpose = ?`
      ).run(attempts + 1, email, purpose);
    }
    return false;
  }
  if (consume) {
    discard();
  }
  return true;
}

export function ensureBootstrapOwner(): UserRecord {
  const explicitEmail = config().owner.email || "";
  if (!explicitEmail) {
    const existingOwner = db
      .query(
        `SELECT * FROM users WHERE role = 'owner' OR is_admin = 1 ORDER BY created_at ASC LIMIT 1`
      )
      .get() as UserRecord | null;
    if (existingOwner) {
      return existingOwner;
    }
  }
  const ownerEmail = explicitEmail || "owner@lectern.local";
  const ownerDisplayName = config().owner.name || "Workspace Owner";
  const configuredPassword = readSecret("LECTERN_OWNER_PASSWORD");
  const ownerApiToken = readSecret("LECTERN_OWNER_API_TOKEN");

  let owner = getUserByEmail(ownerEmail);
  if (!owner) {
    // Never a well-known default: without LECTERN_OWNER_PASSWORD the owner gets a random
    // password and signs in after a password reset (or a restart with the variable set and
    // LECTERN_FORCE_RESET_OWNER_PASSWORD=1).
    if (!configuredPassword) {
      logger.warn(
        "owner account created with a random password: set LECTERN_OWNER_PASSWORD (with LECTERN_FORCE_RESET_OWNER_PASSWORD=1) or use the password reset flow",
        { email: ownerEmail }
      );
    }
    owner = createUser({
      email: ownerEmail,
      displayName: ownerDisplayName,
      password: configuredPassword ?? randomBytes(24).toString("base64url"),
      isAdmin: true,
      role: "owner",
      status: "active",
      quotaMb: 0,
      fixedApiToken: ownerApiToken,
    });
  } else {
    if (owner.role !== "owner" || owner.is_admin !== 1) {
      db.query(
        `UPDATE users SET is_admin = 1, role = 'owner', status = 'active' WHERE id = ?`
      ).run(owner.id);
      owner = getUserById(owner.id)!;
    }
    if (config().owner.forceResetPassword && configuredPassword) {
      updateUserPassword(owner.id, configuredPassword);
      owner = getUserById(owner.id)!;
    }
  }

  // Only adopt orphaned rows; never take over lectures another account already owns.
  db.query(`UPDATE lectures SET owner_id = ? WHERE owner_id = ''`).run(owner.id);

  return owner;
}

function parseDateFromFilename(fname: string, fallbackMtime: Date): string {
  const m8 = fname.match(/(\d{4})(\d{2})(\d{2})/);
  if (m8) {
    return `${m8[1]}-${m8[2]}-${m8[3]}`;
  }
  const m4 = fname.match(/^(\d{2})(\d{2})_/);
  if (m4) {
    return `2026-${m4[1]}-${m4[2]}`;
  }
  return fallbackMtime.toISOString().slice(0, 10);
}

export async function syncLocalLecturesDir(ownerId?: string): Promise<void> {
  if (!existsSync(LECTURES_ROOT)) return;
  const targetOwnerId = ownerId || ensureBootstrapOwner().id;

  const deletedSet = new Set(
    (
      db.query(`SELECT md_source_path FROM deleted_sources`).all() as Array<{
        md_source_path: string;
      }>
    ).map((r) => r.md_source_path)
  );

  const entries = readdirSync(LECTURES_ROOT, { withFileTypes: true });
  for (const dirEntry of entries) {
    if (!dirEntry.isDirectory() || dirEntry.name.startsWith(".")) continue;
    const courseName = dirEntry.name;
    const courseDir = join(LECTURES_ROOT, courseName);

    let files: string[] = [];
    try {
      files = readdirSync(courseDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith("_요약.md") && !file.endsWith(".md")) continue;
      const mdPath = join(courseDir, file);
      if (deletedSet.has(mdPath)) continue;

      const st = statSync(mdPath);
      const mdContent = readFileSync(mdPath, "utf8").trim();
      if (!mdContent) continue;

      const baseStem = file.replace(/_요약\.md$/, "").replace(/\.md$/, "");
      let audioPath: string | null = null;
      let audioMime: string | null = null;
      let audioSize = 0;

      for (const ext of [".m4a", ".mp3", ".wav", ".webm", ".ogg"]) {
        const candidate1 = join(courseDir, `${baseStem}${ext}`);
        const candidate2 = join(courseDir, `${baseStem}_원본${ext}`);
        const candidate = existsSync(candidate1)
          ? candidate1
          : existsSync(candidate2)
          ? candidate2
          : null;
        if (candidate) {
          audioPath = candidate;
          audioSize = statSync(candidate).size;
          audioMime =
            ext === ".m4a"
              ? "audio/mp4"
              : ext === ".mp3"
              ? "audio/mpeg"
              : ext === ".wav"
              ? "audio/wav"
              : ext === ".webm"
              ? "audio/webm"
              : "audio/ogg";
          break;
        }
      }

      const existing = db
        .query(
          "SELECT id, markdown, audio_path, audio_size FROM lectures WHERE md_source_path = ?"
        )
        .get(mdPath) as {
        id: string;
        markdown: string;
        audio_path: string | null;
        audio_size: number;
      } | null;

      const dateLabel = parseDateFromFilename(baseStem, st.mtime);
      const firstHeading = mdContent.match(/^#\s+(.+)$/m)?.[1]?.replace(/^📚\s*/, "").trim();
      const title =
        firstHeading && firstHeading.length > 2
          ? `${courseName} · ${dateLabel}`
          : `${courseName} (${baseStem})`;

      const excerpt = extractExcerpt(mdContent);
      const isoMtime = new Date(
        dateLabel + "T" + st.mtime.toISOString().slice(11)
      ).toISOString();

      if (!existing) {
        const id =
          "lec_" +
          createHash("sha1").update(mdPath).digest("hex").slice(0, 12);
        const shareToken = generateShareToken(mdPath + ":" + targetOwnerId);
        const durationSec = audioPath ? await probeAudioDuration(audioPath) : 0;

        db.query(
          `INSERT INTO lectures (
            id, owner_id, share_token, is_public, title, course, date_label, status, stage, stage_message,
            progress, markdown, excerpt, audio_path, audio_mime, audio_size,
            duration_sec, model_requested, model_used, source_client, md_source_path,
            created_at, updated_at
          ) VALUES (?, ?, ?, 0, ?, ?, ?, 'done', 'done', '완료', 100, ?, ?, ?, ?, ?, ?, 'gemini-3.8-flash', 'gemini-3.8-flash', 'local-sync', ?, ?, ?)`
        ).run(
          id,
          targetOwnerId,
          shareToken,
          title,
          courseName,
          dateLabel,
          mdContent,
          excerpt,
          audioPath,
          audioMime,
          audioSize,
          durationSec,
          mdPath,
          isoMtime,
          st.mtime.toISOString()
        );
      } else {
        const unchanged =
          existing.markdown === mdContent &&
          (!audioPath ||
            (existing.audio_path === audioPath && existing.audio_size === audioSize));
        if (unchanged) continue;
        // Refresh content only: ownership of an existing row is never reassigned here.
        db.query(
          `UPDATE lectures
           SET markdown = ?, excerpt = ?, audio_path = COALESCE(?, audio_path),
               audio_mime = COALESCE(?, audio_mime),
               audio_size = CASE WHEN ? > 0 THEN ? ELSE audio_size END
           WHERE id = ?`
        ).run(
          mdContent,
          excerpt,
          audioPath,
          audioMime,
          audioSize,
          audioSize,
          existing.id
        );
      }
    }
  }
}

export function listAllLecturesForAdmin(limit = 100): Array<
  LectureRecord & { owner_email: string; owner_name: string }
> {
  return db
    .query(
      `SELECT l.*, COALESCE(u.email, '') AS owner_email, COALESCE(u.display_name, '') AS owner_name
       FROM lectures l
       LEFT JOIN users u ON u.id = l.owner_id
       ORDER BY l.created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<
    LectureRecord & { owner_email: string; owner_name: string }
  >;
}

/** `%q%` for a `LIKE ? ESCAPE '\'` clause, with the user's own wildcards made literal. */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type LectureStatusCounts = { all: number; processing: number; error: number; done: number };

/**
 * Filterable, paginated lecture list across all accounts for the admin console. `counts`
 * covers the search/owner filter regardless of `status`, so every status tab can show one.
 */
export function searchLecturesForAdmin(filter: {
  status?: string;
  q?: string;
  ownerId?: string;
  limit: number;
  offset: number;
}): {
  total: number;
  counts: LectureStatusCounts;
  rows: Array<LectureRecord & { owner_email: string; owner_name: string }>;
} {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.ownerId) {
    where.push(`l.owner_id = ?`);
    params.push(filter.ownerId);
  }
  if (filter.q && filter.q.trim()) {
    const like = likeContains(filter.q.trim());
    where.push(
      `(l.title LIKE ? ESCAPE '\\' OR l.course LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR l.id = ?)`
    );
    params.push(like, like, like, filter.q.trim());
  }
  const baseFrom = `FROM lectures l LEFT JOIN users u ON u.id = l.owner_id`;
  const baseWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const c = db
    .query(
      `SELECT COUNT(*) AS all_count,
         COALESCE(SUM(CASE WHEN l.status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN l.status = 'error' THEN 1 ELSE 0 END), 0) AS error,
         COALESCE(SUM(CASE WHEN l.status = 'done' THEN 1 ELSE 0 END), 0) AS done
       ${baseFrom} ${baseWhere}`
    )
    .get(...params) as { all_count: number; processing: number; error: number; done: number };
  const counts: LectureStatusCounts = {
    all: c.all_count,
    processing: c.processing,
    error: c.error,
    done: c.done,
  };

  const status =
    filter.status && ["processing", "done", "error"].includes(filter.status)
      ? (filter.status as "processing" | "done" | "error")
      : null;
  if (status) {
    where.push(`l.status = ?`);
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT l.*, COALESCE(u.email, '') AS owner_email, COALESCE(u.display_name, '') AS owner_name
       ${baseFrom} ${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, filter.limit, filter.offset) as Array<
    LectureRecord & { owner_email: string; owner_name: string }
  >;
  return { total: status ? counts[status] : counts.all, counts, rows };
}

export const AUDIT_ACTION_PREFIXES = ["auth", "account", "admin", "storage", "ops"] as const;
export type AuditActionPrefix = (typeof AUDIT_ACTION_PREFIXES)[number];
export type AuditCounts = Record<"all" | AuditActionPrefix, number>;

/**
 * Audit history for the admin console, newest first, with keyset pagination: pass the
 * last row's (created_at, id) as `before` to get the next page. `counts` covers the text
 * search regardless of `prefix`, so every action filter chip can show one.
 */
export function searchAuditLogs(filter: {
  q?: string;
  prefix?: AuditActionPrefix;
  before?: { createdAt: string; id: string } | null;
  limit: number;
}): { logs: AuditLogRecord[]; hasMore: boolean; counts: AuditCounts } {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.q && filter.q.trim()) {
    const like = likeContains(filter.q.trim());
    where.push(
      `(actor_email LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }
  const textWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const prefixSums = AUDIT_ACTION_PREFIXES.map(
    (p) => `COALESCE(SUM(CASE WHEN action LIKE '${p}.%' THEN 1 ELSE 0 END), 0) AS ${p}`
  ).join(", ");
  const counts = db
    .query(`SELECT COUNT(*) AS "all", ${prefixSums} FROM audit_logs ${textWhere}`)
    .get(...params) as AuditCounts;

  if (filter.prefix) {
    where.push(`action LIKE ?`);
    params.push(`${filter.prefix}.%`);
  }
  if (filter.before) {
    where.push(`(created_at < ? OR (created_at = ? AND id < ?))`);
    params.push(filter.before.createdAt, filter.before.createdAt, filter.before.id);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, filter.limit + 1) as AuditLogRecord[];
  const hasMore = rows.length > filter.limit;
  return { logs: hasMore ? rows.slice(0, filter.limit) : rows, hasMore, counts };
}

export function listLecturesForUser(
  ownerId: string,
  courseFilter?: string,
  search?: string
): LectureRecord[] {
  let sql = `SELECT * FROM lectures WHERE owner_id = ?`;
  const params: any[] = [ownerId];

  if (courseFilter && courseFilter !== "ALL") {
    sql += ` AND course = ?`;
    params.push(courseFilter);
  }
  if (search && search.trim()) {
    sql += ` AND (title LIKE ? OR course LIKE ? OR markdown LIKE ?)`;
    const q = `%${search.trim()}%`;
    params.push(q, q, q);
  }

  sql += ` ORDER BY date_label DESC, created_at DESC`;
  return db.query(sql).all(...params) as LectureRecord[];
}

export function getLectureById(id: string): LectureRecord | null {
  return db.query(`SELECT * FROM lectures WHERE id = ?`).get(id) as LectureRecord | null;
}

export function getLectureByShareToken(token: string): LectureRecord | null {
  return db
    .query(`SELECT * FROM lectures WHERE share_token = ?`)
    .get(token) as LectureRecord | null;
}

export function getLectureByAudioSha256(
  ownerId: string,
  audioSha256: string
): LectureRecord | null {
  if (!ownerId || !audioSha256) return null;
  return db
    .query(
      `SELECT * FROM lectures WHERE owner_id = ? AND audio_sha256 = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(ownerId, audioSha256) as LectureRecord | null;
}

export function resetLectureForRetry(id: string): LectureRecord | null {
  const now = new Date().toISOString();
  db.query(
    `UPDATE lectures
     SET status = 'processing', stage = 'retrying', stage_message = '원본 오디오로 재분석 준비 중...',
         progress = 10, error_message = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, id);
  return getLectureById(id);
}

export function listInterruptedLectures(): LectureRecord[] {
  return db
    .query(`SELECT * FROM lectures WHERE status = 'processing'`)
    .all() as LectureRecord[];
}

export function createPendingLecture(input: {
  id: string;
  ownerId?: string;
  title: string;
  course: string;
  audioPath: string;
  audioMime: string;
  audioSize: number;
  audioSha256?: string;
  modelRequested: string;
  sourceClient: string;
  isPublic?: boolean;
}): LectureRecord {
  const now = new Date().toISOString();
  const kst = formatKstTimestamp(now);
  const dateLabel = kst.fullLabel;
  const shareToken = generateShareToken();
  const ownerId = input.ownerId || ensureBootstrapOwner().id;
  const initialTitle =
    input.title && input.title.trim()
      ? input.title.trim()
      : `${input.course} (${kst.shortLabel})`;

  db.query(
    `INSERT INTO lectures (
      id, owner_id, share_token, is_public, title, course, date_label, status, stage, stage_message,
      progress, markdown, excerpt, audio_path, audio_mime, audio_size, audio_sha256,
      duration_sec, model_requested, model_used, source_client, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'preparing', '오디오 준비 중...', 5, '', '분석 진행 중...', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    ownerId,
    shareToken,
    input.isPublic ? 1 : 0,
    initialTitle,
    input.course,
    dateLabel,
    input.audioPath,
    input.audioMime,
    input.audioSize,
    input.audioSha256 || null,
    input.modelRequested,
    input.modelRequested,
    input.sourceClient,
    now,
    now
  );

  return getLectureById(input.id)!;
}

export function updateLectureProgress(
  id: string,
  stage: string,
  message: string,
  progress: number
): LectureRecord | null {
  db.query(
    `UPDATE lectures SET stage = ?, stage_message = ?, progress = ?, updated_at = ? WHERE id = ?`
  ).run(stage, message, progress, new Date().toISOString(), id);
  return getLectureById(id);
}

export function completeLectureRecord(
  id: string,
  result: {
    title: string;
    courseName: string;
    markdown: string;
    excerpt: string;
    modelUsed: string;
    durationSec: number;
  }
): LectureRecord {
  const now = new Date().toISOString();
  const rec = getLectureById(id);
  const owner = rec ? getUserById(rec.owner_id) : null;
  const kst = formatKstTimestamp(rec?.created_at || now);
  const shortUuid =
    id
      .replace(/^[a-z]+_/i, "")
      .replace(/-/g, "")
      .slice(0, 8) || randomBytes(4).toString("hex");

  // Admin/owner lectures are also written to the lecture archive (LECTURES_ROOT/<course>/).
  // Tests run against a sandboxed LECTURES_ROOT (test/preload.ts), so no test special case.
  let mdSourcePath: string | null = null;
  if (!owner || owner.is_admin === 1) {
    try {
      const safeCourse =
        result.courseName
          .replace(/[\\/:*?"<>|]/g, "_")
          .trim()
          .replace(/^\.+$/, "_") || "기타강의";
      const courseDir = join(LECTURES_ROOT, safeCourse);
      mkdirSync(courseDir, { recursive: true });
      mdSourcePath = join(
        courseDir,
        `${kst.fileStamp}_${safeCourse}_${shortUuid}_요약.md`
      );
      writeFileSync(mdSourcePath, result.markdown + "\n", "utf8");
      if (rec?.audio_path && existsSync(rec.audio_path)) {
        const ext = extname(rec.audio_path) || ".m4a";
        const archiveAudioPath = join(
          courseDir,
          `${kst.fileStamp}_${safeCourse}_${shortUuid}_원본${ext}`
        );
        if (!existsSync(archiveAudioPath)) {
          // A hard link keeps the archived original without a second copy on disk.
          // Compaction later swaps only the uploads/ path, so the archive keeps the
          // lossless original; across filesystems fall back to a real copy.
          try {
            linkSync(rec.audio_path, archiveAudioPath);
          } catch {
            try {
              copyFileSync(rec.audio_path, archiveAudioPath);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore if lectures root not writable
    }
  }

  let finalTitle =
    result.title?.trim() || rec?.title || `${result.courseName} (${kst.shortLabel})`;
  if (
    finalTitle === `${result.courseName} 강의 노트` ||
    finalTitle === result.courseName ||
    /^.+\s·\s\d{4}-\d{2}-\d{2}$/.test(finalTitle)
  ) {
    finalTitle = `${result.courseName} (${kst.shortLabel})`;
  }

  db.query(
    `UPDATE lectures
     SET status = 'done', stage = 'done', stage_message = '완료', progress = 100,
         title = ?, course = ?, markdown = ?, excerpt = ?, model_used = ?,
         duration_sec = ?, md_source_path = COALESCE(?, md_source_path), updated_at = ?
     WHERE id = ?`
  ).run(
    finalTitle,
    result.courseName,
    result.markdown,
    result.excerpt,
    result.modelUsed,
    result.durationSec,
    mdSourcePath,
    now,
    id
  );

  return getLectureById(id)!;
}

export function failLectureRecord(id: string, errorMessage: string): LectureRecord | null {
  db.query(
    `UPDATE lectures
     SET status = 'error', stage = 'error', stage_message = ?, error_message = ?, updated_at = ?
     WHERE id = ?`
  ).run(errorMessage, errorMessage, new Date().toISOString(), id);
  return getLectureById(id);
}

export function updateLectureMarkdown(
  id: string,
  title: string,
  course: string,
  markdown: string,
  isPublic?: boolean
): LectureRecord | null {
  const rec = getLectureById(id);
  if (!rec) return null;
  const excerpt = extractExcerpt(markdown);
  const now = new Date().toISOString();
  const nextPublic = typeof isPublic === "boolean" ? (isPublic ? 1 : 0) : rec.is_public;

  db.query(
    `UPDATE lectures SET title = ?, course = ?, markdown = ?, excerpt = ?, is_public = ?, updated_at = ? WHERE id = ?`
  ).run(title, course, markdown, excerpt, nextPublic, now, id);

  if (rec.md_source_path && existsSync(dirname(rec.md_source_path))) {
    try {
      writeFileSync(rec.md_source_path, markdown + "\n", "utf8");
    } catch {
      // ignore
    }
  }
  return getLectureById(id);
}

export function setLectureVisibility(
  id: string,
  isPublic: boolean,
  rotateToken = false
): LectureRecord | null {
  const rec = getLectureById(id);
  if (!rec) return null;
  const now = new Date().toISOString();
  const nextToken = rotateToken ? generateShareToken() : rec.share_token;
  db.query(
    `UPDATE lectures SET is_public = ?, share_token = ?, updated_at = ? WHERE id = ?`
  ).run(isPublic ? 1 : 0, nextToken, now, id);
  return getLectureById(id);
}

/**
 * Deletes the harness artifacts of a lecture's jobs and the blobs nothing else references.
 * They are copies of the recording's content, so they go with it (privacy policy §3);
 * the jobs' stage_run/ai_call records follow the job rows (maintenance, 30 days).
 */
function deleteHarnessArtifacts(lectureId: string): void {
  try {
    const jobIds = (db.query(`SELECT id FROM job WHERE subject_id = ?`).all(lectureId) as Array<{ id: string }>).map(
      (r) => r.id
    );
    if (jobIds.length) deleteArtifactsForJobs(db, harnessBlobs, jobIds);
  } catch (err) {
    logger.error("could not delete harness artifacts", { lecture_id: lectureId, err });
  }
}

export function deleteLectureAudioOnly(id: string): { ok: boolean; reclaimedBytes: number; lecture: LectureRecord | null } {
  const rec = getLectureById(id);
  if (!rec) return { ok: false, reclaimedBytes: 0, lecture: null };
  let reclaimedBytes = 0;
  // Derived audio (normalized copies, chunks) is audio too; everything derived goes with it.
  deleteHarnessArtifacts(id);

  if (rec.audio_path && existsSync(rec.audio_path)) {
    try {
      reclaimedBytes = statSync(rec.audio_path).size;
      if (rec.audio_path.startsWith(join(DATA_DIR, "uploads"))) {
        unlinkSync(rec.audio_path);
      }
    } catch {
      // ignore
    }
  }

  db.query(
    `UPDATE lectures SET audio_path = NULL, audio_mime = NULL, audio_size = 0, updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);

  return { ok: true, reclaimedBytes, lecture: getLectureById(id) };
}

export function deleteLectureById(id: string): boolean {
  const rec = getLectureById(id);
  deleteHarnessArtifacts(id);
  if (rec) {
    if (rec.md_source_path) {
      db.query(
        `INSERT OR REPLACE INTO deleted_sources (md_source_path, deleted_at) VALUES (?, ?)`
      ).run(rec.md_source_path, new Date().toISOString());
      if (existsSync(rec.md_source_path)) {
        try {
          unlinkSync(rec.md_source_path);
        } catch {
          // ignore if read-only
        }
      }
      const rawPrefix = rec.md_source_path.replace(/_요약\.md$/, "_원본");
      if (rawPrefix !== rec.md_source_path) {
        for (const ext of [".m4a", ".mp3", ".webm", ".wav", ".ogg"]) {
          const candidate = `${rawPrefix}${ext}`;
          if (existsSync(candidate)) {
            try {
              unlinkSync(candidate);
            } catch {}
          }
        }
      }
    }
    if (rec.audio_path && rec.audio_path.startsWith(join(DATA_DIR, "uploads")) && existsSync(rec.audio_path)) {
      try {
        unlinkSync(rec.audio_path);
      } catch {
        // ignore
      }
    }
  }
  const res = db.query(`DELETE FROM lectures WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function cleanupLecturesForUser(
  ownerId: string,
  options: {
    mode:
      | "failed"
      | "short_fragments"
      | "audio_only_all"
      | "batch_delete"
      | "batch_move"
      | "batch_visibility";
    ids?: string[];
    targetCourse?: string;
    isPublic?: boolean;
  }
): { affectedIds: string[]; reclaimedBytes: number } {
  const all = listLecturesForUser(ownerId);
  const affectedIds: string[] = [];
  let reclaimedBytes = 0;

  if (options.mode === "failed") {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const item of all) {
      const isStaleProcessing =
        item.status === "processing" && new Date(item.updated_at).getTime() < cutoff;
      if (item.status === "error" || isStaleProcessing) {
        if (item.audio_size > 0) reclaimedBytes += item.audio_size;
        if (deleteLectureById(item.id)) affectedIds.push(item.id);
      }
    }
  } else if (options.mode === "short_fragments") {
    for (const item of all) {
      const isFragment =
        (item.duration_sec > 0 && item.duration_sec < 15) ||
        item.markdown.includes("극단적인 단편(Fragment)") ||
        item.markdown === "# 📚 정보보호개론\n\n## 🎯 핵심\n- [10:15] AES-GCM 인증 암호화";
      if (isFragment) {
        if (item.audio_size > 0) reclaimedBytes += item.audio_size;
        if (deleteLectureById(item.id)) affectedIds.push(item.id);
      }
    }
  } else if (options.mode === "audio_only_all") {
    for (const item of all) {
      if (item.status === "done" && item.audio_path) {
        const res = deleteLectureAudioOnly(item.id);
        if (res.ok) {
          reclaimedBytes += res.reclaimedBytes;
          affectedIds.push(item.id);
        }
      }
    }
  } else if (options.mode === "batch_delete" && Array.isArray(options.ids)) {
    const idSet = new Set(options.ids);
    for (const item of all) {
      if (idSet.has(item.id)) {
        if (item.audio_size > 0) reclaimedBytes += item.audio_size;
        if (deleteLectureById(item.id)) affectedIds.push(item.id);
      }
    }
  } else if (
    options.mode === "batch_move" &&
    Array.isArray(options.ids) &&
    options.targetCourse?.trim()
  ) {
    const idSet = new Set(options.ids);
    const nextCourse = options.targetCourse.trim();
    const now = new Date().toISOString();
    for (const item of all) {
      if (idSet.has(item.id)) {
        db.query(`UPDATE lectures SET course = ?, updated_at = ? WHERE id = ?`).run(
          nextCourse,
          now,
          item.id
        );
        affectedIds.push(item.id);
      }
    }
  } else if (
    options.mode === "batch_visibility" &&
    Array.isArray(options.ids) &&
    typeof options.isPublic === "boolean"
  ) {
    const idSet = new Set(options.ids);
    for (const item of all) {
      if (idSet.has(item.id)) {
        setLectureVisibility(item.id, options.isPublic);
        affectedIds.push(item.id);
      }
    }
  }

  return { affectedIds, reclaimedBytes };
}

export { DATA_DIR, LECTURES_ROOT };
