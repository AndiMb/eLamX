// The report's canvas figures: the plate views and the failure body, drawn
// off screen as PNG (P3.6, design §5.2).
//
// Fixed size and camera - the views' own defaults - so a report does not
// depend on how someone last turned a view, and the light palette with the
// light theme's ink, since paper is always light (N9). The plate is drawn by
// the WebGL scene the module shows; a browser without WebGL gets the 2D view
// the module falls back to as well, and the caption says so. Only when not
// even a 2D canvas is to be had is there no picture - the caller then says
// that in words rather than leaving a gap.

import { LIGHT_CHART_COLORS } from "../chartColors";
import { DEFAULT_CAMERA } from "../plate3d";
import { drawHeightField } from "../canvas3d/heightField";
import { drawFailureBody } from "../canvas3d/failureBody";
import { normalisedSurface, plateImageLegend, plateScales } from "../plateScene/assemble";
import { canvasBlob, composePlateImage, type PlateImageStyle } from "../plateScene/exportImage";
import { renderPlateImage } from "../plateScene/offscreen";
import { formatSignificant } from "../numberFormat";
import type { Locale } from "../../i18n";
import type { Translate } from "../tables";
import type { FigureRequest, PngFigure } from "./model";

/** The width every bitmap comes out at: 200 mm at 300 dpi, near enough. */
export const BITMAP_WIDTH = 2400;

/** The plate view's size in CSS pixels - the proportions of the module's
 *  view on a desktop, which is what the camera's default was chosen for. */
const PLATE_VIEW = { width: 600, height: 380 };
/** Width of the colour bar beside it, as exportImage draws it. */
const LEGEND_WIDTH = 132;
const FAILURE_BODY_VIEW = { width: 600, height: 440 };

export type BitmapRequest = Extract<FigureRequest, { kind: "plate" | "failureBody" }>;

export function isBitmapRequest(request: FigureRequest): request is BitmapRequest {
  return request.kind === "plate" || request.kind === "failureBody";
}

export interface DrawnBitmap {
  png: PngFigure;
  /** Drawn by the 2D view because the browser has no WebGL. */
  flat: boolean;
}

/** The light theme's ink, read off the same tokens the views use on screen. */
function lightStyle(): PlateImageStyle {
  const host = document.createElement("div");
  host.className = "report-figure-host export-light viz";
  host.style.cssText = "position:absolute;left:-10000px;top:0";
  const view = document.createElement("div");
  view.className = "plate3d";
  host.appendChild(view);
  document.body.appendChild(host);
  try {
    const ink = getComputedStyle(view).color || "#0e131b";
    return { background: "#ffffff", ink, muted: ink, border: ink };
  } finally {
    host.remove();
  }
}

async function pngOf(blob: Blob | null, width: number, height: number): Promise<PngFigure | null> {
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** A 2D canvas of the given CSS size at `scale` device pixels per CSS pixel. */
function canvas2d(size: { width: number; height: number }, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

async function drawPlate(
  request: Extract<BitmapRequest, { kind: "plate" }>,
  t: Translate,
  locale: Locale,
): Promise<DrawnBitmap | null> {
  const { plate } = request;
  const style = lightStyle();
  const colors = LIGHT_CHART_COLORS;
  const legend = plateImageLegend(request.legend, colors);
  const scale = BITMAP_WIDTH / (PLATE_VIEW.width + LEGEND_WIDTH);
  const width = Math.round(PLATE_VIEW.width * scale);
  const height = Math.round(PLATE_VIEW.height * scale);
  const scales = plateScales(plate.surface, plate.length, plate.width, plate.thickness, plate.deflectionFraction);
  const size = t("plate3d.export.size", { length: plate.length, width: plate.width });

  const blob = await renderPlateImage(plate, {
    colors,
    style,
    legend,
    captions: [
      t("plate3d.scales", {
        deflection: formatSignificant(scales.deflection, 3, locale),
        thickness: formatSignificant(scales.thickness, 3, locale),
      }),
      size,
    ],
    size: PLATE_VIEW,
    scale,
  });
  if (blob) {
    const png = await pngOf(blob, width + Math.round(LEGEND_WIDTH * scale), height);
    return png ? { png, flat: false } : null;
  }

  // No WebGL: the view the module shows then, a height field without the ply
  // stack, the supports or the loads.
  const target = canvas2d(PLATE_VIEW, scale);
  if (!target) return null;
  drawHeightField(target.ctx, PLATE_VIEW.width, PLATE_VIEW.height, scale, {
    surface: normalisedSurface(plate.surface),
    length: plate.length,
    width: plate.width,
    zScale: plate.deflectionFraction,
    camera: DEFAULT_CAMERA,
    colors,
    ink: style.ink,
  });
  const sheet = composePlateImage(target.canvas, width, height, { scale, legend, captions: [size], style });
  const png = sheet ? await pngOf(await canvasBlob(sheet), sheet.width, sheet.height) : null;
  return png ? { png, flat: true } : null;
}

async function drawBody(request: Extract<BitmapRequest, { kind: "failureBody" }>): Promise<DrawnBitmap | null> {
  const style = lightStyle();
  const scale = BITMAP_WIDTH / FAILURE_BODY_VIEW.width;
  const target = canvas2d(FAILURE_BODY_VIEW, scale);
  if (!target) return null;
  drawFailureBody(target.ctx, FAILURE_BODY_VIEW.width, FAILURE_BODY_VIEW.height, scale, {
    bodies: request.bodies,
    markers: request.markers,
    axisLabels: ["σ∥", "σ⊥", "τ"],
    camera: DEFAULT_CAMERA,
    colors: LIGHT_CHART_COLORS,
    ink: style.ink,
    background: style.background,
  });
  const { width, height } = target.canvas;
  const sheet = composePlateImage(target.canvas, width, height, { scale, legend: null, captions: [], style });
  const png = sheet ? await pngOf(await canvasBlob(sheet), width, height) : null;
  return png ? { png, flat: false } : null;
}

/** Draws one canvas figure, or returns null when nothing could draw it. */
export async function drawBitmap(request: BitmapRequest, t: Translate, locale: Locale): Promise<DrawnBitmap | null> {
  try {
    return request.kind === "plate" ? await drawPlate(request, t, locale) : await drawBody(request);
  } catch {
    // A driver that fails half-way through a draw is not a reason to lose
    // the report; the figure is then missing, and says so.
    return null;
  }
}
