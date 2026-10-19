// Synthetic recordings for the example eval set and the pipeline tests: a 300 Hz tone
// wherever the script says someone speaks, digital silence elsewhere (`-f lavfi` only, no
// real voices). speech_map then finds the script's long pauses, breaks and tail.

import { runFfmpeg, TRANSCRIBE_ENCODING, encodingArgs, writeAtomically, type AudioEncoding, type Interval } from "@lectern/media";

/** ffmpeg expression that is non-zero inside any of `ranges` (seconds, 3 decimals). */
function inside(ranges: readonly Interval[]): string {
  if (ranges.length === 0) return "0";
  return ranges.map((r) => `between(t,${(r.start_ms / 1000).toFixed(3)},${(r.end_ms / 1000).toFixed(3)})`).join("+");
}

/**
 * Writes `outPath`: `durationMs` of audio, tone inside `speech` ranges, silent elsewhere.
 * Ranges are merged into runs first, so the filter stays short for long scripts.
 */
export async function synthesizeSpeechTone(
  speech: readonly Interval[],
  durationMs: number,
  outPath: string,
  encoding: AudioEncoding = TRANSCRIBE_ENCODING,
): Promise<string> {
  const runs: Interval[] = [];
  for (const r of [...speech].sort((a, b) => a.start_ms - b.start_ms)) {
    const last = runs.at(-1);
    if (last && r.start_ms <= last.end_ms) last.end_ms = Math.max(last.end_ms, r.end_ms);
    else runs.push({ ...r });
  }
  const seconds = (durationMs / 1000).toFixed(3);
  await writeAtomically(outPath, (part) =>
    runFfmpeg(
      [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `sine=frequency=300:sample_rate=16000:duration=${seconds}`,
        "-af", `volume=0:enable='not(${inside(runs)})'`,
        ...encodingArgs(encoding),
        part,
      ],
      "합성 오디오 생성",
    ),
  );
  return outPath;
}
