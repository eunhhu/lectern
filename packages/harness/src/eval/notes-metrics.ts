// Notes eval metrics (`bun run harness eval --notes`): a NotesResult scored against the
// eval set's annotations (annotations.csv). Pure functions, no I/O.
//
// - schema validity: the pipeline finished, its result parses, nothing needed repair;
// - grounding: verified blocks whose sources check out (verify report `ok`);
// - event dates: an annotated event is right when an extracted event cites the transcript
//   within ±60 s of it and resolves to the annotated date (and time, when annotated);
// - over-extraction: extracted events and action items with no annotation of their kind
//   within ±60 s.
// An annotation of a kind the item's template does not extract cannot be found by design:
// it is counted as `skipped`, not as a miss.

import type { Evidence } from "@lectern/domain";
import { NotesResult } from "../notes/schemas.ts";
import type { Transcript } from "../transcript/schemas.ts";
import type { Annotation } from "./set.ts";

/** How far an extraction's evidence may be from the annotation it matches. */
export const MATCH_WINDOW_MS = 60_000;

export interface NotesItemMetrics {
  /** Pipeline finished, NotesResult parses, report.repaired === false. */
  schema_valid: boolean;
  /** From the verify report: blocks whose outcome is `ok` among all blocks (dropped included). */
  blocks: { total: number; grounded: number };
  /** Annotated events, and those found with the right date (and time when annotated). */
  events: { annotated: number; correct: number };
  /** Extracted events + action items, and those no annotation of their kind matches. */
  extracted: { total: number; unmatched: number };
  /** Event and action-item annotations the item's template does not extract (not scored). */
  skipped: number;
}

/** The original-time start of the first transcript source of `evidence`, or null. */
export function evidenceStartMs(evidence: Evidence, segments: readonly { idx: number; start_ms: number }[]): number | null {
  const source = evidence.sources.find((s) => s.kind === "transcript");
  if (!source || source.kind !== "transcript") return null;
  return segments.find((s) => s.idx === source.start_idx)?.start_ms ?? null;
}

/** "YYYY-MM-DD" and "HH:MM" of `ms` in `tz`. */
export function localDateTime(ms: number, tz: string): { date: string; time: string } {
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  const [date = "", time = ""] = text.split(" ");
  return { date, time };
}

/**
 * Pairs each annotation with the nearest unpaired candidate within the window, nearest pairs
 * first, so one candidate answers one annotation. Returns annotation index → candidate index.
 */
function pairByTime(annotationMs: readonly number[], candidateMs: ReadonlyArray<number | null>): Map<number, number> {
  const pairs: Array<{ a: number; c: number; d: number }> = [];
  annotationMs.forEach((at, a) =>
    candidateMs.forEach((ct, c) => {
      if (ct === null) return;
      const d = Math.abs(at - ct);
      if (d <= MATCH_WINDOW_MS) pairs.push({ a, c, d });
    })
  );
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.c - y.c);
  const byAnnotation = new Map<number, number>();
  const used = new Set<number>();
  for (const { a, c } of pairs) {
    if (byAnnotation.has(a) || used.has(c)) continue;
    byAnnotation.set(a, c);
    used.add(c);
  }
  return byAnnotation;
}

export interface ScoreNotesInput {
  result: NotesResult;
  transcript: Transcript;
  /** This item's annotations. */
  annotations: readonly Annotation[];
  /** What the item's template extracts (default: both). */
  extracts?: { events: boolean; action_items: boolean };
}

export function scoreNotes(input: ScoreNotesInput): NotesItemMetrics {
  const { result, transcript } = input;
  const extracts = input.extracts ?? { events: true, action_items: true };
  const segments = transcript.segments;

  const blockItems = result.report.items.filter((i) => i.kind === "block");
  const blocks = { total: blockItems.length, grounded: blockItems.filter((i) => i.outcome === "ok").length };

  const eventAnnotations = input.annotations.filter((a) => a.kind === "event");
  const actionAnnotations = input.annotations.filter((a) => a.kind === "action_item");
  const skipped = (extracts.events ? 0 : eventAnnotations.length) + (extracts.action_items ? 0 : actionAnnotations.length);
  const scoredEvents = extracts.events ? eventAnnotations : [];
  const scoredActions = extracts.action_items ? actionAnnotations : [];

  const eventPairs = pairByTime(
    scoredEvents.map((a) => a.start_ms),
    result.events.map((e) => evidenceStartMs(e.evidence, segments))
  );
  let correct = 0;
  scoredEvents.forEach((annotation, a) => {
    const c = eventPairs.get(a);
    if (c === undefined) return;
    const event = result.events[c]!;
    const local = localDateTime(event.start_at, event.tz);
    if (local.date !== annotation.date) return;
    if (annotation.time !== null && (event.all_day || local.time !== annotation.time)) return;
    correct += 1;
  });

  const actionPairs = pairByTime(
    scoredActions.map((a) => a.start_ms),
    result.action_items.map((i) => evidenceStartMs(i.evidence, segments))
  );
  const total = result.events.length + result.action_items.length;
  const unmatched = result.events.length - eventPairs.size + (result.action_items.length - actionPairs.size);

  return {
    schema_valid: NotesResult.safeParse(result).success && result.report.repaired === false,
    blocks,
    events: { annotated: scoredEvents.length, correct },
    extracted: { total, unmatched },
    skipped,
  };
}

export interface NotesTotals {
  schema_valid_rate: number | null;
  grounding_rate: number | null;
  event_date_accuracy: number | null;
  over_extraction_rate: number | null;
  cost_microusd: number;
  audio_hours: number;
  usd_per_audio_hour: number | null;
}

/** Totals over scored items; a rate with nothing to count is null. */
export function totalsOf(items: readonly NotesItemMetrics[], costMicrousd: number, audioHours: number): NotesTotals {
  const sum = (pick: (m: NotesItemMetrics) => number) => items.reduce((n, m) => n + pick(m), 0);
  const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
  return {
    schema_valid_rate: ratio(items.filter((m) => m.schema_valid).length, items.length),
    grounding_rate: ratio(sum((m) => m.blocks.grounded), sum((m) => m.blocks.total)),
    event_date_accuracy: ratio(sum((m) => m.events.correct), sum((m) => m.events.annotated)),
    over_extraction_rate: ratio(sum((m) => m.extracted.unmatched), sum((m) => m.extracted.total)),
    cost_microusd: costMicrousd,
    audio_hours: audioHours,
    usd_per_audio_hour: audioHours > 0 ? costMicrousd / 1e6 / audioHours : null,
  };
}
