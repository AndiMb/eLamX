// Saving a chart as a picture, which eLamX offers on every view it draws
// (`SnapshotService`, and the camera button in each window's toolbar).
//
// Two kinds of chart live here and each needs a different route. A canvas view
// already IS a bitmap, so it only has to be handed over. An SVG chart is a
// document that borrows its appearance from the page's stylesheet - serialise
// it as it stands and the file comes out black on transparent, because a
// standalone SVG has never heard of `.chart-axis`. So the styles that decide
// how it looks are copied onto the clone, element by element, before it is
// drawn.
//
// The picture is rendered at twice the on-screen size. A chart ends up in a
// report or a slide, where a 680-pixel PNG of a 680-pixel chart is exactly one
// device pixel per CSS pixel and looks soft on every display made since 2012.

import { saveFile } from "./saveFile";
import { darkToLight } from "./chartColors";

/** Rendered at this multiple of the on-screen size. */
export const SNAPSHOT_SCALE = 2;

/**
 * The properties that carry a chart's appearance.
 *
 * Deliberately short: every property copied is one more chance to freeze
 * something that should have stayed fluid, and these six are what the
 * stylesheet actually sets on chart elements.
 */
const STYLE_PROPERTIES = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "opacity",
  "font-size",
  "font-weight",
  "font-family",
  "text-anchor",
] as const;

function inlineStyles(source: Element, clone: Element) {
  const computed = window.getComputedStyle(source);
  const declarations = STYLE_PROPERTIES.map((name) => `${name}:${computed.getPropertyValue(name)}`);
  const existing = clone.getAttribute("style");
  clone.setAttribute("style", `${existing ? `${existing};` : ""}${declarations.join(";")}`);

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < sourceChildren.length; i++) {
    inlineStyles(sourceChildren[i], cloneChildren[i]);
  }
}

/** What a picture is painted on and written with: always the light theme's
 *  paper and ink (N9). A chart goes into a report or onto a slide, and a
 *  dark screen is a setting of the screen, not of the chart. */
const PAPER = "#ffffff";
const INK = "#0e131b";

/**
 * Runs `read` while the element wears the light theme.
 *
 * The chart's colours are custom properties the dark theme redefines, and
 * what the serializer copies is their computed value. The class swaps in the
 * light values for exactly as long as the styles are read: the page is not
 * repainted in between, so nothing on screen flickers.
 */
export function inLightTheme<T>(element: Element, read: () => T): T {
  element.classList.add("export-light");
  try {
    return read();
  } finally {
    element.classList.remove("export-light");
  }
}

/**
 * The chart as a standalone SVG document: a clone with the stylesheet's work
 * written into it, and a size in pixels rather than a percentage.
 *
 * Separate from the drawing because this is the part that can fail silently -
 * a missing style gives a black chart on a white page, which looks like a
 * rendering bug rather than a missing declaration - and it is the part that can
 * be tested without a rasteriser.
 */
export function chartToStandaloneSvg(svg: SVGSVGElement): {
  source: string;
  width: number;
  height: number;
} {
  const rect = svg.getBoundingClientRect();
  // A chart that has not been laid out yet (a test, a hidden tab) still has its
  // viewBox, which is the size it was drawn for.
  const viewBox = svg.viewBox.baseVal;
  const width = Math.max(1, Math.round(rect.width || viewBox.width));
  const height = Math.max(1, Math.round(rect.height || viewBox.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inLightTheme(svg, () => inlineStyles(svg, clone));
  clone.classList.remove("export-light");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Colours the JS palette wrote as attributes do not follow the class; the
  // dark palette's are swapped for their light counterparts by value.
  let source = new XMLSerializer().serializeToString(clone);
  for (const [dark, light] of darkToLight()) source = source.replaceAll(dark, light);
  return { source, width, height };
}

/** Gap between the parts of a chart drawn as several SVGs, in pixels. */
const PART_GAP = 12;

/**
 * A chart as one standalone SVG, whatever it is drawn as: an SVG element, or
 * an element holding several - the through-thickness sheet draws one SVG per
 * column. The parts are placed side by side, each as a nested SVG at the size
 * it has on screen.
 */
export function standaloneSvgOf(target: Element): { source: string; width: number; height: number } {
  if (target instanceof SVGSVGElement) return chartToStandaloneSvg(target);
  const parts = Array.from(target.querySelectorAll<SVGSVGElement>("svg.chart-svg")).filter(
    (svg) => !svg.parentElement?.closest("svg"),
  );
  const standalone = parts.map((svg) => chartToStandaloneSvg(svg));
  let x = 0;
  const nested = standalone.map((part) => {
    const at = x;
    x += part.width + PART_GAP;
    return part.source.replace(/^<svg /, `<svg x="${at}" y="0" `);
  });
  const width = Math.max(1, x - PART_GAP);
  const height = Math.max(1, ...standalone.map((p) => p.height));
  return {
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `${nested.join("")}</svg>`,
    width,
    height,
  };
}

/** Height of the title band, in CSS pixels before scaling. */
const TITLE_BAND = 26;

/** An SVG chart as a PNG blob, at `SNAPSHOT_SCALE` times its on-screen size.
 *
 *  The title is drawn into the picture rather than left behind, because a
 *  chart in a report without its caption is a shape with no subject - the
 *  plate exporter next door makes the same argument about its colour bar. */
export async function svgToPngBlob(svg: Element, title?: string): Promise<Blob | null> {
  const { source, width, height } = standaloneSvgOf(svg);
  // A data URL rather than a blob URL: a blob URL taints the canvas in some
  // browsers, and a tainted canvas cannot be read back.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  const image = new Image();
  image.width = width;
  image.height = height;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("SVG konnte nicht gezeichnet werden"));
    image.src = url;
  });

  const band = title ? TITLE_BAND : 0;
  const canvas = document.createElement("canvas");
  canvas.width = width * SNAPSHOT_SCALE;
  canvas.height = (height + band) * SNAPSHOT_SCALE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (title) {
    context.fillStyle = INK;
    context.textBaseline = "middle";
    // Shrunk to fit rather than clipped: a caption cut off mid-word is worse
    // than a small one, and a chart title is short enough that two points of
    // font size buy the whole sentence.
    const margin = 8 * SNAPSHOT_SCALE;
    const available = canvas.width - 2 * margin;
    let size = 13 * SNAPSHOT_SCALE;
    context.font = `600 ${size}px system-ui, sans-serif`;
    while (context.measureText(title).width > available && size > 8 * SNAPSHOT_SCALE) {
      size -= SNAPSHOT_SCALE / 2;
      context.font = `600 ${size}px system-ui, sans-serif`;
    }
    context.fillText(title, margin, (band / 2) * SNAPSHOT_SCALE, available);
  }
  context.drawImage(
    image,
    0,
    band * SNAPSHOT_SCALE,
    width * SNAPSHOT_SCALE,
    height * SNAPSHOT_SCALE,
  );

  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** A canvas view as a PNG blob. It is already a bitmap; nothing is redrawn,
 *  so what is saved is exactly what is on screen. */
export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Saves either kind, under a name ending in `.png`. */
export async function saveChartPng(
  target: Element,
  name: string,
  title?: string,
): Promise<void> {
  const blob =
    target instanceof HTMLCanvasElement
      ? await canvasToPngBlob(target)
      : await svgToPngBlob(target, title);
  if (!blob) return;
  await saveFile(blob, name.endsWith(".png") ? name : `${name}.png`);
}

/** Saves an SVG chart as an SVG file: a vector drawing that opens in a
 *  browser, Inkscape or a word processor at any size. */
export async function saveChartSvg(svg: Element, name: string): Promise<void> {
  const { source } = standaloneSvgOf(svg);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], { type: "image/svg+xml" });
  await saveFile(blob, name.endsWith(".svg") ? name : `${name}.svg`, ["svg"]);
}
