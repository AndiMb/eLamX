import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { outlineBounds, springInOutlines, type Outline } from "../../lib/springInGeometry";
import { useChartColors } from "../../lib/chartColors";
import { ChartLegend } from "./ChartLegend";
import { useT } from "../../i18n";
import { ChartSnapshotButton } from "./ChartSnapshotButton";

// The tool's corner and the part's, one on top of the other.
//
// A plain 2D canvas: there is nothing three-dimensional about an L-section
// drawn in its own plane, and the original draws it as an XY chart too.
//
// The one decision that is not the original's is the exaggeration. eLamX draws
// the two outlines at true scale, where a spring-in of four tenths of a degree
// is about a pixel and the picture says nothing at all. Here the deviation can
// be multiplied, off by default, with the factor stated - so the picture is
// honest about being a caricature when it is one.

const EXAGGERATIONS = [1, 5, 10, 25] as const;

export const SpringInOutlineView = memo(function SpringInOutlineView({
  angle,
  radius,
  thickness,
  deltaAngle,
}: {
  angle: number;
  radius: number;
  thickness: number;
  deltaAngle: number;
}) {
  const t = useT();
  const colors = useChartColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [exaggeration, setExaggeration] = useState<number>(1);

  const { tool, part } = useMemo(
    () => springInOutlines({ angle, radius, thickness }, deltaAngle * exaggeration),
    [angle, radius, thickness, deltaAngle, exaggeration],
  );

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

    // One scale for both axes - a coupon drawn with different x and y scales
    // would show a bend angle that is not the one computed. The original sets
    // `useEqualAxes(true)` for exactly this reason.
    const { minX, maxX, minY, maxY } = outlineBounds([tool, part]);
    const pad = 12;
    const scale = Math.min(
      (cssW - 2 * pad) / Math.max(maxX - minX, 1e-6),
      (cssH - 2 * pad) / Math.max(maxY - minY, 1e-6),
    );
    const ox = (cssW - (maxX - minX) * scale) / 2 - minX * scale;
    // y grows upward in the geometry and downward on a canvas.
    const oy = (cssH + (maxY - minY) * scale) / 2 + minY * scale;

    const stroke = (outline: Outline, color: string, dash: number[]) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      outline.forEach(([x, y], index) => {
        const px = ox + x * scale;
        const py = oy - y * scale;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    };

    stroke(tool, colors.series[3], [5, 4]);
    stroke(part, colors.series[0], []);
  }, [tool, part, colors]);

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
    /* Legend and exaggeration on one line above the picture, the export in
       the picture's corner - the arrangement of the other 3D stages. */
    <div className="chart viz spring-in-outline">
      <div className="chart-card-controls">
        <ChartLegend
          items={[
            { key: "tool", label: t("springIn.legend.tool"), color: colors.series[3], shape: "line" },
            { key: "part", label: t("springIn.legend.part"), color: colors.series[0], shape: "line" },
          ]}
        />
        <label className="inline-field">
          <span className="field-label">{t("springIn.exaggeration")}</span>
          <select
            value={exaggeration}
            onChange={(e) => setExaggeration(Number(e.target.value))}
          >
            {EXAGGERATIONS.map((factor) => (
              <option key={factor} value={factor}>
                {factor === 1 ? t("springIn.exaggeration.none") : `${factor}×`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="plate3d">
        <canvas ref={canvasRef} className="plate3d-canvas" />
        <div className="chart-actions">
          <ChartSnapshotButton target={canvasRef} name="spring-in" />
        </div>
      </div>
    </div>
  );
});
