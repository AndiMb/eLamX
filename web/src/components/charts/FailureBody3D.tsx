import { memo, useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { CAMERA_GESTURES, DEFAULT_CAMERA, type Camera } from "../../lib/plate3d";
import {
  drawFailureBody,
  type FailureBodyAxisScale,
  type FailureBodySurface,
  type StressMarker,
} from "../../lib/canvas3d/failureBody";
import { useOrbitControls } from "../../lib/useOrbitControls";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";
import { ChartSnapshotButton } from "./ChartSnapshotButton";

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
// The drawing itself is lib/canvas3d/failureBody.ts, a painter's algorithm on
// a 2D canvas; this component owns the canvas, the camera and the gestures.

export type { FailureBodySurface, StressMarker } from "../../lib/canvas3d/failureBody";

/** The first non-transparent background from the element outwards. */
function opaqueBackground(element: Element): string {
  for (let e: Element | null = element; e; e = e.parentElement) {
    const color = getComputedStyle(e).backgroundColor;
    if (color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "#fff";
}

export const FailureBody3D = memo(function FailureBody3D({
  bodies,
  markers,
  axisLabels = ["σ∥", "σ⊥", "τ"],
  exports,
}: {
  /**
   * The bodies to draw, in order. The FIRST is drawn as a solid shaded
   * surface, every further one as a wireframe in its own colour.
   *
   * Not several translucent shells, which is the obvious thing and is wrong
   * here: this view sorts quads by depth (a painter's algorithm, exact for one
   * body because it is star-shaped about the origin), and two criteria's
   * surfaces CROSS - so along the intersection curve the sorting has no right
   * answer and the overlap would be drawn arbitrarily. A wireframe has no fill
   * to order, so what the picture shows is what the criteria say.
   */
  bodies: FailureBodySurface[];
  markers: StressMarker[];
  /** What the three axes are. Stress for a ply, load flows for a laminate. */
  axisLabels?: [string, string, string];
  /** Further entries for the export menu, beside the PNG. */
  exports?: readonly { key: string; label: string; run: () => void | Promise<void> }[];
}) {
  const t = useT();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  // True scale first: the proportions ARE the material - a UD ply is strong
  // along its fibres and nowhere else, and a picture that makes every body a
  // cube hides exactly that. Stretched stays one click away for reading a
  // state in the transverse and shear region.
  const [axisScale, setAxisScale] = useState<FailureBodyAxisScale>("true");
  const controls = useOrbitControls(canvasRef, camera, setCamera, CAMERA_GESTURES);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bodies[0]) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    // The canvas's own ink, which App.css points at the chart token.
    const styles = getComputedStyle(canvas);
    drawFailureBody(ctx, cssW, cssH, dpr, {
      bodies,
      markers,
      axisLabels,
      camera,
      colors,
      ink: styles.color,
      // The canvas itself is transparent; the colour behind it is the
      // stage's (.plate3d), and a transparent "background" drew no ring and
      // no halo at all.
      background: opaqueBackground(canvas),
      axisScale,
    });
  }, [bodies, markers, camera, colors, axisLabels, axisScale]);

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

  return (
    <div className="plate3d">
      <canvas
        ref={canvasRef}
        className="plate3d-canvas"
        role="img"
        aria-label={t("failureBody.aria")}
        {...controls}
      />
      <div className="plate3d-axis-scale" role="group" aria-label={t("failureBody.axisScale")}>
        {(["true", "stretched"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={axisScale === mode}
            onClick={() => setAxisScale(mode)}
            title={t(mode === "true" ? "failureBody.axisScale.true.hint" : "failureBody.axisScale.stretched.hint")}
          >
            {t(mode === "true" ? "failureBody.axisScale.true" : "failureBody.axisScale.stretched")}
          </button>
        ))}
      </div>
      {axisScale === "stretched" && <p className="plate3d-scales">{t("failureBody.axisScale.stretched.note")}</p>}
      <button
        type="button"
        className="plate3d-reset"
        onClick={() => setCamera(DEFAULT_CAMERA)}
        title={t("buckling.plate3d.reset")}
        aria-label={t("buckling.plate3d.reset")}
      >
        <RotateCcw size={14} />
      </button>
      <div className="chart-actions">
        <ChartSnapshotButton target={canvasRef} name="versagenskoerper" extra={exports} />
      </div>
    </div>
  );
});
