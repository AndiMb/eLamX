// The outline eLamX draws beside the spring-in number.
//
// Port of `springinui/geometrycalculators/SimpleGeometryCalculator`, which is
// the only implementation of an abstract `GeometryCalculator` the original
// never gave a second one. It builds a closed polygon of an L-shaped coupon:
// a flange, a bend of the given radius, a second flange, and back along the
// inner surface.
//
// Why draw it at all, when the answer is one number? Because the number is
// four tenths of a degree, and nobody can picture that. Two outlines on top of
// each other - the tool's angle and the part's - turn it into something you can
// see, and they also settle what "angle" means here: it is how far the corner
// TURNS, not the angle enclosed between the flanges. See `SpringInInput::angle`
// in the core.
//
// The geometry lives here rather than in Rust for the same reason
// `strainShape.ts` does: it is a picture, not a calculation, and the original
// keeps it in its UI module too.

export interface SpringInOutlineInput {
  /** Turn angle of the bend, in degrees. */
  angle: number;
  /** Mid-surface radius of the bend, in mm. */
  radius: number;
  /** Laminate thickness, in mm. */
  thickness: number;
}

/** A closed polygon, first point repeated at the end. */
export type Outline = [number, number][];

/**
 * How finely the arc is drawn, as points per 90 degrees. eLamX's own default,
 * and the segment count is derived from it the same way - so a 120 degree bend
 * gets more segments than a 90 degree one rather than the same number stretched
 * over it.
 */
const POINTS_PER_QUARTER = 20;

/**
 * One outline, at the given turn angle.
 *
 * The flange length is not a parameter of the model at all - eLamX fixes it at
 * twice the radius so the drawing has proportions, and nothing else uses it.
 */
export function springInOutline({ angle, radius, thickness }: SpringInOutlineInput): Outline {
  const sweep = (angle * Math.PI) / 180;
  const flange = radius * 2;

  // At least one segment even for a zero angle, which is what `(int)(x) + 1`
  // gives in the Java and what keeps the loop below well defined.
  const segments = Math.floor(sweep / (Math.PI / 2 / POINTS_PER_QUARTER)) + 1;
  const step = sweep / segments;

  // Both arcs share a centre - the outer surface is `thickness/2` outside the
  // mid-surface radius and the inner one that much inside, and the inner one
  // starts a thickness further along x because that is where the flange's
  // inner face is.
  const outer = radius + thickness / 2;
  const inner = radius - thickness / 2;

  const points: Outline = [
    [0, 0],
    [0, flange],
  ];

  for (let i = 1; i <= segments; i++) {
    points.push([(1 - Math.cos(step * i)) * outer, Math.sin(step * i) * outer + flange]);
  }

  // The far flange, drawn from the end of each arc along the turned direction.
  const along: [number, number] = [Math.cos(sweep - Math.PI / 2), -Math.sin(sweep - Math.PI / 2)];
  const outerEnd: [number, number] = [(1 - Math.cos(sweep)) * outer, Math.sin(sweep) * outer + flange];
  const innerEnd: [number, number] = [
    (1 - Math.cos(sweep)) * inner + thickness,
    Math.sin(sweep) * inner + flange,
  ];
  points.push([flange * along[0] + outerEnd[0], flange * along[1] + outerEnd[1]]);
  points.push([flange * along[0] + innerEnd[0], flange * along[1] + innerEnd[1]]);
  points.push(innerEnd);

  for (let i = segments - 1; i >= 0; i--) {
    points.push([
      (1 - Math.cos(step * i)) * inner + thickness,
      Math.sin(step * i) * inner + flange,
    ]);
  }

  points.push([thickness, 0]);
  points.push([0, 0]);

  return points;
}

/** The tool's outline and the part's, in that order. */
export function springInOutlines(
  input: SpringInOutlineInput,
  deltaAngle: number,
): { tool: Outline; part: Outline } {
  return {
    tool: springInOutline(input),
    part: springInOutline({ ...input, angle: input.angle + deltaAngle }),
  };
}

/** Axis-aligned bounds of one or more outlines, for fitting them to a canvas. */
export function outlineBounds(outlines: Outline[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const outline of outlines) {
    for (const [x, y] of outline) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}
