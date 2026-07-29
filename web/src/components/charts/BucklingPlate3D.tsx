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

// The buckled plate as a rotatable, zoomable 3D surface - the thing the Java
// original showed through JOGL/Ardor3D (view3d/BucklingPlate.java). Drawn on a
// 2D canvas with a painter's algorithm rather than WebGL: the scene is one
// single-valued height field, so sorting quads by depth is exact, and it
// avoids both a 3D library in the bundle and a WebGL context on mobile.
//
// Colour is the app's diverging scale, not the Java version's rainbow. The
// sign of the deflection is the meaningful quantity and zero is a real neutral
// point, which is exactly what a diverging scale encodes; a rainbow ramp
// invents boundaries where the data has none.

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

export const BucklingPlate3D = memo(function BucklingPlate3D({
  surface,
  length,
  width,
  zScale,
}: {
  surface: number[][];
  length: number;
  width: number;
  /** Peak deflection as a fraction of the plate's shorter edge. */
  zScale: number;
}) {
  const t = useT();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  // Distance between the two active pointers when a pinch started.
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || surface.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Render at device resolution so the fills stay crisp on phones.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // Canvas cannot resolve CSS custom properties, so the outline colour is
    // taken from the canvas's own inherited `color` - which App.css points at
    // the same token the SVG charts use.
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [surface, length, width, zScale, camera, colors]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on container resize; the canvas is width:100% so its pixel size
  // only changes when the layout does.
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
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    setCamera({
      azimuth: start.camera.azimuth + dx * 0.01,
      elevation: clampElevation(start.camera.elevation + dy * 0.01),
      zoom: start.camera.zoom,
    });
  };

  const endPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  // Non-passive wheel listener: React's onWheel is passive, so it cannot
  // preventDefault, and the page would scroll while zooming.
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
        aria-label={t("buckling.plate3d.aria")}
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
