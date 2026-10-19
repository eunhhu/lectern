import { db } from "../../db.ts";
import { loadRecording, roleIn } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok } from "./common.ts";
import type { QueueJobRow } from "./rows.ts";
import { toJob } from "./store.ts";

export const jobsRouter = defineRouter({
  // A recording's job is visible to whoever can see the recording; system jobs (no
  // workspace) only through /admin/jobs.
  getJob: (req) => {
    const row = db.query(`SELECT * FROM job WHERE id = ?`).get(String(req.params.job_id)) as QueueJobRow | null;
    if (!row) return notFound(req, "작업");
    const job = toJob(row);
    if (!job.workspace_id || !roleIn(req.user!.id, job.workspace_id)) return notFound(req, "작업");
    if (job.recording_id && loadRecording(req, job.recording_id) instanceof Response) return notFound(req, "작업");
    return ok(req, job);
  },
  // The v1 queue has no cancel; the harness adds it (AI_HARNESS §4).
  cancelJob: notImplemented,
});
