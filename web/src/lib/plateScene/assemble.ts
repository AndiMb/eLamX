// From what a plate view is asked to show to what the scene is handed.
//
// Shared by the view on screen (PlateView3D, which memoises each step on its
// own inputs) and the report's picture drawn off screen (offscreen.ts, which
// runs them once). Two callers of the same steps is the point: the report's
// figure is the screen's view, not a second drawing of it that could drift.

import type { BoundaryConditionId, NamedLoadDto, StiffenerDto } from "../types";
import type { ChartColors } from "../chartColors";
import { EMPTY_MESH } from "./annotation";
import { buildColormap, rgbaOf, type ColormapKind } from "./colormap";
import type { PlateImageLegend } from "./exportImage";
import type { PlateFrame } from "./frame";
import { edgeFlowArrows, loadMesh, NO_LOADS, transverseLoadArrows, type HeightAt, type LoadAnnotation } from "./loads";
import { autoDeflectionScale, autoThicknessScale, peakOf } from "./scale";
import type { PlateAnnotation, PlateSceneStyle } from "./scene";
import { stiffenerMesh, stiffenerRibbons } from "./stiffeners";
import { supportEdges, supportMesh } from "./supports";

/** What is pushing on the plate: the two modules load it differently. */
export type PlateViewLoad =
  | { kind: "transverse"; loads: readonly NamedLoadDto[] }
  | { kind: "inPlane"; nx: number; ny: number; nxy: number };

/** How much the drawing exaggerates the deflection and the thickness. */
export function plateScales(
  surface: number[][],
  length: number,
  width: number,
  thickness: number,
  deflectionFraction: number,
): { deflection: number; thickness: number } {
  const peak = peakOf(surface);
  return {
    deflection: autoDeflectionScale(peak, length, width, deflectionFraction),
    thickness: autoThicknessScale(thickness, length, width),
  };
}

/** The load arrows, kept as arrows rather than only as triangles because
 *  their captions are anchored to the same points the heads sit on. */
export function plateLoadArrows(load: PlateViewLoad | undefined, frame: PlateFrame, sampler: HeightAt): LoadAnnotation {
  if (!load) return NO_LOADS;
  if (load.kind === "inPlane") return edgeFlowArrows(load.nx, load.ny, load.nxy, frame);
  return transverseLoadArrows(load.loads, frame, sampler);
}

export function plateAnnotation(
  frame: PlateFrame,
  sampler: HeightAt,
  loadArrows: LoadAnnotation,
  bcX: BoundaryConditionId | undefined,
  bcY: BoundaryConditionId | undefined,
  stiffeners: readonly StiffenerDto[] | undefined,
): PlateAnnotation {
  return {
    supports: bcX && bcY ? supportMesh(supportEdges(bcX, bcY, frame), frame) : EMPTY_MESH,
    loads: loadMesh(loadArrows),
    stiffeners: stiffeners?.length ? stiffenerMesh(stiffenerRibbons(stiffeners, frame, sampler)) : EMPTY_MESH,
  };
}

/**
 * The line colours: `ink` for the plies and the outline, so one token decides
 * what "ink" means in either theme. The annotation is the exception: it must
 * not be readable as a value on the colour scale, so it takes roles of its own.
 */
export function plateSceneStyle(colors: ChartColors, ink: [number, number, number]): PlateSceneStyle {
  return {
    plyLines: [ink[0], ink[1], ink[2], 0.5],
    outline: [ink[0], ink[1], ink[2], 0.35],
    supports: rgbaOf(colors.annotation.support),
    loads: rgbaOf(colors.annotation.load),
    stiffeners: rgbaOf(colors.annotation.stiffener),
    hole: [ink[0], ink[1], ink[2], 1],
  };
}

/** A colour bar as data - the part of PlateLegendModel a picture needs. */
export interface PlateLegendSpec {
  title: string;
  unit: string | null;
  /** Bottom to top, matching the bar. */
  ticks: { t: number; text: string }[];
  anchor: number | null;
  range: string;
  kind: ColormapKind;
}

/** The legend as the exported picture draws it. */
export function plateImageLegend(legend: PlateLegendSpec, colors: ChartColors): PlateImageLegend {
  return {
    title: legend.unit ? `${legend.title} [${legend.unit}]` : legend.title,
    ticks: legend.ticks,
    table: buildColormap(colors, legend.kind),
    anchor: legend.anchor,
    range: legend.range,
  };
}

/** `rgb(r, g, b)` or `rgba(...)` to three 0..1 channels. */
export function parseCssColor(value: string): [number, number, number] {
  const parts = value.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return [0.5, 0.5, 0.5];
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
}

/** Peak-normalised copy, which is what the 2D view expects. */
export function normalisedSurface(surface: number[][]): number[][] {
  const peak = peakOf(surface);
  if (peak === 0) return surface;
  return surface.map((row) => row.map((value) => value / peak));
}
