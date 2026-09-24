// A failure body on a 2D canvas: the picture FailureBody3D shows, as a
// function of its inputs and a camera rather than of a component's state, so
// the report can draw the same picture off screen (P3.6).
//
// A painter's algorithm, like the buckling plate and for the same reasons. It
// is exact here too: the body is star-shaped about the origin by construction
// (every sample is a ray scaled by its reserve factor), so sorting quads by
// depth cannot produce a wrong overlap.

import { project, type Camera } from "../plate3d";
import type { ChartColors } from "../chartColors";
import { CHART_FS_LABEL, CHART_FS_TICK, chartFont } from "../chartType";

export interface StressMarker {
  /** Local stress state [sigma_par, sigma_nor, tau]. */
  stress: [number, number, number];
  /** Reserve factor there - decides the colour, and whether it is outside. */
  reserveFactor: number;
  label: string;
  /** Where the ray from the origin through the state meets the surface, when
   *  known: drawn as a ring with its own label, the ray running on to it. */
  hull?: { point: [number, number, number]; label: string };
}

/** One criterion's surface, as it is drawn. */
export interface FailureBodySurface {
  key: string;
  /**
   * Surface grid from the core; null entries are directions it could not
   * evaluate. Either this or `quads` - a body computed here arrives as a grid,
   * an imported one as a bare list of faces with no grid to speak of.
   */
  points?: ([number, number, number] | null)[][];
  /** Faces of four corners, for a surface that is not a grid. */
  quads?: [number, number, number][][];
  /** Wireframe colour when this body is not the solid one. */
  color?: string;
  /**
   * A base colour per grid cell, same layout as `points`, for a surface whose
   * patches mean different things - the laminate body colours each direction
   * by the ply that governs there, which is the whole reading: it says WHICH
   * ply limits the laminate, and not only by how much.
   *
   * Only the solid body uses it; a wireframe is one colour by definition.
   */
  cellColors?: (string | null)[][];
}

interface Quad {
  points: { x: number; y: number }[];
  depth: number;
  fill: string;
}

// Lambert shading against a fixed headlight: the body's shape is the message,
// and a single hue with real shading reads as a solid object where a colour
// ramp would look like data varying over the surface.
const LIGHT: [number, number, number] = [0.35, 0.45, 0.82];

function shade(rgb: [number, number, number], intensity: number): string {
  const c = rgb.map((v) => Math.round(v * intensity));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** A body's faces, whichever way it arrived. A grid cell with a missing
 *  corner simply has no face - that is what a hole in the surface is. */
function facesOf(body: FailureBodySurface): {
  corners: [number, number, number][];
  row: number;
  col: number;
}[] {
  if (body.quads) {
    return body.quads.map((corners) => ({ corners, row: 0, col: 0 }));
  }
  const grid = body.points ?? [];
  const faces: { corners: [number, number, number][]; row: number; col: number }[] = [];
  for (let r = 0; r + 1 < grid.length; r++) {
    for (let c = 0; c + 1 < grid[r].length; c++) {
      const corners = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]];
      if (corners.some((p) => !p)) continue;
      faces.push({ corners: corners as [number, number, number][], row: r, col: c });
    }
  }
  return faces;
}

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * How the three stress axes are scaled against each other.
 *
 * `true`: one scale for all three, so the picture has the material's real
 * proportions - a UD ply is a long flat body along the fibres, because only
 * the fibres carry. `stretched`: each axis normalised to the body's own
 * extent along it, which turns every body into something cube-like; that
 * throws the proportions away but spreads out the transverse and shear
 * region, where a ply's stress state usually sits.
 */
export type FailureBodyAxisScale = "true" | "stretched";

/**
 * An axis name, with `n_xy` written as n with xy set low and small - the
 * notation the rest of the app uses, where a canvas has no <sub>.
 */
function fillLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  { halo, align = "left" }: { halo: string; align?: "left" | "right" | "center" },
) {
  const [base, sub] = label.split("_", 2);
  const baseFont = chartFont(CHART_FS_LABEL);
  const subFont = chartFont(CHART_FS_TICK - 2);
  ctx.font = baseFont;
  const baseWidth = ctx.measureText(base).width;
  ctx.font = subFont;
  const subWidth = sub ? ctx.measureText(sub).width + 0.5 : 0;
  const width = baseWidth + subWidth;
  const left = align === "left" ? x : align === "right" ? x - width : x - width / 2;
  // A halo in the canvas's own background, so a name that ends up over the
  // body - a stretched body reaches into every corner of its box - stays
  // readable instead of disappearing into the shading.
  const draw = (text: string, font: string, at: number, dy: number) => {
    ctx.font = font;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeText(text, at, y + dy);
    ctx.restore();
    ctx.fillText(text, at, y + dy);
  };
  ctx.textAlign = "left";
  draw(base, baseFont, left, 0);
  if (sub) draw(sub, subFont, left + baseWidth + 0.5, 3);
  ctx.font = baseFont;
}

export interface FailureBodyDrawing {
  /** The first is drawn solid and shaded, every further one as a wireframe -
   *  see FailureBody3D for why. */
  bodies: FailureBodySurface[];
  markers: StressMarker[];
  axisLabels: [string, string, string];
  camera: Camera;
  colors: ChartColors;
  /** Axes, labels and wireframes without a colour of their own. */
  ink: string;
  /** Ring around a marker dot that holds, to lift it off the body. */
  background: string;
  /** Default `true` - see FailureBodyAxisScale. */
  axisScale?: FailureBodyAxisScale;
}

/**
 * Draws the bodies into `ctx`, filling a `cssW` x `cssH` area whose backing
 * store is `pixelRatio` times larger. The canvas is cleared first; nothing is
 * drawn when the first body has no faces.
 */
export function drawFailureBody(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  pixelRatio: number,
  drawing: FailureBodyDrawing,
) {
  const { bodies, markers, axisLabels, camera, colors, ink, background, axisScale = "true" } = drawing;
  const solid = bodies[0];
  if (!solid) return;
  const solidFaces = facesOf(solid);
  if (solidFaces.length === 0) return;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // The extent of the bodies along each axis. Over ALL bodies, not just the
  // solid one: two criteria can only be compared if they are drawn in the
  // same space.
  let spanPar = 0;
  let spanNor = 0;
  let spanShear = 0;
  for (const body of bodies) {
    for (const face of facesOf(body)) {
      for (const p of face.corners) {
        spanPar = Math.max(spanPar, Math.abs(p[0]));
        spanNor = Math.max(spanNor, Math.abs(p[1]));
        spanShear = Math.max(spanShear, Math.abs(p[2]));
      }
    }
  }
  // Deliberately NOT stretched to include the markers: a failed ply sits far
  // outside the body, and letting it set the scale would squash the body
  // itself into a sliver. The markers may leave the unit cube - that they do
  // is the finding - and the fit below still keeps them in frame.
  //
  // At true scale every axis is divided by the largest extent, so the body
  // keeps its proportions and the longest direction spans the unit cube;
  // stretched, each is divided by its own (see FailureBodyAxisScale).
  const spanMax = Math.max(spanPar, spanNor, spanShear) || 1;
  const divisor: [number, number, number] =
    axisScale === "true" ? [spanMax, spanMax, spanMax] : [spanPar || 1, spanNor || 1, spanShear || 1];
  const norm = (p: readonly [number, number, number]) =>
    [p[0] / divisor[0], p[1] / divisor[1], p[2] / divisor[2]] as const;
  /** The body's box in the drawn space, which is what the frame is fitted to. */
  const extent = norm([spanPar || divisor[0], spanNor || divisor[1], spanShear || divisor[2]]);

  // Reach past the body so the labels sit clear of it rather than on top of
  // the surface. At true scale the short axes run on to a common length
  // instead of stopping just past a flat body, where their labels would pile
  // up at the origin.
  // Stretched, the body fills its box to the corners, which lie at up to
  // sqrt(3) along a diagonal - an axis stopping at 1.25 ended inside the
  // picture of the body, and its name with it. There it runs on to 1.6.
  const AXIS_REACH = axisScale === "true" ? 1.25 : 1.6;
  const reach = (span: number) => (axisScale === "true" ? Math.max(span * AXIS_REACH, spanMax * 0.75) : span * AXIS_REACH);
  const axes: { end: [number, number, number]; label: string }[] = [
    { end: [reach(spanPar), 0, 0], label: axisLabels[0] },
    { end: [0, reach(spanNor), 0], label: axisLabels[1] },
    { end: [0, 0, reach(spanShear)], label: axisLabels[2] },
  ];

  const centre = { x: 0, y: 0 };
  const probe: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const [px, py, pz] = [sx * extent[0], sy * extent[1], sz * extent[2]];
        probe.push(project(px, py, pz, { ...camera, zoom: 1 }, centre));
      }
    }
  }
  // ...but the frame does widen to hold them - up to a point. A load far
  // beyond the body (a laminate at RF 0.03 is 35 times outside it) would
  // otherwise shrink the body to a few pixels; past MARKER_WIDEN the frame
  // stays put and the marker is pinned to its edge, pointing outwards.
  const markerProbe: { x: number; y: number }[] = [];
  for (const m of markers) {
    for (const p of m.hull ? [m.stress, m.hull.point] : [m.stress]) {
      const n = norm(p);
      markerProbe.push(project(n[0], n[1], n[2], { ...camera, zoom: 1 }, centre));
    }
  }
  // And the axes with their names, which reach past the body: an axis that
  // leaves the canvas takes its label with it.
  for (const axis of axes) {
    for (const sign of [-1, 1]) {
      const n = norm([sign * axis.end[0], sign * axis.end[1], sign * axis.end[2]]);
      probe.push(project(n[0], n[1], n[2], { ...camera, zoom: 1 }, centre));
    }
  }
  const MARKER_WIDEN = 1.8;
  const reachOf = (points: { x: number; y: number }[], key: "x" | "y") =>
    Math.max(0, ...points.map((p) => Math.abs(p[key]))) * 2;
  const baseX = reachOf(probe, "x") || 1;
  const baseY = reachOf(probe, "y") || 1;
  const spanX = Math.min(Math.max(baseX, reachOf(markerProbe, "x")), baseX * MARKER_WIDEN);
  const spanY = Math.min(Math.max(baseY, reachOf(markerProbe, "y")), baseY * MARKER_WIDEN);
  // Short of the full frame by the width of an axis label.
  const fit = Math.min(cssW / spanX, cssH / spanY) * 0.88;
  const cam: Camera = { ...camera, zoom: fit * camera.zoom };
  const ox = cssW / 2;
  const oy = cssH / 2;

  const to2d = (p: readonly [number, number, number]) => {
    const n = norm(p);
    const q = project(n[0], n[1], n[2], cam, centre);
    return { x: q.x + ox, y: q.y + oy, depth: q.depth };
  };

  const base = parseHex(colors.surface);

  const quads: Quad[] = [];
  for (const face of solidFaces) {
    {
      const raw = face.corners;
      const { row: r, col: c } = face;

      // Flat normal in the NORMALISED space, so the shading follows what is
      // actually drawn rather than the physical aspect ratio.
      const a = norm(raw[0]);
      const b = norm(raw[1]);
      const d = norm(raw[3]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const lambert = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len);

      const projected = raw.map(to2d);
      const cell = solid.cellColors?.[r]?.[c];
      quads.push({
        points: projected.map((p) => ({ x: p.x, y: p.y })),
        depth: projected.reduce((s, p) => s + p.depth, 0) / 4,
        fill: shade(cell ? parseHex(cell) : base, 0.45 + 0.55 * lambert),
      });
    }
  }

  quads.sort((a, b) => b.depth - a.depth);
  for (const q of quads) {
    ctx.beginPath();
    ctx.moveTo(q.points[0].x, q.points[0].y);
    for (let i = 1; i < q.points.length; i++) ctx.lineTo(q.points[i].x, q.points[i].y);
    ctx.closePath();
    ctx.fillStyle = q.fill;
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.strokeStyle = q.fill;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // The further criteria, as wireframes over the solid one. Every fourth
  // grid line in each direction: the full grid is 60 x 30 and would read as
  // a shaded surface again, which is the one thing it must not do.
  const STRIDE = 4;
  for (const body of bodies.slice(1)) {
    ctx.save();
    ctx.strokeStyle = body.color ?? ink;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.9;
    const line = (path: (readonly [number, number, number] | null)[], close = false) => {
      ctx.beginPath();
      let open = false;
      for (const p of path) {
        if (!p) {
          open = false;
          continue;
        }
        const q = to2d(p);
        if (open) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
        open = true;
      }
      if (close) ctx.closePath();
      ctx.stroke();
    };

    const grid = body.points;
    if (grid) {
      // Grid lines, which read as a mesh over the solid body.
      for (let r = 0; r < grid.length; r += STRIDE) line(grid[r]);
      for (let c = 0; c < (grid[0]?.length ?? 0); c += STRIDE) line(grid.map((row) => row[c]));
    } else {
      // No grid to run lines along, so each face is outlined instead. Every
      // face and not every fourth: an imported surface is usually far
      // coarser than a computed one, and thinning it would leave gaps.
      for (const face of facesOf(body)) line(face.corners, true);
    }
    ctx.restore();
  }

  // Axes through the origin, drawn on top so the stress state can be read
  // against them even where the body hides them.
  const axisColor = ink;

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = axisColor;
  ctx.fillStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.font = chartFont(CHART_FS_LABEL);
  for (const axis of axes) {
    const from = to2d([-axis.end[0], -axis.end[1], -axis.end[2]]);
    const to = to2d(axis.end);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    // The line recedes, its name does not: a faded label is the one thing
    // on this picture nobody can read.
    ctx.globalAlpha = 1;
    // Beyond the end of the axis, in its direction on screen: to the left
    // of an axis that points left, above one that points up.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    ctx.textBaseline = "middle";
    fillLabel(ctx, axis.label, to.x + ux * 8, to.y + uy * 8, {
      halo: background,
      align: ux > 0.35 ? "left" : ux < -0.35 ? "right" : "center",
    });
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.55;
  }
  ctx.restore();

  // The ply's own stress state: a line from the origin (the load path) and a
  // dot at its end. Green inside the body, red outside - which is the same
  // statement as RF >= 1, drawn where it can be seen. The shape says it too
  // (N7): a filled dot inside, a cross outside.
  const EDGE = 16;
  /** Where the ray from `origin` to `p` leaves the drawable area, or `p`
   *  itself when it is inside; `pinned` says which. */
  const inFrame = (origin: { x: number; y: number }, p: { x: number; y: number }) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    let t = 1;
    if (p.x < EDGE) t = Math.min(t, (EDGE - origin.x) / dx);
    if (p.x > cssW - EDGE) t = Math.min(t, (cssW - EDGE - origin.x) / dx);
    if (p.y < EDGE) t = Math.min(t, (EDGE - origin.y) / dy);
    if (p.y > cssH - EDGE) t = Math.min(t, (cssH - EDGE - origin.y) / dy);
    t = Math.max(0, t);
    return { x: origin.x + dx * t, y: origin.y + dy * t, pinned: t < 1 };
  };

  for (const marker of markers) {
    const origin = to2d([0, 0, 0]);
    const point = inFrame(origin, to2d(marker.stress));
    const failed = marker.reserveFactor < 1;
    const color = failed ? colors.status.danger : colors.status.ok;
    const hull = marker.hull ? to2d(marker.hull.point) : null;
    // The ray runs to whichever is farther out: the surface for a load that
    // holds, the load itself for one that does not.
    const rayEnd = hull && marker.reserveFactor > 1 ? hull : point;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(rayEnd.x, rayEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hull && marker.hull) {
      ctx.beginPath();
      ctx.arc(hull.x, hull.y, 6, 0, 2 * Math.PI);
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = axisColor;
      ctx.font = chartFont(CHART_FS_TICK, { weight: 600 });
      // Below the ring, where the load label beside the point is not.
      ctx.fillText(marker.hull.label, hull.x + 9, hull.y + 16);
    }

    if (point.pinned) {
      // Off the picture: an arrowhead on the edge, along the ray, so the
      // direction is still read off - how far lies in the label.
      const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
      const size = 9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * Math.cos(angle - 0.45), point.y - size * Math.sin(angle - 0.45));
      ctx.lineTo(point.x - size * Math.cos(angle + 0.45), point.y - size * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    } else if (failed) {
      const r = 5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(point.x - r, point.y - r);
      ctx.lineTo(point.x + r, point.y + r);
      ctx.moveTo(point.x + r, point.y - r);
      ctx.lineTo(point.x - r, point.y + r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = background;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.font = chartFont(CHART_FS_TICK);
    // On the side facing into the picture, so a marker near the right edge
    // does not write its label off the canvas.
    const right = point.x > cssW * 0.6;
    ctx.textAlign = right ? "right" : "left";
    ctx.fillText(marker.label, point.x + (right ? -9 : 7), point.y + (point.pinned && point.y > cssH / 2 ? -8 : 3));
    ctx.textAlign = "left";
    ctx.restore();
  }
}
