import { defineRouter, notFound, notImplemented, ok, okPage } from "./common.ts";
import * as F from "./fixtures.ts";

// defineRouter answers 403 on every `admin`-tagged route unless the caller is an operator.
export const adminRouter = defineRouter({
  adminListJobs: (req) => {
    const q = req.query as { state?: string; kind?: string; workspace_id?: string };
    return okPage(
      req,
      F.jobs
        .filter(
          (j) =>
            (q.state === undefined || j.state === q.state) &&
            (q.kind === undefined || j.kind === q.kind) &&
            (q.workspace_id === undefined || j.workspace_id === q.workspace_id)
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    );
  },
  adminGetJob: (req) => {
    const job = F.jobs.find((j) => j.id === req.params.job_id);
    if (!job) return notFound(req, "작업");
    const stageRuns = F.stageRuns.filter((r) => r.job_id === job.id);
    const runIds = new Set(stageRuns.map((r) => r.id));
    return ok(req, { job, stage_runs: stageRuns, ai_calls: F.aiCalls.filter((a) => runIds.has(a.stage_run_id)) });
  },
  adminRetryJob: notImplemented,
  adminListUsage: (req) => {
    const { period } = req.query as { period?: string };
    return okPage(req, F.usage.filter((u) => period === undefined || u.period === period));
  },
});
