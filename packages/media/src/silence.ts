import { runFfmpeg, type RunOptions } from "./ffmpeg.ts";
import type { Interval } from "./intervals.ts";
import { parseSilenceDetect } from "./parse.ts";
import { readStreamInfo } from "./probe.ts";
import { DEFAULT_SPEECH_MAP_RULES } from "./speech-map.ts";

export const SILENCE_DEFAULTS = Object.freeze({
  /**
   * Peak level (dBFS) below which audio is silence. Run on normalizeAudio()
   * output: with speech at -16 LUFS this sits about 19 dB under it.
   */
  noiseDb: -35,
  /** Shorter silences are not reported (they are kept as speech anyway). */
  minSilenceMs: DEFAULT_SPEECH_MAP_RULES.shortGapMs,
});

export interface DetectSilencesOptions extends RunOptions {
  noiseDb?: number;
  minSilenceMs?: number;
  /** Known length of the file; probed when omitted. */
  durationMs?: number;
}

/** `silencedetect` over a normalized file: the input of buildSpeechMap(). Original time. */
export async function detectSilences(
  path: string,
  options: DetectSilencesOptions = {},
): Promise<{ duration_ms: number; silences: Interval[] }> {
  const opts = { ...SILENCE_DEFAULTS, ...options };
  const duration_ms = options.durationMs ?? (await readStreamInfo(path, options)).duration_ms;
  const { stderr } = await runFfmpeg(
    [
      "-nostats",
      "-i", path,
      "-map", "0:a:0",
      "-af", `silencedetect=noise=${opts.noiseDb}dB:duration=${(opts.minSilenceMs / 1000).toFixed(3)}`,
      "-f", "null", "-",
    ],
    "무음 검출",
    options,
  );
  return { duration_ms, silences: parseSilenceDetect(stderr, duration_ms) };
}
