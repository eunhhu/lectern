// The `pdf_ingest` stage (P3-03, CONTRACTS D-P3-2, D-P3-3): the page text of one lecture PDF.
// The harness does not depend on the PDF reader; the server injects the extractor
// (@lectern/pdf's extractPdfPages). The memo key is the file's content hash, so the same PDF
// uploaded again in the same workspace is not read twice. A PDF that cannot be read is the
// user's input (no retry). Nothing here runs OCR: a scan is only flagged (D-P3-3).

import { existsSync } from "node:fs";
import { z } from "zod";
import { HarnessError } from "../errors.ts";
import { hashFile } from "../hash.ts";
import { defineStage, type StageDefinition } from "../stage.ts";

export const PdfIngestPage = z.object({
  page_no: z.int().min(1),
  text: z.string(),
  char_count: z.int().nonnegative(),
  has_text_layer: z.boolean(),
});
export type PdfIngestPage = z.infer<typeof PdfIngestPage>;

export const PdfIngestOutput = z.object({
  page_count: z.int().nonnegative(),
  scanned: z.boolean(),
  pages: z.array(PdfIngestPage),
});
export type PdfIngestOutput = z.infer<typeof PdfIngestOutput>;

export interface PdfIngestInput {
  /** The stored PDF. Read only, never copied into the blob store. */
  path: string;
}

/** The shape of @lectern/pdf's extractPdfPages; it throws an error named `PdfError` with a `code`. */
export type PdfExtractor = (path: string) => Promise<{
  pageCount: number;
  scanned: boolean;
  pages: { pageNo: number; text: string; charCount: number; hasTextLayer: boolean }[];
}>;

/** Matches @lectern/pdf's MIN_TEXT_CHARS and MAX_PDF_PAGES; part of the memo key. */
const EXTRACT_CONFIG = { extractor: 1, min_chars: 20, max_pages: 500 } as const;

export const pdfIngestStage = (extract: PdfExtractor): StageDefinition<PdfIngestInput, PdfIngestOutput> =>
  defineStage({
    name: "pdf_ingest",
    version: 1,
    output: PdfIngestOutput,
    memo: "shared",
    retry: { maxAttempts: 1, repairs: 0 },
    async key(input: PdfIngestInput) {
      if (!existsSync(input.path)) throw new HarnessError("input", "PDF file not found", { code: "unreadable" });
      return { inputs: [await hashFile(input.path)], config: EXTRACT_CONFIG };
    },
    async run(input) {
      let pdf: Awaited<ReturnType<PdfExtractor>>;
      try {
        pdf = await extract(input.path);
      } catch (err) {
        const e = err as { name?: unknown; message?: unknown; code?: unknown } | null;
        if (e?.name === "PdfError") {
          throw new HarnessError("input", String(e.message ?? ""), { cause: err, code: typeof e.code === "string" ? e.code : undefined });
        }
        throw err;
      }
      return {
        page_count: pdf.pageCount,
        scanned: pdf.scanned,
        pages: pdf.pages.map((p) => ({ page_no: p.pageNo, text: p.text, char_count: p.charCount, has_text_layer: p.hasTextLayer })),
      };
    },
  });
