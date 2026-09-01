// The support symbols on the four plate edges (FR-06).
//
// `bc_x` and `bc_y` each describe a PAIR of opposite edges, and each is two
// letters: the first is the edge at coordinate zero, the second the edge at
// the far end - the same reading the core's shape functions are tested
// against (`shape_functions_vanish_at_every_supported_edge`). Getting that
// pair the wrong way round draws a picture that is right for CC and SS and
// silently mirrored for CF, SC and SF, which is exactly the case a reader
// would trust the picture on.
//
// Everything sits at the UNDEFORMED edge. At a supported edge that is also
// where the body is, so the symbols look attached; at a free edge the body
// lifts off them, and seeing that gap is the point.
//
// Pure functions of numbers, so the parts that can be quietly wrong - which
// edge, which way is out, how many symbols - are checked in Node.

import type { BoundaryCondition } from "../generated/BoundaryCondition";
import type { Vec3 } from "../gl/mat4";
import { add, meshBuilder, scaled, type AnnotationMesh } from "./annotation";
import { SYMBOL_SIZE, type PlateFrame } from "./frame";

/** How one single edge is held. */
export type EdgeCondition = "S" | "C" | "F";

export type EdgeId = "x0" | "x1" | "y0" | "y1";

export interface SupportEdge {
  id: EdgeId;
  condition: EdgeCondition;
  /** Edge start corner, undeformed, on the mid-plane. */
  from: Vec3;
  /** Edge end corner. */
  to: Vec3;
  /** In-plane unit vector pointing away from the plate. */
  outward: Vec3;
  /** Unit vector from `from` towards `to`. */
  along: Vec3;
  /** Where the individual symbols sit, evenly spaced, corners left clear. */
  marks: Vec3[];
}

/** Target distance between two symbols, world units. */
const MARK_SPACING = 0.12;
const MIN_MARKS = 2;
const MAX_MARKS = 12;

export function supportEdges(
  bcX: BoundaryCondition,
  bcY: BoundaryCondition,
  frame: PlateFrame,
): SupportEdge[] {
  const { halfLength: x, halfWidth: y } = frame;
  return [
    edge("x0", conditionOf(bcX, 0), [-x, -y, 0], [-x, y, 0], [-1, 0, 0]),
    edge("x1", conditionOf(bcX, 1), [x, -y, 0], [x, y, 0], [1, 0, 0]),
    edge("y0", conditionOf(bcY, 0), [-x, -y, 0], [x, -y, 0], [0, -1, 0]),
    edge("y1", conditionOf(bcY, 1), [-x, y, 0], [x, y, 0], [0, 1, 0]),
  ];
}

export function supportMesh(
  edges: SupportEdge[],
  frame: PlateFrame,
  size = SYMBOL_SIZE,
): AnnotationMesh {
  const mesh = meshBuilder();
  const up: Vec3 = [0, 0, 1];

  for (const edge of edges) {
    const span = distance(edge.from, edge.to);
    if (span === 0 || edge.marks.length === 0) continue;

    if (edge.condition === "S") {
      // A pin support: a four-sided pyramid standing under the edge, its tip
      // against the underside of the laminate.
      for (const mark of edge.marks) {
        const apex = add(mark, [0, 0, -frame.halfThickness]);
        mesh.cone(apex, up, size, size * 0.5, 4);
      }
      continue;
    }

    if (edge.condition === "F") {
      // A free edge is marked, not supported: a dashed line where the edge
      // would be if it did not move.
      const dash = (span / edge.marks.length) * 0.55;
      for (const mark of edge.marks) {
        mesh.line(add(mark, scaled(edge.along, -dash / 2)), add(mark, scaled(edge.along, dash / 2)));
      }
      continue;
    }

    // Clamped: the hatched block of the drawing convention. The block runs the
    // whole edge and reaches from below the laminate up to its top face, so
    // the plate reads as built into it rather than resting on it.
    const depth = size * 0.85;
    const bottom = -frame.halfThickness - size * 0.55;
    const top = frame.halfThickness;
    const middle = midpoint(edge.from, edge.to);
    mesh.box(
      add(add(middle, scaled(edge.outward, depth / 2)), [0, 0, (top + bottom) / 2]),
      [edge.along, edge.outward, up],
      [span / 2, depth / 2, (top - bottom) / 2],
    );

    // Hatching on the outer face, lifted off it by a hair so it does not fight
    // the block for the same depth values.
    const face = scaled(edge.outward, depth + 0.0015);
    const height = top - bottom;
    for (const mark of edge.marks) {
      const s = distance(edge.from, mark);
      const lower = Math.max(0, s - height / 2);
      const upper = Math.min(span, s + height / 2);
      mesh.line(
        add(add(edge.from, scaled(edge.along, lower)), add(face, [0, 0, bottom])),
        add(add(edge.from, scaled(edge.along, upper)), add(face, [0, 0, top])),
      );
    }
  }

  return mesh.build();
}

function edge(
  id: EdgeId,
  condition: EdgeCondition,
  from: Vec3,
  to: Vec3,
  outward: Vec3,
): SupportEdge {
  const span = distance(from, to);
  const along: Vec3 =
    span > 0 ? [(to[0] - from[0]) / span, (to[1] - from[1]) / span, (to[2] - from[2]) / span] : [0, 0, 0];

  // Half a step in from each end, so the symbols space themselves evenly and
  // no two edges pile a symbol on the same corner.
  const count = Math.min(MAX_MARKS, Math.max(MIN_MARKS, Math.round(span / MARK_SPACING)));
  const marks: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    marks.push(add(from, scaled(along, ((i + 0.5) / count) * span)));
  }

  return { id, condition, from, to, outward, along, marks };
}

function conditionOf(bc: BoundaryCondition, end: 0 | 1): EdgeCondition {
  return bc[end] as EdgeCondition;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
