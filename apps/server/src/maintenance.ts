// The maintenance schedule, run by whichever process runs jobs: the API in embedded mode,
// apps/worker in external mode (never both, so there is one scheduler). The admin
// "run now" endpoint may still call runMaintenance() from the API; two overlapping runs
// are benign (concurrent trash moves fail harmlessly and every step is idempotent).

import { config } from "@lectern/config";
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
        if (r.errors.length || r.orphanFiles.count || r.backup || r.retention.count || r.failedRetention.count) {
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
            errors: r.errors.length,
          });
        }
      })
      .catch((err) => logger.error("maintenance failed", { err }));
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
