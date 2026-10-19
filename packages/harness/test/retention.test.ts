import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  defineStage,
  deleteArtifactsForJobs,
  SWEEP_GRACE_MS,
  sha256Hex,
  sweepHarnessData,
  type Harness,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let harness: Harness;
beforeEach(() => {
  env = testEnv();
  harness = env.harness({ now: () => Date.parse("2026-10-20T00:00:00Z") });
});
afterEach(() => env.close());

/** A stage that stores its text as an extra artifact and makes one metered call. */
const echo = defineStage({
  name: "echo",
  version: 1,
  output: z.object({ text: z.string() }),
  key: (input: { text: string }) => ({ inputs: [sha256Hex(input.text)] }),
  async run(input, ctx) {
    await ctx.putArtifact("text", input.text);
    await ctx.meter({ provider: "gemini", model: "gemini-3.8-flash" }, async () => ({
      usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 10 },
      requestId: `req-${input.text}`,
    }));
    return { text: input.text };
  },
});

const DAY = 24 * 3600_000;
const age = (path: string, ms: number) => {
  const t = new Date(Date.now() - ms);
  utimesSync(path, t, t);
};

describe("deleteArtifactsForJobs", () => {
  test("deletes the jobs' artifacts and the blobs only they referenced", async () => {
    const a = await harness.job({ jobId: env.job("a"), scope: "ws" }).run(echo, { text: "shared" });
    await harness.job({ jobId: env.job("b"), scope: "ws" }).run(echo, { text: "shared" }); // cache hit, same blobs
    const c = await harness.job({ jobId: env.job("c"), scope: "ws" }).run(echo, { text: "only c" });

    expect(deleteArtifactsForJobs(env.db, harness.blobs, ["a", "c"])).toEqual({ artifacts: 4, blobs: 2 });
    expect(harness.blobs.has(a.output.sha256)).toBe(true); // still referenced by job b
    expect(harness.blobs.has(c.output.sha256)).toBe(false);
    expect(harness.blobs.has(sha256Hex("only c"))).toBe(false);
    expect(rows(env.db, `SELECT DISTINCT job_id FROM artifact`)).toEqual([{ job_id: "b" }]);
    // Job records stay with the job (30-day rule); only content went.
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM stage_run`)).toEqual([{ n: 3 }]);
  });
});

describe("sweepHarnessData", () => {
  test("a pruned job takes its stage runs, artifacts and blobs along; its ai_call rows become anonymous", async () => {
    const gone = await harness.job({ jobId: env.job("gone"), scope: "ws" }).run(echo, { text: "old" });
    await harness.job({ jobId: env.job("kept"), scope: "ws" }).run(echo, { text: "new" });
    env.db.query(`UPDATE ai_call SET workspace_id = 'ws-1'`).run();
    env.db.query(`DELETE FROM job WHERE id = 'gone'`).run(); // what pruneFinishedJobs does after 30 days

    expect(sweepHarnessData(env.db, harness.blobs)).toEqual({
      stageRuns: 1,
      artifacts: 2,
      detachedAiCalls: 1,
      blobs: 2, // orphaned rows' blobs go at once, without waiting for the grace period
      tmpFiles: 0,
    });
    expect(harness.blobs.has(gone.output.sha256)).toBe(false);
    expect(rows(env.db, `SELECT job_id FROM stage_run`)).toEqual([{ job_id: "kept" }]);
    expect(
      rows(
        env.db,
        `SELECT job_id, stage_run_id, workspace_id, request_id, input_tokens, cost_microusd FROM ai_call ORDER BY job_id`
      )
    ).toEqual([
      { job_id: null, stage_run_id: null, workspace_id: null, request_id: null, input_tokens: 100, cost_microusd: 113 },
      {
        job_id: "kept",
        stage_run_id: expect.any(String),
        workspace_id: "ws-1",
        request_id: "req-new",
        input_tokens: 100,
        cost_microusd: 113,
      },
    ]);
    // A second pass finds nothing.
    expect(sweepHarnessData(env.db, harness.blobs)).toEqual({
      stageRuns: 0,
      artifacts: 0,
      detachedAiCalls: 0,
      blobs: 0,
      tmpFiles: 0,
    });
  });

  test("artifact rows whose stage run was deleted underneath a running job are swept", async () => {
    const res = await harness.job({ jobId: env.job("j"), scope: "ws" }).run(echo, { text: "raced" });
    env.db.query(`DELETE FROM stage_run WHERE id = ?`).run(res.stageRunId);
    expect(sweepHarnessData(env.db, harness.blobs)).toMatchObject({ artifacts: 2, blobs: 2 });
  });

  test("unreferenced blobs and tmp files survive the grace period, then go; referenced blobs never do", async () => {
    const referenced = await harness.job({ jobId: env.job("j"), scope: "ws" }).run(echo, { text: "in use" });
    const fresh = await harness.blobs.putBytes("written by a stage still running");
    const stale = await harness.blobs.putBytes("left behind by a crash");
    age(harness.blobs.path(stale.sha256), SWEEP_GRACE_MS + 1000);
    age(harness.blobs.path(referenced.output.sha256), 30 * DAY);
    mkdirSync(join(env.blobDir, "tmp"), { recursive: true });
    const freshTmp = join(env.blobDir, "tmp", "in-progress");
    const staleTmp = join(env.blobDir, "tmp", "crashed-write");
    writeFileSync(freshTmp, "x");
    writeFileSync(staleTmp, "x");
    age(staleTmp, 2 * DAY);

    expect(sweepHarnessData(env.db, harness.blobs)).toMatchObject({ blobs: 1, tmpFiles: 1 });
    expect(harness.blobs.has(stale.sha256)).toBe(false);
    expect(harness.blobs.has(fresh.sha256)).toBe(true);
    expect(harness.blobs.has(referenced.output.sha256)).toBe(true);
    expect(existsSync(staleTmp)).toBe(false);
    expect(existsSync(freshTmp)).toBe(true);
  });

  test("reusing an existing blob refreshes its age, so a stage about to record it does not lose it", async () => {
    const old = await harness.blobs.putBytes("same content");
    age(harness.blobs.path(old.sha256), 2 * DAY);
    await harness.blobs.putBytes("same content"); // a running stage produced it again
    expect(sweepHarnessData(env.db, harness.blobs).blobs).toBe(0);
    expect(harness.blobs.has(old.sha256)).toBe(true);
  });

  test("a store nothing was ever written to is a no-op and creates no directories", () => {
    expect(sweepHarnessData(env.db, harness.blobs)).toEqual({
      stageRuns: 0,
      artifacts: 0,
      detachedAiCalls: 0,
      blobs: 0,
      tmpFiles: 0,
    });
    expect(existsSync(env.blobDir)).toBe(false);
  });
});
