import { db } from "../../db.ts";
import { cancelQueuedJobs } from "../../queue.ts";
import { callerIn, loadRecording } from "./access.ts";
import { apiError, defineRouter, notFound, ok, type V2Request } from "./common.ts";
import type { QueueJobRow } from "./rows.ts";
import { toJob } from "./store.ts";

/** Kinds a user may cancel: the ones that process a recording. */
const CANCELABLE_KINDS = new Set(["process", "regenerate", "distill"]);
const FINISHED_STATES = new Set(["succeeded", "failed", "canceled"]);

/**
 * The job row if the caller may see it (getJob's rule; `update` also needs the right to
 * change the recording). Someone else's job is not found, not forbidden.
 */
function visibleJob(req: V2Request, action: "recording:read" | "recording:update"): { row: QueueJobRow; job: ReturnType<typeof toJob> } | null {
  const row = db.query(`SELECT * FROM job WHERE id = ?`).get(String(req.params.job_id)) as QueueJobRow | null;
  if (!row) return null;
  const job = toJob(row);
  if (!job.workspace_id || !callerIn(req, job.workspace_id).role) return null;
  if (job.recording_id && loadRecording(req, job.recording_id, action) instanceof Response) return null;
  return { row, job };
}

export const jobsRouter = defineRouter({
  // A recording's job is visible to whoever can see the recording; system jobs (no
  // workspace) only through /admin/jobs.
  getJob: (req) => {
    const found = visibleJob(req, "recording:read");
    return found ? ok(req, found.job) : notFound(req, "작업");
  },
  // D-P1-8: a queued job is canceled at once; a running one is marked and stops before its
  // next stage (its handler watches cancel_requested_at), so it comes back still `running`.
  cancelJob: (req) => {
    const found = visibleJob(req, "recording:update");
    if (!found) return notFound(req, "작업");
    const { row } = found;
    if (!CANCELABLE_KINDS.has(row.kind)) return apiError(req.c, 409, "conflict", "취소할 수 없는 작업입니다.");
    if (FINISHED_STATES.has(row.state)) return apiError(req.c, 409, "conflict", "이미 끝난 작업입니다.");
    db.query(`UPDATE job SET cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE id = ? AND state IN ('queued', 'running')`).run(
      Date.now(),
      row.id
    );
    cancelQueuedJobs(row.id);
    const now = db.query(`SELECT * FROM job WHERE id = ?`).get(row.id) as QueueJobRow;
    return ok(req, toJob(now));
  },
});
