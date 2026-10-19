// lectern-worker: runs queued jobs and the maintenance schedule outside the API process
// (systemd lectern-worker.service, LECTERN_WORKER_MODE=external). It shares the API's
// SQLite database and data directory and must never import apps/server/src/index.ts,
// whose module-level boot code belongs to the API.

import { config } from "@lectern/config";
import { db } from "../../server/src/db.ts";
import "../../server/src/job-handlers.ts"; // registers the distill/compact handlers
import { readApiRelease, removeWorkerHeartbeat, writeWorkerHeartbeat } from "../../server/src/coordination.ts";
import { startMaintenanceSchedule } from "../../server/src/maintenance.ts";
import { resolveGitSha } from "../../server/src/ops.ts";
import { JobWorker } from "../../server/src/queue.ts";
import { logger } from "../../server/src/log.ts";
import { isFfmpegAvailable } from "../../server/src/storage.ts";

if (config().workerMode !== "external") {
  logger.error(
    "lectern-worker only runs with LECTERN_WORKER_MODE=external; in embedded mode the API process runs jobs itself"
  );
  process.exit(2);
}

const sha = resolveGitSha();
const bootAt = Date.now();
const worker = new JobWorker();
worker.start();
const stopMaintenance = startMaintenanceSchedule();
isFfmpegAvailable(); // logs a warning when compaction cannot run

const beat = () => {
  try {
    writeWorkerHeartbeat(worker.id, { pid: process.pid, sha, active: worker.activeCount });
  } catch (err) {
    logger.error("worker heartbeat failed", { err });
  }
};
beat();
// The one timer that is NOT unref'd: the queue's own timers are (so an embedded worker never
// keeps the API or a test alive), and without a referenced timer this daemon would exit
// as soon as it started.
setInterval(beat, 5_000);

// The CD deploy restarts only the API. When the API reports a newer release than ours,
// finish (or hand back) running jobs and exit; systemd restarts us on the new code.
setInterval(() => {
  const release = readApiRelease();
  if (release && release.sha !== "unknown" && release.sha !== sha && release.at > bootAt) {
    void shutdown(`API is on release ${release.sha.slice(0, 7)}`);
  }
}, 15_000).unref();

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("lectern-worker shutting down", { reason });
  stopMaintenance();
  const drained = await worker.drain(config().shutdownGraceMs);
  if (!drained) logger.warn("jobs still running at shutdown were handed back to the queue");
  try {
    removeWorkerHeartbeat(worker.id);
    db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

logger.info("lectern-worker started", { worker_id: worker.id, sha: sha.slice(0, 7) });
