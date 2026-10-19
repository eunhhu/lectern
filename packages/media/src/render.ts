import { statSync } from "node:fs";
import { join } from "node:path";
import type { ChunkSpec } from "./chunk-plan.ts";
import {
  encodingArgs,
  encodingExtension,
  encodingMime,
  runFfmpeg,
  seconds,
  TRANSCRIBE_ENCODING,
  WORK_ENCODING,
  writeAtomically,
  type AudioEncoding,
  type RunOptions,
} from "./ffmpeg.ts";
import { readStreamInfo } from "./probe.ts";
import { validateTimeMap, type TimeMap } from "./time-map.ts";

export interface RenderedAudio {
  path: string;
  bytes: number;
  mime: string;
  /** Measured by ffprobe. Lossy encoders may differ from the plan by a few frames. */
  duration_ms: number;
}

export interface RenderOptions extends RunOptions {
  /** Default: lossless FLAC for the speech-only audio, AAC 32 kbps for chunks. */
  encoding?: AudioEncoding;
}

/**
 * Writes the speech-only audio: the time map's kept ranges of `source` (the
 * normalized file, original time) back to back. Trimming is sample-accurate,
 * so the result is `cutDurationMs(timeMap)` long.
 */
export async function renderSpeechAudio(
  source: string,
  timeMap: TimeMap,
  outPath: string,
  options: RenderOptions = {},
): Promise<RenderedAudio> {
  const entries = validateTimeMap(timeMap);
  const encoding = options.encoding ?? WORK_ENCODING;
  const trims = entries.map(
    (e) => `atrim=start=${seconds(e.orig_start_ms)}:end=${seconds(e.orig_start_ms + e.length_ms)},asetpts=PTS-STARTPTS`,
  );
  const graph =
    trims.length === 1
      ? `[0:a:0]${trims[0]}[out]`
      : [
          `[0:a:0]asplit=${trims.length}${trims.map((_, i) => `[s${i}]`).join("")}`,
          ...trims.map((trim, i) => `[s${i}]${trim}[k${i}]`),
          `${trims.map((_, i) => `[k${i}]`).join("")}concat=n=${trims.length}:v=0:a=1[out]`,
        ].join(";");
  await writeAtomically(outPath, (part) =>
    runFfmpeg(
      ["-loglevel", "error", "-y", "-i", source, "-filter_complex", graph, "-map", "[out]", "-map_metadata", "-1", ...encodingArgs(encoding), part],
      "발화 오디오 생성",
      options,
    ),
  );
  return describe(outPath, encoding, options);
}

/** One planned chunk written to disk: what a transcription provider receives. Cut-audio time. */
export interface RenderedChunk extends ChunkSpec {
  path: string;
  bytes: number;
  mime: string;
}

/** chunks.json (AI_HARNESS §3.3). Times are cut-audio time; `path` becomes a blob key in the harness. */
export interface ChunkManifest {
  version: 1;
  timebase: "cut";
  cut_duration_ms: number;
  chunks: RenderedChunk[];
}

/**
 * Cuts `speechPath` (the speech-only audio, ideally lossless) into the planned
 * chunks under `outDir` as `<prefix>-000.<ext>`, ... Input seeking with
 * accurate seek keeps each chunk aligned to its planned start.
 */
export async function renderChunks(
  speechPath: string,
  chunks: readonly ChunkSpec[],
  outDir: string,
  options: RenderOptions & { prefix?: string } = {},
): Promise<ChunkManifest> {
  const encoding = options.encoding ?? TRANSCRIBE_ENCODING;
  const prefix = options.prefix ?? "chunk";
  const files: ChunkManifest["chunks"] = [];
  for (const chunk of chunks) {
    const path = join(outDir, `${prefix}-${String(chunk.index).padStart(3, "0")}${encodingExtension(encoding)}`);
    await writeAtomically(path, (part) =>
      runFfmpeg(
        [
          "-loglevel", "error", "-y",
          "-ss", seconds(chunk.start_ms), "-t", seconds(chunk.end_ms - chunk.start_ms), "-i", speechPath,
          "-map", "0:a:0", "-map_metadata", "-1", ...encodingArgs(encoding), part,
        ],
        `청크 ${chunk.index} 생성`,
        options,
      ),
    );
    files.push({ ...chunk, path, bytes: statSync(path).size, mime: encodingMime(encoding) });
  }
  return { version: 1, timebase: "cut", cut_duration_ms: chunks.at(-1)?.end_ms ?? 0, chunks: files };
}

async function describe(path: string, encoding: AudioEncoding, options: RunOptions): Promise<RenderedAudio> {
  const { duration_ms } = await readStreamInfo(path, options);
  return { path, bytes: statSync(path).size, mime: encodingMime(encoding), duration_ms };
}
