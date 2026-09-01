// Where the plate sits in world space, and how far a millimetre goes there.
//
// The body, the support symbols and the load arrows are built by three
// separate functions that must land on exactly the same rectangle - a support
// triangle half a percent off the edge it holds reads as a bug in the
// analysis, not as a rounding difference. So the mapping is one function they
// all call rather than three copies of the same two lines.
//
// The longer plate edge is always exactly one world unit. That is what lets
// the camera be three numbers with no fitting pass: whatever the plate
// measures, the thing to look at is a unit square at the origin.

export interface PlateFrame {
  /** Half the plate extent in x, world units. */
  halfLength: number;
  /** Half the plate extent in y, world units. */
  halfWidth: number;
  /** Half the DRAWN thickness - the real one times its exaggeration. */
  halfThickness: number;
  /** World units per input unit. */
  scale: number;
}

export interface PlateFrameInput {
  length: number;
  width: number;
  thickness: number;
  thicknessScale: number;
}

export function plateFrame({
  length,
  width,
  thickness,
  thicknessScale,
}: PlateFrameInput): PlateFrame {
  // A plate with no extent has no mapping to get right; 1 keeps the arithmetic
  // finite so callers get an empty picture rather than NaN geometry.
  const span = Math.max(length, width);
  const scale = span > 0 ? 1 / span : 1;
  return {
    halfLength: (length / 2) * scale,
    halfWidth: (width / 2) * scale,
    halfThickness: (thickness / 2) * thicknessScale * scale,
    scale,
  };
}

/** The symbol size that reads at any plate aspect: annotation is in world units. */
export const SYMBOL_SIZE = 0.055;
