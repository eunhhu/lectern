// Pure helpers of the PDF viewer (D-P3-7): page bounds, zoom steps and the OCR cost line.

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** `page` within 1…pageCount (NaN and anything below 1 is page 1). */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), Math.max(1, pageCount));
}

/** The next zoom step in `dir` from `current`, saturating at both ends; off-grid values move to the next step. */
export function nextZoom(current: number, dir: 1 | -1): number {
  if (dir === 1) return ZOOM_STEPS.find((z) => z > current + 1e-9) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-9) ?? ZOOM_STEPS[0];
}

/** `$0.0028` for 2,818 µUSD (four decimals), `$0` for nothing. */
export function formatCostUsd(microusd: number): string {
  if (microusd <= 0) return "$0";
  return `$${(microusd / 1_000_000).toFixed(4)}`;
}
