import { extname } from "node:path";
import { db } from "../../db.ts";
import { audioMimeForPath, serveFileWithRange } from "../../media-files.ts";
import { loadRecording } from "./access.ts";
import { defineRouter, notFound, notImplemented } from "./common.ts";
import type { AssetRow } from "./rows.ts";
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
    // Private: the bytes are a user's recording or document.
    return serveFileWithRange(req.c.req.raw, path, mime, { "Cache-Control": "private, no-store" });
  },
  // Lecture PDFs (CONTRACTS §3): P3-03 lists the pages, P3-05 runs the confirmed OCR.
  listAssetPages: notImplemented,
  ocrAsset: notImplemented,
});
