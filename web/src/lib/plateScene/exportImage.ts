// The view as a PNG (FR-13).
//
// Everything the reader can see beside the body goes into the file: the colour
// bar with its labels, the two exaggeration factors, the plate's size. A
// screenshot of the canvas alone would be a solid-looking body at invented
// proportions on an unnamed scale - which is precisely what the caption under
// the view exists to prevent, and exporting without it would undo that.
//
// The picture is redrawn at the requested resolution rather than scaled up
// afterwards: doubling a 340-pixel canvas gives a 680-pixel blur, while
// redrawing gives twice the geometry. The GL context is asked for the larger
// buffer, drawn once, read back, and left for the next frame to restore - the
// scene sizes its buffer from the element on every ordinary render.

import type { PlateScene } from "./scene";
import { sampleColormap } from "./colormap";

export interface PlateImageLegend {
  title: string;
  /** Bottom to top, matching the bar. */
  ticks: { t: number; text: string }[];
  /** The 256-entry table the shader samples, so both agree by construction. */
  table: Uint8Array;
  /** Where the quantity's neutral value sits, 0..1, or null. */
  anchor: number | null;
  /** What the data itself reaches, which the scale need not cover. */
  range: string;
}

export interface PlateImageStyle {
  background: string;
  ink: string;
  muted: string;
  border: string;
}

export interface PlateImageRequest {
  canvas: HTMLCanvasElement;
  scene: PlateScene;
  /** 1 for the size on screen, 2 for twice it. */
  scale: 1 | 2;
  legend: PlateImageLegend | null;
  /** Lines written into the bottom-left corner of the picture. */
  captions: string[];
  style: PlateImageStyle;
}

const LEGEND_WIDTH = 132;
const BAR_WIDTH = 16;
const PADDING = 12;

/**
 * Renders the view and its legend into a PNG.
 *
 * Returns null when the browser will not give a 2D context or a blob - the
 * caller then has nothing to offer, which is a better answer than a file with
 * half the picture in it.
 */
export async function plateImageBlob(request: PlateImageRequest): Promise<Blob | null> {
  const { canvas, scene, scale, legend, captions, style } = request;
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));

  scene.renderAt(width, height);

  const sheet = document.createElement("canvas");
  sheet.width = width + (legend ? LEGEND_WIDTH * scale : 0);
  sheet.height = height;
  const context = sheet.getContext("2d");
  if (!context) return null;

  context.fillStyle = style.background;
  context.fillRect(0, 0, sheet.width, sheet.height);
  // The GL canvas is composited over CSS on screen, so its own background is
  // transparent; the fill above is what stands in for that here.
  context.drawImage(canvas, 0, 0, width, height);

  for (const [index, line] of captions.entries()) {
    context.fillStyle = style.muted;
    context.font = `${11 * scale}px system-ui, sans-serif`;
    context.textBaseline = "bottom";
    context.fillText(line, PADDING * scale, height - (PADDING + index * 15) * scale);
  }

  if (legend) drawLegend(context, legend, width, height, scale, style);

  // The scene's own next frame puts the drawing buffer back to the size the
  // element is shown at, so nothing has to be restored here.
  return new Promise((resolve) => sheet.toBlob((blob) => resolve(blob), "image/png"));
}

function drawLegend(
  context: CanvasRenderingContext2D,
  legend: PlateImageLegend,
  imageWidth: number,
  imageHeight: number,
  scale: number,
  style: PlateImageStyle,
) {
  const left = imageWidth + PADDING * scale;
  const top = (PADDING + 18) * scale;
  const bottom = imageHeight - (PADDING + 20) * scale;
  const barWidth = BAR_WIDTH * scale;
  const barHeight = bottom - top;

  context.fillStyle = style.ink;
  context.font = `${12 * scale}px system-ui, sans-serif`;
  context.textBaseline = "top";
  context.fillText(legend.title, left, PADDING * scale, LEGEND_WIDTH * scale - PADDING * scale);

  // One filled row per pixel of the bar, straight out of the same table the
  // shader samples - no second interpolation to disagree with the first.
  const stops = legend.table.length / 4;
  for (let y = 0; y < barHeight; y++) {
    const t = 1 - y / Math.max(1, barHeight - 1);
    const [r, g, b] = sampleColormap(legend.table, t);
    context.fillStyle = `rgb(${r} ${g} ${b})`;
    context.fillRect(left, top + y, barWidth, 1);
  }
  if (stops === 0) return;

  context.strokeStyle = style.border;
  context.lineWidth = Math.max(1, scale);
  context.strokeRect(left, top, barWidth, barHeight);

  if (legend.anchor !== null) {
    const y = top + (1 - legend.anchor) * barHeight;
    context.strokeStyle = style.ink;
    context.beginPath();
    context.moveTo(left - 3 * scale, y);
    context.lineTo(left + barWidth + 3 * scale, y);
    context.stroke();
  }

  context.fillStyle = style.muted;
  context.font = `${11 * scale}px system-ui, sans-serif`;
  context.textBaseline = "middle";
  for (const tick of legend.ticks) {
    context.fillText(tick.text, left + barWidth + 6 * scale, top + (1 - tick.t) * barHeight);
  }

  context.textBaseline = "bottom";
  context.fillText(legend.range, left, imageHeight - PADDING * scale);
}

/** Hands the blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next task rather than immediately: Safari has not started
  // reading the blob by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
