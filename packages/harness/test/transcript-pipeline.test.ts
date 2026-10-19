// The assembled pipeline on synthetic audio (`-f lavfi` tones) with the scripted provider:
// ffmpeg stages, chunk blobs, merge into original time, speakers, gaps, the ledger, memo
// and resume. Skipped without ffmpeg (CI runners have none); merge/speakers/checks have
// pure tests that always run.

import { afterAll, beforeEach, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGapMarker, isFfmpegAvailable } from "@lectern/media";
import {
  runTranscriptPipeline,
  ScriptedTranscriptionProvider,
  synthesizeSpeechTone,
  type ScriptLine,
  type ScriptedOptions,
} from "../src/index.ts";
import { rows, testEnv, type TestEnv } from "./helpers.ts";
import { letters, rng, sentence } from "./transcript-helpers.ts";

const S = 1000;
const hasFfmpeg = isFfmpegAvailable();
const dir = mkdtempSync(join(process.env.LECTERN_TEST_SANDBOX ?? tmpdir(), "transcript-pipeline-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 4 s lines with 1 s pauses over `[from, to)`; every third line is the second speaker. */
function lines(seed: number, from: number, to: number): ScriptLine[] {
  const r = rng(seed);
  const out: ScriptLine[] = [];
  for (let t = from, i = 0; t + 4 * S <= to; t += 5 * S, i++) {
    out.push({ start_ms: t, end_ms: t + 4 * S, speaker: i % 3 === 2 ? "S2" : "S1", text: sentence(r) });
  }
  return out;
}

// 0–150 s talk, a 20-minute break (150–1350 s), 1350–1500 s talk, 90 s of tail.
const script = [...lines(11, 0, 150 * S), ...lines(12, 1350 * S, 1500 * S)];
const DURATION = 1590 * S;
let audio: Promise<string> | null = null;
const recording = () => (audio ??= synthesizeSpeechTone(script.map((l) => ({ start_ms: l.start_ms, end_ms: l.end_ms })), DURATION, join(dir, "gap.m4a")));

// Scaled down like the media pipeline test: 40 s chunks, 3–6 s overlaps.
const CHUNK = { targetMs: 40 * S, overlapMinMs: 3 * S, overlapMaxMs: 6 * S };

describe.skipIf(!hasFfmpeg)("transcript pipeline", () => {
  let env: TestEnv;
  let workDir: string;
  beforeEach(() => {
    env = testEnv();
    workDir = join(env.dir, "work");
  });
  afterEach(() => env.close());

  const runJob = async (jobId: string, options: ScriptedOptions = {}, scope = "ws-1") => {
    const provider = new ScriptedTranscriptionProvider(script, { chunkLocalLabels: true, ...options });
    const harness = env.harness();
    if (rows(env.db, `SELECT 1 FROM job WHERE id = ?`, jobId).length === 0) env.job(jobId);
    const result = await runTranscriptPipeline(
      harness.job({ jobId, scope }),
      { audioPath: await recording(), language: "ko" },
      { provider, workDir, chunk: CHUNK, onStage: provider.observe },
    );
    return { result, provider };
  };

  test("a recording with a 20-minute break: every line once, in original time, one break gap", async () => {
    const { result, provider } = await runJob("job-gap");
    const { transcript } = result;

    expect(result.speechMap.map.cuts.map((c) => c.kind)).toEqual(["break", "tail"]);
    expect(result.chunks.chunks.length).toBeGreaterThan(4);
    expect(provider.calls.sort((a, b) => a - b)).toEqual(result.chunks.chunks.map((c) => c.index));

    expect(letters(transcript.segments.map((s) => s.text))).toBe(letters(script.map((l) => l.text)));
    // Whole lines come back at their script times (merge applied the time map once). The
    // tolerance is the scripted provider's own rounding of a line cut at a chunk edge to
    // whole letters (a letter is about 200 ms of a 4 s line).
    const byText = new Map(script.map((l) => [letters([l.text]), l]));
    let whole = 0;
    for (const seg of transcript.segments) {
      const line = byText.get(letters([seg.text]));
      if (!line) continue;
      whole++;
      expect(Math.abs(seg.start_ms - line.start_ms)).toBeLessThanOrEqual(250);
      expect(Math.abs(seg.end_ms - line.end_ms)).toBeLessThanOrEqual(250);
    }
    expect(whole).toBeGreaterThan(script.length * 0.8);
    for (const seg of transcript.segments) expect(seg.end_ms <= 151 * S || seg.start_ms >= 1349 * S).toBe(true);

    const [gap, tail] = transcript.gaps;
    expect([gap!.kind, tail!.kind]).toEqual(["break", "tail"]);
    expect(formatGapMarker(gap!)).toBe("[쉬는 시간: 2:30~22:28]");
    expect(tail!.end_ms).toBe(result.normalize.audio.duration_ms);

    // Two speakers, chunk-local numbering unified across every chunk.
    const truthSpeaker = new Map(script.map((l) => [letters([l.text]), l.speaker]));
    const pairs = new Set(
      transcript.segments.flatMap((s) => (truthSpeaker.has(letters([s.text])) ? [`${truthSpeaker.get(letters([s.text]))}->${s.speaker}`] : [])),
    );
    expect(pairs).toEqual(new Set(["S1->S1", "S2->S2"]));
    expect(transcript.speakers.map((s) => s.label)).toEqual(["S1", "S2"]);

    // Ledger: one call per chunk, linked to its stage run; stage runs for every stage.
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM ai_call WHERE provider = 'scripted' AND status = 'ok'`)).toEqual([
      { n: result.chunks.chunks.length },
    ]);
    expect(rows(env.db, `SELECT stage, COUNT(*) AS n FROM stage_run GROUP BY stage ORDER BY stage`)).toEqual([
      { stage: "chunk", n: 1 },
      { stage: "ingest", n: 1 },
      { stage: "merge", n: 1 },
      { stage: "normalize", n: 1 },
      { stage: "speakers", n: 1 },
      { stage: "speech_map", n: 1 },
      { stage: "transcribe", n: result.chunks.chunks.length },
    ]);
    // Audio artifacts: the work copy, the speech-only audio, one per chunk.
    expect(rows(env.db, `SELECT kind, COUNT(*) AS n FROM artifact WHERE kind LIKE 'audio_%' GROUP BY kind ORDER BY kind`)).toEqual([
      { kind: "audio_chunk", n: result.chunks.chunks.length },
      { kind: "audio_speech", n: 1 },
      { kind: "audio_work", n: 1 },
    ]);
  }, 90_000);

  test("run again: the same job resumes everything; another job with the same file reuses it all", async () => {
    const first = await runJob("job-once");
    const again = await runJob("job-once");
    expect(again.provider.calls).toEqual([]);
    expect(again.result.stageRuns.every((r) => r.resumed)).toBe(true);
    expect(again.result.transcript).toEqual(first.result.transcript);

    const other = await runJob("job-twice");
    expect(other.provider.calls).toEqual([]);
    expect(other.result.stageRuns.every((r) => r.cacheHit)).toBe(true);
    expect(rows(env.db, `SELECT COUNT(*) AS n FROM ai_call`)).toEqual([{ n: first.result.chunks.chunks.length }]);

    // Another workspace never sees this one's outputs.
    const elsewhere = await runJob("job-elsewhere", {}, "ws-2");
    expect(elsewhere.provider.calls.length).toBe(first.result.chunks.chunks.length);
  }, 90_000);

  test("a chunk that keeps failing becomes a missing gap; the rest is published", async () => {
    const { result, provider } = await runJob("job-partial", { failChunks: [2] });
    expect(result.chunkFailures).toEqual([
      { index: 2, kind: "output_validation", code: "empty_response", message: "scripted chunk 2: empty response" },
    ]);
    expect(provider.calls.filter((i) => i === 2)).toHaveLength(2); // the first answer and one repair attempt
    expect(result.transcript.failed_chunks).toEqual([2]);
    const missing = result.transcript.gaps.filter((g) => g.kind === "missing_transcript");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.end_ms - missing[0]!.start_ms).toBeGreaterThan(20 * S);
    for (const seg of result.transcript.segments) {
      expect(seg.end_ms <= missing[0]!.start_ms || seg.start_ms >= missing[0]!.end_ms).toBe(true);
    }
    expect(rows(env.db, `SELECT status, COUNT(*) AS n FROM ai_call GROUP BY status ORDER BY status`)).toEqual([
      { status: "error", n: 2 },
      { status: "ok", n: result.chunks.chunks.length - 1 },
    ]);
  }, 90_000);

  test("input problems stop at ingest with the media code", async () => {
    const silent = await synthesizeSpeechTone([], 5 * S, join(dir, "silent.m4a"));
    const provider = new ScriptedTranscriptionProvider([]);
    env.job("job-silent");
    const err = await runTranscriptPipeline(env.harness().job({ jobId: "job-silent", scope: "ws-1" }), { audioPath: silent }, { provider, workDir })
      .catch((e) => e);
    expect([err.kind, err.code]).toEqual(["input", "silent"]);
    expect(rows(env.db, `SELECT stage, state FROM stage_run`)).toEqual([{ stage: "ingest", state: "failed" }]);
    expect(provider.calls).toEqual([]);
  }, 30_000);
});
