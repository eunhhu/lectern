// The 물어보기 service: the providers, prices, ledger and limits @lectern/ask runs with
// (docs/adr/0009-ask-rag.md). Built once from the configuration; null while LECTERN_ASK
// is off, in which case the ask routes answer 501 and no index job is queued.

import { config, readSecret } from "@lectern/config";
import {
  type AskDeps,
  type AskModel,
  type Embedder,
  type ModelCallRecord,
  type Price,
  QueryEmbeddingCache,
  SqliteVectorIndex,
} from "@lectern/ask";
import {
  ASK_ANSWER_MODEL,
  ASK_EMBEDDING_DIM,
  ASK_EMBEDDING_MODEL,
  DEFAULT_PRICING,
  GeminiAskModel,
  GeminiEmbedder,
  priceFor,
  recordAiCall,
} from "@lectern/harness";
import { db } from "../db.ts";
import { logger } from "../log.ts";

export interface AskService {
  deps: AskDeps;
  /** Present when embeddings are configured; the index stage uses the same one. */
  embedder?: Embedder;
  /** False when the user asked more than RATE_LIMIT questions in RATE_WINDOW_MS. */
  allow(userId: string, now?: number): boolean;
}

export const RATE_LIMIT = 30;
export const RATE_WINDOW_MS = 10 * 60_000;

export function priceOf(provider: string, model: string, at = Date.now()): Price | null {
  const p = priceFor(DEFAULT_PRICING, provider, model, at);
  return p ? { input: p.input, cachedInput: p.cached_input, output: p.output } : null;
}

/** Every ask model and query-embedding call becomes an ai_call row (no job). */
function ledger(call: ModelCallRecord): void {
  try {
    recordAiCall(db, {
      workspaceId: call.workspaceId,
      provider: call.provider,
      model: call.model,
      usage: call.usage,
      latencyMs: call.latencyMs,
      status: call.status,
      requestId: call.requestId,
    });
  } catch (err) {
    logger.error("could not record an ask model call", { err });
  }
}

export function createAskService(options: {
  model: AskModel;
  embedder?: Embedder;
  monthlyLimitMicrousd: number;
  now?: () => number;
}): AskService {
  const recent = new Map<string, number[]>();
  return {
    embedder: options.embedder,
    deps: {
      db,
      model: options.model,
      price: (provider, model) => priceOf(provider, model, options.now?.() ?? Date.now()),
      embedder: options.embedder,
      vectorIndex: options.embedder ? new SqliteVectorIndex(db, options.embedder.model, options.embedder.dim) : undefined,
      queryCache: new QueryEmbeddingCache(),
      onModelCall: ledger,
      limits: { monthlyLimitMicrousd: options.monthlyLimitMicrousd },
      now: options.now,
    },
    allow(userId, now = Date.now()) {
      const times = (recent.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
      if (times.length >= RATE_LIMIT) {
        recent.set(userId, times);
        return false;
      }
      times.push(now);
      recent.set(userId, times);
      return true;
    },
  };
}

let defaultService: AskService | null | undefined;

/** The service for this process, or null while LECTERN_ASK is off. */
export function askService(): AskService | null {
  if (defaultService !== undefined) return defaultService;
  const c = config();
  if (!c.ask.enabled) return (defaultService = null);
  const gemini = { apiKey: () => readSecret("GEMINI_API_KEY") };
  defaultService = createAskService({
    model: new GeminiAskModel(ASK_ANSWER_MODEL, gemini),
    embedder: new GeminiEmbedder(ASK_EMBEDDING_MODEL, ASK_EMBEDDING_DIM, gemini),
    monthlyLimitMicrousd: c.ask.monthlyLimitMicrousd,
  });
  return defaultService;
}
