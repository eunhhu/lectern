// OCR of a scanned lecture PDF (P3-05, CONTRACTS D-P3-3): the `pdf_ocr` job a user queues
// by confirming the estimate (POST /assets/{id}/ocr). It reads the pages that still have no
// text (no text layer, not OCR'd yet) 8 at a time with Gemini, stores the text in
// `pdf_page` with `ocr_source = 'model'`, and queues the recording's search index. An
// upload or a `process` run never queues it. The job result holds counts only, never page
// text. Like queue.ts, this module must not import index.ts.

import { readSecret } from "@lectern/config";
import { GeminiOcrProvider, HarnessError, loadRouting, OCR_PAGES_PER_CALL, ocrStage, type Harness, type StageEvent } from "@lectern/harness";
import type { AssetRow, RecordingRow } from "./api/v2/rows.ts";
import { assetPath } from "./api/v2/store.ts";
import { scheduleLectureIndex } from "./ask/index-job.ts";
import { db } from "./db.ts";
import { logger } from "./log.ts";
import { cancelWatcher, canceledByUser, defaultProcessHarness } from "./process-job.ts";
import { JOB_CANCELED_MESSAGE, type JobOutcome, type LeasedJob } from "./queue.ts";

export const OCR_JOB_KIND = "pdf_ocr";
export const OCR_FAILED_MESSAGE = "OCR에 실패했습니다. 잠시 뒤 다시 시도해 주세요.";

/** Pages of a PDF asset that still have no text: no text layer and not OCR'd. */
export function pagesNeedingOcr(assetId: string): number[] {
  return (
    db
      .query(`SELECT page_no FROM pdf_page WHERE asset_id = ? AND has_text_layer = 0 AND ocr_source IS NULL ORDER BY page_no`)
      .all(assetId) as Array<{ page_no: number }>
  ).map((r) => r.page_no);
}

export interface OcrJobDeps {
  provider?: GeminiOcrProvider;
  harness?: Harness;
}

function defaultProvider(): GeminiOcrProvider {
  const route = loadRouting().ocr;
  return new GeminiOcrProvider(route.model, { apiKey: () => readSecret("GEMINI_API_KEY"), maxOutputTokens: route.maxOutputTokens });
}

const charCount = (text: string) => [...text.replace(/\s/g, "")].length;

export async function runOcrJob(job: LeasedJob, deps: OcrJobDeps = {}): Promise<JobOutcome> {
  const assetId = String(job.payload.asset_id ?? "");
  const fields = { job_id: job.id, asset_id: assetId };
  const asset = db.query(`SELECT * FROM asset WHERE id = ? AND kind = 'pdf'`).get(assetId) as AssetRow | null;
  const path = asset ? assetPath(asset) : null;
  if (!asset || !path) return { ok: false, error: "PDF 파일을 찾을 수 없습니다." };
  const recording = db.query(`SELECT * FROM recording WHERE id = ?`).get(asset.recording_id) as RecordingRow | null;
  if (!recording) return { ok: false, error: "녹음을 찾을 수 없습니다." };

  // Read again on every run: pages with a text layer or already OCR'd are never sent.
  const pages = pagesNeedingOcr(asset.id);
  if (pages.length === 0) return { ok: true, result: { pages: 0 } };

  const controller = new AbortController();
  const cancel = cancelWatcher(job.id, controller);
  const harness = deps.harness ?? defaultProcessHarness();
  const run = harness.job({
    jobId: job.id,
    scope: recording.workspace_id,
    workspaceId: recording.workspace_id,
    signal: controller.signal,
    onEvent: (ev: StageEvent) => {
      if (ev.type === "started" || ev.type === "retry") cancel.check();
      if (ev.type === "retry" || ev.type === "failed") {
        logger.warn(`ocr stage ${ev.type}`, { ...fields, stage: ev.stage, error_kind: ev.error.kind, error_code: ev.error.code });
      }
    },
  });

  let ocred = 0;
  try {
    const provider = deps.provider ?? defaultProvider();
    const stage = ocrStage(provider);
    const update = db.query(
      `UPDATE pdf_page SET text = ?, char_count = ?, ocr_source = 'model'
       WHERE asset_id = ? AND page_no = ? AND has_text_layer = 0 AND ocr_source IS NULL`
    );
    for (let at = 0, chunkIndex = 0; at < pages.length; at += OCR_PAGES_PER_CALL, chunkIndex += 1) {
      const batch = pages.slice(at, at + OCR_PAGES_PER_CALL);
      const result = await run.run(stage, { path, pages: batch }, { chunkIndex });
      // Each batch is stored as it lands: a later failure keeps the pages already read.
      db.transaction(() => {
        for (const page of result.value.pages) {
          const text = page.text.normalize("NFC").trim();
          ocred += update.run(text, charCount(text), asset.id, page.page_no).changes;
        }
      }).immediate();
    }
  } catch (err) {
    const error = err instanceof HarnessError ? err : null;
    logger.warn("pdf ocr failed", { ...fields, error_kind: error?.kind, error_code: error?.code, ocr_pages: ocred });
    if (canceledByUser(controller.signal)) return { ok: false, canceled: true, error: JOB_CANCELED_MESSAGE };
    return { ok: false, error: OCR_FAILED_MESSAGE };
  } finally {
    cancel.stop();
    if (ocred > 0) afterOcr(asset, recording, job.ownerId);
  }
  return { ok: true, result: { pages: ocred } };
}

/** Records how many pages were OCR'd and queues the recording's search index. */
function afterOcr(asset: AssetRow, recording: RecordingRow, ownerId: string): void {
  const total = (
    db.query(`SELECT COUNT(*) AS n FROM pdf_page WHERE asset_id = ? AND ocr_source = 'model'`).get(asset.id) as { n: number }
  ).n;
  db.query(`UPDATE asset SET meta_json = json_set(COALESCE(NULLIF(meta_json, ''), '{}'), '$.ocr_pages', ?) WHERE id = ?`).run(total, asset.id);
  if (recording.lecture_id) scheduleLectureIndex(recording.lecture_id, ownerId);
}
