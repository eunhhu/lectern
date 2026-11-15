// The `export` job (P5-08, D-P5-8): builds a requested workspace export zip under
// <data dir>/exports, then keeps it 7 days. The zip is written to `<id>.zip.tmp` and renamed
// when complete, so a crash never leaves a half-written file that looks finished. A failure
// is final: the row says why, and the user asks again.

import { readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "@lectern/config";
import { db } from "../db.ts";
import { ensurePrivateDir, makePrivate } from "../fsperm.ts";
import { logger } from "../log.ts";
import { registerJobHandler } from "../queue.ts";
import { exportEntries } from "./build.ts";
import { writeZip, ZIP_TOO_LARGE } from "./zip.ts";

export const EXPORT_JOB_KIND = "export";
export const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A temp file or a zip without a ready row older than this was left by a crash. */
const STRAY_FILE_AGE_MS = 24 * 60 * 60 * 1000;
const BLOB_KEY_RE = /^exports\/[A-Za-z0-9_-]+\.zip$/;

export const EXPORT_TOO_LARGE_MESSAGE = "내보낼 데이터가 너무 큽니다. 오디오를 빼고 다시 시도해 주세요.";
export const EXPORT_FAILED_MESSAGE = "내보내기를 만들지 못했습니다.";
export const EXPORT_NOT_MEMBER_MESSAGE = "이 워크스페이스의 멤버가 아니어서 내보내기를 만들 수 없습니다.";

export interface DataExportRow {
  id: string;
  user_id: string;
  workspace_id: string;
  include_audio: number;
  state: "queued" | "running" | "ready" | "failed" | "expired";
  blob_key: string | null;
  bytes: number | null;
  requested_at: number;
  ready_at: number | null;
  expires_at: number | null;
  error: string | null;
}

/** <data dir>/exports, created owner-only (0700). */
export function exportDir(): string {
  const dir = join(config().dataDir, "exports");
  ensurePrivateDir(dir);
  return dir;
}

/** The finished zip of a blob key, or null for a key that is not an export's. */
export function exportFilePath(blobKey: string | null): string | null {
  return blobKey && BLOB_KEY_RE.test(blobKey) ? join(config().dataDir, blobKey) : null;
}

export function getExport(id: string): DataExportRow | null {
  return db.query(`SELECT * FROM data_export WHERE id = ?`).get(id) as DataExportRow | null;
}

/** Only an unfinished export fails: a late hook never overwrites a ready one. Never throws. */
function fail(id: string, message: string): void {
  try {
    db.query(`UPDATE data_export SET state = 'failed', error = ?, blob_key = NULL, bytes = NULL WHERE id = ? AND state IN ('queued', 'running')`).run(
      message,
      id
    );
  } catch (err) {
    logger.error("could not mark export failed", { export_id: id, err });
  }
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (err) {
    logger.warn("could not remove export file", { err });
  }
}

const isMember = (row: DataExportRow) => db.query(`SELECT 1 FROM membership WHERE workspace_id = ? AND user_id = ?`).get(row.workspace_id, row.user_id) !== null;

/** Builds one export. Never throws: whatever goes wrong ends the row as `failed`. */
export async function runExportJob(exportId: string, now = () => Date.now()): Promise<void> {
  const row = getExport(exportId);
  // `running` too: a job interrupted by a restart runs again from the start.
  if (!row || (row.state !== "queued" && row.state !== "running")) return;
  let tmp: string | null = null;
  try {
    // Checked again here: the user may have left the workspace while the export waited.
    if (!isMember(row)) {
      fail(row.id, EXPORT_NOT_MEMBER_MESSAGE);
      logger.warn("export refused", { export_id: row.id, user_id: row.user_id, reason: "not a member" });
      return;
    }
    db.query(`UPDATE data_export SET state = 'running', error = NULL WHERE id = ?`).run(row.id);
    const dir = exportDir();
    tmp = join(dir, `${row.id}.zip.tmp`);
    const { bytes, files } = await writeZip(
      tmp,
      exportEntries({ userId: row.user_id, workspaceId: row.workspace_id, includeAudio: row.include_audio === 1, now: now() })
    );
    const final = join(dir, `${row.id}.zip`);
    renameSync(tmp, final);
    tmp = null;
    makePrivate(final);
    const readyAt = now();
    db.query(`UPDATE data_export SET state = 'ready', blob_key = ?, bytes = ?, ready_at = ?, expires_at = ?, error = NULL WHERE id = ?`).run(
      `exports/${row.id}.zip`,
      bytes,
      readyAt,
      readyAt + EXPORT_TTL_MS,
      row.id
    );
    logger.info("export ready", { export_id: row.id, user_id: row.user_id, files, bytes });
  } catch (err) {
    if (tmp) removeQuietly(tmp);
    const tooLarge = err instanceof Error && err.message === ZIP_TOO_LARGE;
    fail(row.id, tooLarge ? EXPORT_TOO_LARGE_MESSAGE : EXPORT_FAILED_MESSAGE);
    logger.warn("export failed", { export_id: row.id, user_id: row.user_id, too_large: tooLarge, err });
  }
}

/**
 * Deletes the zips past their expiry (state `expired`), temp files and row-less zips a crash
 * or a deleted account left, and fails exports whose job is gone (so the one-at-a-time rule
 * can never lock a user out). Returns how many expired.
 */
export function expireExports(now = Date.now()): number {
  const due = db.query(`SELECT * FROM data_export WHERE state = 'ready' AND expires_at <= ?`).all(now) as DataExportRow[];
  for (const row of due) {
    const path = exportFilePath(row.blob_key);
    if (path) removeQuietly(path);
    db.query(`UPDATE data_export SET state = 'expired', blob_key = NULL WHERE id = ?`).run(row.id);
  }
  db.query(
    `UPDATE data_export SET state = 'failed', error = ?
     WHERE state IN ('queued', 'running')
       AND NOT EXISTS (SELECT 1 FROM job WHERE job.kind = ? AND job.subject_id = data_export.id AND job.state IN ('queued', 'running'))`
  ).run(EXPORT_FAILED_MESSAGE, EXPORT_JOB_KIND);

  const dir = exportDir();
  const readyIds = new Set((db.query(`SELECT id FROM data_export WHERE state = 'ready'`).all() as Array<{ id: string }>).map((r) => r.id));
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // A finished zip is renamed into place just before its row says `ready`: young files wait.
    const orphanZip = name.endsWith(".zip") && !readyIds.has(name.slice(0, -".zip".length));
    if (!orphanZip && !name.endsWith(".zip.tmp")) continue;
    try {
      if (now - statSync(path).mtimeMs > STRAY_FILE_AGE_MS) removeQuietly(path);
    } catch {
      // Gone in the meantime.
    }
  }
  return due.length;
}

// The queue sees every export as done: a failure is recorded on the row, never retried.
registerJobHandler(
  EXPORT_JOB_KIND,
  async (job) => {
    if (job.subjectId) await runExportJob(job.subjectId); // never throws
    return { ok: true };
  },
  {
    concurrency: 1,
    onLost: ({ subjectId }) => {
      if (subjectId) fail(subjectId, EXPORT_FAILED_MESSAGE);
    },
    onCanceled: ({ subjectId }) => {
      if (subjectId) fail(subjectId, EXPORT_FAILED_MESSAGE);
    },
  }
);
