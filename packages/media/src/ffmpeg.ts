import { renameSync, unlinkSync } from "node:fs";

/**
 * Why a media operation failed. The harness maps these to `StageError`:
 * input problems (`empty`, `corrupt`, `no_audio_stream`, `unsupported_codec`,
 * `silent`) are class `input`, `ffmpeg_missing` is `config`, `ffmpeg_failed`
 * is `transient` unless it repeats.
 */
export type MediaErrorCode =
  | "ffmpeg_missing"
  | "ffmpeg_failed"
  | "empty"
  | "corrupt"
  | "no_audio_stream"
  | "unsupported_codec"
  | "silent";

export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string,
    /** Tail of the tool's stderr, for logs. Never shown to users. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

/** Options every ffmpeg-backed call accepts. */
export interface RunOptions {
  /** Aborts the running tool (job canceled, lease lost). */
  signal?: AbortSignal;
  /** Kills the tool after this long. */
  timeoutMs?: number;
}

let available: boolean | null = null;

/** True when both `ffmpeg` and `ffprobe` run from PATH. Cached for the process. */
export function isFfmpegAvailable(): boolean {
  if (available === null) {
    available = ["ffmpeg", "ffprobe"].every((tool) => {
      try {
        return Bun.spawnSync([tool, "-hide_banner", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
      } catch {
        return false;
      }
    });
  }
  return available;
}

export interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs ffmpeg or ffprobe, reading both pipes while it runs so a chatty tool never stalls. */
export async function runTool(tool: "ffmpeg" | "ffprobe", args: string[], options: RunOptions = {}): Promise<ToolResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([tool, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: options.signal,
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (err) {
    throw new MediaError("ffmpeg_missing", `${tool}를 실행할 수 없습니다.`, String(err));
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("aborted", "AbortError");
  return { code, stdout, stderr };
}

/** Runs ffmpeg and throws `ffmpeg_failed` on a non-zero exit. */
export async function runFfmpeg(args: string[], what: string, options: RunOptions = {}): Promise<ToolResult> {
  const result = await runTool("ffmpeg", ["-nostdin", "-hide_banner", ...args], options);
  if (result.code !== 0) {
    throw new MediaError("ffmpeg_failed", `${what} 실패 (ffmpeg exit ${result.code})`, result.stderr.trim().slice(-600));
  }
  return result;
}

/**
 * Lets `write` produce `<path>.part`, then renames it into place, so a crash
 * or retry never leaves a half-written file under the final name.
 */
export async function writeAtomically<T>(path: string, write: (partPath: string) => Promise<T>): Promise<T> {
  const part = `${path}.part`;
  try {
    const result = await write(part);
    renameSync(part, path);
    return result;
  } catch (err) {
    try {
      unlinkSync(part);
    } catch {
      // never written
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Encodings
// ---------------------------------------------------------------------------

export type AudioEncoding =
  | { codec: "flac" }
  | { codec: "wav" }
  | { codec: "aac"; bitrateKbps: number }
  | { codec: "opus"; bitrateKbps: number };

/** Lossless working copy: the source for analysis, cutting and chunking. */
export const WORK_ENCODING: AudioEncoding = Object.freeze({ codec: "flac" });

/**
 * Upload format for providers. Native AAC is in every ffmpeg build; Opus
 * needs libopus. Audio tokens do not depend on bitrate, so this only shrinks
 * uploads (32 kbps mono ≈ 14 MB per hour).
 */
export const TRANSCRIBE_ENCODING: AudioEncoding = Object.freeze({ codec: "aac", bitrateKbps: 32 });

const ENCODING_INFO = {
  flac: { extension: ".flac", mime: "audio/flac" },
  wav: { extension: ".wav", mime: "audio/wav" },
  aac: { extension: ".m4a", mime: "audio/mp4" },
  opus: { extension: ".ogg", mime: "audio/ogg" },
} as const;

export function encodingExtension(encoding: AudioEncoding): string {
  return ENCODING_INFO[encoding.codec].extension;
}

export function encodingMime(encoding: AudioEncoding): string {
  return ENCODING_INFO[encoding.codec].mime;
}

/** Output arguments (codec and container), container stated explicitly so `.part` paths work. */
export function encodingArgs(encoding: AudioEncoding): string[] {
  switch (encoding.codec) {
    case "flac":
      return ["-c:a", "flac", "-sample_fmt", "s16", "-f", "flac"];
    case "wav":
      return ["-c:a", "pcm_s16le", "-f", "wav"];
    case "aac":
      return ["-c:a", "aac", "-b:a", `${encoding.bitrateKbps}k`, "-movflags", "+faststart", "-f", "mp4"];
    case "opus":
      return ["-c:a", "libopus", "-b:a", `${encoding.bitrateKbps}k`, "-application", "voip", "-f", "ogg"];
  }
}

/** Seconds with millisecond precision, as ffmpeg time arguments. */
export function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}
