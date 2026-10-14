import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparedAudio } from "./types.ts";

const DIRECT_MIME_MAP: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

export async function probeAudioDuration(filePath: string): Promise<number> {
  try {
    const proc = Bun.spawn(
      [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { stdout: "pipe", stderr: "ignore" }
    );
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const val = parseFloat(out.trim());
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
  } catch {
    return 0;
  }
}

/**
 * Zero-overhead audio preparation:
 * - Compressed formats (.m4a, .mp3, .aac, .webm, .ogg) <= 75 MB bypass ffmpeg completely.
 * - Uncompressed (.wav, .flac) or oversized (> 75 MB) files are transcoded to 16kHz mono 32kbps HE-AAC (.m4a).
 */
export async function prepareAudio(inputPath: string): Promise<PreparedAudio> {
  if (!existsSync(inputPath)) {
    throw new Error(`Audio file not found: ${inputPath}`);
  }

  const st = statSync(inputPath);
  const sizeBytes = st.size;
  const sizeMb = sizeBytes / (1024 * 1024);
  const ext = extname(inputPath).toLowerCase();
  const durationSec = await probeAudioDuration(inputPath);

  const isCompactCompressed =
    [".m4a", ".mp3", ".aac", ".mp4", ".ogg", ".opus", ".webm"].includes(ext) &&
    sizeMb <= 75;

  if (isCompactCompressed) {
    return {
      filePath: inputPath,
      mimeType: DIRECT_MIME_MAP[ext] ?? "audio/mp4",
      sizeBytes,
      durationSec,
      isTemp: false,
    };
  }

  const tmpOut = join(
    process.env.TMPDIR || tmpdir(),
    `lectern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.m4a`
  );

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      tmpOut,
    ],
    { stdout: "ignore", stderr: "pipe" }
  );

  const code = await proc.exited;
  if (code !== 0 || !existsSync(tmpOut)) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(
      `ffmpeg transcoding failed (${basename(inputPath)}): ${errText.slice(-300)}`
    );
  }

  const outStat = statSync(tmpOut);
  return {
    filePath: tmpOut,
    mimeType: "audio/mp4",
    sizeBytes: outStat.size,
    durationSec: durationSec || (await probeAudioDuration(tmpOut)),
    isTemp: true,
  };
}

export function cleanupPreparedAudio(prep: PreparedAudio): void {
  if (prep.isTemp && existsSync(prep.filePath)) {
    try {
      unlinkSync(prep.filePath);
    } catch {
      // ignore cleanup error
    }
  }
}
