// Stage definitions and the memoization key (AI_HARNESS §2, §4.4).
//
// A stage is a named, versioned function from an input to a zod-validated output. The
// runner (runner.ts) records each execution as a `stage_run` and stores the output as a
// content-addressed artifact, so a stage whose key matches an earlier success is not run
// again: an edited prompt or template changes the key, an unchanged one is reused.

import type { ZodType } from "zod";
import type { BlobRef, BlobStore } from "./blobs.ts";
import type { HarnessError } from "./errors.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { ProviderCallResult } from "./providers.ts";

/** Everything besides the stage name and version that decides a stage's output (§4.4). */
export interface StageKeyParts {
  /** sha256 of every input artifact or file. Order does not matter (sorted for the key). */
  inputs?: string[];
  /** Content hash of the prompt file(s). */
  prompt?: string;
  /** `template_id@version` plus the template schema hash. */
  template?: string;
  provider?: string;
  /** Pinned model id. */
  model?: string;
  /** Provider parameters: temperature, response schema hash, ... */
  params?: unknown;
  /** Stage configuration: chunk length, language hint, ... */
  config?: unknown;
}

export interface RetryPolicy {
  /** Attempts per run for transient failures, the first included. */
  maxAttempts: number;
  /** Extra attempts after an output validation failure, each told what was wrong. */
  repairs: number;
  /** Delay before attempt `attempt` (2, 3, ...). */
  backoffMs: (attempt: number) => number;
  /** Ceiling on any delay, including a provider's retry-after. */
  maxDelayMs: number;
}

/** Exponential backoff from 1s with full jitter between half and all of the step. */
export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  repairs: 1,
  backoffMs: (attempt) => {
    const step = 1000 * 2 ** Math.max(0, attempt - 2);
    return Math.round(step / 2 + Math.random() * (step / 2));
  },
  maxDelayMs: 60_000,
};

export interface ArtifactRef extends BlobRef {
  id: string;
  kind: string;
}

export interface StageContext {
  readonly jobId: string;
  readonly stageRunId: string;
  /** 1-based attempt within this run. */
  readonly attempt: number;
  /** Set on a repair attempt: why the previous output was rejected, for the repair prompt. */
  readonly repair: { issues: string } | null;
  readonly signal?: AbortSignal;
  /** Reads input artifacts. */
  readonly blobs: BlobStore;
  /** Stores an extra output (e.g. normalized audio); linked to the run when it succeeds. */
  putArtifact(kind: string, data: string | Uint8Array): Promise<ArtifactRef>;
  putArtifactFile(kind: string, path: string): Promise<ArtifactRef>;
  /**
   * Runs one provider call and records it in the cost ledger (`ai_call`). Every model call
   * a stage makes goes through here. `model` is the pinned id the call asks for; it is
   * what `ai_call.model` holds and what prices are looked up by.
   */
  meter<T extends ProviderCallResult>(meta: { provider: string; model: string }, call: () => Promise<T>): Promise<T>;
}

export interface StageDefinition<I, O> {
  /** snake_case stage name, stored in `stage_run.stage` and used as the output artifact kind. */
  name: string;
  /** Code version: bump it whenever the same inputs would now produce a different output. */
  version: number;
  output: ZodType<O>;
  /** The memo key parts for an input. Never include secrets (API keys) here. */
  key(input: I): StageKeyParts | Promise<StageKeyParts>;
  run(input: I, ctx: StageContext): Promise<O>;
  /**
   * Where a success can be reused. "shared" (default): any job in the same scope (workspace)
   * with the same key. "job": only a resumed run of the same job.
   */
  memo?: "shared" | "job";
  retry?: Partial<RetryPolicy>;
  /** Maps a thrown error to its failure class (default: classifyError). */
  classify?: (err: unknown) => HarnessError;
}

const STAGE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Checks a stage definition once, where it is declared. */
export function defineStage<I, O>(def: StageDefinition<I, O>): StageDefinition<I, O> {
  if (!STAGE_NAME_RE.test(def.name)) throw new Error(`invalid stage name: ${def.name}`);
  if (!Number.isInteger(def.version) || def.version < 1) {
    throw new Error(`stage ${def.name}: version must be a positive integer`);
  }
  return def;
}

/**
 * sha256 over a fixed-shape canonical JSON of the stage identity, the scope and the key
 * parts. The scope (workspace, or owner until workspaces exist) keeps one tenant from ever
 * being served another tenant's output.
 */
export function stageKey(stage: { name: string; version: number }, scope: string, parts: StageKeyParts): string {
  return sha256Hex(
    canonicalJson({
      format: 1,
      scope,
      stage: stage.name,
      version: stage.version,
      inputs: [...(parts.inputs ?? [])].sort(),
      prompt: parts.prompt ?? "",
      template: parts.template ?? "",
      provider: parts.provider ?? "",
      model: parts.model ?? "",
      params: parts.params ?? null,
      config: parts.config ?? null,
    })
  );
}
