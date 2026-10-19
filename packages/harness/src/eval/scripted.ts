// A transcription provider that answers from a script instead of listening: for synthetic
// recordings (tones where the script says someone speaks) it knows what each chunk
// "contains". It powers the example eval set and the pipeline tests, so the whole path
// (ffmpeg stages, merge, speakers, metrics, the ledger) runs with no provider cost.
//
// It needs the recording's speech_map time map to see which script lines fall into a chunk;
// the pipeline's onStage hook hands it over (`provider.observe`). Perturbations imitate LLM
// transcription faults: substituted letters, drifting timestamps, chunk-local speaker
// numbering, and chunks that come back empty.

import { toCutMs, toOriginalRanges, type RenderedChunk, type TimeMap } from "@lectern/media";
import type { TranscribeResult, TranscribeSegment } from "@lectern/domain";
import { HarnessError } from "../errors.ts";
import { canonicalJson, sha256Hex } from "../hash.ts";
import type { ProviderCallResult, TranscribeOptions, TranscriptionProvider, Usage } from "../providers.ts";
import type { PipelineStageEvent } from "../transcript/pipeline.ts";
import type { SpeechMapOutput } from "../transcript/schemas.ts";

/** One line of the script, in original-audio time with a recording-wide speaker label. */
export interface ScriptLine {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

export interface ScriptedOptions {
  /** Share of letters replaced by another letter (0..1). */
  charErrorRate?: number;
  /** Chunk-relative times are multiplied by 1 + driftRate (negative: early). */
  driftRate?: number;
  /** Number speakers per chunk by first appearance (as an LLM does) instead of using the script's labels. */
  chunkLocalLabels?: boolean;
  /** Chunk indexes that always come back empty (billed), so they end up as missing. */
  failChunks?: number[];
  seed?: number;
}

export const SCRIPTED_PROVIDER_ID = "scripted";

/** Gemini-like usage for the ledger: 32 audio tokens per second, about one output token per 1.5 letters plus JSON. */
export function scriptedUsage(seconds: number, letters: number, segments: number): Usage {
  return {
    inputTokens: Math.round(32 * seconds) + 300,
    cachedTokens: 0,
    outputTokens: Math.round(letters / 1.5) + 20 * segments,
    audioSeconds: seconds,
  };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ScriptedTranscriptionProvider implements TranscriptionProvider {
  readonly id = SCRIPTED_PROVIDER_ID;
  readonly model = "scripted-1";
  readonly maxChunkSeconds = 8 * 60;
  readonly fingerprint: { prompt: string; params: unknown };
  /** Chunk indexes asked for, in call order. */
  readonly calls: number[] = [];
  private timeMap: TimeMap | null = null;

  constructor(
    private readonly script: readonly ScriptLine[],
    private readonly options: ScriptedOptions = {},
    /** Runs before each answer (tests use it to count calls or to crash). */
    private readonly onCall?: (chunk: RenderedChunk) => void,
  ) {
    this.fingerprint = { prompt: sha256Hex(canonicalJson(script)), params: { ...options } };
  }

  /** Pass to the pipeline's `onStage`: picks up the speech_map time map. */
  readonly observe = (event: PipelineStageEvent): void => {
    if (event.stage === "speech_map") this.timeMap = (event.value as SpeechMapOutput).map.time_map;
  };

  async transcribe(chunk: RenderedChunk, _opts: TranscribeOptions): Promise<TranscribeResult & ProviderCallResult> {
    this.calls.push(chunk.index);
    this.onCall?.(chunk);
    if (!this.timeMap) throw new HarnessError("config", "scripted provider needs the speech_map time map (pass provider.observe as onStage)");
    const length = chunk.end_ms - chunk.start_ms;
    const seconds = length / 1000;
    if (this.options.failChunks?.includes(chunk.index)) {
      throw new HarnessError("output_validation", `scripted chunk ${chunk.index}: empty response`, {
        code: "empty_response",
        billed: { usage: scriptedUsage(seconds, 0, 0) },
      });
    }

    const kept = toOriginalRanges(chunk, this.timeMap);
    const random = rng((this.options.seed ?? 1) * 7919 + chunk.index);
    const drift = 1 + (this.options.driftRate ?? 0);
    const labels = new Map<string, string>();
    const segments: TranscribeSegment[] = [];
    for (const line of this.script) {
      for (const range of kept) {
        const from = Math.max(line.start_ms, range.start_ms);
        const to = Math.min(line.end_ms, range.end_ms);
        if (to <= from) continue;
        const span = line.end_ms - line.start_ms;
        const chars = [...line.text];
        let text = chars.slice(Math.round(((from - line.start_ms) / span) * chars.length), Math.round(((to - line.start_ms) / span) * chars.length)).join("").trim();
        if (!text) continue;
        text = this.garble(text, random);
        const rel = (orig: number) => Math.min(length + 1000, Math.max(0, Math.round((toCutMs(orig, this.timeMap!) - chunk.start_ms) * drift)));
        let speaker = line.speaker;
        if (this.options.chunkLocalLabels) {
          if (!labels.has(line.speaker)) labels.set(line.speaker, `S${labels.size + 1}`);
          speaker = labels.get(line.speaker)!;
        }
        segments.push({ start_ms: rel(from), end_ms: rel(to), speaker, text });
      }
    }
    const letters = segments.reduce((n, s) => n + s.text.length, 0);
    return { segments, language: "ko", usage: scriptedUsage(seconds, letters, segments.length), model: this.model, requestId: null };
  }

  private garble(text: string, random: () => number): string {
    const rate = this.options.charErrorRate ?? 0;
    if (rate <= 0) return text;
    return [...text]
      .map((c) => (/[\p{L}\p{N}]/u.test(c) && random() < rate ? String.fromCodePoint(0xac00 + Math.floor(random() * 11172)) : c))
      .join("");
  }
}
