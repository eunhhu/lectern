import { defineRouter, notFound, notImplemented, ok } from "./common.ts";
import * as F from "./fixtures.ts";

export const jobsRouter = defineRouter({
  getJob: (req) => {
    // System jobs (no workspace) are only visible through /admin/jobs.
    const job = F.jobs.find((j) => j.id === req.params.job_id && j.workspace_id !== null);
    return job ? ok(req, job) : notFound(req, "작업");
  },
  cancelJob: notImplemented,
});
