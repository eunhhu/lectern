// The lecture PDF pages of a recording as index input (P3-06, CONTRACTS D-P3-5): every page
// `pdf_ingest` stored (and any the user had OCR'd), grouped by asset in upload order.
// Pages without text are passed along; the chunker skips them.

import type { RecordingSources } from "@lectern/ask";
import { db } from "../db.ts";

export function pdfSourcesOf(recordingId: string): NonNullable<RecordingSources["pdfs"]> {
  const rows = db
    .query(
      `SELECT a.id AS asset_id, p.page_no, p.text FROM pdf_page p JOIN asset a ON a.id = p.asset_id
       WHERE p.recording_id = ? AND a.kind = 'pdf' ORDER BY a.part_index, a.created_at, p.page_no`
    )
    .all(recordingId) as Array<{ asset_id: string; page_no: number; text: string }>;
  const byAsset = new Map<string, Array<{ page: number; text: string }>>();
  for (const row of rows) {
    const pages = byAsset.get(row.asset_id) ?? [];
    pages.push({ page: row.page_no, text: row.text });
    byAsset.set(row.asset_id, pages);
  }
  return [...byAsset.entries()].map(([assetId, pages]) => ({ assetId, pages }));
}
