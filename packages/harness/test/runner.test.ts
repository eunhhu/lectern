import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  BlobStore,
  canonicalJson,
  defineStage,
  HarnessError,
  sha256Hex,
  stageKey,
  type StageEvent,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
beforeEach(() => {
  env = testEnv();
});
afterEach(() => env.close());

/** A stage that counts its executions; `prompt` stands in for a prompt file's content. */
function counted(opts: { prompt?: string; version?: number; memo?: "shared" | "job" } = {}) {
  const calls: number[] = [];
  const stage = defineStage({
    name: "summarize",
    version: opts.version ?? 1,
    memo: opts.memo,
    output: z.object({ summary: z.string() }),
    key: (input: { text: string }) => ({
      inputs: [sha256Hex(input.text)],
      prompt: sha256Hex(opts.prompt ?? "Summarize."),
      model: "gemini-3.8-flash",
    }),
    async run(input) {
      calls.push(Date.now());
      return { summary: input.text.toUpperCase() };
    },
  });
  return { stage, calls };
}

describe("memoization", () => {
  test("a second job with the same key reuses the output: cache_hit row, no execution, own artifact rows", async () => {
    const harness = env.harness();
    const { stage, calls } = counted();
    const first = await harness.job({ jobId: env.job("job-1"), scope: "ws-1" }).run(stage, { text: "hello" });
    const events: StageEvent[] = [];
    const second = await harness
      .job({ jobId: env.job("job-2"), scope: "ws-1", onEvent: (e) => events.push(e) })
      .run(stage, { text: "hello" });

    expect(calls.length).toBe(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.value).toEqual({ summary: "HELLO" });
    expect(second.output.sha256).toBe(first.output.sha256);
    expect(second.output.id).not.toBe(first.output.id);
    expect(events.map((e) => e.type)).toEqual(["cache_hit"]);

    const runs = rows(env.db, `SELECT job_id, state, cache_hit, attempts, stage_key FROM stage_run ORDER BY job_id`);
    expect(runs).toEqual([
      { job_id: "job-1", state: "succeeded", cache_hit: 0, attempts: 1, stage_key: runs[0].stage_key },
      { job_id: "job-2", state: "succeeded", cache_hit: 1, attempts: 0, stage_key: runs[0].stage_key },
    ]);
    const artifacts = rows(env.db, `SELECT job_id, sha256, kind FROM artifact ORDER BY job_id`);
    expect(artifacts).toEqual([
      { job_id: "job-1", sha256: first.output.sha256, kind: "summarize" },
      { job_id: "job-2", sha256: first.output.sha256, kind: "summarize" },
    ]);
    // The blob holds the canonical JSON of the output, stored once.
    expect(harness.blobs.readText(first.output.sha256)).toBe(canonicalJson({ summary: "HELLO" }));
  });

  test("a changed prompt, stage version or input misses; another scope never hits", async () => {
    const harness = env.harness();
    const base = counted();
    await harness.job({ jobId: env.job("j1"), scope: "ws-1" }).run(base.stage, { text: "hello" });

    const editedPrompt = counted({ prompt: "Summarize in Korean." });
    await harness.job({ jobId: env.job("j2"), scope: "ws-1" }).run(editedPrompt.stage, { text: "hello" });
    expect(editedPrompt.calls.length).toBe(1);

    const bumped = counted({ version: 2 });
    await harness.job({ jobId: env.job("j3"), scope: "ws-1" }).run(bumped.stage, { text: "hello" });
    expect(bumped.calls.length).toBe(1);

    const again = counted();
    await harness.job({ jobId: env.job("j4"), scope: "ws-1" }).run(again.stage, { text: "hello!" });
    await harness.job({ jobId: env.job("j5"), scope: "ws-2" }).run(again.stage, { text: "hello" });
    expect(again.calls.length).toBe(2);

    await harness.job({ jobId: env.job("j6"), scope: "ws-1" }).run(again.stage, { text: "hello" });
    expect(again.calls.length).toBe(2); // the original prompt/version/input in ws-1: a hit
  });

  test("the key is order-insensitive for inputs and object members, and covers every §4.4 part", () => {
    const stage = { name: "s", version: 1 };
    const a = stageKey(stage, "ws", { inputs: ["b", "a"], params: { temperature: 0.2, schema: "x" } });
    const b = stageKey(stage, "ws", { inputs: ["a", "b"], params: { schema: "x", temperature: 0.2 } });
    expect(a).toBe(b);
    const parts = { inputs: ["a"], prompt: "p", template: "t@1", provider: "gemini", model: "m", params: 1, config: 1 };
    const keys = new Set([stageKey(stage, "ws", parts)]);
    for (const [k, v] of Object.entries({ prompt: "p2", template: "t@2", provider: "x", model: "m2", params: 2, config: 2 })) {
      keys.add(stageKey(stage, "ws", { ...parts, [k]: v }));
    }
    expect(keys.size).toBe(7);
  });

  test('memo "job" stages reuse only within the job that produced the output', async () => {
    const harness = env.harness();
    const { stage, calls } = counted({ memo: "job" });
    const run = harness.job({ jobId: env.job("j1"), scope: "ws" });
    await run.run(stage, { text: "x" });
    const resumed = await run.run(stage, { text: "x" });
    expect(resumed.resumed).toBe(true);
    expect(calls.length).toBe(1);
    await harness.job({ jobId: env.job("j2"), scope: "ws" }).run(stage, { text: "x" });
    expect(calls.length).toBe(2);
  });

  test("a hit whose blob is gone runs the stage again", async () => {
    const harness = env.harness();
    const { stage, calls } = counted();
    const first = await harness.job({ jobId: env.job("j1"), scope: "ws" }).run(stage, { text: "x" });
    harness.blobs.delete(first.output.sha256);
    const second = await harness.job({ jobId: env.job("j2"), scope: "ws" }).run(stage, { text: "x" });
    expect(second.cacheHit).toBe(false);
    expect(calls.length).toBe(2);
    expect(harness.blobs.has(first.output.sha256)).toBe(true);
  });
});

describe("artifacts and blobs", () => {
  test("blobs are owner-only (dirs 0700, files 0600) and extra artifacts are linked on success", async () => {
    const harness = env.harness();
    const stage = defineStage({
      name: "normalize",
      version: 1,
      output: z.object({ audio: z.string() }),
      key: () => ({ inputs: ["raw"] }),
      async run(_input: null, ctx) {
        const audio = await ctx.putArtifact("audio", new Uint8Array([1, 2, 3]));
        return { audio: audio.sha256 };
      },
    });
    const res = await harness.job({ jobId: env.job("j"), scope: "ws" }).run(stage, null);
    const kinds = rows(env.db, `SELECT kind FROM artifact WHERE stage_run_id = ? ORDER BY kind`, res.stageRunId);
    expect(kinds.map((k) => k.kind)).toEqual(["audio", "normalize"]);
    const output = JSON.parse(rows(env.db, `SELECT output_json FROM stage_run`)[0].output_json);
    expect(output.output).toBe(res.output.id);
    expect(output.artifacts.length).toBe(2);

    expect(statSync(env.blobDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(env.blobDir, "sha256")).mode & 0o777).toBe(0o700);
    const blobPath = harness.blobs.path(res.value.audio);
    expect(statSync(blobPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(blobPath, "..")).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(env.blobDir, "tmp"))).toEqual([]);
  });

  test("putFile streams a file in and dedupes equal content", async () => {
    const store = new BlobStore(env.blobDir);
    const src = join(env.dir, "in.bin");
    await Bun.write(src, "same bytes");
    const a = await store.putFile(src);
    const b = await store.putBytes("same bytes");
    expect(a).toEqual(b);
    expect(a.sha256).toBe(sha256Hex("same bytes"));
    expect(readdirSync(join(env.blobDir, "tmp"))).toEqual([]);
  });

  test("deleteArtifactsForJob removes the job's rows and only blobs nobody else references", async () => {
    const harness = env.harness();
    const { stage } = counted();
    const a = await harness.job({ jobId: env.job("j1"), scope: "ws" }).run(stage, { text: "shared" });
    await harness.job({ jobId: env.job("j2"), scope: "ws" }).run(stage, { text: "shared" }); // hit: same blob
    const own = await harness.job({ jobId: env.job("j3"), scope: "ws" }).run(stage, { text: "mine" });

    expect(harness.deleteArtifactsForJob("j1")).toEqual({ artifacts: 1, blobs: 0 });
    expect(harness.blobs.has(a.output.sha256)).toBe(true); // j2 still references it
    expect(harness.deleteArtifactsForJob("j2")).toEqual({ artifacts: 1, blobs: 1 });
    expect(harness.blobs.has(a.output.sha256)).toBe(false);
    expect(harness.blobs.has(own.output.sha256)).toBe(true);
  });
});

describe("retries and failure classes (§4.5)", () => {
  function flaky(failures: unknown[]) {
    let n = 0;
    return defineStage({
      name: "flaky",
      version: 1,
      output: z.object({ n: z.number() }),
      key: () => ({}),
      async run() {
        const failure = failures[n++];
        if (failure) throw failure;
        return { n };
      },
    });
  }

  test("transient errors retry on the same row with backoff, honoring retry-after", async () => {
    const sleeps: number[] = [];
    const harness = env.harness({ sleep: async (ms) => void sleeps.push(ms) });
    const events: StageEvent[] = [];
    const stage = flaky([
      new HarnessError("transient", "Gemini generateContent failed (503)"),
      new HarnessError("transient", "Gemini generateContent failed (429)", { retryAfterMs: 30_000 }),
    ]);
    const res = await harness.job({ jobId: env.job("j"), scope: "ws", onEvent: (e) => events.push(e) }).run(stage, null);
    expect(res.value).toEqual({ n: 3 });
    expect(rows(env.db, `SELECT state, attempts, error FROM stage_run`)).toEqual([
      { state: "succeeded", attempts: 3, error: null },
    ]);
    expect(sleeps[0]).toBeGreaterThanOrEqual(500);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
    expect(sleeps[1]).toBe(30_000);
    const retries = events.filter((e) => e.type === "retry") as Array<Extract<StageEvent, { type: "retry" }>>;
    expect(retries.map((e) => [e.attempt, e.maxAttempts])).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  test("transient errors give up after maxAttempts and the run is failed with the original message", async () => {
    const harness = env.harness();
    const err = () => new Error("fetch failed");
    const stage = flaky([err(), err(), err()]);
    const failure = await harness
      .job({ jobId: env.job("j"), scope: "ws" })
      .run(stage, null)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HarnessError);
    expect(failure.kind).toBe("transient");
    expect(failure.message).toBe("fetch failed");
    expect(rows(env.db, `SELECT state, attempts, error FROM stage_run`)).toEqual([
      { state: "failed", attempts: 3, error: "fetch failed" },
    ]);
  });

  test("input and config errors fail at once", async () => {
    const harness = env.harness();
    for (const [i, kind] of (["input", "config", "canceled"] as const).entries()) {
      const stage = flaky([new HarnessError(kind, `${kind} problem`)]);
      const failure = await harness
        .job({ jobId: env.job(`j${i}`), scope: "ws" })
        .run(stage, null)
        .catch((e) => e);
      expect(failure.kind).toBe(kind);
    }
    expect(rows(env.db, `SELECT DISTINCT attempts FROM stage_run`)).toEqual([{ attempts: 1 }]);
  });

  test("an invalid output gets one repair attempt that is told what was wrong", async () => {
    const harness = env.harness();
    const seen: Array<string | null> = [];
    const stage = defineStage({
      name: "structure",
      version: 1,
      output: z.object({ title: z.string().min(1) }),
      key: () => ({}),
      async run(_input: null, ctx) {
        seen.push(ctx.repair?.issues ?? null);
        return { title: ctx.repair ? "고친 제목" : "" };
      },
    });
    const res = await harness.job({ jobId: env.job("j"), scope: "ws" }).run(stage, null);
    expect(res.value.title).toBe("고친 제목");
    expect(seen[0]).toBeNull();
    expect(seen[1]).toContain("structure output failed validation");

    const neverValid = defineStage({ ...stage, name: "structure_bad", run: async () => ({ title: "" }) });
    const failure = await harness
      .job({ jobId: env.job("j2"), scope: "ws" })
      .run(neverValid, null)
      .catch((e) => e);
    expect(failure.kind).toBe("output_validation");
    expect(rows(env.db, `SELECT attempts, state FROM stage_run WHERE stage = 'structure_bad'`)).toEqual([
      { attempts: 2, state: "failed" },
    ]);
  });

  test("a job over its budget runs no new paid stage, but memo hits still pass", async () => {
    const harness = env.harness();
    const { stage, calls } = counted();
    await harness.job({ jobId: env.job("paid"), scope: "ws" }).run(stage, { text: "known" });
    env.job("broke", { budgetMicrousd: 100 });
    env.db.query(`UPDATE job SET spent_microusd = 100 WHERE id = 'broke'`).run();
    const run = harness.job({ jobId: "broke", scope: "ws" });
    expect((await run.run(stage, { text: "known" })).cacheHit).toBe(true);
    const failure = await run.run(stage, { text: "new" }).catch((e) => e);
    expect(failure.kind).toBe("budget");
    expect(calls.length).toBe(1);
  });

  test("an aborted job stops before its next stage and between retries", async () => {
    const harness = env.harness();
    const controller = new AbortController();
    const stage = flaky([new Error("fetch failed")]);
    const run = harness.job({
      jobId: env.job("j"),
      scope: "ws",
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "retry") controller.abort();
      },
    });
    const failure = await run.run(stage, null).catch((e) => e);
    expect(failure.kind).toBe("canceled");
    expect(rows(env.db, `SELECT state FROM stage_run`)).toEqual([{ state: "failed" }]);
    expect((await run.run(counted().stage, { text: "x" }).catch((e) => e)).kind).toBe("canceled");
  });
});

describe("resume (§4.3)", () => {
  test("rerunning a job after a failure skips finished stages and resumes the failed run in place", async () => {
    const harness = env.harness();
    const first = counted();
    let breakSecond = true;
    const secondCalls: number[] = [];
    const second = defineStage({
      name: "extract",
      version: 1,
      output: z.object({ items: z.array(z.string()) }),
      key: (input: { summary: string }) => ({ inputs: [sha256Hex(input.summary)] }),
      async run(input) {
        secondCalls.push(1);
        if (breakSecond) throw new HarnessError("input", "temporarily broken");
        return { items: [input.summary] };
      },
    });
    const jobId = env.job("j");
    const pipeline = async () => {
      const run = harness.job({ jobId, scope: "ws" });
      const a = await run.run(first.stage, { text: "lecture" });
      return run.run(second, { summary: a.value.summary });
    };
    expect((await pipeline().catch((e) => e)).message).toBe("temporarily broken");
    breakSecond = false;
    const res = await pipeline();
    expect(res.value.items).toEqual(["LECTURE"]);
    expect(first.calls.length).toBe(1);
    expect(secondCalls.length).toBe(2);
    expect(rows(env.db, `SELECT stage, state, attempts FROM stage_run ORDER BY stage`)).toEqual([
      { stage: "extract", state: "succeeded", attempts: 2 },
      { stage: "summarize", state: "succeeded", attempts: 1 },
    ]);
  });
});
