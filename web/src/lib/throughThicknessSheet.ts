// The geometry of the sampling-point sheet (F2.6), apart from its drawing:
// which vertical position a z (or a ply) sits at, what a quantity is at a
// given z, and each column's value range. Pure, so it can be tested and the
// report can lay out the same sheet.
//
// No mechanics here (N4). The core gives every ply's state at its two
// surfaces; within a ply strain and stress are linear in z (CLT: eps(z) =
// eps0 + z kappa, sigma = Q eps), so the value between the surfaces is the
// straight line between the core's two numbers - the same line the chart
// draws, read off rather than computed anew.

import type { FailureMetric } from "./failureMetric";
import { metricLimit, toMetric } from "./failureMetric";
import type { LayerResultDto, ReserveFactorDto } from "./types";

export type Triple = [number, number, number];

/** One ply of the expanded stack, with what the sheet shows of it. */
export interface SheetPly {
  /** Stacking-order number, 1 at the top. */
  number: number;
  angle: number;
  materialId: string;
  zLower: number;
  zUpper: number;
  strain: { local: { lower: Triple; upper: Triple }; global: { lower: Triple; upper: Triple } };
  stress: { local: { lower: Triple; upper: Triple }; global: { lower: Triple; upper: Triple } };
  rf: { lower: ReserveFactorDto; upper: ReserveFactorDto };
  criterion: { lower: string; upper: string };
}

export type SheetSystem = "local" | "global";
export type SheetAxis = "z" | "ply";

/** Maps positions in the stack to a vertical coordinate 0 (top) .. height.
 *  In "z" mode proportional to z; in "ply" mode every ply gets the same band,
 *  so a thin ply is as readable as a thick one. */
export interface VerticalScale {
  /** y of a z-coordinate (either mode: in ply mode z is placed within its
   *  ply's band). */
  y: (z: number) => number;
  /** The z at a y - the inverse, for the hover. */
  z: (y: number) => number;
  /** The bands of the plies, top to bottom. */
  bands: { ply: SheetPly; top: number; bottom: number }[];
}

export function verticalScale(plies: readonly SheetPly[], axis: SheetAxis, height: number): VerticalScale {
  const zTop = Math.max(...plies.map((p) => p.zUpper));
  const zBottom = Math.min(...plies.map((p) => p.zLower));
  const span = zTop - zBottom || 1;
  // Top to bottom: the ply with the largest z first.
  const ordered = [...plies].sort((a, b) => b.zUpper - a.zUpper);
  if (axis === "z") {
    const y = (z: number) => ((zTop - z) / span) * height;
    return {
      y,
      z: (py: number) => zTop - (py / height) * span,
      bands: ordered.map((ply) => ({ ply, top: y(ply.zUpper), bottom: y(ply.zLower) })),
    };
  }
  const band = height / Math.max(ordered.length, 1);
  const bands = ordered.map((ply, i) => ({ ply, top: i * band, bottom: (i + 1) * band }));
  const bandOf = (z: number) =>
    bands.find((b) => z <= b.ply.zUpper && z >= b.ply.zLower) ??
    (z > zTop ? bands[0] : bands[bands.length - 1]);
  return {
    y: (z: number) => {
      const b = bandOf(z);
      const t = (b.ply.zUpper - z) / (b.ply.zUpper - b.ply.zLower || 1);
      return b.top + t * (b.bottom - b.top);
    },
    z: (py: number) => {
      const i = Math.min(bands.length - 1, Math.max(0, Math.floor(py / band)));
      const b = bands[i];
      const t = (py - b.top) / (b.bottom - b.top || 1);
      return b.ply.zUpper - t * (b.ply.zUpper - b.ply.zLower);
    },
    bands,
  };
}

/** The ply at z - the upper one exactly on an interface - or null outside. */
export function plyAt(plies: readonly SheetPly[], z: number): SheetPly | null {
  const ordered = [...plies].sort((a, b) => b.zUpper - a.zUpper);
  return ordered.find((p) => z <= p.zUpper && z >= p.zLower) ?? null;
}

/** A strain or stress component at z within its ply, on the line between the
 *  core's two surface values. */
export function valueAt(
  ply: SheetPly,
  quantity: "strain" | "stress",
  system: SheetSystem,
  component: 0 | 1 | 2,
  z: number,
): number {
  const { lower, upper } = ply[quantity][system];
  const t = (z - ply.zLower) / (ply.zUpper - ply.zLower || 1);
  return lower[component] + t * (upper[component] - lower[component]);
}

/** The range a strain or stress column spans, zero included so the axis
 *  line is always inside. */
export function valueRange(
  plies: readonly SheetPly[],
  quantity: "strain" | "stress",
  system: SheetSystem,
  component: 0 | 1 | 2,
): [number, number] {
  const values = plies.flatMap((p) => [p[quantity][system].lower[component], p[quantity][system].upper[component]]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** The range of the metric column: zero, the limit, and every finite value -
 *  but not beyond ten times the limit's scale, or one lightly loaded ply
 *  with an RF of 400 would press everything else against the axis. Values
 *  beyond are drawn at the edge, marked as cut off. */
export function metricRange(plies: readonly SheetPly[], metric: FailureMetric): [number, number] {
  const limit = metricLimit(metric);
  const values = plies
    .flatMap((p) => [p.rf.lower.minimal_reserve_factor, p.rf.upper.minimal_reserve_factor])
    .map((rf) => toMetric(rf, metric))
    .filter(Number.isFinite);
  const cap = 10 * Math.max(1, Math.abs(limit));
  const lo = Math.max(-cap, Math.min(0, limit, ...values));
  const hi = Math.min(cap, Math.max(0, limit, ...values));
  return [lo, hi === lo ? lo + 1 : hi * 1.05];
}

/** The expanded stack as the sheet needs it, from the core's response. */
export function sheetPlies(
  contributions: { layer_number: number; angle_deg: number; material_id: string; zm: number; thickness: number }[],
  results: LayerResultDto[],
): SheetPly[] {
  return contributions.map((c, i) => {
    const r = results[i];
    return {
      number: c.layer_number,
      angle: c.angle_deg,
      materialId: c.material_id,
      zLower: c.zm - c.thickness / 2,
      zUpper: c.zm + c.thickness / 2,
      strain: {
        local: { lower: r.sss_lower.strain as Triple, upper: r.sss_upper.strain as Triple },
        global: { lower: r.sss_lower_global.strain as Triple, upper: r.sss_upper_global.strain as Triple },
      },
      stress: {
        local: { lower: r.sss_lower.stress as Triple, upper: r.sss_upper.stress as Triple },
        global: { lower: r.sss_lower_global.stress as Triple, upper: r.sss_upper_global.stress as Triple },
      },
      rf: { lower: r.rr_lower, upper: r.rr_upper },
      criterion: { lower: r.governing_lower, upper: r.governing_upper },
    };
  });
}
