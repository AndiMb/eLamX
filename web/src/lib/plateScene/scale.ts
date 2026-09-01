// How much of what the view draws is real, and how much is exaggeration.
//
// Both factors here are lies the picture tells on purpose, and both have to be
// written next to the picture (FR-08): a plate whose deflection is drawn at a
// sixth of its edge and whose 2 mm of thickness is drawn at 2 % of 500 mm is
// legible, and it is not to scale. Keeping the arithmetic in one tested place
// is what lets the caption state the factor rather than guess it.

/** Peak deflection as a fraction of the shorter edge, at the default setting. */
export const DEFAULT_DEFLECTION_FRACTION = 1 / 6;

/** Drawn thickness as a fraction of the shorter edge, when the real one is thinner. */
export const MIN_THICKNESS_FRACTION = 0.018;

/**
 * The factor that brings the field's peak to `fraction` of the shorter edge.
 *
 * A field that is exactly zero has no peak to scale; the factor is then
 * irrelevant to the drawn geometry, and 1 keeps it out of the caption's way.
 */
export function autoDeflectionScale(
  peak: number,
  length: number,
  width: number,
  fraction = DEFAULT_DEFLECTION_FRACTION,
): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  return (fraction * Math.min(length, width)) / peak;
}

/**
 * The factor that makes the laminate thick enough to see, and 1 once it is.
 *
 * Never below 1: a plate that really is a tenth of its own width must not be
 * drawn thinner than it is.
 */
export function autoThicknessScale(
  thickness: number,
  length: number,
  width: number,
  fraction = MIN_THICKNESS_FRACTION,
): number {
  if (!Number.isFinite(thickness) || thickness <= 0) return 1;
  const wanted = fraction * Math.min(length, width);
  return Math.max(1, wanted / thickness);
}

/** Largest magnitude in the field, ignoring holes the core could not evaluate. */
export function peakOf(grid: (number | null)[][]): number {
  let peak = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value !== null && Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

/** [`scaleBounds`] applied to a whole grid, for callers holding one. */
/**
 * Scale limits for a field whose extremes are already known, anchored where
 * the quantity's own neutral point is.
 *
 * Zero for a signed quantity, 1.0 for a reserve factor - the value that
 * decides whether a ply holds. An unanchored scale would put the colour that
 * reads as "neutral" wherever the data happened to be centred, and the reader
 * would have to consult the legend to find out whether green meant safe.
 */
/** Where the reserve factor's scale is pinned: the value that decides. */
export const RESERVE_ANCHOR = 1;
/** How far from it the scale may stretch before the colour just saturates. */
export const RESERVE_REACH = 1;

export function scaleBounds(
  kind: "diverging" | "sequential" | "reserve",
  min: number,
  max: number,
): [number, number] {
  if (kind === "sequential") return max > min ? [min, max] : [min, min + 1];

  if (kind === "reserve") {
    // A reserve factor runs to infinity wherever the plate is unloaded - at a
    // simply supported edge the stress is zero and the criterion reports a
    // reserve of 1e16. Stretching the scale over that paints the entire plate
    // the neutral colour and hides the one place that fails. So the reach is
    // capped: past a factor of two from 1.0 the exact number stops telling a
    // reader anything they would act on, and the colour saturates instead.
    const reach = Math.min(
      Math.max(Math.abs(min - RESERVE_ANCHOR), Math.abs(max - RESERVE_ANCHOR)),
      RESERVE_REACH,
    );
    // Never below zero: a negative reserve factor is not a thing.
    return reach > 0
      ? [Math.max(0, RESERVE_ANCHOR - reach), RESERVE_ANCHOR + reach]
      : [0, 2 * RESERVE_ANCHOR];
  }

  const reach = Math.max(Math.abs(min), Math.abs(max));
  return reach > 0 ? [-reach, reach] : [-1, 1];
}

export function autoBounds(
  grid: (number | null)[][],
  kind: "diverging" | "sequential" | "reserve",
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const value of row) {
      if (value === null || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === Infinity) return kind === "sequential" ? [0, 1] : scaleBounds(kind, 0, 0);
  return scaleBounds(kind, min, max);
}
