import { statSync } from "node:fs";
import { MediaError, runTool, type RunOptions } from "./ffmpeg.ts";
import { parsePacketDurationMs, parseProbeJson, type ProbeStreamInfo } from "./parse.ts";

// ingest (AI_HARNESS §3.1): what the file is, how long it is, when it was recorded, and its hash.

export interface AudioProbe extends ProbeStreamInfo {
  size_bytes: number;
  /** Lowercase hex SHA-256 of the file bytes: the duplicate key within a workspace. */
  sha256: string;
}

/** Streams the file through SHA-256 (uploads can be hundreds of MB; nothing is read whole). */
export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/**
 * ffprobe metadata of the first audio stream plus size and SHA-256. When the
 * container states no duration (MediaRecorder WebM does not), the packets are
 * scanned. Throws `corrupt` when ffprobe cannot read the file and
 * `no_audio_stream` when it has no audio.
 */
export async function probeAudio(path: string, options: RunOptions = {}): Promise<AudioProbe> {
  const size_bytes = statSync(path).size;
  const [info, sha256] = await Promise.all([readStreamInfo(path, options), sha256File(path)]);
  return { ...info, size_bytes, sha256 };
}

/** probeAudio() without the hash: for files this package wrote. */
export async function readStreamInfo(path: string, options: RunOptions = {}): Promise<ProbeStreamInfo> {
  const result = await runTool("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], options);
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  if (result.code !== 0 || json === null) {
    throw new MediaError("corrupt", "오디오 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.", result.stderr.trim().slice(-600));
  }
  const info = parseProbeJson(json);
  if (!info) throw new MediaError("no_audio_stream", "파일에 오디오 트랙이 없습니다.");
  if (info.duration_ms === 0) info.duration_ms = await scanDurationMs(path, options);
  return info;
}

async function scanDurationMs(path: string, options: RunOptions): Promise<number> {
  const result = await runTool(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", path],
    options,
  );
  return result.code === 0 ? parsePacketDurationMs(result.stdout) : 0;
}
