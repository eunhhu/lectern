// Entry point for worker.test.ts: registers a test-only job kind, then boots the real
// lectern-worker entry (apps/worker/src/index.ts) in the same module graph. The kind
// marks each attempt and sleeps on the first one, so the test can SIGKILL the worker
// mid-job and check that the next worker reclaims and finishes it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerJobHandler } from "../../src/queue.ts";

const markerDir = process.env.LECTERN_TEST_MARKER_DIR!;

registerJobHandler(
  "test-sleep",
  async (job) => {
    writeFileSync(join(markerDir, `${job.id}.${job.attempts}`), String(process.pid));
    if (job.attempts === 0) await Bun.sleep(30_000);
    return { ok: true, result: { finishedOnAttempt: job.attempts } };
  },
  { concurrency: 1 }
);

await import("../../../worker/src/index.ts");
