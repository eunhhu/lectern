// The current one-call distillation as a single harness stage (AI_HARNESS §11 step 1), so
// the existing path runs on the runner (stage_run, artifact, ai_call) before the staged
// pipeline replaces it. The caller publishes the output to `lectures` exactly as before.
//
// - Retries match the job handler it replaces: 3 attempts, 2.5s × attempt between them,
//   same transient/permanent split (classifyGeminiError).
// - Reuse is per job (memo "job"): a crashed job resumes without paying for Gemini again,
//   but a new job — "재분석" on a finished lecture — always asks Gemini afresh, as before.
// - The title is neither an input nor stored: Gemini only gets the course, and the caller
//   applies the user's title over `title` (derived from the Markdown) when publishing.

import { existsSync } from "node:fs";
import { buildDistillationPrompt, resolveGeminiModel, type ProgressEvent } from "@lectern/core";
import { z } from "zod";
import { HarnessError } from "../errors.ts";
import { classifyGeminiError, geminiLegacyDistillProvider, type LegacyDistillProvider } from "../gemini.ts";
import { hashFile, sha256Hex } from "../hash.ts";
import { defineStage, type StageDefinition } from "../stage.ts";

export const LEGACY_DISTILL_STAGE = "legacy_distill";

export const LegacyDistillOutput = z.object({
  markdown: z.string().min(1),
  /** First H1 of the Markdown, or "<course> 강의 노트"; the caller's title wins over it. */
  title: z.string(),
  courseName: z.string(),
  excerpt: z.string(),
  modelRequested: z.string(),
  modelUsed: z.string(),
  durationSec: z.number(),
  sizeBytes: z.number(),
});
export type LegacyDistillOutput = z.infer<typeof LegacyDistillOutput>;

export interface LegacyDistillInput {
  audioPath: string;
  course: string;
  /** Requested model; resolved against the allowlist like the direct path. */
  model: string;
  /** A user-supplied key. Never part of the memo key, the stored output or a log line. */
  apiKey?: string;
  onProgress?: (ev: ProgressEvent) => void;
  /** Runs before every attempt; throw (e.g. a "canceled" HarnessError) to stop. */
  beforeAttempt?: () => void;
}

export function legacyDistillStage(
  provider: LegacyDistillProvider = geminiLegacyDistillProvider()
): StageDefinition<LegacyDistillInput, LegacyDistillOutput> {
  return defineStage({
    name: LEGACY_DISTILL_STAGE,
    version: 1,
    output: LegacyDistillOutput,
    memo: "job",
    retry: { maxAttempts: 3, repairs: 0, backoffMs: (attempt) => 2500 * attempt },
    classify: classifyGeminiError,
    async key(input) {
      if (!existsSync(input.audioPath)) {
        throw new HarnessError("input", `Audio file not found: ${input.audioPath}`);
      }
      return {
        inputs: [await hashFile(input.audioPath)],
        // The prompt text depends only on the course (the duration comes from the audio).
        prompt: sha256Hex(buildDistillationPrompt(input.course)),
        provider: provider.id,
        model: resolveGeminiModel(input.model),
      };
    },
    async run(input, ctx) {
      input.beforeAttempt?.();
      const model = resolveGeminiModel(input.model);
      const { result } = await ctx.meter({ provider: provider.id, model }, () =>
        provider.distill({
          audioPath: input.audioPath,
          courseName: input.course,
          model,
          apiKey: input.apiKey,
          onProgress: input.onProgress,
        })
      );
      return {
        markdown: result.markdown,
        title: result.title,
        courseName: result.courseName,
        excerpt: result.excerpt,
        modelRequested: result.modelRequested,
        modelUsed: result.modelUsed,
        durationSec: result.durationSec,
        sizeBytes: result.sizeBytes,
      };
    },
  });
}
