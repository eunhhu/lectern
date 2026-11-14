import { extname } from "node:path";
import { config, readSecret } from "@lectern/config";
import { estimateOcrCost, loadRouting } from "@lectern/harness";
import { db } from "../../db.ts";
import { audioMimeForPath, serveFileWithRange } from "../../media-files.ts";
import { OCR_JOB_KIND, pagesNeedingOcr } from "../../pdf-ocr-job.ts";
import { enqueueJob } from "../../queue.ts";
import { loadRecording } from "./access.ts";
import { apiError, defineRouter, notFound, notImplemented, ok } from "./common.ts";
import { canUseServerKey } from "./recordings.ts";
import { parseJson, type AssetRow } from "./rows.ts";
import { assetPath } from "./store.ts";

// Asset bytes with Range support (the audio player seeks). Native players that cannot set
// headers may pass `?token=` (auth.ts), as with v1 `/api/lectures/{id}/audio`. The type
// comes from the stored file's extension, never from the uploader.
const DOCUMENT_TYPES: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

export const assetsRouter = defineRouter({
  getAssetContent: (req) => {
    const asset = db.query(`SELECT * FROM asset WHERE id = ?`).get(String(req.params.asset_id)) as AssetRow | null;
    if (!asset) return notFound(req, "파일");
    if (loadRecording(req, asset.recording_id) instanceof Response) return notFound(req, "파일");
    const path = assetPath(asset);
    if (!path) return notFound(req, "파일");
    const mime = asset.kind.startsWith("audio") ? audioMimeForPath(path) : (DOCUMENT_TYPES[extname(path).toLowerCase()] ?? null);
    // Private: the bytes are a user's recording or document. A PDF opens in the browser's
    // viewer (inline) and is never sniffed as anything else.
    const headers: Record<string, string> =
      asset.kind === "pdf"
        ? { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" }
        : { "Cache-Control": "private, no-store" };
    return serveFileWithRange(req.c.req.raw, path, mime, headers);
  },
  // Lecture PDFs (CONTRACTS §3, D-P3-3): the pages `pdf_ingest` read (P3-03); P3-05 runs the
  // confirmed OCR. Before the run reads a PDF it has no pages yet.
  listAssetPages: (req) => {
    if (!config().pdf) return notImplemented(req);
    const asset = db.query(`SELECT * FROM asset WHERE id = ?`).get(String(req.params.asset_id)) as AssetRow | null;
    if (!asset || asset.kind !== "pdf") return notFound(req, "파일");
    if (loadRecording(req, asset.recording_id) instanceof Response) return notFound(req, "파일");
    const rows = db
      .query(`SELECT page_no, has_text_layer, char_count FROM pdf_page WHERE asset_id = ? ORDER BY page_no`)
      .all(asset.id) as Array<{ page_no: number; has_text_layer: number; char_count: number }>;
    const pages = rows.map((r) => ({ page_no: r.page_no, has_text_layer: r.has_text_layer === 1, char_count: r.char_count }));
    const meta = parseJson<Record<string, unknown>>(asset.meta_json, {});
    return ok(req, { page_count: asset.page_count ?? pages.length, scanned: meta.scanned === true, pages });
  },
  // OCR only after the user saw the estimate (D-P3-3): a dry run never touches the model or
  // the queue; a confirmed request queues one `pdf_ocr` job for the pages without text.
  ocrAsset: (req) => {
    if (!config().pdf) return notImplemented(req);
    const asset = db.query(`SELECT * FROM asset WHERE id = ?`).get(String(req.params.asset_id)) as AssetRow | null;
    if (!asset || asset.kind !== "pdf") return notFound(req, "파일");
    const recording = loadRecording(req, asset.recording_id, "recording:update");
    if (recording instanceof Response) return recording.status === 404 ? notFound(req, "파일") : recording;
    const rows = (db.query(`SELECT COUNT(*) AS n FROM pdf_page WHERE asset_id = ?`).get(asset.id) as { n: number }).n;
    if (rows === 0) return apiError(req.c, 409, "conflict", "아직 PDF를 읽는 중입니다. 잠시 뒤 다시 시도해 주세요.");

    const pages = pagesNeedingOcr(asset.id);
    if (pages.length === 0) return ok(req, { pages_to_ocr: 0, estimated_cost_microusd: 0, job_id: null }, { status: 200 });
    const cost = estimateOcrCost({ pagesToOcr: pages.length, pageCount: asset.page_count ?? rows, model: loadRouting().ocr.model });
    const estimate = { pages_to_ocr: pages.length, estimated_cost_microusd: cost };
    if ((req.body as { dry_run: boolean }).dry_run) return ok(req, { ...estimate, job_id: null }, { status: 200 });

    if (!canUseServerKey(req.user!)) return apiError(req.c, 403, "forbidden", "서버 AI 키 사용 권한이 없는 계정입니다.");
    if (!readSecret("GEMINI_API_KEY")) return apiError(req.c, 503, "unavailable", "AI 키가 설정되지 않아 OCR을 할 수 없습니다.");
    const queued = enqueueJob({
      kind: OCR_JOB_KIND,
      ownerId: req.user!.id,
      subjectId: recording.id,
      payload: { asset_id: asset.id },
      budgetMicrousd: cost * 2,
    });
    // One OCR per recording at a time (the queue dedupes on the recording): another PDF's
    // job still pending means this one has to wait for it.
    if (queued.deduplicated) {
      const existing = db.query(`SELECT payload FROM job WHERE id = ?`).get(queued.jobId) as { payload: string } | null;
      if (parseJson<{ asset_id?: string }>(existing?.payload, {}).asset_id !== asset.id) {
        return apiError(req.c, 409, "conflict", "이 녹음의 다른 PDF를 OCR하는 중입니다. 끝난 뒤 다시 시도해 주세요.");
      }
    }
    return ok(req, { ...estimate, job_id: queued.jobId }, { status: 202 });
  },
});
