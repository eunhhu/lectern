import type { Interval } from "./intervals.ts";

/** Gap kinds with a marker. Same names as `GapKind` in @lectern/domain. */
export type GapMarkerKind = "break" | "tail" | "missing_transcript";

/** Korean labels shown in documents for code-decided gaps (AI_HARNESS §3.2). */
export const GAP_MARKER_LABELS: Readonly<Record<GapMarkerKind, string>> = Object.freeze({
  break: "쉬는 시간",
  tail: "종료 후",
  missing_transcript: "전사 누락",
});

/** `M:SS` below an hour, `H:MM:SS` from an hour on. Truncates to whole seconds. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`time must be a non-negative number, got ${ms}`);
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Deterministic document marker for a gap in original-audio time, e.g.
 * `[쉬는 시간: 50:12~1:02:40]`. Pass original times (a `Cut` or a
 * `TranscriptGap`), never cut-audio times.
 */
export function formatGapMarker(gap: Interval & { kind: GapMarkerKind }): string {
  return `[${GAP_MARKER_LABELS[gap.kind]}: ${formatClock(gap.start_ms)}~${formatClock(gap.end_ms)}]`;
}
