import { memo, useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { CAMERA_GESTURES, DEFAULT_CAMERA, type Camera } from "../../lib/plate3d";
import { drawHeightField } from "../../lib/canvas3d/heightField";
import { useOrbitControls } from "../../lib/useOrbitControls";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";

// The buckled plate as a rotatable, zoomable 3D surface - the thing the Java
// original showed through JOGL/Ardor3D (view3d/BucklingPlate.java). The
// drawing itself is lib/canvas3d/heightField.ts, a painter's algorithm on a 2D
// canvas; this component owns the canvas, the camera and the gestures.

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
  const controls = useOrbitControls(canvasRef, camera, setCamera, CAMERA_GESTURES);

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
    // Canvas cannot resolve CSS custom properties, so the outline colour is
    // taken from the canvas's own inherited `color` - which App.css points at
    // the same token the SVG charts use.
    const ink = getComputedStyle(canvas).color;
    drawHeightField(ctx, cssW, cssH, dpr, { surface, length, width, zScale, camera, colors, ink });
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

  return (
    <div className="plate3d">
      <canvas
        ref={canvasRef}
        className="plate3d-canvas"
        role="img"
        aria-label={t("buckling.plate3d.aria")}
        {...controls}
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
