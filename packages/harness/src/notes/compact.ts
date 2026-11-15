// The compact transcript the notes stages read (CONTRACTS §1.3): one segment per line,
// `#<idx> [MM:SS] S1: text`, and the source tokens (`#12`, `#40-#44`) the model cites back.

import type { SourceRef } from "@lectern/domain";

export interface CompactSegment {
  idx: number;
  start_ms: number;
  speaker: string | null;
  text: string;
}

/** `MM:SS` under an hour (minutes zero-padded), `H:MM:SS` from one hour. Seconds round down. */
export function compactClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatCompactTranscript(t: { segments: readonly CompactSegment[] }): { text: string; ids: number[] } {
  const lines: string[] = [];
  const ids: number[] = [];
  for (const segment of t.segments) {
    const body = segment.text.replace(/\r?\n/g, " ");
    const label = segment.speaker === null ? "" : `${segment.speaker}: `;
    lines.push(`#${segment.idx} [${compactClock(segment.start_ms)}] ${label}${body}`);
    ids.push(segment.idx);
  }
  return { text: lines.join("\n"), ids };
}

const TOKEN_RE = /^#(\d+)(?:-#(\d+))?$/;
const MAX_RANGE = 100_000;

/** `#12` → 12..12, `#40-#44` → 40..44; anything else (or a reversed range) → null. */
export function parseSourceToken(token: string): { start: number; end: number } | null {
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

/**
 * Turns source tokens into transcript refs, keeping only segment ids that exist. A range
 * with holes becomes one ref per contiguous run; the missing ids (or the whole token when
 * nothing in it exists) are returned in `dropped`.
 */
export function expandSourceTokens(
  tokens: readonly string[],
  knownIds: ReadonlySet<number> | readonly number[]
): { refs: SourceRef[]; dropped: string[] } {
  const known: ReadonlySet<number> = knownIds instanceof Set ? knownIds : new Set(knownIds as readonly number[]);
  const refs: SourceRef[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];

  const addRef = (startIdx: number, endIdx: number) => {
    const key = `${startIdx}-${endIdx}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind: "transcript", start_idx: startIdx, end_idx: endIdx });
  };

  for (const token of tokens) {
    const range = parseSourceToken(token);
    if (!range || range.end - range.start + 1 > MAX_RANGE) {
      dropped.push(token);
      continue;
    }
    const missing: number[] = [];
    let runStart: number | null = null;
    let found = 0;
    for (let id = range.start; id <= range.end; id++) {
      if (known.has(id)) {
        found++;
        if (runStart === null) runStart = id;
      } else {
        missing.push(id);
        if (runStart !== null) {
          addRef(runStart, id - 1);
          runStart = null;
        }
      }
    }
    if (runStart !== null) addRef(runStart, range.end);
    if (found === 0) dropped.push(token);
    else for (const id of missing) dropped.push(`#${id}`);
  }
  return { refs, dropped };
}
