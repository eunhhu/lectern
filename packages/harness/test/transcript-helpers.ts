// Synthetic transcripts for the merge/speakers tests: a "truth" script in absolute cut-audio
// time, and what a provider would answer for one chunk of it (with optional drift,
// different segmentation and chunk-local speaker labels).

import type { TranscribeResult } from "@lectern/domain";
import type { ChunkSpec } from "@lectern/media";

/** mulberry32: a small seeded PRNG, so every test run sees the same text. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random Hangul syllable (no final consonant half the time). */
function syllable(r: () => number): string {
  const initial = Math.floor(r() * 19);
  const medial = Math.floor(r() * 21);
  const final = r() < 0.5 ? 0 : 1 + Math.floor(r() * 27);
  return String.fromCodePoint(0xac00 + (initial * 21 + medial) * 28 + final);
}

/** A sentence of 4–7 words of 1–4 random syllables, ending in a period. */
export function sentence(r: () => number): string {
  const words = 4 + Math.floor(r() * 4);
  return (
    Array.from({ length: words }, () => Array.from({ length: 1 + Math.floor(r() * 4) }, () => syllable(r)).join("")).join(" ") +
    "."
  );
}

export interface Utterance {
  /** Absolute cut-audio time. */
  start: number;
  end: number;
  /** Recording-wide speaker. */
  speaker: string;
  text: string;
}

/**
 * Utterances of `ms` each with `pauseMs` between them over `[from, to)`, speakers taken
 * from `speakers(i)`.
 */
export function script(opts: {
  seed: number;
  from: number;
  to: number;
  ms?: number;
  pauseMs?: number;
  speakers?: (i: number) => string;
}): Utterance[] {
  const r = rng(opts.seed);
  const ms = opts.ms ?? 4_000;
  const pause = opts.pauseMs ?? 1_000;
  const out: Utterance[] = [];
  for (let t = opts.from, i = 0; t + ms <= opts.to; t += ms + pause, i++) {
    out.push({ start: t, end: t + ms, speaker: opts.speakers?.(i) ?? "S1", text: sentence(r) });
  }
  return out;
}

/** A proportional prefix or suffix of `text` by `share` of its length (whole words not required). */
function part(text: string, from: number, to: number): string {
  const chars = [...text];
  return chars.slice(Math.round(from * chars.length), Math.round(to * chars.length)).join("").trim();
}

export interface ViewOptions {
  /** Timestamp drift: every chunk-relative time t becomes t * (1 + rate). */
  driftRate?: number;
  /** Join every `group` consecutive utterances into one segment (different segmentation). */
  group?: number;
  /** Chunk-local label for a recording-wide speaker. */
  label?: (speaker: string) => string;
}

/** What a provider answers for `chunk`: utterances inside it, edge ones truncated, chunk-relative. */
export function chunkView(truth: readonly Utterance[], chunk: Pick<ChunkSpec, "start_ms" | "end_ms">, opts: ViewOptions = {}): TranscribeResult {
  const length = chunk.end_ms - chunk.start_ms;
  const pieces = truth.flatMap((u) => {
    if (u.end <= chunk.start_ms || u.start >= chunk.end_ms) return [];
    const from = Math.max(u.start, chunk.start_ms);
    const to = Math.min(u.end, chunk.end_ms);
    const span = u.end - u.start;
    const text = part(u.text, (from - u.start) / span, (to - u.start) / span);
    return text ? [{ start: from - chunk.start_ms, end: to - chunk.start_ms, speaker: u.speaker, text }] : [];
  });
  const grouped: typeof pieces = [];
  const group = opts.group ?? 1;
  for (let i = 0; i < pieces.length; i += group) {
    const g = pieces.slice(i, i + group);
    if (g.some((p) => p.speaker !== g[0]!.speaker)) {
      grouped.push(...g);
      continue;
    }
    grouped.push({ start: g[0]!.start, end: g.at(-1)!.end, speaker: g[0]!.speaker, text: g.map((p) => p.text).join(" ") });
  }
  const drift = (t: number) => Math.min(length + 1000, Math.round(t * (1 + (opts.driftRate ?? 0))));
  return {
    segments: grouped.map((p) => ({
      start_ms: drift(p.start),
      end_ms: drift(p.end),
      speaker: opts.label?.(p.speaker) ?? p.speaker,
      text: p.text,
    })),
  };
}

/** A chunk plan from `[start, end, seam]` triples (seam = where this chunk hands over to the next). */
export function plan(cutDuration: number, specs: Array<{ start: number; end: number }>): ChunkSpec[] {
  return specs.map((spec, index) => {
    const prev = specs[index - 1];
    const next = specs[index + 1];
    const overlapPrev = prev ? { start_ms: spec.start, end_ms: prev.end, seam_ms: Math.round((spec.start + prev.end) / 2), seam_in_silence: true } : null;
    const overlapNext = next ? { start_ms: next.start, end_ms: spec.end, seam_ms: Math.round((next.start + spec.end) / 2), seam_in_silence: true } : null;
    return {
      index,
      start_ms: spec.start,
      end_ms: index === specs.length - 1 ? cutDuration : spec.end,
      core_start_ms: overlapPrev?.seam_ms ?? 0,
      core_end_ms: overlapNext?.seam_ms ?? cutDuration,
      overlap_prev: overlapPrev,
      overlap_next: overlapNext,
    };
  });
}

/** Letters and digits only, for "nothing duplicated, nothing lost" comparisons. */
export function letters(texts: readonly string[]): string {
  return texts.join("").replace(/[^\p{L}\p{N}]/gu, "");
}
