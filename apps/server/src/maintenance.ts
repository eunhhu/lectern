// The maintenance schedule, run by whichever process runs jobs: the API in embedded mode,
// apps/worker in external mode (never both, so there is one scheduler). The admin
// "run now" endpoint may still call runMaintenance() from the API; two overlapping runs
// are benign (concurrent trash moves fail harmlessly and every step is idempotent).

import { config } from "@lectern/config";
import { toLectureSummaryDto } from "./dto.ts";
import { emitLectureEvent } from "./events.ts";
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
          console.log(
            `Maintenance: sessions -${r.expiredSessions}, codes -${r.expiredCodes}, audit -${r.prunedAuditLogs}, events -${r.prunedJobEvents ?? 0}, jobs -${r.prunedJobs ?? 0}, orphans→trash ${r.orphanFiles.count}, retention ${r.retention.count}/${r.failedRetention.count}, backup ${r.backup?.file ?? "-"}, errors ${r.errors.length}`
          );
        }
      })
      .catch((err) => console.error("Maintenance failed:", err));
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
