// Where the marks on a colour bar go.
//
// Shared by the legend on screen and the one drawn into an exported image, so
// the two cannot drift apart - an export whose ticks sat at different values
// from the ones the reader saw would be worse than no export.

import type { ColormapKind } from "./colormap";

export interface LegendTick {
  /** Position along the bar, 0 at the low end. */
  t: number;
  value: number;
}

/** Evenly spaced marks across the bar, both ends included. */
export function legendTicks(bounds: [number, number], count = 5): LegendTick[] {
  const [low, high] = bounds;
  const span = high - low;
  const steps = Math.max(2, count) - 1;
  return Array.from({ length: steps + 1 }, (_, i) => ({
    t: i / steps,
    value: low + (span * i) / steps,
  }));
}

/**
 * Where the quantity's own neutral value sits on the bar, or null when it is
 * off the scale or the scale has no neutral value.
 *
 * Marked rather than left to be worked out: a reader who has to derive where
 * "safe" begins from two end labels has been given a picture that needs a
 * manual.
 */
export function anchorFraction(kind: ColormapKind, bounds: [number, number]): number | null {
  if (kind === "sequential") return null;
  const anchor = kind === "reserve" ? 1 : 0;
  const [low, high] = bounds;
  if (!(high > low) || anchor <= low || anchor >= high) return null;
  return (anchor - low) / (high - low);
}
