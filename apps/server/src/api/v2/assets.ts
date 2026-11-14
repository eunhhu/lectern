import { extname } from "node:path";
import { config } from "@lectern/config";
import { db } from "../../db.ts";
import { audioMimeForPath, serveFileWithRange } from "../../media-files.ts";
import { loadRecording } from "./access.ts";
import { defineRouter, notFound, notImplemented, ok } from "./common.ts";
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
  ocrAsset: notImplemented,
});
