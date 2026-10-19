// Cost ledger (AI_HARNESS §1.6, §6): every model call becomes one `ai_call` row with its
// tokens, cost, latency and status, and its cost is added to the job's `spent_microusd`
// in the same transaction. Prices live in packages/harness/pricing.json with the date
// they were checked.

import type { Database } from "bun:sqlite";
import { z } from "zod";
import pricingJson from "../pricing.json";
import type { Usage } from "./providers.ts";

const PriceEntry = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** UTC date (YYYY-MM-DD) from which this price applies. */
  from: z.iso.date(),
  /** USD per 1M tokens = microUSD per token. */
  input: z.number().nonnegative(),
  cached_input: z.number().nonnegative(),
  output: z.number().nonnegative(),
});
export type PriceEntry = z.infer<typeof PriceEntry>;

export const PricingTable = z.object({
  as_of: z.iso.date(),
  models: z.array(PriceEntry).min(1),
});
export type PricingTable = z.infer<typeof PricingTable>;

/** pricing.json, validated at load so a malformed edit fails the CD preflight. */
export const DEFAULT_PRICING: PricingTable = PricingTable.parse(pricingJson);

/** The price in effect for `provider`/`model` at `at` (ms), or null when it is not listed. */
export function priceFor(table: PricingTable, provider: string, model: string, at: number): PriceEntry | null {
  const entries = table.models
    .filter((p) => p.provider === provider && p.model === model)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (entries.length === 0) return null;
  const day = new Date(at).toISOString().slice(0, 10);
  let current = entries[0]!; // a call dated before the first entry uses the first price
  for (const entry of entries) if (entry.from <= day) current = entry;
  return current;
}

export function costMicrousd(usage: Usage, price: PriceEntry): number {
  return Math.round(
    usage.inputTokens * price.input + usage.cachedTokens * price.cached_input + usage.outputTokens * price.output
  );
}

export interface AiCallInput {
  jobId?: string | null;
  stageRunId?: string | null;
  workspaceId?: string | null;
  provider: string;
  /**
   * The pinned model id the call asked for: stored in `ai_call.model` (as @lectern/domain
   * AiCall.model defines it) and used for the price. The version the provider reports has
   * no column yet (domain AiCall.model_version).
   */
  model: string;
  usage: Usage;
  latencyMs: number;
  status: "ok" | "error";
  requestId?: string | null;
}

export interface LedgerOptions {
  pricing?: PricingTable;
  now?: number;
  /** Told about calls whose model has no price (recorded at cost 0). */
  onUnpriced?: (provider: string, model: string) => void;
}

/** Records one model call in `ai_call` and charges its cost to the job. */
export function recordAiCall(
  db: Database,
  call: AiCallInput,
  options: LedgerOptions = {}
): { id: string; costMicrousd: number; priced: boolean } {
  const now = options.now ?? Date.now();
  const price = priceFor(options.pricing ?? DEFAULT_PRICING, call.provider, call.model, now);
  if (!price) options.onUnpriced?.(call.provider, call.model);
  const cost = price ? costMicrousd(call.usage, price) : 0;
  const id = `aic_${Bun.randomUUIDv7()}`;
  db.transaction(() => {
    db.query(
      `INSERT INTO ai_call (id, workspace_id, job_id, stage_run_id, provider, model, input_tokens,
         cached_tokens, output_tokens, audio_seconds, cost_microusd, latency_ms, status, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      call.workspaceId ?? null,
      call.jobId ?? null,
      call.stageRunId ?? null,
      call.provider,
      call.model,
      Math.max(0, Math.round(call.usage.inputTokens)),
      Math.max(0, Math.round(call.usage.cachedTokens)),
      Math.max(0, Math.round(call.usage.outputTokens)),
      Math.max(0, Math.round(call.usage.audioSeconds ?? 0)),
      cost,
      Math.max(0, Math.round(call.latencyMs)),
      call.status,
      call.requestId ?? null,
      now
    );
    if (call.jobId && cost > 0) {
      db.query(`UPDATE job SET spent_microusd = spent_microusd + ? WHERE id = ?`).run(cost, call.jobId);
    }
  })();
  return { id, costMicrousd: cost, priced: price !== null };
}
