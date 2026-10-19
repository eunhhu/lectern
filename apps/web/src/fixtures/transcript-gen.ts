// Generates synthetic Korean transcripts from small scripts. Nothing here comes from a
// real recording: lines are written for the fixtures and recombined with a seeded RNG,
// so a three-hour lecture yields thousands of plausible segments in a few milliseconds.
//
// Anchors are fixed lines placed at known points of a phase. Documents cite them by key,
// so a source chip lands on a segment that actually says what the block claims.

import type { GapKind, RecordingId, SpeakerId, TranscriptGap, TranscriptSegment, WorkspaceId } from "../api/types.ts";
import { createRng, type Rng } from "./random.ts";

/** A line, or a template filled per use: `{n:1-5}` becomes a random integer in range. */
export type ScriptLine = string;

export interface Anchor {
  key: string;
  /** One or more consecutive segments. */
  text: string | string[];
  speaker?: string;
}

export interface Phase {
  key: string;
  /** Share of the speaking time, relative to the other phases. */
  weight: number;
  lines: ScriptLine[];
  anchors?: Anchor[];
  /** Speaker weights for this phase (meetings); defaults to the script's. */
  turns?: Record<string, number>;
}

export interface Interjection {
  speaker: string;
  /** Chance per segment. */
  rate: number;
  lines: ScriptLine[];
  /** What the main speaker says right after. */
  replies?: ScriptLine[];
}

export interface Script {
  speakers: { label: string; name: string | null }[];
  /** Speaker weights; one speaker keeps talking for 1–`maxRun` segments before a switch. */
  turns: Record<string, number>;
  maxRun?: number;
  phases: Phase[];
  interjections?: Interjection[];
  fillers?: string[];
  /** Cuts with no transcript, as a fraction of the duration. */
  breaks?: { at: number; ms: number; kind?: GapKind }[];
  tailMs?: number;
}

export interface GeneratedTranscript {
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  speakerIds: Record<string, SpeakerId>;
  /** Anchor key → inclusive segment idx range. */
  anchors: Record<string, { start_idx: number; end_idx: number }>;
  /** Actual length of the generated audio, tail included. */
  durationMs: number;
}

function fill(line: string, rng: Rng): string {
  return line.replace(/\{n:(\d+)-(\d+)\}/g, (_, a: string, b: string) => String(rng.int(Number(a), Number(b))));
}

function pickWeighted(weights: Record<string, number>, rng: Rng, exclude?: string): string {
  const entries = Object.entries(weights).filter(([k]) => k !== exclude);
  const pool = entries.length ? entries : Object.entries(weights);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [key, w] of pool) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return pool.at(-1)![0];
}

/** Rough spoken length of a Korean line: about 6–7 syllables per second. */
function spokenMs(text: string, rng: Rng): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.min(7000, Math.max(900, chars * 150 + rng.int(-200, 350)));
}

/** Speech recognisers cut long sentences at pauses: split at ", " or ". " now and then. */
function splitAtPause(text: string, rng: Rng): string[] {
  if (text.length < 24 || !rng.chance(0.6)) return [text];
  const cut = text.search(/[,.] (?=\S)/);
  return cut > 6 && cut < text.length - 6 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
}

export function generateTranscript(
  script: Script,
  ids: { workspaceId: WorkspaceId; recordingId: RecordingId },
  durationMs: number,
  seed: string,
): GeneratedTranscript {
  const rng = createRng(seed);
  const segments: TranscriptSegment[] = [];
  const gaps: TranscriptGap[] = [];
  const anchors: GeneratedTranscript["anchors"] = {};
  const speakerIds = Object.fromEntries(
    script.speakers.map((s) => [s.label, `${ids.recordingId}_${s.label.toLowerCase()}` as SpeakerId]),
  );

  const tail = script.tailMs ?? 0;
  const breaks = (script.breaks ?? []).map((b) => ({ ...b, start: Math.round(durationMs * b.at) }));
  const speakingMs = durationMs - tail - breaks.reduce((s, b) => s + b.ms, 0);
  const totalWeight = script.phases.reduce((s, p) => s + p.weight, 0);

  // Speaking-time boundaries of each phase, and when each anchor is due.
  let acc = 0;
  const plan = script.phases.map((phase) => {
    const start = (acc / totalWeight) * speakingMs;
    acc += phase.weight;
    const end = (acc / totalWeight) * speakingMs;
    const list = phase.anchors ?? [];
    const due = list.map((a, i) => ({ anchor: a, at: start + ((i + 1) / (list.length + 1)) * (end - start) }));
    return { phase, end, due };
  });

  let t = rng.int(800, 2500); // wall-clock position (with breaks)
  let spoken = 0; // speaking time used so far
  let phaseIndex = 0;
  let speaker = pickWeighted(script.turns, rng);
  let run = 0;
  const maxRun = script.maxRun ?? 6;
  const pendingReplies: string[] = [];

  const push = (text: string, who: string) => {
    const length = spokenMs(text, rng);
    const idx = segments.length;
    segments.push({
      workspace_id: ids.workspaceId,
      recording_id: ids.recordingId,
      idx,
      start_ms: Math.round(t),
      end_ms: Math.round(t + length),
      speaker_id: speakerIds[who] ?? null,
      text,
      confidence: Math.round((0.86 + rng.next() * 0.13) * 100) / 100,
      source_chunk: Math.floor(t / 600_000),
    });
    const pause = rng.chance(0.05) ? rng.int(1200, 3200) : rng.int(120, 560);
    t += length + pause;
    spoken += length + pause;
    for (const b of breaks) {
      if (b.start >= 0 && t >= b.start) {
        gaps.push({ kind: b.kind ?? "break", start_ms: Math.round(t), end_ms: Math.round(t + b.ms) });
        t += b.ms;
        b.start = -1;
      }
    }
    return idx;
  };

  while (spoken < speakingMs) {
    while (phaseIndex < plan.length - 1 && spoken >= plan[phaseIndex]!.end) phaseIndex++;
    const { phase, due } = plan[phaseIndex]!;
    const turns = phase.turns ?? script.turns;

    const nextAnchor = due[0];
    if (nextAnchor && spoken >= nextAnchor.at) {
      due.shift();
      const lines = Array.isArray(nextAnchor.anchor.text) ? nextAnchor.anchor.text : [nextAnchor.anchor.text];
      const who = nextAnchor.anchor.speaker ?? pickWeighted(turns, rng);
      const first = push(lines[0]!, who);
      let last = first;
      for (const line of lines.slice(1)) last = push(line, who);
      anchors[nextAnchor.anchor.key] = { start_idx: first, end_idx: last };
      speaker = who;
      run = lines.length;
      continue;
    }

    if (pendingReplies.length) {
      push(pendingReplies.shift()!, speaker);
      continue;
    }

    const inter = script.interjections?.find((i) => rng.chance(i.rate));
    if (inter) {
      const main = speaker;
      push(fill(rng.pick(inter.lines), rng), inter.speaker);
      if (inter.replies?.length) pendingReplies.push(fill(rng.pick(inter.replies), rng));
      speaker = main;
      continue;
    }

    if (run >= rng.int(1, maxRun) && Object.keys(turns).length > 1) {
      speaker = pickWeighted(turns, rng, speaker);
      run = 0;
    }
    const filler = script.fillers && rng.chance(0.18) ? rng.pick(script.fillers) : "";
    for (const piece of splitAtPause(filler + fill(rng.pick(phase.lines), rng), rng)) push(piece, speaker);
    run++;
  }

  // Anchors the time budget never reached still exist (short recordings): append them.
  for (const { due } of plan) {
    for (const { anchor } of due) {
      const lines = Array.isArray(anchor.text) ? anchor.text : [anchor.text];
      const who = anchor.speaker ?? Object.keys(script.turns)[0]!;
      const first = push(lines[0]!, who);
      let last = first;
      for (const line of lines.slice(1)) last = push(line, who);
      anchors[anchor.key] = { start_idx: first, end_idx: last };
    }
  }

  if (tail > 0) gaps.push({ kind: "tail", start_ms: Math.round(t), end_ms: Math.round(t + tail) });
  return { segments, gaps, speakerIds, anchors, durationMs: Math.round(t + tail) };
}
