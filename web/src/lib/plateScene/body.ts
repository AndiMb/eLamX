// The deformed plate as a solid: a top and a bottom surface, four side faces,
// and the ply interfaces drawn on those sides.
//
// Two decisions here carry the whole look.
//
// The faces are offset along the surface NORMAL, not along z. That is the
// Kirchhoff assumption itself - the cross-section stays straight and normal to
// the mid-surface - and it is what makes the rotation of the section visible at
// a clamped edge instead of a band of constant thickness. Offsetting in z would
// draw a plate that shears rather than bends.
//
// The exaggeration is applied to z BEFORE the normals are taken. The normal of
// the drawn body is the normal of the drawn shape, not of the real one; take it
// from the unexaggerated field and the lighting says "flat" while the
// silhouette says "curved", which reads as a broken render and is very hard to
// find afterwards.
//
// Everything is a pure function of numbers, so the parts that can be wrong
// silently - counts, winding, normals, the thickness that ends up on screen -
// are checked in Node without a GL context anywhere near them.

import { plateFrame, type PlateFrame } from "./frame";

export interface PlateBodyInput {
  /** Deflection field, rows along y, columns along x. */
  surface: number[][];
  /** Plate extent in x, in the same unit as `thickness`. */
  length: number;
  /** Plate extent in y. */
  width: number;
  /** Total laminate thickness. */
  thickness: number;
  /** Multiplies the surface values; 1 means "draw the real deflection". */
  deflectionScale: number;
  /** Multiplies the thickness; see `autoThicknessScale`. */
  thicknessScale: number;
  /**
   * Ply interfaces as fractions of the thickness, ascending, from -0.5 to
   * +0.5 inclusive. A single ply is therefore `[-0.5, 0.5]`.
   */
  plyBoundaries: number[];
  /**
   * Fibre angle of each ply in radians, bottom-up - one fewer than there are
   * boundaries. Drawn as a hatch on the cut edge, which is the only face where
   * a ply's direction is visible at all.
   */
  plyAngles?: number[];
  /**
   * What to colour the body by, on the same grid as `surface`. Omitted, the
   * deflection colours itself.
   *
   * `null` is a point the core could not evaluate - a failure criterion that
   * refused, not a zero - and it must stay distinguishable all the way to the
   * shader, which is what `HOLE` is for.
   */
  values?: (number | null)[][];
}

/**
 * The vertex value that means "no answer here".
 *
 * A sentinel rather than NaN: NaN survives neither the float attribute nor the
 * shader arithmetic in any defined way, and a hole that quietly became a
 * colour would read as a result.
 */
export const HOLE = -1e30;

/** The ply index of a vertex that is not on a cut edge. */
export const NO_PLY = -1;

export interface PlateBody {
  positions: Float32Array;
  normals: Float32Array;
  /** One value per vertex, in the units of the coloured field. */
  values: Float32Array;
  /**
   * Which ply each vertex belongs to, or `NO_PLY` for the top and bottom
   * faces, which are not a cut through anything.
   *
   * A vertex attribute rather than a draw call per ply: highlighting the
   * evaluated ply is then a uniform, and a body with twenty plies is still one
   * `drawElements`.
   */
  plies: Float32Array;
  /** The fibre angle that belongs to that ply, in radians. */
  fibres: Float32Array;
  indices: Uint32Array;
  /** Ply interfaces on the side faces, as line segment pairs. */
  plyLines: Float32Array;
  /** The undeformed outline at z = 0, as line segment pairs. */
  outline: Float32Array;
  /** Where this body sits in world space - what the annotation builds on. */
  frame: PlateFrame;
}

/** Which (row, column) samples make up an edge, and which way is outwards. */
interface Edge {
  samples: [number, number][];
  outward: [number, number, number];
}

export function buildPlateBody(input: PlateBodyInput): PlateBody {
  const { surface, length, width, deflectionScale } = input;
  // Colour follows its own grid when one is given; the deflection is only the
  // default because it is the field the body's shape already is.
  const colours = input.values ?? surface;
  // World units: the longer plate edge is 1, centred on the origin. The camera
  // then needs no fitting pass and no knowledge of the plate's size.
  const frame = plateFrame(input);
  const { scale, halfThickness } = frame;

  const rows = surface.length;
  const cols = rows > 0 ? surface[0].length : 0;
  if (rows < 2 || cols < 2) {
    return emptyBody(frame);
  }

  const px: number[] = new Array(cols);
  const py: number[] = new Array(rows);
  for (let c = 0; c < cols; c++) px[c] = ((c / (cols - 1)) * length - length / 2) * scale;
  for (let r = 0; r < rows; r++) py[r] = ((r / (rows - 1)) * width - width / 2) * scale;

  const dx = px[1] - px[0];
  const dy = py[1] - py[0];

  const pz: number[][] = surface.map((row) => row.map((v) => v * deflectionScale * scale));

  // Normals from the slopes of the drawn field. Central differences inside,
  // one-sided at the border - a plate's edge is exactly where the curvature is
  // most interesting, so a normal that quietly falls back to (0,0,1) there
  // would flatten the light where it matters most.
  const normals: [number, number, number][][] = [];
  for (let r = 0; r < rows; r++) {
    const row: [number, number, number][] = [];
    for (let c = 0; c < cols; c++) {
      const dzdx =
        c === 0
          ? (pz[r][1] - pz[r][0]) / dx
          : c === cols - 1
            ? (pz[r][cols - 1] - pz[r][cols - 2]) / dx
            : (pz[r][c + 1] - pz[r][c - 1]) / (2 * dx);
      const dzdy =
        r === 0
          ? (pz[1][c] - pz[0][c]) / dy
          : r === rows - 1
            ? (pz[rows - 1][c] - pz[rows - 2][c]) / dy
            : (pz[r + 1][c] - pz[r - 1][c]) / (2 * dy);
      row.push(unit([-dzdx, -dzdy, 1]));
    }
    normals.push(row);
  }

  const positions: number[] = [];
  const normalOut: number[] = [];
  const values: number[] = [];
  const plies: number[] = [];
  const fibres: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    p: [number, number, number],
    n: [number, number, number],
    value: number,
    ply = NO_PLY,
    fibre = 0,
  ) => {
    positions.push(p[0], p[1], p[2]);
    normalOut.push(n[0], n[1], n[2]);
    values.push(value);
    plies.push(ply);
    fibres.push(fibre);
  };

  // --- top and bottom -----------------------------------------------------

  const topBase = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = normals[r][c];
      pushVertex(offset([px[c], py[r], pz[r][c]], n, halfThickness), n, valueAt(colours, r, c));
    }
  }

  const bottomBase = rows * cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = normals[r][c];
      pushVertex(offset([px[c], py[r], pz[r][c]], n, -halfThickness), neg(n), valueAt(colours, r, c));
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = topBase + r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Counter-clockwise seen from +z.
      indices.push(a, b, e, a, e, d);

      const a2 = bottomBase + r * cols + c;
      const b2 = a2 + 1;
      const d2 = a2 + cols;
      const e2 = d2 + 1;
      // Reversed, so the bottom faces -z.
      indices.push(a2, e2, b2, a2, d2, e2);
    }
  }

  // --- side faces ---------------------------------------------------------

  // One strip per ply rather than one per edge. The plies have to be separate
  // geometry because each carries its own fibre angle and its own identity -
  // a vertex on an interface belongs to two plies, and a shared one could
  // only ever answer for one of them.
  const boundaries = input.plyBoundaries;
  const angles = input.plyAngles ?? [];

  for (const edge of edgesOf(rows, cols)) {
    const count = edge.samples.length;

    for (let band = 0; band < boundaries.length - 1; band++) {
      const base = positions.length / 3;
      const lowerFraction = boundaries[band] * 2 * halfThickness;
      const upperFraction = boundaries[band + 1] * 2 * halfThickness;
      const fibre = angles[band] ?? 0;

      for (let i = 0; i < count; i++) {
        const [r, c] = edge.samples[i];
        const [rPrev, cPrev] = edge.samples[Math.max(0, i - 1)];
        const [rNext, cNext] = edge.samples[Math.min(count - 1, i + 1)];

        const tangent: [number, number, number] = [
          px[cNext] - px[cPrev],
          py[rNext] - py[rPrev],
          pz[rNext][cNext] - pz[rPrev][cPrev],
        ];

        const n = normals[r][c];
        // The side face is ruled by the tangent and the thickness direction,
        // so its normal is exactly their cross product - no approximation.
        let side = unit(cross(tangent, n));
        if (dot(side, edge.outward) < 0) side = neg(side);

        const mid: [number, number, number] = [px[c], py[r], pz[r][c]];
        const value = valueAt(colours, r, c);
        pushVertex(offset(mid, n, lowerFraction), side, value, band, fibre);
        pushVertex(offset(mid, n, upperFraction), side, value, band, fibre);
      }

      for (let i = 0; i < count - 1; i++) {
        const lowerA = base + i * 2;
        const upperA = lowerA + 1;
        const lowerB = lowerA + 2;
        const upperB = lowerA + 3;
        indices.push(lowerA, lowerB, upperB, lowerA, upperB, upperA);
      }
    }
  }

  // --- ply interfaces and the undeformed outline --------------------------

  const plyLines: number[] = [];
  for (const edge of edgesOf(rows, cols)) {
    for (const fraction of boundaries) {
      const distance = fraction * 2 * halfThickness;
      for (let i = 0; i < edge.samples.length - 1; i++) {
        const [r0, c0] = edge.samples[i];
        const [r1, c1] = edge.samples[i + 1];
        const a = offset([px[c0], py[r0], pz[r0][c0]], normals[r0][c0], distance);
        const b = offset([px[c1], py[r1], pz[r1][c1]], normals[r1][c1], distance);
        plyLines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
  }

  const x0 = px[0];
  const x1 = px[cols - 1];
  const y0 = py[0];
  const y1 = py[rows - 1];
  const outline = new Float32Array([
    x0, y0, 0, x1, y0, 0,
    x1, y0, 0, x1, y1, 0,
    x1, y1, 0, x0, y1, 0,
    x0, y1, 0, x0, y0, 0,
  ]);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normalOut),
    values: new Float32Array(values),
    plies: new Float32Array(plies),
    fibres: new Float32Array(fibres),
    indices: new Uint32Array(indices),
    plyLines: new Float32Array(plyLines),
    outline,
    frame,
  };
}

/** A grid entry, with anything unevaluable mapped onto the sentinel. */
function valueAt(grid: (number | null)[][], row: number, col: number): number {
  const value = grid[row]?.[col];
  return value === null || value === undefined || !Number.isFinite(value) ? HOLE : value;
}

function edgesOf(rows: number, cols: number): Edge[] {
  const alongX = (r: number): [number, number][] =>
    Array.from({ length: cols }, (_, c) => [r, c] as [number, number]);
  const alongY = (c: number): [number, number][] =>
    Array.from({ length: rows }, (_, r) => [r, c] as [number, number]);
  return [
    { samples: alongX(0), outward: [0, -1, 0] },
    { samples: alongX(rows - 1), outward: [0, 1, 0] },
    { samples: alongY(0), outward: [-1, 0, 0] },
    { samples: alongY(cols - 1), outward: [1, 0, 0] },
  ];
}

function emptyBody(frame: PlateFrame): PlateBody {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    values: new Float32Array(0),
    plies: new Float32Array(0),
    fibres: new Float32Array(0),
    indices: new Uint32Array(0),
    plyLines: new Float32Array(0),
    outline: new Float32Array(0),
    frame,
  };
}

function offset(
  p: [number, number, number],
  n: [number, number, number],
  distance: number,
): [number, number, number] {
  return [p[0] + n[0] * distance, p[1] + n[1] * distance, p[2] + n[2] * distance];
}

function neg(v: [number, number, number]): [number, number, number] {
  return [-v[0], -v[1], -v[2]];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}
