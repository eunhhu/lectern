import { runFfmpeg, type RunOptions } from "./ffmpeg.ts";
import type { Interval } from "./intervals.ts";
import { SAMPLE_RATE } from "./normalize.ts";
import { parseSilenceDetect, parseWindowPeaks } from "./parse.ts";
import { readStreamInfo } from "./probe.ts";
import { DEFAULT_SPEECH_MAP_RULES } from "./speech-map.ts";
import {
  AUTO_THRESHOLD_DEFAULTS,
  estimateSilenceThreshold,
  type AutoThresholdOptions,
  type SilenceThreshold,
} from "./threshold.ts";

/** The fixed threshold: the default, and the floor `"auto"` never goes below. */
export const FIXED_NOISE_DB = -35;

export const SILENCE_DEFAULTS = Object.freeze({
  /**
   * Peak level (dBFS) below which audio is silence. Run on normalizeAudio()
   * output: with speech at -16 LUFS this sits about 19 dB under it. `"auto"`
   * raises it in noisy recordings (estimateSilenceThreshold); the fixed value
   * stays the default until the eval set shows auto is safe.
   */
  noiseDb: FIXED_NOISE_DB as number | "auto",
  /** Shorter silences are not reported (they are kept as speech anyway). */
  minSilenceMs: DEFAULT_SPEECH_MAP_RULES.shortGapMs,
});

export interface DetectSilencesOptions extends RunOptions {
  noiseDb?: number | "auto";
  /** Tuning for `noiseDb: "auto"`. */
  auto?: AutoThresholdOptions;
  minSilenceMs?: number;
  /** Known length of the file; probed when omitted. */
  durationMs?: number;
}

export interface DetectedSilences {
  duration_ms: number;
  silences: Interval[];
  /** The threshold used and, for `"auto"`, how it was chosen. Log it; it belongs in the memo key. */
  threshold: SilenceThreshold;
}

/** `silencedetect` over a normalized file: the input of buildSpeechMap(). Original time. */
export async function detectSilences(path: string, options: DetectSilencesOptions = {}): Promise<DetectedSilences> {
  const opts = { ...SILENCE_DEFAULTS, ...options };
  const needInfo = options.durationMs === undefined || opts.noiseDb === "auto";
  const info = needInfo ? await readStreamInfo(path, options) : null;
  const duration_ms = options.durationMs ?? info!.duration_ms;
  const threshold: SilenceThreshold =
    opts.noiseDb === "auto"
      ? estimateSilenceThreshold(
          await measureWindowPeaks(path, info!.sample_rate, options.auto?.windowMs, options),
          FIXED_NOISE_DB,
          options.auto,
        )
      : { noise_db: opts.noiseDb, adaptive: false, floor_db: null, speech_db: null };
  const { stderr } = await runFfmpeg(
    [
      "-nostats",
      "-i", path,
      "-map", "0:a:0",
      "-af", `silencedetect=noise=${threshold.noise_db}dB:duration=${(opts.minSilenceMs / 1000).toFixed(3)}`,
      "-f", "null", "-",
    ],
    "무음 검출",
    options,
  );
  return { duration_ms, silences: parseSilenceDetect(stderr, duration_ms), threshold };
}

/**
 * Peak level of every `windowMs` window (dBFS, in order): one cheap decode of
 * the file with `astats`, printed to stdout. About 36,000 values per hour at
 * the default 100 ms.
 */
export async function measureWindowPeaks(
  path: string,
  sampleRate: number,
  windowMs: number = AUTO_THRESHOLD_DEFAULTS.windowMs,
  options: RunOptions = {},
): Promise<number[]> {
  const samples = Math.max(1, Math.round(((sampleRate > 0 ? sampleRate : SAMPLE_RATE) * windowMs) / 1000));
  const { stdout } = await runFfmpeg(
    [
      "-loglevel", "error",
      "-i", path,
      "-map", "0:a:0",
      "-af",
      [
        `asetnsamples=n=${samples}:p=0`,
        "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level",
        "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-",
      ].join(","),
      "-f", "null", "-",
    ],
    "음량 분포 측정",
    options,
  );
  return parseWindowPeaks(stdout);
}
