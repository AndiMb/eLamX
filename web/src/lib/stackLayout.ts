// The geometry of the stack drawing, apart from the drawing: which plies are
// drawn in which order, how tall, and where the midplane runs. Kept out of
// the component so it can be tested, and so the report can lay out the same
// picture.

import type { LayerRow } from "./constants";

type Ply = Pick<LayerRow, "id" | "angle" | "thickness" | "materialId">;

/** From this many plies on, the drawing shows a window of them: bars thinner
 *  than a line of text cannot carry an angle, and a stack of 64 plies drawn
 *  whole is a striped rectangle. */
export const STACK_WINDOW = 40;

/** One ply as drawn: which stored ply it is and whether it is its mirror. */
export interface DrawnPly<P extends Ply = Ply> {
  layer: P;
  mirror: boolean;
  /** Position in the whole drawn stack. */
  index: number;
}

/** The plies in drawing order, top to bottom, the mirrored half included
 *  unless `showMirror` is off. */
export function drawnPlies<P extends Ply>(
  layers: P[],
  symmetric: boolean,
  withMiddleLayer: boolean,
  showMirror = true,
): DrawnPly<P>[] {
  const mirrored = symmetric && showMirror ? [...layers].reverse().slice(withMiddleLayer ? 1 : 0) : [];
  return [
    ...layers.map((layer) => ({ layer, mirror: false })),
    ...mirrored.map((layer) => ({ layer, mirror: true })),
  ].map((ply, index) => ({ ...ply, index }));
}

export interface PlacedPly<P extends Ply = Ply> extends DrawnPly<P> {
  y: number;
  height: number;
}

/**
 * Bars for the plies of a window, stacked from y = 0, each at least
 * `minBar` tall so a thin ply stays visible; and the midplane's y if it lies
 * in the window - between the halves, or through the middle of a middle ply.
 */
export function placePlies<P extends Ply>(
  plies: DrawnPly<P>[],
  { height, minBar, midplane }: { height: number; minBar: number; midplane: number | null },
): { bars: PlacedPly<P>[]; total: number; midY: number | null } {
  const thickness = plies.reduce((s, p) => s + Math.max(p.layer.thickness, 1e-9), 0);
  const scale = height / thickness;
  const bars: PlacedPly<P>[] = [];
  let y = 0;
  let midY: number | null = null;
  for (const ply of plies) {
    const h = Math.max(minBar, ply.layer.thickness * scale);
    if (midplane !== null) {
      if (ply.index === Math.ceil(midplane) && Number.isInteger(midplane)) midY = y;
      if (!Number.isInteger(midplane) && ply.index === Math.floor(midplane)) midY = y + h / 2;
    }
    bars.push({ ...ply, y, height: h });
    y += h;
  }
  return { bars, total: y, midY };
}

/** Where the midplane is, counted in drawn plies: an integer n means between
 *  ply n-1 and ply n, a half means through the middle of a ply. Null when the
 *  drawing does not show both halves. */
export function midplaneIndex(storedCount: number, symmetric: boolean, withMiddleLayer: boolean, showMirror: boolean) {
  if (!symmetric || !showMirror || storedCount === 0) return null;
  return withMiddleLayer ? storedCount - 0.5 : storedCount;
}

/** A colour per angle. The four angles nearly every stack is made of get
 *  their own, fixed, so 45° is the same colour in every laminate; the rest
 *  share one colour per sign rather than cycling through the palette, where
 *  30° and 60° would look as different as 0° and 90° do. */
export function angleColor(angle: number): string {
  if (angle === 0) return "var(--viz-series-1)";
  if (Math.abs(angle) === 90) return "var(--viz-series-6)";
  if (angle === 45) return "var(--viz-series-3)";
  if (angle === -45) return "var(--viz-series-2)";
  return angle > 0 ? "var(--viz-series-8)" : "var(--viz-series-5)";
}

// Material identity -> fixed categorical slot (never re-assigned by current
// filter state; index in the materials catalog is stable per session).
const SLOT_VARS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-5)",
  "var(--viz-series-6)",
  "var(--viz-series-8)",
];

/** The colour of a material, by its place in the catalogue. */
export function materialColor(materials: { id: string }[], materialId: string): string {
  const index = Math.max(0, materials.findIndex((m) => m.id === materialId));
  return SLOT_VARS[index % SLOT_VARS.length];
}
