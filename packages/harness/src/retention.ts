// Deleting what the harness keeps, in line with the privacy policy (§3 of
// apps/server/static/legal/privacy.html):
//
// - Artifacts and their blobs are copies of user content (audio, transcripts, notes).
//   They go the moment the recording (or only its audio) is deleted: deleteArtifactsForJobs.
// - `stage_run` and `ai_call` rows are job records without content. They follow the job row,
//   which maintenance prunes 30 days after it finished; then sweepHarnessData deletes the
//   job's stage runs and strips `ai_call` of everything that links it to a person (job,
//   stage run, workspace, provider request id), leaving anonymous usage (model, tokens, cost).
// - The sweep also removes what a crash or a race can leave behind: artifact rows whose run
//   or job is gone, blobs no artifact references, and stale tmp/ files. Files younger than
//   the grace period are left alone, because a running stage writes its blobs before it
//   records them (AI_HARNESS §4.3).

import type { Database } from "bun:sqlite";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { BlobStore } from "./blobs.ts";

/** How old an unreferenced blob or tmp file must be before the sweep deletes it. */
export const SWEEP_GRACE_MS = 24 * 3600_000;

/** Deletes these jobs' artifact rows, then every blob no other artifact still references. */
export function deleteArtifactsForJobs(
  db: Database,
  blobs: BlobStore,
  jobIds: readonly string[]
): { artifacts: number; blobs: number } {
  let artifacts = 0;
  const shas = new Set<string>();
  db.transaction(() => {
    for (const jobId of jobIds) {
      for (const row of db.query(`SELECT DISTINCT sha256 FROM artifact WHERE job_id = ?`).all(jobId) as Array<{
        sha256: string;
      }>) {
        shas.add(row.sha256);
      }
      artifacts += db.query(`DELETE FROM artifact WHERE job_id = ?`).run(jobId).changes;
    }
  })();
  return { artifacts, blobs: deleteUnreferenced(db, blobs, shas) };
}

export interface HarnessSweepResult {
  stageRuns: number;
  artifacts: number;
  /** ai_call rows whose job was pruned, now anonymous usage. */
  detachedAiCalls: number;
  blobs: number;
  tmpFiles: number;
}

/** Maintenance pass; see the header. Safe to run while jobs are running. */
export function sweepHarnessData(
  db: Database,
  blobs: BlobStore,
  options: { now?: number; graceMs?: number } = {}
): HarnessSweepResult {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? SWEEP_GRACE_MS;

  const orphanShas = new Set<string>();
  let stageRuns = 0;
  let artifacts = 0;
  let detachedAiCalls = 0;
  db.transaction(() => {
    stageRuns = db
      .query(`DELETE FROM stage_run WHERE NOT EXISTS (SELECT 1 FROM job WHERE job.id = stage_run.job_id)`)
      .run().changes;
    const orphanArtifacts = `
      FROM artifact
      WHERE (job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job WHERE job.id = artifact.job_id))
         OR (stage_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stage_run WHERE stage_run.id = artifact.stage_run_id))`;
    for (const row of db.query(`SELECT DISTINCT sha256 ${orphanArtifacts}`).all() as Array<{ sha256: string }>) {
      orphanShas.add(row.sha256);
    }
    artifacts = db.query(`DELETE ${orphanArtifacts}`).run().changes;
    detachedAiCalls = db
      .query(
        `UPDATE ai_call SET job_id = NULL, stage_run_id = NULL, workspace_id = NULL, request_id = NULL
         WHERE job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job WHERE job.id = ai_call.job_id)`
      )
      .run().changes;
  })();

  // Blobs of the orphaned rows go now; any other unreferenced blob only after the grace period.
  let deletedBlobs = deleteUnreferenced(db, blobs, orphanShas);
  for (const sha of listBlobs(blobs.root)) {
    if (orphanShas.has(sha) || isReferenced(db, sha)) continue;
    const mtime = mtimeOf(blobs.path(sha));
    if (mtime !== null && now - mtime >= graceMs && blobs.delete(sha)) deletedBlobs++;
  }

  let tmpFiles = 0;
  const tmpDir = join(blobs.root, "tmp");
  for (const name of readDir(tmpDir)) {
    const path = join(tmpDir, name);
    const mtime = mtimeOf(path);
    if (mtime === null || now - mtime < graceMs) continue;
    try {
      unlinkSync(path);
      tmpFiles++;
    } catch {
      // vanished meanwhile
    }
  }

  return { stageRuns, artifacts, detachedAiCalls, blobs: deletedBlobs, tmpFiles };
}

function isReferenced(db: Database, sha256: string): boolean {
  return Boolean(db.query(`SELECT 1 FROM artifact WHERE sha256 = ? LIMIT 1`).get(sha256));
}

function deleteUnreferenced(db: Database, blobs: BlobStore, shas: Iterable<string>): number {
  let deleted = 0;
  for (const sha of shas) {
    if (!isReferenced(db, sha) && blobs.delete(sha)) deleted++;
  }
  return deleted;
}

/** sha256 names of every blob under root/sha256/<2>/. */
function listBlobs(root: string): string[] {
  const base = join(root, "sha256");
  const out: string[] = [];
  for (const prefix of readDir(base)) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const name of readDir(join(base, prefix))) {
      if (/^[0-9a-f]{64}$/.test(name) && name.startsWith(prefix)) out.push(name);
    }
  }
  return out;
}

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return []; // not created yet: nothing was ever written
  }
}

function mtimeOf(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}
