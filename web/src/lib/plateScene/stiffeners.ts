// The stiffeners standing on the plate: where they run, and how tall they are.
//
// A stiffener has no degrees of freedom of its own - it follows the plate's
// deflection at its line (see elamx-core/core/src/plate/stiffener.rs) - so the
// picture has to follow it too: the web is a ribbon sampled along the SAME
// height function the body is built from, not a straight beam laid over a bent
// plate. A stiffener drawn straight while the plate below it bends would
// suggest a model this is not.
//
// Heights are drawn TRUE to the plate's span, and deliberately not stretched
// by the laminate's thickness exaggeration. That exaggeration exists to make a
// 0.4 mm laminate visible at all on a 500 mm plate - a factor above twenty -
// and a stiffener is already two orders of magnitude taller than the laminate.
// Applying it to a 60 mm web put a brown wall through the whole picture. So
// the one dimension that is honest here stays honest: how far the stiffener
// stands out of the plate, against how wide the plate is.
//
// Pure functions of numbers, like the supports and the loads beside them.

import type { Stiffener } from "../generated/Stiffener";
import type { Vec3 } from "../gl/mat4";
import { meshBuilder, type AnnotationMesh } from "./annotation";
import type { HeightAt } from "./loads";
import type { PlateFrame } from "./frame";

export interface StiffenerRibbon {
  name: string;
  /** Points along the stiffener's line, on the DEFORMED top face. */
  foot: Vec3[];
  /** Web height above the foot, world units. Always positive. */
  height: number;
  /** Half the flange width, world units. Zero for a profile without one. */
  flangeHalf: number;
  /** In-plane unit vector across the stiffener - the flange's width. */
  across: Vec3;
}

/** How many points a ribbon is sampled at. Matches the body's own grid well
 *  enough that the two do not visibly part company at the crest. */
const SAMPLES = 41;

/**
 * Drawn height of a stiffener whose profile does not have one.
 *
 * The direct input carries stiffnesses, not geometry: `E`, `I`, `G` and `J`
 * say nothing about how tall the beam is. Rather than invent a height from
 * `I` - which would be a made-up number drawn to scale, the worst of both -
 * the direct input gets a fixed token ribbon, as eLamX's own 3D view draws
 * for every stiffener.
 */
const TOKEN_HEIGHT_MM = 20;

export function stiffenerRibbons(
  stiffeners: readonly Stiffener[],
  frame: PlateFrame,
  height: HeightAt,
): StiffenerRibbon[] {
  const ribbons: StiffenerRibbon[] = [];
  const { halfLength, halfWidth, scale } = frame;
  if (!(halfLength > 0) || !(halfWidth > 0)) return ribbons;

  for (const stiffener of stiffeners) {
    if (!Number.isFinite(stiffener.position)) continue;

    // Position counts from the plate's centre, as everywhere in this module.
    const offset = stiffener.position * scale;
    const alongX = stiffener.direction === "x";
    // Outside the plate there is no plate to stand on, and no deflection to
    // follow: the height function is only defined over the unit square. The
    // analysis does NOT skip it - eLamX evaluates the shape functions past
    // their interval and adds whatever comes out - so the editor says so in
    // words rather than this drawing a beam floating in the air.
    const t = alongX ? offset / halfWidth : offset / halfLength;
    if (!(Math.abs(t) <= 1)) continue;

    const foot: Vec3[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const s = i / (SAMPLES - 1);
      const u = alongX ? s : (offset + halfLength) / (2 * halfLength);
      const v = alongX ? (offset + halfWidth) / (2 * halfWidth) : s;
      const x = -halfLength + 2 * halfLength * u;
      const y = -halfWidth + 2 * halfWidth * v;
      foot.push([x, y, height(u, v) + frame.halfThickness]);
    }

    const mm = (value: number) => value * scale;
    ribbons.push({
      name: stiffener.name,
      foot,
      height: mm(webHeightMm(stiffener)),
      flangeHalf: mm(flangeWidthMm(stiffener) / 2),
      across: alongX ? [0, 1, 0] : [1, 0, 0],
    });
  }
  return ribbons;
}

/** How far the profile stands above the plate, in mm. */
function webHeightMm(stiffener: Stiffener): number {
  switch (stiffener.profile) {
    case "i_profile":
      return finiteOr(stiffener.w1, TOKEN_HEIGHT_MM);
    case "t_profile":
      return finiteOr(stiffener.w2, TOKEN_HEIGHT_MM);
    default:
      return TOKEN_HEIGHT_MM;
  }
}

/** Width of the flange sitting on top of the web, in mm. Only the T has one. */
function flangeWidthMm(stiffener: Stiffener): number {
  return stiffener.profile === "t_profile" ? finiteOr(stiffener.w1, 0) : 0;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function stiffenerMesh(ribbons: readonly StiffenerRibbon[]): AnnotationMesh {
  const mesh = meshBuilder();

  for (const ribbon of ribbons) {
    const { foot, height, flangeHalf, across } = ribbon;
    for (let i = 0; i + 1 < foot.length; i++) {
      const a = foot[i];
      const b = foot[i + 1];
      const aTop: Vec3 = [a[0], a[1], a[2] + height];
      const bTop: Vec3 = [b[0], b[1], b[2] + height];
      mesh.quad(a, b, bTop, aTop);

      if (flangeHalf > 0) {
        const out: Vec3 = [across[0] * flangeHalf, across[1] * flangeHalf, 0];
        mesh.quad(
          [aTop[0] - out[0], aTop[1] - out[1], aTop[2]],
          [bTop[0] - out[0], bTop[1] - out[1], bTop[2]],
          [bTop[0] + out[0], bTop[1] + out[1], bTop[2]],
          [aTop[0] + out[0], aTop[1] + out[1], aTop[2]],
        );
      }
    }

    // The top edge as a line as well: at a grazing angle the web collapses to
    // nothing and the stiffener would disappear exactly where it matters most.
    for (let i = 0; i + 1 < foot.length; i++) {
      const a = foot[i];
      const b = foot[i + 1];
      mesh.line([a[0], a[1], a[2] + height], [b[0], b[1], b[2] + height]);
    }
  }

  return mesh.build();
}
