// The maintenance schedule, run by whichever process runs jobs: the API in embedded mode,
// apps/worker in external mode (never both, so there is one scheduler). The admin
// "run now" endpoint may still call runMaintenance() from the API; two overlapping runs
// are benign (concurrent trash moves fail harmlessly and every step is idempotent).

import { config } from "@lectern/config";
import { runAskUpkeep } from "./ask/index-job.ts";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
import { logger } from "./log.ts";
import { runMaintenance } from "./ops.ts";
import { isLectureBusy } from "./queue.ts";
import type { RetentionOutcome } from "./storage.ts";

/** Tells clients about lectures retention changed (audio removed or lecture deleted). */
export function emitRetentionOutcome(outcome: RetentionOutcome): void {
  for (const item of outcome.audioRemoved) {
    if (item.lecture) {
      emitLectureEvent(item.owner_id, {
        type: "updated",
        id: item.id,
        lecture: toLectureSummaryDto(item.lecture),
      });
    }
  }
  for (const item of outcome.deleted) {
    emitLectureEvent(item.owner_id, { type: "deleted", id: item.id, ids: [item.id] });
  }
}

export function runMaintenanceNow(forceBackup = false) {
  return runMaintenance({
    forceBackup,
    isBusy: (lectureId) => isLectureBusy(lectureId),
    onRetention: emitRetentionOutcome,
  });
}

/** First run two minutes after boot, then every LECTERN_MAINTENANCE_INTERVAL_MIN. */
export function startMaintenanceSchedule(): () => void {
  const run = () => {
    runMaintenanceNow()
      .then((r) => {
        const harness = r.harnessCleanup;
        const harnessChanged = harness ? Object.values(harness).some((n) => n > 0) : false;
        if (
          r.errors.length ||
          r.orphanFiles.count ||
          r.backup ||
          r.retention.count ||
          r.failedRetention.count ||
          harnessChanged
        ) {
          logger.info("maintenance", {
            expired_sessions: r.expiredSessions,
            expired_codes: r.expiredCodes,
            pruned_audit_logs: r.prunedAuditLogs,
            pruned_job_events: r.prunedJobEvents ?? 0,
            pruned_jobs: r.prunedJobs ?? 0,
            orphans_trashed: r.orphanFiles.count,
            retention: r.retention.count,
            failed_retention: r.failedRetention.count,
            backup: r.backup?.file ?? null,
            pruned_snapshots: r.prunedSnapshots?.count ?? 0,
            harness_stage_runs: harness?.stageRuns ?? 0,
            harness_artifacts: harness?.artifacts ?? 0,
            harness_blobs: harness?.blobs ?? 0,
            harness_tmp_files: harness?.tmpFiles ?? 0,
            detached_ai_calls: harness?.detachedAiCalls ?? 0,
            errors: r.errors.length,
          });
        }
      })
      .catch((err) => logger.error("maintenance failed", { err }));
    try {
      const ask = runAskUpkeep();
      if (ask.queued || ask.removed || ask.staleTurns) {
        logger.info("ask upkeep", { index_jobs_queued: ask.queued, index_orphans_removed: ask.removed, stale_turns: ask.staleTurns });
      }
    } catch (err) {
      logger.error("ask upkeep failed", { err });
    }
  };
  const first = setTimeout(run, 2 * 60_000);
  first.unref?.();
  const every = setInterval(run, config().maintenanceIntervalMin * 60_000);
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
