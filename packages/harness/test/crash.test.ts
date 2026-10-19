// Kill the process in the middle of a stage (SIGKILL: no finally, no cleanup), then run
// the same job again: finished stages must not run again, the interrupted one must.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BlobStore, canonicalJson, sha256Hex } from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

const FIXTURE = join(import.meta.dir, "fixtures/crash-pipeline.ts");

let env: TestEnv;
let markers: string;
beforeEach(() => {
  env = testEnv();
  markers = join(env.dir, "markers");
  mkdirSync(markers);
});
afterEach(() => env.close());

async function runPipeline(jobId: string, crashAt: "none" | "in-run" | "after-blob") {
  const proc = Bun.spawn(["bun", FIXTURE, env.dbPath, env.blobDir, jobId, markers, crashAt], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return { stdout, stderr, signal: proc.signalCode };
}

const executions = (stage: string) =>
  existsSync(join(markers, stage)) ? readFileSync(join(markers, stage), "utf8").length : 0;

describe("crash and resume", () => {
  test("killed inside a stage: the next run skips the finished stage and resumes the interrupted run", async () => {
    const crashed = await runPipeline("job-crash", "in-run");
    expect(crashed.signal).toBe("SIGKILL");
    expect(rows(env.db, `SELECT stage, state, attempts FROM stage_run ORDER BY started_at`)).toEqual([
      { stage: "double", state: "succeeded", attempts: 1 },
      { stage: "square", state: "running", attempts: 1 },
    ]);

    const resumed = await runPipeline("job-crash", "none");
    expect(resumed.stderr).toBe("");
    expect(JSON.parse(resumed.stdout)).toEqual({ n: 36 });
    expect(executions("double")).toBe(1);
    expect(executions("square")).toBe(2);
    // Same row, resumed in place: one run per stage, the interruption counted as an attempt.
    expect(rows(env.db, `SELECT stage, state, attempts, cache_hit FROM stage_run ORDER BY started_at`)).toEqual([
      { stage: "double", state: "succeeded", attempts: 1, cache_hit: 0 },
      { stage: "square", state: "succeeded", attempts: 2, cache_hit: 0 },
    ]);
  }, 30_000);

  test("killed after the blob was written but before it was recorded: the rerun commits the same blob", async () => {
    const crashed = await runPipeline("job-commit", "after-blob");
    expect(crashed.signal).toBe("SIGKILL");
    const outputSha = sha256Hex(canonicalJson({ n: 36 }));
    expect(new BlobStore(env.blobDir).has(outputSha)).toBe(true); // step 1 done...
    expect(rows(env.db, `SELECT 1 FROM artifact WHERE sha256 = ?`, outputSha)).toEqual([]); // ...step 2 not
    expect(rows(env.db, `SELECT state FROM stage_run WHERE stage = 'square'`)).toEqual([{ state: "running" }]);

    const resumed = await runPipeline("job-commit", "none");
    expect(JSON.parse(resumed.stdout)).toEqual({ n: 36 });
    expect(executions("double")).toBe(1);
    expect(executions("square")).toBe(2);
    expect(rows(env.db, `SELECT kind FROM artifact WHERE sha256 = ?`, outputSha)).toEqual([{ kind: "square" }]);
    expect(rows(env.db, `SELECT state, attempts FROM stage_run WHERE stage = 'square'`)).toEqual([
      { state: "succeeded", attempts: 2 },
    ]);
    expect(readdirSync(join(env.blobDir, "tmp"))).toEqual([]);
  }, 30_000);

  test("a finished job run again does no work at all", async () => {
    await runPipeline("job-done", "none");
    const again = await runPipeline("job-done", "none");
    expect(JSON.parse(again.stdout)).toEqual({ n: 36 });
    expect(executions("double")).toBe(1);
    expect(executions("square")).toBe(1);
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM stage_run`)).toEqual([{ n: 2 }]);
  }, 30_000);
});
