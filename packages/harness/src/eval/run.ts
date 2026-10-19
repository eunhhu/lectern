// `bun run harness eval` (AI_HARNESS §8): run the transcript pipeline over an eval set and
// score it against the reference transcripts.
//
// - The runs go to their own SQLite file and blob store (the cache directory), never the
//   server's database. Memoization is shared across eval runs of one set, so rerunning
//   with an unchanged prompt, model and audio reuses the transcriptions at no cost; the
//   ledger then shows what this run actually paid.
// - A paid provider is called only after `confirm` accepts the cost estimate (an upper
//   bound: it assumes nothing is cut by speech_map and nothing is cached).

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveGeminiApiKey } from "@lectern/core";
import { runMigrations } from "@lectern/db";
import { readStreamInfo } from "@lectern/media";
import { GeminiTranscriptionProvider, TRANSCRIBE_MODEL } from "../gemini-transcribe.ts";
import { canonicalJson, sha256Hex } from "../hash.ts";
import { DEFAULT_PRICING, priceFor } from "../ledger.ts";
import type { TranscriptionProvider } from "../providers.ts";
import { Harness } from "../runner.ts";
import { runTranscriptPipeline, type ChunkFailure } from "../transcript/pipeline.ts";
import type { ChunkPlanConfig } from "../transcript/stages.ts";
import { compareTranscripts, type TranscriptMetrics } from "./metrics.ts";
import { ScriptedTranscriptionProvider, type ScriptedOptions } from "./scripted.ts";
import type { EvalItem, EvalSet } from "./set.ts";
import { synthesizeSpeechTone } from "./synth.ts";

export type EvalProviderName = "scripted" | "gemini";

export interface CostEstimate {
  provider: string;
  model: string;
  items: number;
  audio_seconds: number;
  /** Upper bound in micro-USD (no cuts, no cache hits). */
  max_microusd: number;
  assumptions: string;
}

/** Output tokens per minute of audio the estimate assumes: Korean text, JSON keys and timestamps, low thinking. */
export const ESTIMATE_OUTPUT_TOKENS_PER_MIN = 450;
/** Extra audio sent because neighbouring chunks overlap (15–30 s per 6-minute seam). */
export const ESTIMATE_OVERLAP_SHARE = 0.07;

export function estimateTranscriptionCost(provider: string, model: string, audioSeconds: number, items: number, at = Date.now()): CostEstimate {
  const price = priceFor(DEFAULT_PRICING, provider, model, at);
  const inputTokens = audioSeconds * (1 + ESTIMATE_OVERLAP_SHARE) * 32 + 600 * Math.ceil(audioSeconds / 360);
  const outputTokens = (audioSeconds / 60) * ESTIMATE_OUTPUT_TOKENS_PER_MIN;
  return {
    provider,
    model,
    items,
    audio_seconds: audioSeconds,
    max_microusd: price ? Math.round(inputTokens * price.input + outputTokens * price.output) : 0,
    assumptions: `audio 32 tokens/s +${Math.round(ESTIMATE_OVERLAP_SHARE * 100)}% overlap, ${ESTIMATE_OUTPUT_TOKENS_PER_MIN} output tokens/min, pricing.json as of ${DEFAULT_PRICING.as_of}`,
  };
}

export interface EvalRunOptions {
  set: EvalSet;
  provider: EvalProviderName;
  /** Requested Gemini model (resolved against the allowlist). */
  model?: string;
  scripted?: ScriptedOptions;
  /** SQLite file, blob store, synthetic audio and scratch space for this set's eval runs. */
  cacheDir: string;
  /** Asked before any paid call; false stops the run. Not asked for the scripted provider. */
  confirm?: (estimate: CostEstimate) => boolean | Promise<boolean>;
  chunk?: Partial<ChunkPlanConfig>;
  concurrency?: number;
  label?: string;
  log?: (line: string) => void;
  now?: () => number;
}

export interface EvalItemResult {
  id: string;
  status: "ok" | "failed" | "skipped";
  error?: string;
  duration_ms: number;
  cut_duration_ms: number;
  chunks: number;
  chunk_failures: ChunkFailure[];
  seams: { aligned: number; time: number; no_partner: number; max_abs_drift_ms: number };
  speakers: number;
  metrics: TranscriptMetrics | null;
  /** What this run paid (memo hits are free); tokens as the ledger recorded them. */
  cost_microusd: number;
  input_tokens: number;
  output_tokens: number;
  provider_calls: number;
  wall_ms: number;
}

export interface EvalRun {
  format: 1;
  created_at: string;
  label: string;
  set: { id: string; items: number };
  provider: string;
  model: string;
  options: { scripted?: ScriptedOptions; chunk?: Partial<ChunkPlanConfig> };
  estimate: CostEstimate | null;
  items: EvalItemResult[];
  totals: {
    scored: number;
    ref_chars: number;
    /** Letter-weighted over scored items. */
    cer: number | null;
    wer: number | null;
    speaker_error: number | null;
    cost_microusd: number;
    audio_hours: number;
    /** USD per hour of recording at this run's cost (zero when everything was cached). */
    usd_per_audio_hour: number | null;
  };
}

function providerFor(options: EvalRunOptions, item: EvalItem): { provider: TranscriptionProvider; observe?: ScriptedTranscriptionProvider["observe"] } {
  if (options.provider === "scripted") {
    const scripted = new ScriptedTranscriptionProvider(item.reference.lines, { chunkLocalLabels: true, ...options.scripted });
    return { provider: scripted, observe: scripted.observe };
  }
  return {
    provider: new GeminiTranscriptionProvider({
      model: options.model ?? TRANSCRIBE_MODEL,
      apiKey: () => {
        try {
          return resolveGeminiApiKey();
        } catch {
          return undefined;
        }
      },
    }),
  };
}

function openCache(dir: string): { db: Database; harness: Harness } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "eval.sqlite"), { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
  runMigrations(db, { backupDir: join(dir, "backups") });
  return { db, harness: new Harness({ db, blobDir: join(dir, "blobs") }) };
}

async function audioFor(item: EvalItem, cacheDir: string): Promise<string> {
  if (item.audio !== "synth") return item.audio;
  const ref = item.reference;
  const key = sha256Hex(canonicalJson({ lines: ref.lines.map((l) => [l.start_ms, l.end_ms]), duration: ref.duration_ms })).slice(0, 16);
  const dir = join(cacheDir, "synth");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${item.id}-${key}.m4a`);
  return existsSync(path) ? path : synthesizeSpeechTone(ref.lines, ref.duration_ms!, path);
}

export async function runEval(options: EvalRunOptions): Promise<EvalRun> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const runnable = options.set.items.filter((item) => options.provider === "scripted" || item.audio !== "synth");
  const sample = providerFor(options, options.set.items[0]!).provider;

  let estimate: CostEstimate | null = null;
  if (options.provider !== "scripted") {
    let seconds = 0;
    for (const item of runnable) {
      if (!existsSync(item.audio)) throw new Error(`${item.id}: audio ${item.audio} not found`);
      seconds += (await readStreamInfo(item.audio)).duration_ms / 1000;
    }
    estimate = estimateTranscriptionCost(sample.id, sample.model, seconds, runnable.length, now());
    if (!(await options.confirm?.(estimate))) throw new Error("eval stopped before any paid call (cost not confirmed)");
  }

  const { db, harness } = openCache(options.cacheDir);
  const runId = `${new Date(now()).toISOString().replace(/[-:]/g, "").slice(0, 15)}-${Bun.randomUUIDv7().slice(-6)}`;
  const items: EvalItemResult[] = [];
  try {
    for (const item of options.set.items) {
      const empty: EvalItemResult = {
        id: item.id,
        status: "skipped",
        duration_ms: item.reference.duration_ms ?? 0,
        cut_duration_ms: 0,
        chunks: 0,
        chunk_failures: [],
        seams: { aligned: 0, time: 0, no_partner: 0, max_abs_drift_ms: 0 },
        speakers: 0,
        metrics: null,
        cost_microusd: 0,
        input_tokens: 0,
        output_tokens: 0,
        provider_calls: 0,
        wall_ms: 0,
      };
      if (!runnable.includes(item)) {
        items.push({ ...empty, error: "synthetic audio has no speech for a real provider" });
        continue;
      }
      const started = now();
      const jobId = `eval_${runId}_${item.id}`;
      db.query(
        `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, created_at, started_at)
         VALUES (?, 'eval', 'eval', ?, 'running', 0, ?, ?)`,
      ).run(jobId, item.id, started, started);
      const { provider, observe } = providerFor(options, item);
      log(`${item.id}: ${provider.id}/${provider.model}`);
      try {
        const result = await runTranscriptPipeline(
          harness.job({ jobId, scope: `eval:${options.set.id}` }),
          { audioPath: await audioFor(item, options.cacheDir), language: item.language ?? undefined },
          { provider, workDir: join(options.cacheDir, "work"), chunk: options.chunk, concurrency: options.concurrency, onStage: observe },
        );
        const ledger = db
          .query(
            `SELECT COALESCE(SUM(cost_microusd), 0) AS cost, COALESCE(SUM(input_tokens + cached_tokens), 0) AS input,
               COALESCE(SUM(output_tokens), 0) AS output, COUNT(*) AS calls FROM ai_call WHERE job_id = ?`,
          )
          .get(jobId) as { cost: number; input: number; output: number; calls: number };
        const seams = result.merged.seams;
        items.push({
          ...empty,
          status: "ok",
          duration_ms: result.normalize.audio.duration_ms,
          cut_duration_ms: result.speechMap.map.cut_duration_ms,
          chunks: result.chunks.chunks.length,
          chunk_failures: result.chunkFailures,
          seams: {
            aligned: seams.filter((s) => s.method === "aligned").length,
            time: seams.filter((s) => s.method === "time").length,
            no_partner: seams.filter((s) => s.method === "no_partner").length,
            max_abs_drift_ms: Math.max(0, ...seams.map((s) => Math.abs(s.drift_ms))),
          },
          speakers: result.transcript.speakers.length,
          metrics: compareTranscripts(item.reference.lines, result.transcript.segments, item.reference.reviewed),
          cost_microusd: ledger.cost,
          input_tokens: ledger.input,
          output_tokens: ledger.output,
          provider_calls: ledger.calls,
          wall_ms: now() - started,
        });
        db.query(`UPDATE job SET state = 'succeeded', finished_at = ? WHERE id = ?`).run(now(), jobId);
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        log(`${item.id}: failed: ${message}`);
        items.push({ ...empty, status: "failed", error: message, wall_ms: now() - started });
        db.query(`UPDATE job SET state = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(message, now(), jobId);
      }
    }
  } finally {
    db.close();
  }

  const scored = items.filter((i) => i.metrics);
  const refChars = scored.reduce((n, i) => n + i.metrics!.ref_chars, 0);
  const refWords = scored.reduce((n, i) => n + i.metrics!.ref_words, 0);
  const weighted = (pick: (m: TranscriptMetrics) => number | null, weight: (m: TranscriptMetrics) => number) => {
    const parts = scored.flatMap((i) => (pick(i.metrics!) === null ? [] : [[pick(i.metrics!)!, weight(i.metrics!)] as const]));
    const total = parts.reduce((n, [, w]) => n + w, 0);
    return total ? parts.reduce((n, [v, w]) => n + v * w, 0) / total : null;
  };
  const cost = items.reduce((n, i) => n + i.cost_microusd, 0);
  const hours = items.filter((i) => i.status === "ok").reduce((n, i) => n + i.duration_ms, 0) / 3_600_000;
  return {
    format: 1,
    created_at: new Date(now()).toISOString(),
    label: options.label ?? `${sample.id}-${sample.model}`,
    set: { id: options.set.id, items: options.set.items.length },
    provider: sample.id,
    model: sample.model,
    options: { scripted: options.provider === "scripted" ? options.scripted : undefined, chunk: options.chunk },
    estimate,
    items,
    totals: {
      scored: scored.length,
      ref_chars: refChars,
      cer: refChars ? weighted((m) => m.cer, (m) => m.ref_chars) : null,
      wer: refWords ? weighted((m) => m.wer, (m) => m.ref_words) : null,
      speaker_error: weighted((m) => m.speaker_error, (m) => m.ref_chars),
      cost_microusd: cost,
      audio_hours: hours,
      usd_per_audio_hour: hours > 0 ? cost / 1e6 / hours : null,
    },
  };
}
