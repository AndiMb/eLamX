import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { loadableAngleSweepFamily } from "../../store/derivedAtoms";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { formatFixed, formatScientific } from "../../lib/numberFormat";
import { useLocale, useT } from "../../i18n";
import type { SymbolSpec } from "../../lib/symbols";
import { Sym } from "../Sym";

const WIDTH = 600;
const HEIGHT = 220;
const MARGIN = { top: 10, right: 10, bottom: 24, left: 56 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

const SERIES = [
  { key: "a11", sym: { base: "A", sub: "11" }, color: "var(--viz-series-1)" },
  { key: "a22", sym: { base: "A", sub: "22" }, color: "var(--viz-series-2)" },
  { key: "a66", sym: { base: "A", sub: "66" }, color: "var(--viz-series-3)" },
] as const satisfies readonly { key: string; sym: SymbolSpec; color: string }[];

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const AngleSweepChart = memo(function AngleSweepChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const loadableState = useAtomValue(loadableAngleSweepFamily(laminateId));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const data = loadableState.state === "hasData" ? loadableState.data : null;

  const scales = useMemo(() => {
    if (!data) return null;
    const allValues = [...data.a11, ...data.a22, ...data.a66];
    const yMin = Math.min(...allValues, 0);
    const yMax = Math.max(...allValues);
    const xScale = (angle: number) => (angle / 360) * PLOT_W;
    const yScale = (v: number) => PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;
    return { xScale, yScale, yMin, yMax };
  }, [data]);

  if (!data || !scales) return null;
  const { xScale, yScale } = scales;

  const paths = SERIES.map((s) => ({
    ...s,
    d: data.angle_deg.map((angle, i) => `${i === 0 ? "M" : "L"}${xScale(angle)},${yScale(data[s.key][i])}`).join(" "),
  }));

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const angle = (relX / rect.width) * 360;
    const idx = Math.round(angle / 5);
    setHoverIndex(Math.max(0, Math.min(data.angle_deg.length - 1, idx)));
  };

  const yTicks = [scales.yMin, (scales.yMin + scales.yMax) / 2, scales.yMax];

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.angleSweep.title")}</p>
      <div className="chart-controls">
        <button type="button" className="chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {t(showTable ? "chart.showChart" : "chart.showTable")}
        </button>
      </div>
      {!showTable && (
        <>
          <ChartLegend
            items={SERIES.map((s) => ({ key: s.key, label: <Sym {...s.sym} />, color: s.color, shape: "line" }))}
          />
          <div className="chart-svg-wrap">
            <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={t("chart.angleSweep.aria")}>
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Keyed by tick POSITION, not value: a degenerate laminate
                    (no layers, zero thickness) collapses min/mid/max onto the
                    same number, and value keys would then collide. */}
                {yTicks.map((tick, tickIndex) => (
                  <g key={tickIndex}>
                    <line x1={0} x2={PLOT_W} y1={yScale(tick)} y2={yScale(tick)} className="chart-gridline" />
                    <text x={-8} y={yScale(tick)} textAnchor="end" dominantBaseline="middle">
                      {formatScientific(tick, 1, locale)}
                    </text>
                  </g>
                ))}
                <line x1={0} x2={PLOT_W} y1={PLOT_H} y2={PLOT_H} className="chart-axis" />
                {[0, 90, 180, 270, 360].map((a) => (
                  <text key={a} x={xScale(a)} y={PLOT_H + 16} textAnchor="middle">
                    {a}°
                  </text>
                ))}
                {paths.map((p) => (
                  <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {hoverIndex !== null && (
                  <line
                    x1={xScale(data.angle_deg[hoverIndex])}
                    x2={xScale(data.angle_deg[hoverIndex])}
                    y1={0}
                    y2={PLOT_H}
                    className="chart-axis"
                  />
                )}
                <rect
                  x={0}
                  y={0}
                  width={PLOT_W}
                  height={PLOT_H}
                  fill="transparent"
                  pointerEvents="all"
                  onPointerMove={handleMove}
                  onPointerLeave={() => setHoverIndex(null)}
                />
              </g>
            </svg>
            {hoverIndex !== null && (
              <ChartTooltip
                x={MARGIN.left + xScale(data.angle_deg[hoverIndex]) + 12}
                y={MARGIN.top + 4}
              >
                <div>
                  <strong>{formatFixed(data.angle_deg[hoverIndex], 0, locale)}°</strong>
                </div>
                {SERIES.map((s) => (
                  <div className="chart-tooltip-row" key={s.key}>
                    <span className="chart-legend-swatch line" style={{ background: s.color }} />
                    <Sym {...s.sym} />: {formatScientific(data[s.key][hoverIndex], 2, locale)}
                  </div>
                ))}
              </ChartTooltip>
            )}
          </div>
        </>
      )}
      {showTable && (
        <table className="chart-table">
          <thead>
            <tr>
              <th>{t("chart.angleSweep.column.angle")}</th>
              {SERIES.map((s) => (
                <th key={s.key}>
                  <Sym {...s.sym} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.angle_deg.map((angle, i) => (
              <tr key={angle}>
                <td>{formatFixed(angle, 0, locale)}°</td>
                <td>{formatScientific(data.a11[i], 3, locale)}</td>
                <td>{formatScientific(data.a22[i], 3, locale)}</td>
                <td>{formatScientific(data.a66[i], 3, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
