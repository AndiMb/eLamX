// The load arrows (FR-07): what is pushing on the plate, drawn where it
// pushes and pointing the way it pushes.
//
// Three kinds, one shape. A transverse surface load becomes a grid of arrows
// over the plate, a point load a single longer one at its point of
// application, and the buckling module's in-plane flows a row of arrows on
// each edge they act on. All of them end up as `LoadArrow`s and are
// tessellated once, so an arrow means the same thing in either module.
//
// Two conventions decide whether the picture is right, and both come from the
// core rather than from taste:
//
//   - A transverse force is positive along +z, because that is the sign that
//     comes back as a positive deflection: TransverseLoad::add projects the
//     force onto shape functions that are positive over the plate.
//   - An in-plane flow is NEGATIVE in compression - the buckling tests solve
//     n_x = -1 and expect a positive critical factor - so a negative flow
//     draws arrows pressing onto the edge and a positive one arrows pulling
//     away from it.
//
// An arrow's TIP is the point the force acts on. A pressure pushing down
// therefore hangs above the plate with its point on the top face; the same
// pressure with the other sign sits underneath. That is what lets the reader
// tell the two apart at a glance instead of reading the caption.

import type { NamedLoad } from "../generated/NamedLoad";
import type { Vec3 } from "../gl/mat4";
import { add, meshBuilder, scaled, type AnnotationMesh } from "./annotation";
import type { PlateFrame } from "./frame";

export interface LoadArrow {
  /** The point the force acts on - where the arrowhead ends. */
  tip: Vec3;
  /** Unit vector from tail to tip: the direction the force pushes. */
  direction: Vec3;
  /** Tail-to-tip distance, world units. */
  length: number;
}

/** Which unit the caption writes after the number. */
export type LoadUnit = "pressure" | "force" | "flow";

export interface LoadLabel {
  /** Anchor in world space: just beyond the tail of the arrow it names. */
  at: Vec3;
  /** The load's own name, or the name of the flow component. */
  name: string;
  value: number;
  unit: LoadUnit;
}

export interface LoadAnnotation {
  arrows: LoadArrow[];
  labels: LoadLabel[];
}

export const NO_LOADS: LoadAnnotation = { arrows: [], labels: [] };

/** Drawn z of the mid-surface at (u, v) in the unit square, in world units. */
export type HeightAt = (u: number, v: number) => number;

const SURFACE_ARROW = 0.13;
const POINT_ARROW = 0.22;
const FLOW_ARROW = 0.16;
/** How far past the tail a caption sits, and how far apart stacked ones are. */
const LABEL_GAP = 0.035;

export function transverseLoadArrows(
  loads: readonly NamedLoad[],
  frame: PlateFrame,
  height: HeightAt,
): LoadAnnotation {
  const arrows: LoadArrow[] = [];
  const labels: LoadLabel[] = [];
  let stacked = 0;

  for (const load of loads) {
    if (!Number.isFinite(load.force) || load.force === 0) continue;
    const direction: Vec3 = load.force > 0 ? [0, 0, 1] : [0, 0, -1];

    if (load.kind === "Surface") {
      const columns = arrowCount(frame.halfLength * 2);
      const rows = arrowCount(frame.halfWidth * 2);
      for (let i = 0; i < columns; i++) {
        for (let j = 0; j < rows; j++) {
          const tip = tipAt((i + 0.5) / columns, (j + 0.5) / rows, frame, height, direction);
          arrows.push({ tip, direction, length: SURFACE_ARROW });
        }
      }
      labels.push({
        at: labelAnchor(
          tipAt(0.5, 0.5, frame, height, direction),
          direction,
          SURFACE_ARROW,
          stacked++,
        ),
        name: load.name,
        value: load.force,
        unit: "pressure",
      });
      continue;
    }

    // The input gives the point from the plate's centre, which is also where
    // the world origin sits - so this is a scaling, not a shift.
    const u = clamp01(0.5 + halfShare(load.x * frame.scale, frame.halfLength));
    const v = clamp01(0.5 + halfShare(load.y * frame.scale, frame.halfWidth));
    const tip = tipAt(u, v, frame, height, direction);
    arrows.push({ tip, direction, length: POINT_ARROW });
    labels.push({
      at: labelAnchor(tip, direction, POINT_ARROW, stacked++),
      name: load.name,
      value: load.force,
      unit: "force",
    });
  }

  return { arrows, labels };
}

/**
 * The buckling module's in-plane flows, on the edges each of them acts on.
 *
 * Only the RATIO of the three carries meaning, so the arrows are scaled
 * against the largest of them rather than against an absolute value: the
 * picture shows which load dominates, which is all the numbers say.
 */
export function edgeFlowArrows(
  nx: number,
  ny: number,
  nxy: number,
  frame: PlateFrame,
): LoadAnnotation {
  const peak = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nxy));
  if (!Number.isFinite(peak) || peak === 0) return NO_LOADS;

  const arrows: LoadArrow[] = [];
  const lengthOf = (value: number) => FLOW_ARROW * (0.45 + (0.55 * Math.abs(value)) / peak);

  for (const edge of flowEdges(frame)) {
    const normal = edge.normalAxis === "x" ? nx : ny;
    const count = arrowCount(edge.half * 2);
    for (let i = 0; i < count; i++) {
      const s = (((i + 0.5) / count) * 2 - 1) * edge.half;
      const anchor: Vec3 =
        edge.normalAxis === "x" ? [edge.at, s, 0] : [s, edge.at, 0];

      if (normal !== 0) {
        const length = lengthOf(normal);
        // Tension pulls away from the edge, so the far end is its tip;
        // compression presses onto the edge, so the edge itself is.
        const direction = normal > 0 ? edge.outward : scaled(edge.outward, -1);
        const tip = normal > 0 ? add(anchor, scaled(direction, length)) : anchor;
        arrows.push({ tip, direction, length });
      }

      if (nxy !== 0) {
        // Traction of a shear flow on an edge with outward normal n:
        // t = (sigma_xy * n_y, sigma_xy * n_x) - which is the components of n
        // swapped, and that is what makes the four edges circulate.
        const swapped: Vec3 = [edge.outward[1], edge.outward[0], 0];
        const direction = nxy > 0 ? swapped : scaled(swapped, -1);
        const length = lengthOf(nxy);
        // Centred on the edge: neither end of a shear arrow is a point of
        // application, so putting the tip on the edge would claim otherwise.
        arrows.push({ tip: add(anchor, scaled(direction, length / 2)), direction, length });
      }
    }
  }

  const labels: LoadLabel[] = [];
  let stacked = 0;
  const label = (value: number, name: string, outward: Vec3) => {
    if (value === 0) return;
    const reach =
      frame.halfLength * Math.abs(outward[0]) + frame.halfWidth * Math.abs(outward[1]);
    labels.push({
      at: scaled(outward, reach + FLOW_ARROW + LABEL_GAP * (1 + stacked++)),
      name,
      value,
      unit: "flow",
    });
  };
  label(nx, "nx", [1, 0, 0]);
  label(ny, "ny", [0, 1, 0]);
  label(nxy, "nxy", [0, -1, 0]);

  return { arrows, labels };
}

/**
 * Bilinear sampler over a deflection grid, in the world units the arrows live
 * in.
 *
 * Rows run along y and columns along x, the same reading `buildPlateBody`
 * gives them. A point the core could not evaluate comes back as the flat
 * plate rather than as NaN: an arrow at NaN silently leaves the picture, and a
 * missing load arrow is a worse lie than one drawn on the undeflected surface.
 */
export function heightSampler(
  surface: readonly (readonly number[])[],
  deflectionScale: number,
  scale: number,
): HeightAt {
  const rows = surface.length;
  const cols = rows > 0 ? surface[0].length : 0;
  if (rows < 2 || cols < 2) return () => 0;

  return (u, v) => {
    const c = clamp01(u) * (cols - 1);
    const r = clamp01(v) * (rows - 1);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const c1 = Math.min(cols - 1, c0 + 1);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fc = c - c0;
    const fr = r - r0;
    const near = surface[r0][c0] * (1 - fc) + surface[r0][c1] * fc;
    const far = surface[r1][c0] * (1 - fc) + surface[r1][c1] * fc;
    const value = (near * (1 - fr) + far * fr) * deflectionScale * scale;
    return Number.isFinite(value) ? value : 0;
  };
}

export function loadMesh(annotation: LoadAnnotation): AnnotationMesh {
  const mesh = meshBuilder();
  for (const arrow of annotation.arrows) {
    const head = Math.min(arrow.length * 0.45, 0.045);
    const tail = add(arrow.tip, scaled(arrow.direction, -arrow.length));
    mesh.line(tail, add(arrow.tip, scaled(arrow.direction, -head)));
    mesh.cone(arrow.tip, arrow.direction, head, head * 0.42, 8);
  }
  return mesh.build();
}

interface FlowEdge {
  /** Which axis the edge is normal to. */
  normalAxis: "x" | "y";
  /** Coordinate of the edge along that axis. */
  at: number;
  /** Half the edge's own length. */
  half: number;
  outward: Vec3;
}

function flowEdges(frame: PlateFrame): FlowEdge[] {
  const { halfLength: x, halfWidth: y } = frame;
  return [
    { normalAxis: "x", at: -x, half: y, outward: [-1, 0, 0] },
    { normalAxis: "x", at: x, half: y, outward: [1, 0, 0] },
    { normalAxis: "y", at: -y, half: x, outward: [0, -1, 0] },
    { normalAxis: "y", at: y, half: x, outward: [0, 1, 0] },
  ];
}

function tipAt(u: number, v: number, frame: PlateFrame, height: HeightAt, direction: Vec3): Vec3 {
  // An upward force presses on the underside, a downward one on the top face.
  const face = direction[2] > 0 ? -frame.halfThickness : frame.halfThickness;
  return [(u * 2 - 1) * frame.halfLength, (v * 2 - 1) * frame.halfWidth, height(u, v) + face];
}

function labelAnchor(tip: Vec3, direction: Vec3, length: number, stacked: number): Vec3 {
  return add(tip, scaled(direction, -(length + LABEL_GAP * (1 + stacked))));
}

/** Enough arrows to read as a field, few enough to see the plate through. */
function arrowCount(span: number): number {
  return Math.min(5, Math.max(2, Math.round(span / 0.26)));
}

/** `offset / (2 * half)`, and 0 where there is no plate to be offset within. */
function halfShare(offset: number, half: number): number {
  return half > 0 ? offset / (2 * half) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
