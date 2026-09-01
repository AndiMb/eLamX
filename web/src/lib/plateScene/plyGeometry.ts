// The stacking, as the 3D body needs it: how thick the laminate is, and where
// the ply interfaces sit within that thickness.
//
// Both come out of the CLT response's layer contributions, which already carry
// the expanded stack - the mirrored half of a symmetric laminate exists there
// and nowhere else, so deriving this from the layer list in the store would
// draw a symmetric laminate at half its thickness.

import type { LayerContributionDto } from "../types";

export interface PlyGeometry {
  /** Total laminate thickness, in the layers' own unit. */
  thickness: number;
  /** Interfaces as fractions of the thickness, -0.5 to +0.5, ascending. */
  boundaries: number[];
  /**
   * Fibre angle of each ply in RADIANS, bottom-up, one per band between two
   * neighbouring boundaries. Radians because the only consumer is a shader.
   */
  angles: number[];
  /**
   * Which entry of the contribution list each band is, bottom-up.
   *
   * The two orders are opposite: the core stacks layer 0 at the TOP and works
   * downwards (`CltLaminate::new`), while the drawn bands run bottom-up with
   * z. Highlighting the evaluated ply by its core index without this map picks
   * the mirror-image ply - and on a symmetric laminate it would look right.
   */
  layerIndices: number[];
}

/** A laminate whose stacking is not known yet: one ply, no thickness. */
export const UNKNOWN_PLY_GEOMETRY: PlyGeometry = {
  thickness: 0,
  boundaries: [-0.5, 0.5],
  angles: [0],
  layerIndices: [0],
};

export function plyGeometryOf(contributions: LayerContributionDto[] | null): PlyGeometry {
  if (!contributions || contributions.length === 0) return UNKNOWN_PLY_GEOMETRY;

  // Sorted by height, because the contribution list is in stacking order and
  // the drawn bands run bottom-up; for a symmetric laminate the expanded half
  // comes back in the order it was mirrored, not in the order it is drawn.
  const stack = contributions
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.zm - b.layer.zm);

  const faces: number[] = [];
  for (const { layer } of stack) {
    faces.push(layer.zm - layer.thickness / 2, layer.zm + layer.thickness / 2);
  }

  const zMin = Math.min(...faces);
  const zMax = Math.max(...faces);
  const thickness = zMax - zMin;
  if (!(thickness > 0)) return UNKNOWN_PLY_GEOMETRY;

  // Measured from the middle of the stack rather than from z = 0. The two
  // differ whenever the laminate carries a reference-plane offset, and the
  // drawn body is centred on its own faces - so anchoring on z = 0 would put
  // the ply lines beside the body instead of on it.
  const centre = (zMin + zMax) / 2;

  const boundaries = [
    // Neighbouring plies share an interface, and the two ways of arriving at
    // its z coordinate do not always agree to the last bit. Rounding first
    // keeps one line where the laminate has one interface.
    ...new Set(faces.map((z) => Math.round(((z - centre) / thickness) * 1e9) / 1e9)),
  ].sort((a, b) => a - b);

  return {
    thickness,
    boundaries,
    angles: stack.map(({ layer }) => (layer.angle_deg * Math.PI) / 180),
    layerIndices: stack.map(({ index }) => index),
  };
}
