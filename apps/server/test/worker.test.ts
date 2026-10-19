import "./preload.ts"; // must stay first: sandboxes DB/HOME before db.ts loads
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, ensureBootstrapOwner } from "../src/db.ts";
import { enqueueJob } from "../src/queue.ts";
import { liveWorkers } from "../src/coordination.ts";

const REPO = join(import.meta.dir, "../../..");

function spawnWorker(markerDir: string) {
  return Bun.spawn(
    ["bun", join(import.meta.dir, "fixtures/worker-with-test-handlers.ts")],
    {
      cwd: REPO,
      env: {
        ...process.env,
        LECTERN_WORKER_MODE: "external",
        LECTERN_JOB_LEASE_TTL_MS: "1500",
        LECTERN_JOB_POLL_MS: "100",
        LECTERN_SHUTDOWN_GRACE_SEC: "2",
        LECTERN_TEST_MARKER_DIR: markerDir,
      },
      stdout: "ignore",
      stderr: "ignore",
    }
  );
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

describe("lectern-worker process", () => {
  test(
    "a job survives SIGKILL of its worker: the next worker reclaims it and finishes it",
    async () => {
      const markers = mkdtempSync(join(tmpdir(), "lectern-worker-markers-"));
      const { jobId } = enqueueJob({
        kind: "test-sleep", // not registered in this process, so only the spawned workers run it
        ownerId: ensureBootstrapOwner().id,
        subjectId: `sigkill-${Date.now()}`,
      });
      const first = spawnWorker(markers);
      try {
        await waitFor(() => existsSync(join(markers, `${jobId}.0`)), 15_000);
        expect(liveWorkers().length).toBeGreaterThanOrEqual(1);
        first.kill(9);
        await first.exited;
        expect((db.query(`SELECT state FROM job WHERE id = ?`).get(jobId) as any).state).toBe("running");

        const second = spawnWorker(markers);
        try {
          await waitFor(
            () => (db.query(`SELECT state FROM job WHERE id = ?`).get(jobId) as any).state === "succeeded",
            15_000
          );
          const row = db.query(`SELECT attempts, result, lease_owner, idempotency_key FROM job WHERE id = ?`).get(jobId) as any;
          expect(row.attempts).toBe(1); // one interruption: the SIGKILL
          expect(JSON.parse(row.result)).toEqual({ finishedOnAttempt: 1 });
          expect(row.lease_owner).toBeNull();
          expect(row.idempotency_key).toBeNull();
          expect(existsSync(join(markers, `${jobId}.1`))).toBe(true);
        } finally {
          second.kill("SIGTERM");
          expect(await second.exited).toBe(0); // graceful: drains and exits cleanly
        }
      } finally {
        if (!first.killed) first.kill(9);
        rmSync(markers, { recursive: true, force: true });
      }
    },
    60_000
  );

  test("refuses to start unless LECTERN_WORKER_MODE=external", async () => {
    const proc = Bun.spawn(["bun", join(REPO, "apps/worker/src/index.ts")], {
      cwd: REPO,
      env: { ...process.env, LECTERN_WORKER_MODE: "embedded" },
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(2);
    expect(await new Response(proc.stderr).text()).toContain("LECTERN_WORKER_MODE=external");
  });
});

describe("API/worker coordination", () => {
  test("release record and worker heartbeats", async () => {
    const { publishApiRelease, readApiRelease, writeWorkerHeartbeat, removeWorkerHeartbeat } = await import(
      "../src/coordination.ts"
    );
    publishApiRelease("abc123");
    expect(readApiRelease()?.sha).toBe("abc123");
    writeWorkerHeartbeat("unit-worker", { pid: 1, sha: "abc123", active: 0 });
    expect(liveWorkers().some((w) => w.id === "unit-worker" && w.sha === "abc123")).toBe(true);
    expect(liveWorkers(60_000, Date.now() + 120_000).some((w) => w.id === "unit-worker")).toBe(false); // stale
    removeWorkerHeartbeat("unit-worker");
    expect(liveWorkers().some((w) => w.id === "unit-worker")).toBe(false);
  });
});
