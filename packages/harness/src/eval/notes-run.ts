// `bun run harness eval --notes`: the notes pipeline over an eval set's reference
// transcripts, scored against its annotations (notes-metrics.ts). Same rules as the
// transcript eval (run.ts): its own SQLite file and blob store, and a paid provider only
// after `confirm` accepts the cost estimate.

import { resolveGeminiApiKey } from "@lectern/core";
import { canonicalJson, sha256Hex } from "../hash.ts";
import { GeminiLlmProvider } from "../gemini-llm.ts";
import { costMicrousd, DEFAULT_PRICING, priceFor } from "../ledger.ts";
import type { LlmProvider } from "../providers.ts";
import { runNotesPipeline } from "../notes/pipeline.ts";
import { loadRouting, type Routing } from "../routing.ts";
import { loadTemplate } from "../templates.ts";
import type { Transcript } from "../transcript/schemas.ts";
import { scoreNotes, totalsOf, type NotesItemMetrics, type NotesTotals } from "./notes-metrics.ts";
import { EVAL_RECORDED_AT, oracleNotesLlm, referenceSegments, type OracleOptions } from "./notes-scripted.ts";
import { openCache, type CostEstimate } from "./run.ts";
import type { EvalItem, EvalSet } from "./set.ts";

export interface NotesEvalRunOptions {
  set: EvalSet;
  provider: "scripted" | "gemini";
  /** Gemini model for structure, extract and repair (classify keeps routing.json's). */
  model?: string;
  oracle?: OracleOptions;
  cacheDir: string;
  label?: string;
  log?: (line: string) => void;
  now?: () => number;
  /** Asked before any paid call; false stops the run. Not asked for the scripted provider. */
  confirm?: (estimate: CostEstimate) => boolean | Promise<boolean>;
}

export interface NotesEvalItemResult {
  id: string;
  status: "ok" | "failed";
  error?: string;
  metrics: NotesItemMetrics | null;
  /** What this run paid (memo hits are free). */
  cost_microusd: number;
  /** Length of the recording (reference). */
  duration_ms: number;
  wall_ms: number;
}

export interface NotesEvalRun {
  format: 1;
  kind: "notes";
  created_at: string;
  label: string;
  set: { id: string; items: number };
  provider: string;
  model: string;
  options: { oracle?: OracleOptions };
  estimate: CostEstimate | null;
  items: NotesEvalItemResult[];
  totals: NotesTotals;
}

/** Output tokens one item's notes are assumed to take (structure + extract + classify). */
export const NOTES_ESTIMATE_OUTPUT_TOKENS = 4_000;

/**
 * Upper-bound cost of a notes eval: classify, structure and extract each read the whole
 * transcript (about two characters per token for Korean), plus one item's worth of output.
 */
export function estimateNotesCost(model: string, transcriptChars: number, items: number, at = Date.now()): CostEstimate {
  const price = priceFor(DEFAULT_PRICING, "gemini", model, at);
  if (!price) throw new Error(`gemini/${model} has no price in pricing.json: add it before a paid eval run`);
  const usage = { inputTokens: Math.ceil(transcriptChars / 2) * 3, cachedTokens: 0, outputTokens: NOTES_ESTIMATE_OUTPUT_TOKENS * items };
  return {
    provider: "gemini",
    model,
    items,
    audio_seconds: 0,
    max_microusd: costMicrousd(usage, price),
    assumptions: `전사 2자당 1토큰을 분류·구조화·추출이 각각 한 번씩 읽음, 출력 ${NOTES_ESTIMATE_OUTPUT_TOKENS}토큰/건, 모든 단계를 ${model} 가격으로, pricing.json ${DEFAULT_PRICING.as_of} 기준`,
  };
}

/** The reference transcript as the harness Transcript the notes pipeline reads. */
export function referenceTranscript(item: EvalItem): Transcript {
  const segments = referenceSegments(item).map((s) => ({ ...s, source_chunk: 0 }));
  const bySpeaker = new Map<string, { segments: number; chars: number }>();
  for (const s of segments) {
    const entry = bySpeaker.get(s.speaker) ?? { segments: 0, chars: 0 };
    entry.segments += 1;
    entry.chars += s.text.length;
    bySpeaker.set(s.speaker, entry);
  }
  return {
    version: 1,
    duration_ms: item.reference.duration_ms ?? segments.at(-1)?.end_ms ?? 0,
    segments,
    speakers: [...bySpeaker].map(([label, stats]) => ({
      label,
      confidence: 1,
      basis: "single_chunk" as const,
      segments: stats.segments,
      chars: stats.chars,
      members: [{ chunk: 0, label }],
    })),
    gaps: [],
    failed_chunks: [],
  };
}

function withModel(routing: Routing, model: string | undefined): Routing {
  if (!model) return routing;
  return {
    ...routing,
    structure: { ...routing.structure, model },
    extract: { ...routing.extract, model },
    repair: { ...routing.repair, model },
  };
}

export async function runNotesEval(options: NotesEvalRunOptions): Promise<NotesEvalRun> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const set = options.set;
  const routing = withModel(loadRouting(), options.provider === "gemini" ? options.model : undefined);
  const scripted = options.provider === "scripted";
  const model = scripted ? "oracle" : routing.structure.model;

  let estimate: CostEstimate | null = null;
  if (!scripted) {
    const chars = set.items.reduce((n, item) => n + item.reference.lines.reduce((m, l) => m + l.text.length, 0), 0);
    const seconds = set.items.reduce((n, item) => n + referenceTranscript(item).duration_ms / 1000, 0);
    estimate = { ...estimateNotesCost(model, chars, set.items.length, now()), audio_seconds: seconds };
    if (!(await options.confirm?.(estimate))) throw new Error("eval stopped before any paid call (cost not confirmed)");
  }

  const llm: LlmProvider = scripted
    ? oracleNotesLlm(set, options.oracle)
    : new GeminiLlmProvider({
        apiKey: () => {
          try {
            return resolveGeminiApiKey();
          } catch {
            return undefined;
          }
        },
      });
  // Memo is shared across runs of one set; the oracle's answers depend on its knobs, so
  // scripted runs with other knobs get their own memo scope.
  const scope = scripted ? `eval:${set.id}:oracle:${sha256Hex(canonicalJson(options.oracle ?? {})).slice(0, 12)}` : `eval:${set.id}`;

  const { db, harness } = openCache(options.cacheDir);
  const runId = `${new Date(now()).toISOString().replace(/[-:]/g, "").slice(0, 15)}-${Bun.randomUUIDv7().slice(-6)}`;
  const items: NotesEvalItemResult[] = [];
  try {
    for (const item of set.items) {
      const started = now();
      const jobId = `eval_${runId}_${item.id}`;
      const transcript = referenceTranscript(item);
      db.query(
        `INSERT INTO job (id, owner_id, kind, subject_id, state, run_after, created_at, started_at)
         VALUES (?, 'eval', 'eval', ?, 'running', 0, ?, ?)`
      ).run(jobId, item.id, started, started);
      log(`${item.id}: ${llm.id}/${model}`);
      try {
        const recordedAt = Date.parse(item.reference.meta.recorded_at ?? EVAL_RECORDED_AT);
        if (Number.isNaN(recordedAt)) throw new Error(`${item.id}: unreadable recorded_at "${item.reference.meta.recorded_at}"`);
        const result = await runNotesPipeline(
          harness.job({ jobId, scope }),
          {
            transcript,
            filename: `${item.id}.m4a`,
            hint: { domain: null, folder_id: null },
            folders: [],
            tags: [],
            recordedAtMs: recordedAt,
            recordedAtSource: "client",
            tz: "Asia/Seoul",
          },
          { llm, routing }
        );
        const def = loadTemplate(result.template.id).def;
        const metrics = scoreNotes({
          result,
          transcript,
          annotations: set.annotations.filter((a) => a.item === item.id),
          extracts: { events: def.extract.events === true, action_items: def.extract.action_items === true },
        });
        const cost = (db.query(`SELECT COALESCE(SUM(cost_microusd), 0) AS cost FROM ai_call WHERE job_id = ?`).get(jobId) as { cost: number }).cost;
        items.push({ id: item.id, status: "ok", metrics, cost_microusd: cost, duration_ms: transcript.duration_ms, wall_ms: now() - started });
        db.query(`UPDATE job SET state = 'succeeded', finished_at = ? WHERE id = ?`).run(now(), jobId);
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        log(`${item.id}: failed: ${message}`);
        const cost = (db.query(`SELECT COALESCE(SUM(cost_microusd), 0) AS cost FROM ai_call WHERE job_id = ?`).get(jobId) as { cost: number }).cost;
        items.push({ id: item.id, status: "failed", error: message, metrics: null, cost_microusd: cost, duration_ms: transcript.duration_ms, wall_ms: now() - started });
        db.query(`UPDATE job SET state = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(message, now(), jobId);
      }
    }
  } finally {
    db.close();
  }

  // A failed item counts as an invalid result; its annotations are not scored.
  const failed: NotesItemMetrics = { schema_valid: false, blocks: { total: 0, grounded: 0 }, events: { annotated: 0, correct: 0 }, extracted: { total: 0, unmatched: 0 }, skipped: 0 };
  const cost = items.reduce((n, i) => n + i.cost_microusd, 0);
  const hours = items.filter((i) => i.status === "ok").reduce((n, i) => n + i.duration_ms, 0) / 3_600_000;
  return {
    format: 1,
    kind: "notes",
    created_at: new Date(now()).toISOString(),
    label: options.label ?? `${llm.id}-${model}`,
    set: { id: set.id, items: set.items.length },
    provider: llm.id,
    model,
    options: { oracle: scripted ? options.oracle ?? {} : undefined },
    estimate,
    items,
    totals: totalsOf(
      items.map((i) => i.metrics ?? failed),
      cost,
      hours
    ),
  };
}
