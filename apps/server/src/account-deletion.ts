// Account deletion (P5-09, CONTRACTS D-P5-9): a request starts a 7-day grace period in which
// everything keeps working and the user can cancel. After it, the `account_deletion` job
// removes the user's recordings, files, index, tokens, sessions, integrations and the user
// row, so that no table holds the user's id, personal workspace id or e-mail any more
// (account-deletion.test.ts checks every text column of every table).
//
// What the user shared in a team stays with the team: a `workspace`-visible recording passes
// to the team's earliest other owner (its v1 lecture changes owner, so the projection keeps
// it). Private recordings go. A team with no other member goes as a whole.
//
// Every step can run again: a run cut short starts over from the top, and steps already
// done find nothing left to do.

import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "@lectern/config";
import { deleteRecordingIndex, deleteWorkspaceAskData } from "@lectern/ask";
import { deleteRecordingRows, deleteWorkspaceRows, personalWorkspaceId, projectLecture } from "@lectern/db";
import { BlobStore, deleteArtifactsForJobs } from "@lectern/harness";
import { db, deleteLectureById, deleteUserAndData, getUserById, HARNESS_BLOB_DIR, transferLectureOwner } from "./db.ts";
import { exportFilePath } from "./export/job.ts";
import { revokeToken } from "./google/oauth.ts";
import { forgetAccessToken, openGoogleTokens } from "./google/tokens.ts";
import { logger } from "./log.ts";
import { deleteAlignment } from "./pdf-align-file.ts";
import { enqueueJob, registerJobHandler } from "./queue.ts";

export const ACCOUNT_DELETION_JOB_KIND = "account_deletion";
export const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** `updated_by` of a quota set by an operator whose account is gone (the column is NOT NULL). */
const DELETED_USER = "deleted-user";

/**
 * Every table column that holds a user id. Rows are deleted; a table that does not exist
 * (yet) is skipped. `job` is not here: the deletion's own job goes last (see the handler).
 */
export const USER_TABLES: { table: string; column: string }[] = [
  { table: "oauth_identity", column: "user_id" },
  { table: "auth_session_meta", column: "user_id" },
  { table: "access_token", column: "user_id" },
  { table: "native_session", column: "user_id" },
  { table: "workspace_invite", column: "invited_by" },
  { table: "workspace_invite", column: "accepted_by" },
  { table: "data_export", column: "user_id" },
  { table: "calendar_feed", column: "user_id" },
  { table: "reminder", column: "user_id" },
  { table: "integration", column: "user_id" },
  { table: "oauth_state", column: "user_id" },
  { table: "push_device", column: "user_id" },
  { table: "share_link", column: "created_by" },
  { table: "recording_marker", column: "created_by" },
  { table: "ask_turn", column: "user_id" },
  { table: "ask_thread", column: "user_id" },
  { table: "saved_view", column: "user_id" },
  { table: "job_event", column: "owner_id" },
  { table: "audit_logs", column: "actor_id" },
  { table: "audit_logs", column: "target_id" },
];

/**
 * Tables with rows of a deleted workspace that packages/db deleteWorkspaceRows does not cover
 * (`ai_call` is detached instead, `job`/`stage_run`/`artifact` go with the jobs).
 */
const WORKSPACE_EXTRA_TABLES = [
  "workspace_invite",
  "workspace_quota",
  "data_export",
  "calendar_feed",
  "reminder",
  "oauth_state",
  "saved_view",
  "pdf_page",
  "job_event",
  "push_device",
  "recording_marker",
];

interface DeletionRow {
  user_id: string;
  requested_at: number;
  execute_after: number;
  state: "scheduled" | "canceled" | "done";
}

/** The first 12 hex characters of the user id's SHA-256: enough to follow a run in the logs. */
const userRef = (userId: string) => createHash("sha256").update(userId).digest("hex").slice(0, 12);

const tableExists = (table: string) => db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== null;

const json = (values: readonly string[]) => JSON.stringify(values);

export function deletionOf(userId: string): { state: "none" | "scheduled"; requestedAt: number | null; executeAfter: number | null } {
  const row = db.query(`SELECT * FROM account_deletion WHERE user_id = ? AND state = 'scheduled'`).get(userId) as DeletionRow | null;
  return row ? { state: "scheduled", requestedAt: row.requested_at, executeAfter: row.execute_after } : { state: "none", requestedAt: null, executeAfter: null };
}

/** Team workspaces where the user is the only owner and someone else is a member. */
/** The server's owner account (v1 role `owner`): never deleted, as the v1 admin delete refuses it too. */
export const isServerOwner = (userId: string) => (db.query(`SELECT role FROM users WHERE id = ?`).get(userId) as { role: string } | null)?.role === "owner";

export function soleOwnerTeams(userId: string): { id: string; name: string }[] {
  return db
    .query(
      `SELECT w.id, w.name FROM workspace w JOIN membership m ON m.workspace_id = w.id
       WHERE w.kind = 'team' AND m.user_id = ? AND m.role = 'owner'
         AND NOT EXISTS (SELECT 1 FROM membership o WHERE o.workspace_id = w.id AND o.user_id != ? AND o.role = 'owner')
         AND EXISTS (SELECT 1 FROM membership x WHERE x.workspace_id = w.id AND x.user_id != ?)
       ORDER BY w.name, w.id`
    )
    .all(userId, userId, userId) as { id: string; name: string }[];
}

/**
 * Schedules the deletion. A deletion already scheduled keeps its date; one canceled before
 * (the row stays, keyed by the user) starts a fresh 7 days.
 */
export function requestDeletion(userId: string, now = Date.now()): { requestedAt: number; executeAfter: number } {
  return db.transaction(() => {
    const current = deletionOf(userId);
    if (current.state === "scheduled") return { requestedAt: current.requestedAt!, executeAfter: current.executeAfter! };
    const executeAfter = now + DELETION_GRACE_MS;
    db.query(
      `INSERT INTO account_deletion (user_id, requested_at, execute_after, state) VALUES (?, ?, ?, 'scheduled')
       ON CONFLICT (user_id) DO UPDATE SET requested_at = excluded.requested_at, execute_after = excluded.execute_after, state = 'scheduled'`
    ).run(userId, now, executeAfter);
    return { requestedAt: now, executeAfter };
  })();
}

/** Cancels a scheduled deletion; false when none was scheduled. A queued job then finds nothing to do. */
export function cancelDeletion(userId: string): boolean {
  return db.transaction(() => {
    const changed = db.query(`UPDATE account_deletion SET state = 'canceled' WHERE user_id = ? AND state = 'scheduled'`).run(userId).changes > 0;
    db.query(`DELETE FROM job WHERE kind = ? AND subject_id = ? AND state = 'queued'`).run(ACCOUNT_DELETION_JOB_KIND, userId);
    return changed;
  })();
}

/** Queues a deletion job for every scheduled deletion past its date; returns how many were new. */
export function enqueueDueDeletions(now = Date.now()): number {
  const due = db
    .query(`SELECT user_id FROM account_deletion WHERE state = 'scheduled' AND execute_after <= ? ORDER BY execute_after`)
    .all(now) as Array<{ user_id: string }>;
  let queued = 0;
  for (const { user_id } of due) {
    const { deduplicated } = enqueueJob({ kind: ACCOUNT_DELETION_JOB_KIND, ownerId: user_id, subjectId: user_id, maxAttempts: 3 });
    if (!deduplicated) queued += 1;
  }
  return queued;
}

/** Deletes a recording that has no lecture of its own behind it: files, pages, index, rows. */
function deleteLooseRecording(recordingId: string, workspaceId: string): void {
  const uploads = join(config().dataDir, "uploads");
  const files = db.query(`SELECT blob_key FROM asset WHERE recording_id = ? AND blob_key LIKE 'file:%'`).all(recordingId) as Array<{ blob_key: string }>;
  for (const { blob_key } of files) {
    const path = blob_key.slice("file:".length);
    if (path.startsWith(uploads)) rmSync(path, { force: true });
  }
  db.query(`DELETE FROM pdf_page WHERE recording_id = ?`).run(recordingId);
  deleteAlignment(recordingId);
  deleteRecordingIndex(db, workspaceId, recordingId);
  deleteRecordingRows(db, recordingId);
}

const lectureOwner = (lectureId: string | null) =>
  lectureId ? ((db.query(`SELECT owner_id FROM lectures WHERE id = ?`).get(lectureId) as { owner_id: string } | null)?.owner_id ?? null) : null;

interface RecordingRef {
  id: string;
  workspace_id: string;
  lecture_id: string | null;
  visibility: string;
}

/** A team the user leaves behind: shared recordings pass to the earliest other owner, private ones go. */
function leaveTeam(userId: string, workspaceId: string): void {
  const heir = db
    .query(`SELECT user_id FROM membership WHERE workspace_id = ? AND role = 'owner' AND user_id != ? ORDER BY created_at, user_id LIMIT 1`)
    .get(workspaceId, userId) as { user_id: string } | null;
  const recordings = db
    .query(`SELECT id, workspace_id, lecture_id, visibility FROM recording WHERE workspace_id = ? AND created_by = ?`)
    .all(workspaceId, userId) as RecordingRef[];
  for (const r of recordings) {
    const ownLecture = lectureOwner(r.lecture_id) === userId;
    if (r.visibility === "workspace" && heir) {
      // The projection makes the new lecture owner the recording's creator, share links too.
      if (ownLecture) transferLectureOwner(r.lecture_id!, heir.user_id);
      else {
        db.query(`UPDATE recording SET created_by = ? WHERE id = ?`).run(heir.user_id, r.id);
        db.query(`UPDATE share_link SET created_by = ? WHERE target_id = ? AND created_by = ?`).run(heir.user_id, r.id, userId);
      }
    } else if (ownLecture) {
      deleteLectureById(r.lecture_id!);
    } else {
      deleteLooseRecording(r.id, workspaceId);
    }
  }
}

/**
 * A team with no other member goes as a whole. A recording in it of someone else's lecture
 * (a member who left) goes back to that person's personal workspace: once the workspace row
 * is gone, the projection no longer sees a team and moves it home.
 */
function removeSoloTeam(userId: string, workspaceId: string): void {
  const recordings = db.query(`SELECT id, workspace_id, lecture_id, visibility FROM recording WHERE workspace_id = ?`).all(workspaceId) as RecordingRef[];
  db.query(`DELETE FROM workspace WHERE id = ?`).run(workspaceId);
  for (const r of recordings) {
    const owner = lectureOwner(r.lecture_id);
    if (owner && owner !== userId) projectLecture(db, r.lecture_id!);
    else if (owner === userId) deleteLectureById(r.lecture_id!);
    else deleteLooseRecording(r.id, workspaceId);
  }
  deleteWorkspaceAskData(db, workspaceId);
  deleteWorkspaceRows(db, workspaceId);
}

/** Revokes the user's Google grants and removes their integrations, as disconnecting does. */
async function removeIntegrations(userId: string): Promise<void> {
  const rows = db.query(`SELECT id, token_enc FROM integration WHERE user_id = ?`).all(userId) as Array<{ id: string; token_enc: string | null }>;
  for (const row of rows) {
    try {
      const tokens = openGoogleTokens(row.token_enc);
      if (tokens) await revokeToken(tokens.refresh_token);
    } catch (err) {
      logger.warn("account deletion: token revoke failed", { integration_id: row.id, err });
    }
    db.transaction(() => {
      db.query(
        `UPDATE event_candidate SET status = 'accepted', updated_at = ?
         WHERE status = 'synced' AND id IN (SELECT event_candidate_id FROM calendar_event_link WHERE integration_id = ?)`
      ).run(Date.now(), row.id);
      db.query(`DELETE FROM calendar_event_link WHERE integration_id = ?`).run(row.id);
      db.query(`DELETE FROM integration WHERE id = ?`).run(row.id);
    })();
    forgetAccessToken(row.id);
  }
}

/** The user's jobs and every job of a removed workspace, with their harness rows and blobs. */
function removeJobs(userId: string, gone: readonly string[]): void {
  const jobIds = (
    db
      .query(`SELECT id FROM job WHERE (owner_id = ? OR workspace_id IN (SELECT value FROM json_each(?))) AND kind != ?`)
      .all(userId, json(gone), ACCOUNT_DELETION_JOB_KIND) as Array<{ id: string }>
  ).map((r) => r.id);
  const artifactJobs = (
    db.query(`SELECT DISTINCT job_id FROM artifact WHERE workspace_id IN (SELECT value FROM json_each(?))`).all(json(gone)) as Array<{ job_id: string }>
  ).map((r) => r.job_id);
  const all = [...new Set([...jobIds, ...artifactJobs])];
  if (all.length) deleteArtifactsForJobs(db, new BlobStore(HARNESS_BLOB_DIR), all);
  db.transaction(() => {
    // Spending stays in the ledger as anonymous usage, as harness retention leaves it.
    db.query(
      `UPDATE ai_call SET job_id = NULL, stage_run_id = NULL, workspace_id = NULL, request_id = NULL
       WHERE job_id IN (SELECT value FROM json_each(?)) OR workspace_id IN (SELECT value FROM json_each(?))`
    ).run(json(all), json(gone));
    db.query(`DELETE FROM stage_run WHERE job_id IN (SELECT value FROM json_each(?)) OR workspace_id IN (SELECT value FROM json_each(?))`).run(json(all), json(gone));
    db.query(`DELETE FROM job_event WHERE owner_id = ? OR workspace_id IN (SELECT value FROM json_each(?))`).run(userId, json(gone));
    db.query(`DELETE FROM job WHERE id IN (SELECT value FROM json_each(?))`).run(json(jobIds));
  })();
}

/** Rows that name the user or a removed workspace, outside what deleteUserAndData removes. */
async function removeUserRows(userId: string, email: string | null, gone: readonly string[]): Promise<void> {
  // The user's uploads: their part files (only theirs: others may be mid-upload), then the rows.
  const uploads = (db.query(`SELECT id FROM upload WHERE user_id = ?`).all(userId) as Array<{ id: string }>).map((r) => r.id);
  if (uploads.length) {
    const { removeParts } = await import("./api/v2/uploads.ts");
    for (const id of uploads) removeParts(id);
  }
  db.query(`DELETE FROM upload_part WHERE upload_id IN (SELECT id FROM upload WHERE user_id = ?)`).run(userId);
  db.query(`DELETE FROM upload WHERE user_id = ?`).run(userId);

  db.transaction(() => {
    for (const { table, column } of USER_TABLES) {
      if (tableExists(table)) db.query(`DELETE FROM ${table} WHERE ${column} = ?`).run(userId);
    }
    for (const table of WORKSPACE_EXTRA_TABLES) {
      if (tableExists(table)) db.query(`DELETE FROM ${table} WHERE workspace_id IN (SELECT value FROM json_each(?))`).run(json(gone));
    }
    db.query(`DELETE FROM audit_logs WHERE target_id IN (SELECT value FROM json_each(?))`).run(json(gone));
    if (email) {
      db.query(`DELETE FROM audit_logs WHERE lower(actor_email) = ? OR instr(lower(detail), ?) > 0`).run(email, email);
      db.query(`DELETE FROM email_verifications WHERE lower(email) = ?`).run(email);
      db.query(`DELETE FROM workspace_invite WHERE lower(email) = ?`).run(email);
    }
    // Rows that belong to others keep existing without the user's id.
    db.query(`UPDATE document_version SET author_id = NULL WHERE author_id = ?`).run(userId);
    db.query(`UPDATE workspace_quota SET updated_by = ? WHERE updated_by = ?`).run(DELETED_USER, userId);
  })();
}

/**
 * Deletes the account if its deletion is scheduled and due. `skipped` (nothing changes) when
 * it is not, when the user became the only owner of a team with members, or while one of the
 * user's jobs is still running (it is asked to stop; the next maintenance run tries again).
 */
export async function executeDeletion(userId: string, now = Date.now()): Promise<"done" | "skipped"> {
  const row = db.query(`SELECT * FROM account_deletion WHERE user_id = ?`).get(userId) as DeletionRow | null;
  if (!row || row.state !== "scheduled" || row.execute_after > now) return "skipped";
  const ref = userRef(userId);
  if (soleOwnerTeams(userId).length || isServerOwner(userId)) {
    logger.info("account deletion waits", { user: ref, reason: isServerOwner(userId) ? "server owner" : "sole owner of a team" });
    return "skipped";
  }
  const running = db
    .query(`SELECT id FROM job WHERE owner_id = ? AND state = 'running' AND kind != ?`)
    .all(userId, ACCOUNT_DELETION_JOB_KIND) as Array<{ id: string }>;
  if (running.length) {
    db.query(`UPDATE job SET cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE id IN (SELECT value FROM json_each(?))`).run(
      now,
      json(running.map((r) => r.id))
    );
    logger.info("account deletion waits", { user: ref, reason: "jobs running", jobs: running.length });
    return "skipped";
  }
  // Nothing of the user's may start while the deletion runs.
  db.query(`DELETE FROM job WHERE owner_id = ? AND state = 'queued' AND kind != ?`).run(userId, ACCOUNT_DELETION_JOB_KIND);

  // Null on a run that resumes after the user row went: the e-mail steps ran before that.
  const email = getUserById(userId)?.email.trim().toLowerCase() ?? null;
  const personal = personalWorkspaceId(userId);
  // Found through the memberships: a team whose workspace row a cut-short run already deleted
  // (removeSoloTeam does that first) is still found, and finished as a solo team.
  const teams = db
    .query(
      `SELECT m.workspace_id AS id, w.id IS NULL AS half_removed,
         (SELECT COUNT(*) FROM membership x WHERE x.workspace_id = m.workspace_id AND x.user_id != ?) AS others
       FROM membership m LEFT JOIN workspace w ON w.id = m.workspace_id
       WHERE m.user_id = ? AND m.workspace_id != ? AND (w.kind = 'team' OR w.id IS NULL)`
    )
    .all(userId, userId, personal) as Array<{ id: string; half_removed: number; others: number }>;
  const soloTeams = teams.filter((t) => t.others === 0 || t.half_removed).map((t) => t.id);
  const gone = [personal, ...soloTeams];

  await removeIntegrations(userId);
  for (const e of db
    .query(`SELECT id, blob_key FROM data_export WHERE user_id = ? OR workspace_id IN (SELECT value FROM json_each(?))`)
    .all(userId, json(gone)) as Array<{ id: string; blob_key: string | null }>) {
    const path = exportFilePath(e.blob_key);
    if (path) rmSync(path, { force: true });
    rmSync(join(config().dataDir, "exports", `${e.id}.zip.tmp`), { force: true });
  }
  for (const team of teams) if (!soloTeams.includes(team.id)) leaveTeam(userId, team.id);
  for (const id of soloTeams) removeSoloTeam(userId, id);
  await removeUserRows(userId, email, gone);
  // The personal workspace and its lectures, files, index, sessions, memberships, the user row.
  if (getUserById(userId)) deleteUserAndData(userId);
  else {
    // A run that resumes after deleteUserAndData: whatever it had not reached yet.
    deleteWorkspaceAskData(db, personal);
    deleteWorkspaceRows(db, personal);
    db.query(`DELETE FROM membership WHERE user_id = ?`).run(userId);
  }
  // Last: deleting lectures can queue follow-up jobs (index, calendar) under the user.
  removeJobs(userId, gone);
  db.query(`DELETE FROM account_deletion WHERE user_id = ?`).run(userId);
  logger.info("account deleted", { user: ref });
  return "done";
}

/** After a finished deletion: its own job rows, the last ones naming the user. */
function removeDeletionJobs(userId: string): void {
  db.query(`DELETE FROM job_event WHERE owner_id = ?`).run(userId);
  db.query(`DELETE FROM job WHERE kind = ? AND (subject_id = ? OR owner_id = ?)`).run(ACCOUNT_DELETION_JOB_KIND, userId, userId);
}

registerJobHandler(
  ACCOUNT_DELETION_JOB_KIND,
  async (job) => {
    const userId = job.subjectId;
    if (!userId) return { ok: true };
    const result = await executeDeletion(userId);
    return { ok: true, result: { result }, followUp: result === "done" ? () => removeDeletionJobs(userId) : undefined };
  },
  { concurrency: 1 }
);
