import { statSync } from "node:fs";
import { MediaError, runTool, seconds, type MediaErrorCode, type RunOptions } from "./ffmpeg.ts";
import type { Interval } from "./intervals.ts";
import { parseVolumeDetect, type VolumeStats } from "./parse.ts";
import { probeAudio, type AudioProbe } from "./probe.ts";

// Pre-rejection (AI_HARNESS §3.1): empty, corrupt, unsupported or silent files fail before any
// normalization or provider cost. Silence is judged on samples spread over the whole recording,
// not its first five minutes.

/** Audio codecs the pipeline accepts (the upload whitelist's containers), plus every `pcm_*`. */
export const SUPPORTED_CODECS: ReadonlySet<string> = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "alac",
  "amr_nb",
  "amr_wb",
]);

export function isSupportedCodec(codec: string): boolean {
  return SUPPORTED_CODECS.has(codec) || codec.startsWith("pcm_");
}

export const SCREEN_DEFAULTS = Object.freeze({
  /** Shorter recordings are rejected as empty. */
  minDurationMs: 1_000,
  /** A peak at or below this (dBFS) is silence, as in the v1 check. */
  silenceMaxDb: -60,
  sampleCount: 12,
  sampleWindowMs: 10_000,
});

export interface ScreenOptions extends RunOptions {
  minDurationMs?: number;
  silenceMaxDb?: number;
  sampleCount?: number;
  sampleWindowMs?: number;
}

export type ScreenRejection = Exclude<MediaErrorCode, "ffmpeg_missing" | "ffmpeg_failed">;

export type ScreenResult =
  | {
      ok: true;
      probe: AudioProbe;
      /** Peak over the samples, or over the whole file when the samples looked silent. */
      max_volume_db: number;
      /** False when the whole file was scanned. */
      sampled: boolean;
    }
  | {
      ok: false;
      code: ScreenRejection;
      /** Korean, shown to the user (with the likely cause, e.g. microphone permission). */
      message: string;
      probe: AudioProbe | null;
      detail?: string;
    };

/**
 * `count` windows of `windowMs` spread evenly from the start to the end of
 * the recording (first at 0, last ending at the end). A recording no longer
 * than the windows together is one window over the whole file.
 */
export function sampleWindows(durationMs: number, count: number, windowMs: number): Interval[] {
  if (durationMs <= 0) return [];
  if (count <= 1 || durationMs <= count * windowMs) return [{ start_ms: 0, end_ms: durationMs }];
  const stride = (durationMs - windowMs) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.round(i * stride);
    return { start_ms: start, end_ms: Math.min(durationMs, start + windowMs) };
  });
}

const EMPTY_MESSAGE = "녹음 길이가 0초이거나 너무 짧습니다.";
const SILENT_MESSAGE =
  "녹음된 오디오에서 소리가 감지되지 않았습니다. 기기의 마이크 권한과 입력 마이크 설정을 확인해 주세요.";

/**
 * Decides whether a file is worth processing. A rejection is a verdict, not
 * an exception; only ffmpeg being unavailable or an abort throws.
 */
export async function screenAudio(path: string, options: ScreenOptions = {}): Promise<ScreenResult> {
  const opts = { ...SCREEN_DEFAULTS, ...options };
  if (statSync(path).size === 0) return { ok: false, code: "empty", message: EMPTY_MESSAGE, probe: null };
  let probe: AudioProbe;
  try {
    probe = await probeAudio(path, options);
  } catch (err) {
    if (err instanceof MediaError && (err.code === "corrupt" || err.code === "no_audio_stream")) {
      return { ok: false, code: err.code, message: err.message, probe: null, detail: err.detail };
    }
    throw err;
  }
  if (!isSupportedCodec(probe.codec)) {
    return { ok: false, code: "unsupported_codec", message: `지원하지 않는 오디오 코덱입니다 (${probe.codec || "알 수 없음"}).`, probe };
  }
  if (probe.duration_ms < opts.minDurationMs) {
    return { ok: false, code: "empty", message: EMPTY_MESSAGE, probe };
  }

  const windows = sampleWindows(probe.duration_ms, opts.sampleCount, opts.sampleWindowMs);
  let stats = windows.length > 1 ? await volumeOf(path, windows, options) : null;
  let sampled = stats !== null;
  // Samples can all land in pauses, and seeking can fail on odd files: before rejecting, scan the whole file.
  if (!stats || stats.n_samples === 0 || stats.max_volume_db <= opts.silenceMaxDb) {
    stats = await volumeOf(path, [], options);
    sampled = false;
  }
  if (!stats || stats.n_samples === 0) {
    return { ok: false, code: "corrupt", message: "오디오를 디코딩할 수 없습니다. 파일이 손상되었을 수 있습니다.", probe };
  }
  if (stats.max_volume_db <= opts.silenceMaxDb) {
    return { ok: false, code: "silent", message: SILENT_MESSAGE, probe };
  }
  return { ok: true, probe, max_volume_db: stats.max_volume_db, sampled };
}

/** `volumedetect` over the given windows (input-seeked and concatenated), or the whole file when none. */
async function volumeOf(path: string, windows: readonly Interval[], options: RunOptions): Promise<VolumeStats | null> {
  const inputs = windows.length
    ? windows.flatMap((w) => ["-ss", seconds(w.start_ms), "-t", seconds(w.end_ms - w.start_ms), "-i", path])
    : ["-i", path];
  const count = Math.max(1, windows.length);
  const graph =
    count === 1
      ? "[0:a:0]volumedetect[out]"
      : `${Array.from({ length: count }, (_, i) => `[${i}:a:0]`).join("")}concat=n=${count}:v=0:a=1,volumedetect[out]`;
  const result = await runTool(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-nostats", ...inputs, "-filter_complex", graph, "-map", "[out]", "-f", "null", "-"],
    options,
  );
  return result.code === 0 ? parseVolumeDetect(result.stderr) : null;
}
