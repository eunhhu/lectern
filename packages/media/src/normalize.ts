import { statSync } from "node:fs";
import {
  encodingArgs,
  encodingMime,
  MediaError,
  runFfmpeg,
  WORK_ENCODING,
  writeAtomically,
  type AudioEncoding,
  type RunOptions,
} from "./ffmpeg.ts";
import { parseEbur128Integrated } from "./parse.ts";
import { readStreamInfo } from "./probe.ts";

// normalize (AI_HARNESS §3.1): mono, 16 kHz, loudness-normalized.
//
// Loudness is normalized with one constant gain (measured EBU R128 integrated
// loudness → target) plus a peak limiter, not with ffmpeg's dynamic
// `loudnorm`. Dynamic loudnorm rides the gain up in pauses (5–20 dB more than
// the speech gets, measured), which hides silences from speech_map, and it
// resamples to 192 kHz internally (≈25× the CPU of this path, a real cost on
// the Raspberry Pi).

export const SAMPLE_RATE = 16_000;

export const NORMALIZE_DEFAULTS = Object.freeze({
  /** Target integrated loudness (EBU R128 / ITU-R BS.1770), LUFS. */
  targetLufs: -16,
  /** Gain is clamped to ±this, so a near-silent file is not amplified into pure noise. */
  maxGainDb: 30,
  /** Peak ceiling after the gain, dBFS. */
  limitDb: -1.5,
});

const MONO_16K = `aformat=channel_layouts=mono,aresample=${SAMPLE_RATE}`;

export interface NormalizeOptions extends RunOptions {
  targetLufs?: number;
  maxGainDb?: number;
  limitDb?: number;
  /** Also write a low-bitrate copy of the whole normalized audio (one decode for both files). */
  transcode?: { path: string; encoding: AudioEncoding };
}

export interface NormalizedAudio {
  /** Lossless working copy (FLAC, mono, 16 kHz): the source for speech_map and chunk. */
  path: string;
  duration_ms: number;
  integrated_lufs: number | null;
  gain_db: number;
  transcode: { path: string; bytes: number; mime: string } | null;
}

/** Gain that moves `integratedLufs` to the target, clamped; 0 when loudness is unknown (silence). */
export function loudnessGainDb(integratedLufs: number | null, targetLufs: number, maxGainDb: number): number {
  if (integratedLufs === null) return 0;
  const gain = Math.max(-maxGainDb, Math.min(maxGainDb, targetLufs - integratedLufs));
  return Math.round(gain * 100) / 100;
}

/** Integrated loudness of the mono 16 kHz mix; null below the -70 LUFS gate. */
export async function measureLoudness(input: string, options: RunOptions = {}): Promise<number | null> {
  const { stderr } = await runFfmpeg(
    ["-nostats", "-i", input, "-map", "0:a:0", "-af", `${MONO_16K},ebur128=framelog=quiet`, "-f", "null", "-"],
    "음량 측정",
    options,
  );
  return parseEbur128Integrated(stderr);
}

/** Writes the normalized working copy to `outPath` (FLAC) and, if asked, a transcode beside it. */
export async function normalizeAudio(input: string, outPath: string, options: NormalizeOptions = {}): Promise<NormalizedAudio> {
  const opts = { ...NORMALIZE_DEFAULTS, ...options };
  const integrated = await measureLoudness(input, options);
  const gain = loudnessGainDb(integrated, opts.targetLufs, opts.maxGainDb);
  const limit = Math.min(1, Math.max(0.0625, 10 ** (opts.limitDb / 20))).toFixed(4);
  // latency=1 compensates the limiter's lookahead, so output time equals input time. An ffmpeg
  // without the option (older than 5.1) rejects the graph rather than shifting timestamps.
  const chain = `${MONO_16K},volume=${gain}dB,alimiter=limit=${limit}:level=0:latency=1`;
  const output = (path: string, encoding: AudioEncoding) => [
    "-map", "0:a:0", "-map_metadata", "-1", "-af", chain, ...encodingArgs(encoding), path,
  ];

  const transcode = options.transcode;
  await writeAtomically(outPath, (part) =>
    transcode
      ? writeAtomically(transcode.path, (transcodePart) =>
          runFfmpeg(["-y", "-i", input, ...output(part, WORK_ENCODING), ...output(transcodePart, transcode.encoding)], "정규화", options),
        )
      : runFfmpeg(["-y", "-i", input, ...output(part, WORK_ENCODING)], "정규화", options),
  );

  const { duration_ms } = await readStreamInfo(outPath, options);
  if (duration_ms === 0) throw new MediaError("corrupt", "정규화 결과가 비어 있습니다.");
  return {
    path: outPath,
    duration_ms,
    integrated_lufs: integrated,
    gain_db: gain,
    transcode: transcode
      ? { path: transcode.path, bytes: statSync(transcode.path).size, mime: encodingMime(transcode.encoding) }
      : null,
  };
}
