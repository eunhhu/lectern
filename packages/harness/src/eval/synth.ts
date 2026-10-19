// Synthetic recordings for the example eval set and the pipeline tests: a 300 Hz tone
// wherever the script says someone speaks, digital silence elsewhere (`-f lavfi` only, no
// real voices). speech_map then finds the script's long pauses, breaks and tail.

import {
  complementIntervals,
  encodingArgs,
  normalizeIntervals,
  runFfmpeg,
  TRANSCRIBE_ENCODING,
  writeAtomically,
  type AudioEncoding,
  type Interval,
} from "@lectern/media";

/** ffmpeg expression that is non-zero inside any of `ranges` (seconds, 3 decimals). */
function inside(ranges: readonly Interval[]): string {
  return ranges.map((r) => `between(t,${(r.start_ms / 1000).toFixed(3)},${(r.end_ms / 1000).toFixed(3)})`).join("+");
}

/** ffmpeg's expression parser gives up on long sums, so gaps are muted by several filters in a row. */
const RANGES_PER_FILTER = 40;

/**
 * Writes `outPath`: `durationMs` of audio, tone inside `speech` ranges, silent elsewhere.
 * The gaps between speech are muted, at most RANGES_PER_FILTER per `volume` filter.
 */
export async function synthesizeSpeechTone(
  speech: readonly Interval[],
  durationMs: number,
  outPath: string,
  encoding: AudioEncoding = TRANSCRIBE_ENCODING,
): Promise<string> {
  const runs = normalizeIntervals(speech, durationMs);
  const gaps = complementIntervals(runs, durationMs);
  const filters: string[] = [];
  for (let i = 0; i < gaps.length; i += RANGES_PER_FILTER) {
    filters.push(`volume=0:enable='${inside(gaps.slice(i, i + RANGES_PER_FILTER))}'`);
  }
  const seconds = (durationMs / 1000).toFixed(3);
  await writeAtomically(outPath, (part) =>
    runFfmpeg(
      [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `sine=frequency=300:sample_rate=16000:duration=${seconds}`,
        "-af", filters.length ? filters.join(",") : "anull",
        ...encodingArgs(encoding),
        part,
      ],
      "합성 오디오 생성",
    ),
  );
  return outPath;
}
