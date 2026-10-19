// Adaptive silence threshold: where silencedetect should draw the line in a noisy room.
// Pure; measureWindowPeaks() in silence.ts produces the input.
//
// The fixed threshold (-35 dBFS after normalization) finds no pause once room
// noise peaks above it (about 22 dB peak SNR), and then speech_map cuts
// nothing. "auto" raises the threshold to just above the measured noise floor,
// never below the fixed value (so a clean recording is treated exactly as
// before) and never close to the speech level.

export const AUTO_THRESHOLD_DEFAULTS = Object.freeze({
  /** Window length of the peak series. */
  windowMs: 100,
  /** Windows at or below this are digital silence (muted input, dither) and say nothing about the room. */
  digitalSilenceDb: -80,
  /** Noise floor estimate: this percentile of the remaining window peaks. */
  floorPercentile: 0.05,
  /** Speech level estimate: this percentile. */
  speechPercentile: 0.95,
  /** The threshold sits this far above the noise floor. */
  marginDb: 6,
  /** ...and at least this far below the speech level. */
  speechHeadroomDb: 15,
  /** ...and never above this, however noisy the room. */
  ceilingDb: -25,
  /** Below this spread between speech and floor, pauses cannot be told apart by level: keep the fixed threshold. */
  minSpreadDb: 15,
  /** Fewer audible windows than this (5 s) is too little to estimate from. */
  minWindows: 50,
});

export type AutoThresholdOptions = Partial<Record<keyof typeof AUTO_THRESHOLD_DEFAULTS, number>>;

export interface SilenceThreshold {
  /** The silencedetect noise level used, dBFS. */
  noise_db: number;
  /** True when the threshold was raised above the fixed one. */
  adaptive: boolean;
  /** Estimated noise floor and speech level (window peaks, dBFS); null when not estimated. */
  floor_db: number | null;
  speech_db: number | null;
}

/** Lower nearest-rank percentile of an ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.floor(p * (sorted.length - 1))]!;
}

const round1 = (db: number) => Math.round(db * 10) / 10;

/**
 * Picks the silencedetect threshold from per-window peak levels:
 * `clamp(floor + marginDb, fixedDb, min(ceilingDb, speech - speechHeadroomDb))`,
 * or `fixedDb` when there is too little audio, no clear gap between floor and
 * speech, or no room between the bounds.
 */
export function estimateSilenceThreshold(
  peaksDb: readonly number[],
  fixedDb: number,
  options: AutoThresholdOptions = {},
): SilenceThreshold {
  const opts = { ...AUTO_THRESHOLD_DEFAULTS, ...options };
  const fixed = { noise_db: fixedDb, adaptive: false };
  const audible = peaksDb.filter((db) => Number.isFinite(db) && db > opts.digitalSilenceDb).sort((a, b) => a - b);
  if (audible.length < opts.minWindows) return { ...fixed, floor_db: null, speech_db: null };

  const floor = round1(percentile(audible, opts.floorPercentile));
  const speech = round1(percentile(audible, opts.speechPercentile));
  const estimate = { floor_db: floor, speech_db: speech };
  if (speech - floor < opts.minSpreadDb) return { ...fixed, ...estimate };

  const wanted = floor + opts.marginDb;
  const upper = Math.min(opts.ceilingDb, speech - opts.speechHeadroomDb);
  if (wanted <= fixedDb || upper <= fixedDb) return { ...fixed, ...estimate };
  return { noise_db: round1(Math.min(wanted, upper)), adaptive: true, ...estimate };
}
