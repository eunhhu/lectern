// Stored media files: the audio types uploads may have, and serving a file with Range
// requests. The served type always comes from the stored file's extension, never from the
// uploader (AGENTS.md "업로드"), so a stored file is never rendered as HTML or script.

import { statSync } from "node:fs";
import { extname } from "node:path";

export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".3gp": "audio/3gpp",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

// Declared upload types we recognise, mapped to the extension the file is stored under.
export const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/x-aac": ".aac",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/vnd.wave": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/3gpp": ".3gp",
  "audio/aiff": ".aiff",
  "audio/x-aiff": ".aiff",
  "video/mp4": ".m4a",
  "video/webm": ".webm",
  "video/ogg": ".ogg",
  "video/3gpp": ".3gp",
};

/** Content-Type for a stored audio file, derived from its extension alone. */
export function audioMimeForPath(filePath: string): string | null {
  return AUDIO_MIME_BY_EXT[extname(filePath).toLowerCase()] ?? null;
}

/**
 * Picks the storage extension for an upload. Only audio extensions are accepted and a
 * declared type must be audio (or generic binary). The stored and served MIME type is
 * then derived from that extension and never echoed back from the client.
 */
export function resolveUploadAudioExt(fileName: string, declaredType: string): string {
  const mime = declaredType.split(";")[0].trim().toLowerCase();
  const isGenericBinary = !mime || mime === "application/octet-stream";
  if (!isGenericBinary && !AUDIO_EXT_BY_MIME[mime] && !mime.startsWith("audio/")) {
    throw new Error(`오디오 파일만 업로드할 수 있습니다. (지원하지 않는 형식: ${mime})`);
  }
  const ext = extname(fileName).toLowerCase();
  if (ext) {
    if (!AUDIO_MIME_BY_EXT[ext]) {
      throw new Error(`지원하지 않는 오디오 확장자입니다: ${ext}`);
    }
    return ext;
  }
  return AUDIO_EXT_BY_MIME[mime] ?? ".m4a";
}

/** Serves a stored audio file with Range support. */
export function serveAudioWithRange(req: Request, filePath: string): Response {
  return serveFileWithRange(req, filePath, audioMimeForPath(filePath));
}

/**
 * Serves a file with Range support as `mimeType`; without a type the file is offered as
 * a download instead of being rendered.
 */
export function serveFileWithRange(req: Request, filePath: string, mimeType: string | null, extra: Record<string, string> = {}): Response {
  const st = statSync(filePath);
  const total = st.size;
  const range = req.headers.get("range");
  const bunFile = Bun.file(filePath);
  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeType ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    ...extra,
  };
  if (!mimeType) baseHeaders["Content-Disposition"] = "attachment";

  const m = range ? range.match(/bytes=(\d*)-(\d*)/) : null;
  if (!m) {
    return new Response(bunFile, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  }
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  return new Response(bunFile.slice(start, end + 1), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
