// Lecture PDFs in a `process` run (P3-03, CONTRACTS D-P3-2, D-P3-3): each PDF asset of the
// recording goes through the harness `pdf_ingest` stage and its page text lands in
// `pdf_page`; the asset gets its `page_count` and `meta_json.scanned`. A PDF that cannot be
// read is recorded on its asset (`meta_json.pdf_error`) and skipped: it never fails the
// recording. A scan is only flagged; OCR runs when the user confirms its cost (P3-05).
// Page text and file paths never reach the log. Like queue.ts, this module must not import
// index.ts.

import { HarnessError, pdfIngestStage, type JobRun, type PdfExtractor, type PdfIngestOutput } from "@lectern/harness";
import { extractPdfPages } from "@lectern/pdf";
import type { AssetRow } from "./api/v2/rows.ts";
import { assetPath, transact } from "./api/v2/store.ts";
import { db } from "./db.ts";
import { logger } from "./log.ts";

export interface PdfIngestSummary {
  ingested: number;
  failed: number;
  /** Ids of the assets that are scans (D-P3-3). */
  scannedAssets: string[];
  /** PDFs whose pages came from the memo (the same file was read before). */
  cacheHits: number;
}

function metaOf(json: string | null | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Replaces an asset's pages and sets its page count and scan flag. Idempotent. */
export function savePdfPages(args: { assetId: string; recordingId: string; workspaceId: string; out: PdfIngestOutput }): void {
  const { assetId, recordingId, workspaceId, out } = args;
  transact(() => {
    db.query(`DELETE FROM pdf_page WHERE asset_id = ?`).run(assetId);
    const insert = db.query(
      `INSERT INTO pdf_page (asset_id, page_no, workspace_id, recording_id, text, char_count, has_text_layer, ocr_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    for (const page of out.pages) {
      insert.run(assetId, page.page_no, workspaceId, recordingId, page.text, page.char_count, page.has_text_layer ? 1 : 0);
    }
    const row = db.query(`SELECT meta_json FROM asset WHERE id = ?`).get(assetId) as { meta_json: string } | null;
    const { pdf_error: _error, ...meta } = metaOf(row?.meta_json);
    db.query(`UPDATE asset SET page_count = ?, meta_json = ? WHERE id = ?`).run(out.page_count, JSON.stringify({ ...meta, scanned: out.scanned }), assetId);
  });
}

/**
 * Runs `pdf_ingest` for every PDF asset of a recording, in upload order. A cancel of the job
 * is rethrown; any other failure is counted, recorded on the asset and skipped.
 */
export async function ingestRecordingPdfs(args: {
  run: JobRun;
  recordingId: string;
  workspaceId: string;
  extract?: PdfExtractor;
}): Promise<PdfIngestSummary> {
  const { run, recordingId, workspaceId } = args;
  const stage = pdfIngestStage(args.extract ?? extractPdfPages);
  const assets = db
    .query(`SELECT * FROM asset WHERE recording_id = ? AND kind = 'pdf' ORDER BY part_index, created_at`)
    .all(recordingId) as AssetRow[];
  const summary: PdfIngestSummary = { ingested: 0, failed: 0, scannedAssets: [], cacheHits: 0 };

  for (const asset of assets) {
    try {
      const path = assetPath(asset);
      if (!path) throw new HarnessError("input", "PDF file is missing", { code: "unreadable" });
      const result = await run.run(stage, { path });
      savePdfPages({ assetId: asset.id, recordingId, workspaceId, out: result.value });
      summary.ingested += 1;
      if (result.value.scanned) summary.scannedAssets.push(asset.id);
      if (result.cacheHit || result.resumed) summary.cacheHits += 1;
    } catch (err) {
      if (err instanceof HarnessError && err.kind === "canceled") throw err;
      const code = (err instanceof HarnessError && err.code) || "unreadable";
      summary.failed += 1;
      db.query(`UPDATE asset SET meta_json = json_set(COALESCE(NULLIF(meta_json, ''), '{}'), '$.pdf_error', ?) WHERE id = ?`).run(code, asset.id);
      logger.warn("pdf ingest failed", { asset_id: asset.id, recording_id: recordingId, code });
    }
  }
  return summary;
}
