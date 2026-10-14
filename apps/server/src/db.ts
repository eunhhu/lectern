import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  extractExcerpt,
  probeAudioDuration,
} from "../../../packages/core/src/index.ts";

export interface LectureRecord {
  id: string;
  share_token: string;
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

const DATA_DIR =
  process.env.LECTERN_DATA_DIR || "/home/eunhhu/work/lectern/data";
const LECTURES_ROOT =
  process.env.LECTERN_LECTURES_DIR || "/home/eunhhu/work/lectures";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });

const dbPath = join(DATA_DIR, "lectern.sqlite");
export const db = new Database(dbPath, { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS lectures (
    id TEXT PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
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

export function generateId(prefix = "lec"): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function generateShareToken(seed?: string): string {
  if (seed) {
    return createHash("sha256").update(seed).digest("base64url").slice(0, 12);
  }
  return randomBytes(9).toString("base64url");
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

export async function syncLocalLecturesDir(): Promise<void> {
  if (!existsSync(LECTURES_ROOT)) return;

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
        const shareToken = generateShareToken(mdPath);
        const durationSec = audioPath ? await probeAudioDuration(audioPath) : 0;

        db.query(
          `INSERT INTO lectures (
            id, share_token, title, course, date_label, status, stage, stage_message,
            progress, markdown, excerpt, audio_path, audio_mime, audio_size,
            duration_sec, model_requested, model_used, source_client, md_source_path,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'done', 'done', '완료', 100, ?, ?, ?, ?, ?, ?, 'gemini-flash-latest', 'gemini-3.8-flash', 'local-sync', ?, ?, ?)`
        ).run(
          id,
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

export function listLectures(courseFilter?: string, search?: string): LectureRecord[] {
  let sql = `SELECT * FROM lectures WHERE 1=1`;
  const params: any[] = [];

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
  title: string;
  course: string;
  audioPath: string;
  audioMime: string;
  audioSize: number;
  modelRequested: string;
  sourceClient: string;
}): LectureRecord {
  const now = new Date().toISOString();
  const dateLabel = now.slice(0, 10);
  const shareToken = generateShareToken();

  db.query(
    `INSERT INTO lectures (
      id, share_token, title, course, date_label, status, stage, stage_message,
      progress, markdown, excerpt, audio_path, audio_mime, audio_size,
      duration_sec, model_requested, model_used, source_client, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'processing', 'preparing', '오디오 준비 중...', 5, '', '분석 진행 중...', ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    shareToken,
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
): void {
  db.query(
    `UPDATE lectures SET stage = ?, stage_message = ?, progress = ?, updated_at = ? WHERE id = ?`
  ).run(stage, message, progress, new Date().toISOString(), id);
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

  // Also persist to /home/eunhhu/work/lectures/<course>/ for CLI & file sync compatibility
  let mdSourcePath: string | null = null;
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

export function failLectureRecord(id: string, errorMessage: string): void {
  db.query(
    `UPDATE lectures
     SET status = 'error', stage = 'error', stage_message = ?, error_message = ?, updated_at = ?
     WHERE id = ?`
  ).run(errorMessage, errorMessage, new Date().toISOString(), id);
}

export function updateLectureMarkdown(
  id: string,
  title: string,
  course: string,
  markdown: string
): LectureRecord | null {
  const rec = getLectureById(id);
  if (!rec) return null;
  const excerpt = extractExcerpt(markdown);
  const now = new Date().toISOString();

  db.query(
    `UPDATE lectures SET title = ?, course = ?, markdown = ?, excerpt = ?, updated_at = ? WHERE id = ?`
  ).run(title, course, markdown, excerpt, now, id);

  if (rec.md_source_path && existsSync(dirname(rec.md_source_path))) {
    try {
      writeFileSync(rec.md_source_path, markdown + "\n", "utf8");
    } catch {
      // ignore
    }
  }
  return getLectureById(id);
}

export function deleteLectureById(id: string): boolean {
  const res = db.query(`DELETE FROM lectures WHERE id = ?`).run(id);
  return res.changes > 0;
}

export { DATA_DIR, LECTURES_ROOT };
