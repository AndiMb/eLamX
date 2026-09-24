import { memo, useMemo, useRef } from "react";
import { useChartColors } from "../../lib/chartColors";
import { formatSignificant } from "../../lib/numberFormat";
import type { CarpetPlotDto } from "../../lib/types";
import { useLocale, useT } from "../../i18n";
import { ChartSnapshotButton } from "./ChartSnapshotButton";
import { carpetTable } from "../../lib/tables/charts";
import { useChartWidth } from "../../lib/useChartWidth";

// The carpet, drawn as the carpet it is named after.
//
// Eleven curves in one frame with no legend entry each: what identifies a
// curve is the label sitting on it, at its left end, saying what percentage of
// the plies lie at 0 degrees. That is how the picture is read - find the
// stiffness you need on the vertical axis, then read off which mix reaches it -
// and a legend beside the frame would make the reader count curves instead.

const DEFAULT_WIDTH = 680;
const HEIGHT = 380;
const MARGIN = { top: 16, right: 64, bottom: 40, left: 66 };
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export const CarpetPlotChart = memo(function CarpetPlotChart({ plot }: { plot: CarpetPlotDto }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const locale = useLocale();
  const colors = useChartColors();
  const { ref: boxRef, width: WIDTH } = useChartWidth(DEFAULT_WIDTH);
  const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;

  const { paths, low, high, y, x } = useMemo(() => {
    const values = plot.curves.flatMap((c) => c.values);
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (high - low < 1e-12) {
      low -= 1;
      high += 1;
    }
    const pad = (high - low) * 0.06;
    low -= pad;
    high += pad;

    const x = (fraction: number) => MARGIN.left + fraction * PLOT_W;
    const y = (value: number) => MARGIN.top + PLOT_H - ((value - low) / (high - low)) * PLOT_H;

    const paths = plot.curves.map((curve) => ({
      curve,
      d: curve.fraction_45
        .map((f, i) => `${i === 0 ? "M" : "L"}${x(f).toFixed(2)},${y(curve.values[i]).toFixed(2)}`)
        .join(" "),
    }));
    return { paths, low, high, y, x };
  }, [plot, PLOT_W]);

  const gridValues = [0, 0.25, 0.5, 0.75, 1];

  // For the shear modulus the whole family collapses onto one line: a 0 degree
  // and a 90 degree ply contribute the same Q66, so only the +-45 share moves
  // it and the eleven curves lie on top of each other. Labelling them there
  // would stack eleven numbers on one point, so - as in the original, which
  // switches its annotations off for exactly this case - none are drawn.
  const labelled = plot.value !== "g_xy";

  return (
    <div className="chart" ref={boxRef}>
      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t("carpet.chart.aria")}
      >
        {gridValues.map((fraction) => (
          <g key={fraction}>
            <line
              x1={x(fraction)}
              y1={MARGIN.top}
              x2={x(fraction)}
              y2={MARGIN.top + PLOT_H}
              className={fraction === 0 || fraction === 1 ? "chart-axis" : "chart-gridline"}
            />
            <text x={x(fraction)} y={MARGIN.top + PLOT_H + 18} textAnchor="middle">
              {fraction * 100}
            </text>
          </g>
        ))}
        <text
          x={MARGIN.left + PLOT_W / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          className="chart-axis-label"
        >
          {t("carpet.axis.x")}
        </text>

        <line
          x1={MARGIN.left}
          y1={MARGIN.top + PLOT_H}
          x2={MARGIN.left + PLOT_W}
          y2={MARGIN.top + PLOT_H}
          className="chart-axis"
        />
        <text x={MARGIN.left - 8} y={MARGIN.top + 10} textAnchor="end">
          {formatSignificant(high, 3, locale)}
        </text>
        <text x={MARGIN.left - 8} y={MARGIN.top + PLOT_H} textAnchor="end">
          {formatSignificant(low, 3, locale)}
        </text>

        {paths.map(({ curve, d }, index) => (
          <g key={index}>
            <path
              d={d}
              fill="none"
              // The bound without 90 degree plies is the one curve that is not
              // one of the family, so it is drawn as a boundary rather than as
              // another member: dashed, in the emphasis colour.
              stroke={curve.without_90 ? colors.series[2] : colors.series[0]}
              strokeWidth={curve.without_90 ? 1.75 : 1.25}
              strokeDasharray={curve.without_90 ? "5 4" : undefined}
              opacity={curve.without_90 ? 1 : 0.85}
            />
            {labelled && !curve.without_90 && (
              // The curve's own name, on the curve: the share of 0 degree plies.
              <text
                x={x(curve.fraction_45[0]) + 4}
                y={y(curve.values[0]) - 4}
                className="chart-inline-label"
              >
                {Math.round(curve.fraction_0 * 100)}
              </text>
            )}
          </g>
        ))}

        {/* The end of the dashed bound, labelled where it leaves the frame. */}
        {labelled && (
        <text
          x={MARGIN.left + PLOT_W + 6}
          y={y(plot.curves[plot.curves.length - 1].values[plot.curves[0].values.length - 1]) + 4}
          className="chart-inline-label"
        >
          {t("carpet.bound.short")}
        </text>
        )}
      </svg>
      <p className="hint">{t("carpet.chart.hint")}</p>
      <div className="chart-actions">
        <ChartSnapshotButton target={svgRef} name="carpet-plot" title={t("carpet.title")} data={() => carpetTable(plot, t)} />
      </div>
    </div>
  );
});
