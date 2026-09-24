// The buckled plate drawn on a 2D canvas: the picture BucklingPlate3D shows,
// as a function of its inputs and a camera rather than of a component's state,
// so the report can draw the same picture off screen (P3.6).
//
// A painter's algorithm rather than WebGL: the scene is one single-valued
// height field, so sorting quads by depth is exact, and it needs neither a 3D
// library in the bundle nor a WebGL context - which is why it is also the view
// a machine without WebGL gets.
//
// Colour is the app's diverging scale, not the Java version's rainbow. The
// sign of the deflection is the meaningful quantity and zero is a real neutral
// point, which is exactly what a diverging scale encodes; a rainbow ramp
// invents boundaries where the data has none.

import { project, type Camera } from "../plate3d";
import type { ChartColors } from "../chartColors";

export interface HeightFieldDrawing {
  /** Deflection normalised to a peak of 1, rows along y, columns along x. */
  surface: number[][];
  length: number;
  width: number;
  /** Peak deflection as a fraction of the plate's shorter edge. */
  zScale: number;
  camera: Camera;
  colors: ChartColors;
  /** Colour of the undeformed outline - the canvas's own ink. */
  ink: string;
}

interface Quad {
  points: { x: number; y: number }[];
  depth: number;
  fill: string;
}

function lerpChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function lerpColor(hexA: string, hexB: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = pa.map((ca, i) => lerpChannel(ca, pb[i], t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Draws the plate into `ctx`, filling a `cssW` x `cssH` area whose backing
 * store is `pixelRatio` times larger. The canvas is cleared first.
 */
export function drawHeightField(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  pixelRatio: number,
  drawing: HeightFieldDrawing,
) {
  const { surface, length, width, zScale, camera, colors, ink } = drawing;
  if (surface.length < 2) return;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const rows = surface.length;
  const cols = surface[0].length;
  const centre = { x: length / 2, y: width / 2 };
  // Deflection is normalised to a peak of 1, so this maps it onto a
  // physical height the plate's own size makes sense against.
  const amplitude = Math.min(length, width) * zScale;

  // Fit: project the eight corners of the bounding box and scale to fill.
  const probe: { x: number; y: number }[] = [];
  for (const px of [0, length]) {
    for (const py of [0, width]) {
      for (const pz of [-amplitude, amplitude]) {
        probe.push(project(px, py, pz, { ...camera, zoom: 1 }, centre));
      }
    }
  }
  const spanX = Math.max(...probe.map((p) => Math.abs(p.x))) * 2 || 1;
  const spanY = Math.max(...probe.map((p) => Math.abs(p.y))) * 2 || 1;
  const fit = Math.min(cssW / spanX, cssH / spanY) * 0.88;
  const cam: Camera = { ...camera, zoom: fit * camera.zoom };
  const ox = cssW / 2;
  const oy = cssH / 2;

  const { neg, mid, pos } = colors.diverging;
  const colorFor = (v: number) => {
    const c = Math.max(-1, Math.min(1, v));
    return c >= 0 ? lerpColor(mid, pos, c) : lerpColor(mid, neg, -c);
  };

  const quads: Quad[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const corners = [
        [r, c],
        [r, c + 1],
        [r + 1, c + 1],
        [r + 1, c],
      ] as const;
      let depth = 0;
      let mean = 0;
      const points = corners.map(([rr, cc]) => {
        const x = (cc / (cols - 1)) * length;
        const y = (rr / (rows - 1)) * width;
        const z = surface[rr][cc] * amplitude;
        mean += surface[rr][cc];
        const p = project(x, y, z, cam, centre);
        depth += p.depth;
        return { x: p.x + ox, y: p.y + oy };
      });
      quads.push({ points, depth: depth / 4, fill: colorFor(mean / 4) });
    }
  }

  // Painter's algorithm: farthest first.
  quads.sort((a, b) => b.depth - a.depth);
  for (const q of quads) {
    ctx.beginPath();
    ctx.moveTo(q.points[0].x, q.points[0].y);
    for (let i = 1; i < q.points.length; i++) ctx.lineTo(q.points[i].x, q.points[i].y);
    ctx.closePath();
    ctx.fillStyle = q.fill;
    ctx.fill();
    // Stroke in the fill colour: without it, antialiasing leaves hairline
    // seams between neighbouring quads.
    ctx.strokeStyle = q.fill;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // Outline of the undeformed plate, so the deflection has a reference.
  ctx.beginPath();
  const outline = [
    [0, 0],
    [length, 0],
    [length, width],
    [0, width],
  ] as const;
  outline.forEach(([px, py], i) => {
    const p = project(px, py, 0, cam, centre);
    if (i === 0) ctx.moveTo(p.x + ox, p.y + oy);
    else ctx.lineTo(p.x + ox, p.y + oy);
  });
  ctx.closePath();
  ctx.strokeStyle = ink;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
