import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import {
  clampElevation,
  clampZoom,
  project,
  DEFAULT_CAMERA,
  type Camera,
} from "../../lib/plate3d";
import { autoStrainScale, strainShape, type StrainState } from "../../lib/strainShape";
import { useChartColors } from "../../lib/chartColors";
import { formatSignificant } from "../../lib/numberFormat";
import { useLocale, useT } from "../../i18n";

// What the load case does to the laminate, as one picture - the Java
// original's "3D-Ansicht" of a CLT calculation.
//
// The six numbers it draws are already on the page as numbers. What a number
// cannot do is tell a reader that their unsymmetric layup is twisting under a
// pure tensile load, which is exactly the surprise this view exists for: the
// B matrix couples stretching to bending, and the picture is where that stops
// being an entry in a table.
//
// Drawn on a 2D canvas with a painter's algorithm, like FailureBody3D. It is
// not exact here - a strongly twisted square can fold over itself in view -
// but the surface is single-valued in x and y for any displacement worth
// looking at, and the alternative was a WebGL context for one small figure.

const SAMPLES = 17;
/** The undeformed square, drawn as a reference frame. */
const REFERENCE: [number, number, number][] = [
  [-0.5, -0.5, 0],
  [0.5, -0.5, 0],
  [0.5, 0.5, 0],
  [-0.5, 0.5, 0],
];

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const StrainShapeView = memo(function StrainShapeView({ strains }: { strains: StrainState }) {
  const t = useT();
  const locale = useLocale();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);

  // Memoised, or the `draw` callback below is rebuilt on every render and the
  // canvas repaints on a camera-independent change it cannot see.
  const { probe, scale, shape } = useMemo(() => {
    const unscaled = strainShape(strains, SAMPLES, 1);
    const factor = autoStrainScale(unscaled.peak);
    return { probe: unscaled, scale: factor, shape: strainShape(strains, SAMPLES, factor) };
  }, [strains]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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

    const centre = { x: 0, y: 0 };
    const corners: { x: number; y: number }[] = [];
    for (const row of shape.points) {
      for (const p of row) {
        corners.push(project(p.position[0], p.position[1], p.position[2], { ...camera, zoom: 1 }, centre));
      }
    }
    const spanX = Math.max(...corners.map((p) => Math.abs(p.x))) * 2 || 1;
    const spanY = Math.max(...corners.map((p) => Math.abs(p.y))) * 2 || 1;
    const fit = Math.min(cssW / spanX, cssH / spanY) * 0.8;
    const cam: Camera = { ...camera, zoom: fit * camera.zoom };
    const ox = cssW / 2;
    const oy = cssH / 2;

    const to2d = (p: readonly [number, number, number]) => {
      const q = project(p[0], p[1], p[2], cam, centre);
      return { x: q.x + ox, y: q.y + oy, depth: q.depth };
    };

    // The undeformed square, so the displacement is read against something.
    ctx.save();
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    REFERENCE.forEach((corner, index) => {
      const q = to2d(corner);
      if (index === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Coloured by how far each point moved, which is the one scalar this view
    // has: a corner of a twisted plate moves furthest, and seeing where the
    // motion is concentrated is half the reading.
    const cold = parseHex(colors.diverging.mid);
    const hot = parseHex(colors.diverging.pos);
    const quads: { points: { x: number; y: number }[]; depth: number; fill: string }[] = [];
    for (let r = 0; r + 1 < shape.points.length; r++) {
      for (let c = 0; c + 1 < shape.points[r].length; c++) {
        const cell = [
          shape.points[r][c],
          shape.points[r][c + 1],
          shape.points[r + 1][c + 1],
          shape.points[r + 1][c],
        ];
        const projected = cell.map((p) => to2d(p.position));
        const mean = cell.reduce((s, p) => s + p.magnitude, 0) / 4;
        quads.push({
          points: projected.map((p) => ({ x: p.x, y: p.y })),
          depth: projected.reduce((s, p) => s + p.depth, 0) / 4,
          fill: mix(cold, hot, probe.peak > 0 ? mean / probe.peak : 0),
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
      ctx.fill();
      ctx.strokeStyle = q.fill;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }, [shape, probe.peak, camera, colors]);

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
    drag.current = { x: e.clientX, y: e.clientY, camera };
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start) return;
    setCamera({
      azimuth: start.camera.azimuth + (e.clientX - start.x) * 0.01,
      elevation: clampElevation(start.camera.elevation + (e.clientY - start.y) * 0.01),
      zoom: start.camera.zoom,
    });
  };

  const endPointer = () => {
    drag.current = null;
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
    /* No chart title of its own: unlike the ABD charts, which share a panel
       and need one each, this one is alone in a panel that already names it. */
    <div className="chart viz">
      <div className="plate3d">
        <canvas
          ref={canvasRef}
          className="plate3d-canvas"
          role="img"
          aria-label={t("strainShape.aria")}
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
        <p className="plate3d-scales">
          {probe.peak > 0
            ? t("strainShape.scale", { factor: formatSignificant(scale, 3, locale) })
            : t("strainShape.undeformed")}
        </p>
      </div>
      <p className="hint">{t("strainShape.hint")}</p>
    </div>
  );
});
