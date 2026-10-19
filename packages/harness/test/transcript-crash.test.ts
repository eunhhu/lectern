// SIGKILL the transcript pipeline in the middle of transcription (no finally, no cleanup),
// then run the same job again: the media stages and the chunks already transcribed must
// not run again, the interrupted chunk must (§1.5, §4.3). Needs ffmpeg (synthetic audio).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isFfmpegAvailable } from "@lectern/media";
import { synthesizeSpeechTone, type ScriptLine } from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";
import { letters, rng, sentence } from "./transcript-helpers.ts";

const FIXTURE = join(import.meta.dir, "fixtures/transcript-crash.ts");
const S = 1000;

let env: TestEnv;
beforeEach(() => (env = testEnv()));
afterEach(() => env.close());

describe.skipIf(!isFfmpegAvailable())("transcript pipeline: crash and resume", () => {
  test("killed during the second chunk: the rerun resumes there and pays for no finished work", async () => {
    const r = rng(21);
    const script: ScriptLine[] = Array.from({ length: 18 }, (_, i) => ({
      start_ms: i * 5 * S,
      end_ms: i * 5 * S + 4 * S,
      speaker: "S1",
      text: sentence(r),
    }));
    const audio = await synthesizeSpeechTone(script, 92 * S, join(env.dir, "talk.m4a"));
    const scriptJson = join(env.dir, "script.json");
    writeFileSync(scriptJson, JSON.stringify(script));
    const marker = join(env.dir, "calls");
    env.job("job-crash");

    const run = async (crashAt: number) => {
      const proc = Bun.spawn(
        ["bun", FIXTURE, env.dbPath, env.blobDir, join(env.dir, "work"), "job-crash", marker, audio, scriptJson, String(crashAt)],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      await proc.exited;
      return { stdout, stderr, signal: proc.signalCode };
    };
    const calls = () => (existsSync(marker) ? readFileSync(marker, "utf8").length : 0);

    const crashed = await run(2);
    expect(crashed.signal).toBe("SIGKILL");
    expect(calls()).toBe(2);
    expect(rows(env.db, `SELECT stage, chunk_index, state FROM stage_run ORDER BY started_at`)).toEqual([
      { stage: "ingest", chunk_index: null, state: "succeeded" },
      { stage: "normalize", chunk_index: null, state: "succeeded" },
      { stage: "speech_map", chunk_index: null, state: "succeeded" },
      { stage: "chunk", chunk_index: null, state: "succeeded" },
      { stage: "transcribe", chunk_index: 0, state: "succeeded" },
      { stage: "transcribe", chunk_index: 1, state: "running" },
    ]);

    const resumed = await run(0);
    expect(resumed.stderr).toBe("");
    const out = JSON.parse(resumed.stdout) as { stageRuns: Array<{ stage: string; resumed: boolean }>; texts: string[]; chunks: number };
    expect(out.chunks).toBeGreaterThanOrEqual(3);
    // One extra provider call in total: the interrupted chunk, again.
    expect(calls()).toBe(out.chunks + 1);
    expect(out.stageRuns.filter((s) => ["ingest", "normalize", "speech_map", "chunk"].includes(s.stage)).every((s) => s.resumed)).toBe(
      true,
    );
    expect(letters(out.texts)).toBe(letters(script.map((l) => l.text)));
    expect(rows(env.db, `SELECT stage, attempts FROM stage_run WHERE stage <> 'transcribe' ORDER BY started_at`)).toEqual([
      { stage: "ingest", attempts: 1 },
      { stage: "normalize", attempts: 1 },
      { stage: "speech_map", attempts: 1 },
      { stage: "chunk", attempts: 1 },
      { stage: "merge", attempts: 1 },
      { stage: "speakers", attempts: 1 },
    ]);
    expect(rows(env.db, `SELECT chunk_index, attempts FROM stage_run WHERE stage = 'transcribe' AND chunk_index < 2 ORDER BY chunk_index`)).toEqual([
      { chunk_index: 0, attempts: 1 },
      { chunk_index: 1, attempts: 2 },
    ]);
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM ai_call`)).toEqual([{ n: out.chunks }]);
  }, 60_000);
});
