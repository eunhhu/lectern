import { encodingArgs, MediaError, runFfmpeg, WORK_ENCODING, writeAtomically, type RunOptions } from "./ffmpeg.ts";
import { readStreamInfo } from "./probe.ts";

// Several audio files recorded as one session (part 1, part 2, …) become one timeline
// (CONTRACTS D-P1-9): each part is resampled to 16 kHz mono and appended in order, so a time
// in part n is that part's offset plus the lengths of the parts before it.

export interface ConcatResult {
  duration_ms: number;
  /** Input order, each part's own length. */
  parts: Array<{ path: string; duration_ms: number }>;
}

/**
 * Joins audio files end to end into one lossless 16 kHz mono file at `outPath`. Original
 * time of part n starts where the parts before it end. Inputs may differ in format, rate
 * and channel count.
 */
export async function concatAudio(inputs: readonly string[], outPath: string, options: RunOptions = {}): Promise<ConcatResult> {
  if (inputs.length === 0) throw new MediaError("empty", "이어 붙일 오디오가 없습니다.");
  const parts: ConcatResult["parts"] = [];
  for (const path of inputs) parts.push({ path, duration_ms: (await readStreamInfo(path, options)).duration_ms });

  const graph = [
    ...inputs.map((_, i) => `[${i}:a:0]aresample=16000,aformat=channel_layouts=mono[a${i}]`),
    `${inputs.map((_, i) => `[a${i}]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`,
  ].join(";");
  await writeAtomically(outPath, (part) =>
    runFfmpeg(
      ["-y", ...inputs.flatMap((p) => ["-i", p]), "-filter_complex", graph, "-map", "[out]", ...encodingArgs(WORK_ENCODING), part],
      "오디오 이어 붙이기",
      options
    )
  );
  return { duration_ms: (await readStreamInfo(outPath, options)).duration_ms, parts };
}
