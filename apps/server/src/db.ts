import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  extractExcerpt,
  probeAudioDuration,
} from "../../../packages/core/src/index.ts";

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  api_token: string;
  is_admin: number;
  created_at: string;
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
  duration_sec: number;
  model_requested: string;
  model_used: string;
  source_client: string;
  error_message: string | null;
  md_source_path?: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_BASE = existsSync("/home/eunhhu/work")
  ? "/home/eunhhu/work/lectern"
  : process.cwd();
const DATA_DIR =
  process.env.LECTERN_DATA_DIR || join(DEFAULT_BASE, "data");
const LECTURES_ROOT =
  process.env.LECTERN_LECTURES_DIR ||
  (existsSync("/home/eunhhu/work/lectures")
    ? "/home/eunhhu/work/lectures"
    : join(DEFAULT_BASE, "lectures"));

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });

const dbPath = join(DATA_DIR, "lectern.sqlite");
export const db = new Database(dbPath, { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

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
    model_requested TEXT NOT NULL DEFAULT 'gemini-flash-latest',
    model_used TEXT NOT NULL DEFAULT 'gemini-flash-latest',
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

// Schema migrations for existing lectures table
try {
  const cols = db.query(`PRAGMA table_info(lectures)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "owner_id")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "is_public")) {
    db.exec(`ALTER TABLE lectures ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lectures_owner ON lectures(owner_id)`);
} catch {
  // ignore if already migrated
}

export function generateId(prefix = "lec"): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
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
  fixedApiToken?: string;
}): UserRecord {
  const normEmail = input.email.trim().toLowerCase();
  const existing = getUserByEmail(normEmail);
  if (existing) {
    throw new Error("이미 등록된 이메일(아이디)입니다.");
  }

  const id = generateId("usr");
  const now = new Date().toISOString();
  const passwordHash = hashPassword(input.password);
  const apiToken = input.fixedApiToken || generateApiToken();

  db.query(
    `INSERT INTO users (id, email, display_name, password_hash, api_token, is_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normEmail,
    input.displayName.trim() || normEmail.split("@")[0],
    passwordHash,
    apiToken,
    input.isAdmin ? 1 : 0,
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

export function rotateUserApiToken(userId: string): string {
  const newToken = generateApiToken();
  db.query(`UPDATE users SET api_token = ? WHERE id = ?`).run(newToken, userId);
  return newToken;
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

export function ensureBootstrapOwner(): UserRecord {
  const ownerEmail = (
    process.env.LECTERN_OWNER_EMAIL || "necpition205@gmail.com"
  )
    .trim()
    .toLowerCase();
  const ownerPassword =
    process.env.LECTERN_OWNER_PASSWORD || "sunwoo2026!lectern";
  const ownerApiToken = process.env.LECTERN_OWNER_API_TOKEN || undefined;

  let owner = getUserByEmail(ownerEmail);
  if (!owner) {
    owner = createUser({
      email: ownerEmail,
      displayName: "문선우",
      password: ownerPassword,
      isAdmin: true,
      fixedApiToken: ownerApiToken,
    });
  } else if (process.env.LECTERN_OWNER_PASSWORD) {
    if (!verifyPassword(ownerPassword, owner.password_hash)) {
      updateUserPassword(owner.id, ownerPassword);
      owner = getUserById(owner.id)!;
    }
  }

  db.query(
    `UPDATE lectures SET owner_id = ? WHERE owner_id = '' OR source_client = 'local-sync'`
  ).run(owner.id);

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
        const candidate = join(courseDir, `${baseStem}${ext}`);
        if (existsSync(candidate)) {
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
        .query("SELECT id, updated_at, duration_sec FROM lectures WHERE md_source_path = ?")
        .get(mdPath) as { id: string; updated_at: string; duration_sec: number } | null;

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
          ) VALUES (?, ?, ?, 0, ?, ?, ?, 'done', 'done', '완료', 100, ?, ?, ?, ?, ?, ?, 'gemini-flash-latest', 'gemini-3.8-flash', 'local-sync', ?, ?, ?)`
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
        db.query(
          `UPDATE lectures
           SET owner_id = ?, markdown = ?, excerpt = ?, audio_path = COALESCE(?, audio_path),
               audio_mime = COALESCE(?, audio_mime),
               audio_size = CASE WHEN ? > 0 THEN ? ELSE audio_size END
           WHERE id = ?`
        ).run(
          targetOwnerId,
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

export function createPendingLecture(input: {
  id: string;
  ownerId?: string;
  title: string;
  course: string;
  audioPath: string;
  audioMime: string;
  audioSize: number;
  modelRequested: string;
  sourceClient: string;
  isPublic?: boolean;
}): LectureRecord {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const shareToken = generateShareToken();
  const ownerId = input.ownerId || ensureBootstrapOwner().id;

  db.query(
    `INSERT INTO lectures (
      id, owner_id, share_token, is_public, title, course, date_label, status, stage, stage_message,
      progress, markdown, excerpt, audio_path, audio_mime, audio_size,
      duration_sec, model_requested, model_used, source_client, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'preparing', '오디오 준비 중...', 5, '', '분석 진행 중...', ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    ownerId,
    shareToken,
    input.isPublic ? 1 : 0,
    input.title,
    input.course,
    dateLabel,
    input.audioPath,
    input.audioMime,
    input.audioSize,
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
  const isTestClient = rec?.source_client === "bun-test" || id.startsWith("test_") || id.startsWith("unauth_");

  // Persist to /home/eunhhu/work/lectures/<course>/ only for real admin/owner lectures (never test runs)
  let mdSourcePath: string | null = null;
  if (!isTestClient && (!owner || owner.is_admin === 1)) {
    try {
      const safeCourse = result.courseName.replace(/[\\/:*?"<>|]/g, "_").trim() || "기타강의";
      const courseDir = join(LECTURES_ROOT, safeCourse);
      mkdirSync(courseDir, { recursive: true });
      const stamp = now.slice(0, 10).replace(/-/g, "") + "_" + now.slice(11, 16).replace(":", "");
      mdSourcePath = join(courseDir, `${stamp}_${safeCourse}_요약.md`);
      writeFileSync(mdSourcePath, result.markdown + "\n", "utf8");
    } catch {
      // ignore if lectures root not writable
    }
  }

  db.query(
    `UPDATE lectures
     SET status = 'done', stage = 'done', stage_message = '완료', progress = 100,
         title = ?, course = ?, markdown = ?, excerpt = ?, model_used = ?,
         duration_sec = ?, md_source_path = COALESCE(?, md_source_path), updated_at = ?
     WHERE id = ?`
  ).run(
    result.title || rec?.title || `${result.courseName} 강의 노트`,
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

export function deleteLectureAudioOnly(id: string): { ok: boolean; reclaimedBytes: number; lecture: LectureRecord | null } {
  const rec = getLectureById(id);
  if (!rec) return { ok: false, reclaimedBytes: 0, lecture: null };
  let reclaimedBytes = 0;

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
