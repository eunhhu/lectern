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

export async function probeAudioVolume(
  filePath: string
): Promise<{ maxVolumeDb: number | null; meanVolumeDb: number | null }> {
  try {
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-t",
        "300",
        "-i",
        filePath,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { stdout: "ignore", stderr: "pipe" }
    );
    const stderrText = await new Response(proc.stderr).text();
    await proc.exited;
    const maxMatch = stderrText.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanMatch = stderrText.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]) : null;
    const meanVolumeDb = meanMatch ? parseFloat(meanMatch[1]) : null;
    return {
      maxVolumeDb:
        maxVolumeDb !== null && Number.isFinite(maxVolumeDb)
          ? maxVolumeDb
          : null,
      meanVolumeDb:
        meanVolumeDb !== null && Number.isFinite(meanVolumeDb)
          ? meanVolumeDb
          : null,
    };
  } catch {
    return { maxVolumeDb: null, meanVolumeDb: null };
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
  const vol = await probeAudioVolume(inputPath);

  const isCompactCompressed =
    [".m4a", ".mp3", ".aac", ".mp4", ".ogg", ".opus", ".webm"].includes(ext) &&
    sizeMb <= 75;

  if (isCompactCompressed) {
    return {
      filePath: inputPath,
      mimeType: DIRECT_MIME_MAP[ext] ?? "audio/mp4",
      sizeBytes,
      durationSec,
      maxVolumeDb: vol.maxVolumeDb,
      meanVolumeDb: vol.meanVolumeDb,
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
    maxVolumeDb: vol.maxVolumeDb,
    meanVolumeDb: vol.meanVolumeDb,
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
