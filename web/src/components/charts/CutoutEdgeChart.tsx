import { memo, useMemo, useState, useRef } from "react";
import { ChartLegend } from "./ChartLegend";
import { useChartColors } from "../../lib/chartColors";
import { formatSignificant } from "../../lib/numberFormat";
import type { CutoutPointDto } from "../../lib/types";
import { useLocale, useT } from "../../i18n";
import { ChartSnapshotButton } from "./ChartSnapshotButton";

// What the load does as it runs round the hole.
//
// The tangential resultant against the angle, which is the curve the original
// plots and the one an engineer reads: a free hole edge carries nothing across
// itself, so everything the far field pushes into the plate has to squeeze
// past tangentially, and where that curve peaks is where the laminate gives.
//
// Cartesian rather than polar, unlike the stiffness sweep next door. The
// quantity here is not a direction but a value AT a direction, and the thing
// being read off is a peak and the angle it sits at - which a curve over an
// axis states and a closed loop only implies.

const WIDTH = 640;
const HEIGHT = 260;
const MARGIN = { top: 12, right: 14, bottom: 32, left: 58 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

type SeriesId = "n_theta" | "m_theta";

export const CutoutEdgeChart = memo(function CutoutEdgeChart({
  points,
  peakAlpha,
}: {
  points: CutoutPointDto[];
  peakAlpha: number;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const locale = useLocale();
  const colors = useChartColors();
  const [series, setSeries] = useState<SeriesId>("n_theta");

  const { path, min, max, zeroY } = useMemo(() => {
    const values = points.map((p) => (series === "n_theta" ? p.n_theta : p.m_theta));
    let low = Math.min(...values, 0);
    let high = Math.max(...values, 0);
    if (high - low < 1e-12) {
      // A load case that does nothing still needs an axis to be drawn on.
      low = -1;
      high = 1;
    }
    const pad = (high - low) * 0.06;
    low -= pad;
    high += pad;

    const x = (alpha: number) => MARGIN.left + (alpha / 360) * PLOT_W;
    const y = (v: number) => MARGIN.top + PLOT_H - ((v - low) / (high - low)) * PLOT_H;

    return {
      path: points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.alpha).toFixed(2)},${y(values[i]).toFixed(2)}`)
        .join(" "),
      min: low,
      max: high,
      zeroY: y(0),
    };
  }, [points, series]);

  const xOf = (alpha: number) => MARGIN.left + (alpha / 360) * PLOT_W;
  const color = series === "n_theta" ? colors.series[0] : colors.series[2];

  return (
    <div className="chart">
      <ChartLegend
        items={[
          { key: "n_theta", label: t("cutout.series.nTheta"), color: colors.series[0] },
          { key: "m_theta", label: t("cutout.series.mTheta"), color: colors.series[2] },
        ]}
      />
      <label className="inline-field">
        <span className="field-label">{t("cutout.series")}</span>
        <select value={series} onChange={(e) => setSeries(e.target.value as SeriesId)}>
          <option value="n_theta">{t("cutout.series.nTheta")}</option>
          <option value="m_theta">{t("cutout.series.mTheta")}</option>
        </select>
      </label>

      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t("cutout.chart.aria")}
      >
        {/* A tick every 45 degrees: the quadrant boundaries are where the
            answer usually sits, and a hole is symmetric about them. */}
        {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((alpha) => (
          <g key={alpha}>
            <line
              x1={xOf(alpha)}
              y1={MARGIN.top}
              x2={xOf(alpha)}
              y2={MARGIN.top + PLOT_H}
              className={alpha % 90 === 0 ? "chart-axis" : "chart-gridline"}
            />
            <text
              x={xOf(alpha)}
              y={MARGIN.top + PLOT_H + 18}
              textAnchor="middle"
            >
              {alpha}°
            </text>
          </g>
        ))}

        {/* Zero, drawn solid: the sign of the tangential resultant is the
            difference between a hole edge in tension and one in compression. */}
        <line
          x1={MARGIN.left}
          y1={zeroY}
          x2={MARGIN.left + PLOT_W}
          y2={zeroY}
          className="chart-axis"
        />
        <text x={MARGIN.left - 6} y={zeroY + 4} textAnchor="end">
          0
        </text>
        <text
          x={MARGIN.left - 6}
          y={MARGIN.top + 10}
          textAnchor="end"
        >
          {formatSignificant(max, 3, locale)}
        </text>
        <text
          x={MARGIN.left - 6}
          y={MARGIN.top + PLOT_H}
          textAnchor="end"
        >
          {formatSignificant(min, 3, locale)}
        </text>

        {/* Where it peaks - the one point on this curve anyone acts on. */}
        <line
          x1={xOf(peakAlpha)}
          y1={MARGIN.top}
          x2={xOf(peakAlpha)}
          y2={MARGIN.top + PLOT_H}
          stroke={colors.series[0]}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
        />

        <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
      </svg>
      <div className="chart-actions">
        <ChartSnapshotButton target={svgRef} name="ausschnitt" title={t("cutout.chart.aria")} />
      </div>
    </div>
  );
});
