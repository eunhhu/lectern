// The `pdf_ocr` stage and its estimate (P3-05, CONTRACTS D-P3-3). The estimate is what the
// user sees before confirming: Gemini reads the whole PDF on every request (258 input
// tokens per page), and requests take 8 pages each, so the input side is
// calls × page_count × 258; the output side is 600 tokens per page read. The stage runs one
// request through the cost ledger (ctx.meter) and memoizes on the file and the page list.

import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../errors.ts";
import { OCR_PAGES_PER_CALL, OcrResult, type GeminiOcrProvider } from "../gemini-ocr.ts";
import { hashFile, sha256Hex } from "../hash.ts";
import { DEFAULT_PRICING, priceFor } from "../ledger.ts";
import { defineStage, type StageDefinition } from "../stage.ts";

export const OCR_INPUT_TOKENS_PER_PAGE = 258;
export const OCR_OUTPUT_TOKENS_PER_PAGE = 600;

/** Estimated cost in microUSD of reading `pagesToOcr` pages of a `pageCount`-page PDF. */
export function estimateOcrCost(args: { pagesToOcr: number; pageCount: number; model: string; at?: number }): number {
  if (args.pagesToOcr <= 0) return 0;
  const price = priceFor(DEFAULT_PRICING, "gemini", args.model, args.at ?? Date.now());
  if (!price) throw new Error(`no price for gemini/${args.model}`);
  const calls = Math.ceil(args.pagesToOcr / OCR_PAGES_PER_CALL);
  const input = calls * args.pageCount * OCR_INPUT_TOKENS_PER_PAGE;
  const output = args.pagesToOcr * OCR_OUTPUT_TOKENS_PER_PAGE;
  return Math.round(input * price.input + output * price.output);
}

export interface OcrStageInput {
  /** The stored PDF. */
  path: string;
  /** 1-based page numbers, at most OCR_PAGES_PER_CALL. */
  pages: number[];
}

export const ocrStage = (provider: GeminiOcrProvider): StageDefinition<OcrStageInput, OcrResult> =>
  defineStage({
    name: "pdf_ocr",
    version: 1,
    output: OcrResult,
    memo: "shared",
    retry: { maxAttempts: 3, repairs: 1 },
    async key(input: OcrStageInput) {
      if (!existsSync(input.path)) throw new HarnessError("input", "PDF file not found", { code: "unreadable" });
      return {
        inputs: [await hashFile(input.path), sha256Hex(JSON.stringify(input.pages))],
        prompt: provider.fingerprint.prompt,
        provider: provider.id,
        model: provider.model,
        params: provider.fingerprint.params,
      };
    },
    async run(input, ctx) {
      const pdf = new Uint8Array(readFileSync(input.path));
      const result = await ctx.meter({ provider: provider.id, model: provider.model }, () =>
        provider.ocr({ pdf, pages: input.pages, signal: ctx.signal, repair: ctx.repair })
      );
      return { pages: result.pages };
    },
  });
