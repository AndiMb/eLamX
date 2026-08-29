import { memo, useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import {
  clampElevation,
  clampZoom,
  project,
  DEFAULT_CAMERA,
  type Camera,
} from "../../lib/plate3d";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";

// The failure body of one ply's criterion, with that ply's own stress state
// drawn inside or outside it - the view the Java original had in
// FailureCriterionView3D and its stress-state variant.
//
// What it answers that a reserve factor alone cannot: WHERE the ply sits.
// A reserve factor of 0.8 says "fails"; the picture says whether it fails
// because of transverse tension, because of shear, or because it is a hair
// beyond a corner where two mechanisms meet - and how far the state would
// have to move to be safe.
//
// Drawn on a 2D canvas with a painter's algorithm, like BucklingPlate3D and
// for the same reasons. It is exact here too: the body is star-shaped about
// the origin by construction (every sample is a ray scaled by its reserve
// factor), so sorting quads by depth cannot produce a wrong overlap.

export interface StressMarker {
  /** Local stress state [sigma_par, sigma_nor, tau]. */
  stress: [number, number, number];
  /** Reserve factor there - decides the colour, and whether it is outside. */
  reserveFactor: number;
  label: string;
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

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export const FailureBody3D = memo(function FailureBody3D({
  points,
  markers,
}: {
  /** Surface grid from the core; null entries are directions it could not evaluate. */
  points: ([number, number, number] | null)[][];
  markers: StressMarker[];
}) {
  const t = useT();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // The three stress components span wildly different magnitudes (fibre
    // strength ~2000, shear ~70), so each axis is normalised to its own
    // extent. The body would otherwise be a needle: this is a stress SPACE
    // plot, not a scale drawing.
    let spanPar = 0;
    let spanNor = 0;
    let spanShear = 0;
    for (const row of points) {
      for (const p of row) {
        if (!p) continue;
        spanPar = Math.max(spanPar, Math.abs(p[0]));
        spanNor = Math.max(spanNor, Math.abs(p[1]));
        spanShear = Math.max(spanShear, Math.abs(p[2]));
      }
    }
    // Deliberately NOT stretched to include the markers: a failed ply sits far
    // outside the body, and letting it set the scale would squash the body
    // itself into a sliver. The markers may leave the unit cube - that they do
    // is the finding - and the fit below still keeps them in frame.
    const norm = (p: readonly [number, number, number]) =>
      [p[0] / (spanPar || 1), p[1] / (spanNor || 1), p[2] / (spanShear || 1)] as const;

    const centre = { x: 0, y: 0 };
    const probe: { x: number; y: number }[] = [];
    for (const px of [-1, 1]) {
      for (const py of [-1, 1]) {
        for (const pz of [-1, 1]) {
          probe.push(project(px, py, pz, { ...camera, zoom: 1 }, centre));
        }
      }
    }
    // ...but the frame does have to hold them, or a ply that fails badly would
    // have its marker off-canvas - the one thing the view exists to show.
    for (const m of markers) {
      const n = norm(m.stress);
      probe.push(project(n[0], n[1], n[2], { ...camera, zoom: 1 }, centre));
    }
    const spanX = Math.max(...probe.map((p) => Math.abs(p.x))) * 2 || 1;
    const spanY = Math.max(...probe.map((p) => Math.abs(p.y))) * 2 || 1;
    const fit = Math.min(cssW / spanX, cssH / spanY) * 0.78;
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
    for (let r = 0; r < points.length - 1; r++) {
      for (let c = 0; c < points[r].length - 1; c++) {
        const corners = [points[r][c], points[r][c + 1], points[r + 1][c + 1], points[r + 1][c]];
        // A hole in the surface simply drops its quads.
        if (corners.some((p) => !p)) continue;
        const raw = corners as [number, number, number][];

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
        quads.push({
          points: projected.map((p) => ({ x: p.x, y: p.y })),
          depth: projected.reduce((s, p) => s + p.depth, 0) / 4,
          fill: shade(base, 0.45 + 0.55 * lambert),
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

    // Axes through the origin, drawn on top so the stress state can be read
    // against them even where the body hides them.
    const axisColor = getComputedStyle(canvas).color;
    // Reach past the body (1.0 in normalised space) so the labels sit clear of
    // it rather than on top of the surface.
    const AXIS_REACH = 1.25;
    const axes: { end: [number, number, number]; label: string }[] = [
      { end: [spanPar * AXIS_REACH, 0, 0], label: "σ∥" },
      { end: [0, spanNor * AXIS_REACH, 0], label: "σ⊥" },
      { end: [0, 0, spanShear * AXIS_REACH], label: "τ" },
    ];

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = axisColor;
    ctx.fillStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, sans-serif";
    for (const axis of axes) {
      const from = to2d([-axis.end[0], -axis.end[1], -axis.end[2]]);
      const to = to2d(axis.end);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.fillText(axis.label, to.x + 4, to.y - 2);
    }
    ctx.restore();

    // The ply's own stress state: a line from the origin (the load path) and a
    // dot at its end. Green inside the body, red outside - which is the same
    // statement as RF >= 1, drawn where it can be seen.
    for (const marker of markers) {
      const origin = to2d([0, 0, 0]);
      const point = to2d(marker.stress);
      const failed = marker.reserveFactor < 1;
      const color = failed ? colors.status.danger : colors.status.ok;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = getComputedStyle(canvas).backgroundColor || "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(marker.label, point.x + 7, point.y + 3);
      ctx.restore();
    }
  }, [points, markers, camera, colors]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, camera };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.distance > 0) {
        const factor = distance / pinch.current.distance;
        setCamera((c) => ({ ...c, zoom: clampZoom(pinch.current!.zoom * factor) }));
      }
      return;
    }

    const start = drag.current;
    if (!start) return;
    setCamera({
      azimuth: start.camera.azimuth + (e.clientX - start.x) * 0.01,
      elevation: clampElevation(start.camera.elevation + (e.clientY - start.y) * 0.01),
      zoom: start.camera.zoom,
    });
  };

  const endPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)) }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="plate3d">
      <canvas
        ref={canvasRef}
        className="plate3d-canvas"
        role="img"
        aria-label={t("failureBody.aria")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />
      <button
        type="button"
        className="plate3d-reset"
        onClick={() => setCamera(DEFAULT_CAMERA)}
        title={t("buckling.plate3d.reset")}
        aria-label={t("buckling.plate3d.reset")}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
});
