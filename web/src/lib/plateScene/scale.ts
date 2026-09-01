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
export function peakOf(grid: number[][]): number {
  let peak = 0;
  for (const row of grid) {
    for (const value of row) {
      if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

/**
 * Colour scale limits for a field.
 *
 * Symmetric about zero for a diverging scale - otherwise the neutral colour
 * lands somewhere other than zero and a plate that deflects mostly one way
 * looks like it changes sign where it does not.
 */
export function autoBounds(grid: number[][], kind: "diverging" | "sequential"): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const value of row) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === Infinity) return kind === "diverging" ? [-1, 1] : [0, 1];

  if (kind === "diverging") {
    const peak = Math.max(Math.abs(min), Math.abs(max));
    return peak > 0 ? [-peak, peak] : [-1, 1];
  }
  return max > min ? [min, max] : [min, min + 1];
}
