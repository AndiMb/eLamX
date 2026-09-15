import { memo, useMemo, useState, useRef } from "react";
import { useAtomValue } from "jotai";
import { loadableAngleSweepFamily } from "../../store/derivedAtoms";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { formatFixed, formatScientific } from "../../lib/numberFormat";
import { useLocale, useT } from "../../i18n";
import type { SymbolSpec } from "../../lib/symbols";
import { Sym } from "../Sym";
import { ChartSnapshotButton } from "./ChartSnapshotButton";

// How a laminate's stiffness depends on the direction it is loaded from, as a
// POLAR diagram - which is what eLamX 3.x draws, and for a good reason: the
// quantity is a direction, so a shape in the plane says more about it than a
// curve over an axis. A quasi-isotropic layup is a circle and one look tells
// you so; on the cartesian plot it was a straight line, which says the same
// thing far less directly.
//
// All twelve components the original offers, not just the A terms: B and D are
// where an unsymmetric or a bend-twist-coupled stack shows itself, and the A
// terms alone cannot tell those apart. The defaults are the original's - the
// four A terms on, B and D off - including A12, which the cartesian version
// computed and never drew.

const SIZE = 420;
const CENTRE = SIZE / 2;
/** Room for the angle labels outside the outer circle. */
const R_MAX = CENTRE - 34;

interface SeriesDef {
  key:
    | "a11" | "a12" | "a22" | "a66"
    | "b11" | "b12" | "b22" | "b66"
    | "d11" | "d12" | "d22" | "d66";
  sym: SymbolSpec;
  color: string;
  /** Which matrix it belongs to - the dash pattern follows it, as in the
   *  original, so the three groups stay apart even in one colour. */
  group: "A" | "B" | "D";
}

const SERIES: readonly SeriesDef[] = [
  { key: "a11", sym: { base: "A", sub: "11" }, color: "var(--viz-series-1)", group: "A" },
  { key: "a12", sym: { base: "A", sub: "12" }, color: "var(--viz-series-2)", group: "A" },
  { key: "a22", sym: { base: "A", sub: "22" }, color: "var(--viz-series-3)", group: "A" },
  { key: "a66", sym: { base: "A", sub: "66" }, color: "var(--viz-series-5)", group: "A" },
  { key: "b11", sym: { base: "B", sub: "11" }, color: "var(--viz-series-1)", group: "B" },
  { key: "b12", sym: { base: "B", sub: "12" }, color: "var(--viz-series-2)", group: "B" },
  { key: "b22", sym: { base: "B", sub: "22" }, color: "var(--viz-series-3)", group: "B" },
  { key: "b66", sym: { base: "B", sub: "66" }, color: "var(--viz-series-5)", group: "B" },
  { key: "d11", sym: { base: "D", sub: "11" }, color: "var(--viz-series-1)", group: "D" },
  { key: "d12", sym: { base: "D", sub: "12" }, color: "var(--viz-series-2)", group: "D" },
  { key: "d22", sym: { base: "D", sub: "22" }, color: "var(--viz-series-3)", group: "D" },
  { key: "d66", sym: { base: "D", sub: "66" }, color: "var(--viz-series-5)", group: "D" },
];

const DASH: Record<SeriesDef["group"], string | undefined> = {
  A: undefined,
  B: "6 4",
  D: "2 3",
};

/** eLamX's own defaults: the A terms, and nothing else. */
const DEFAULT_SELECTION = new Set(["a11", "a12", "a22", "a66"]);

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const AngleSweepChart = memo(function AngleSweepChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const locale = useLocale();
  const loadableState = useAtomValue(loadableAngleSweepFamily(laminateId));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  // Local rather than persisted: this is a chart control, not part of the
  // document, and the laminate page has no other per-panel state.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_SELECTION));

  const data = loadableState.state === "hasData" ? loadableState.data : null;
  const shown = SERIES.filter((s) => selected.has(s.key));

  // One radial scale PER MATRIX, not one for the picture.
  //
  // A is a force per length, B a force, D a force times a length: on a 0.4 mm
  // laminate D is four orders of magnitude below A, so a shared axis collapses
  // it onto the origin and the diagram shows one matrix and three dots. The
  // original does share the axis; this does not, because putting quantities of
  // different units on one axis was never meaningful - and what a polar
  // diagram is read for is the SHAPE, which survives the scaling. The size is
  // on each group's own ring label, in the tooltip and in the table.
  const scales = useMemo(() => {
    if (!data || shown.length === 0) return null;
    const perGroup = {} as Record<SeriesDef["group"], { min: number; max: number }>;
    for (const group of ["A", "B", "D"] as const) {
      const values = shown.filter((s) => s.group === group).flatMap((s) => data[s.key]);
      if (values.length === 0) continue;
      // The axis starts at zero unless something goes below it - a B term can.
      // Then zero is a circle inside the plot rather than the centre.
      const min = Math.min(0, ...values);
      perGroup[group] = { min, max: Math.max(...values, min + 1e-12) };
    }
    return perGroup;
  }, [data, shown]);

  if (!data || !scales) return null;

  const radiusIn = (group: SeriesDef["group"], value: number) => {
    const scale = scales[group];
    if (!scale) return 0;
    return ((value - scale.min) / (scale.max - scale.min)) * R_MAX;
  };

  const groups = (["A", "B", "D"] as const).filter((g) => scales[g]);
  // The grid belongs to whichever matrix is listed first - it is one set of
  // rings for what may be three scales, so it is drawn for the leading one and
  // labelled with it.
  const leading = groups[0];
  const { min, max } = scales[leading];

  const point = (group: SeriesDef["group"], angleDeg: number, value: number) => {
    // Zero degrees points right and the angle runs anticlockwise, as a polar
    // plot of a material direction should: it IS the x axis of the laminate.
    const rad = (angleDeg * Math.PI) / 180;
    const r = radiusIn(group, value);
    return [CENTRE + r * Math.cos(rad), CENTRE - r * Math.sin(rad)] as const;
  };

  const paths = shown.map((s) => ({
    ...s,
    d:
      data.angle_deg
        .map((angle, i) => {
          const [x, y] = point(s.group, angle, data[s.key][i]);
          return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ") + " Z",
  }));

  const rings = [min, (min + max) / 2, max];
  const zeroRing = min < 0 ? radiusIn(leading, 0) : null;

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - CENTRE;
    const y = CENTRE - ((e.clientY - rect.top) / rect.height) * SIZE;
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    const step = data.angle_deg.length > 1 ? data.angle_deg[1] - data.angle_deg[0] : 1;
    const index = Math.round(angle / step) % data.angle_deg.length;
    setHoverIndex(index);
  };

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.angleSweep.title")}</p>
      <div className="chart-controls">
        <button type="button" className="chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {t(showTable ? "chart.showChart" : "chart.showTable")}
        </button>
      </div>

      <div className="polar-series-picker" role="group" aria-label={t("chart.angleSweep.series")}>
        {SERIES.map((s) => (
          <label key={s.key}>
            <input
              type="checkbox"
              checked={selected.has(s.key)}
              onChange={() => toggle(s.key)}
            />
            <Sym {...s.sym} />
          </label>
        ))}
      </div>

      {shown.length === 0 && <p className="hint">{t("chart.angleSweep.none")}</p>}

      {!showTable && shown.length > 0 && (
        <>
          <ChartLegend
            items={shown.map((s) => ({
              key: s.key,
              label: <Sym {...s.sym} />,
              color: s.color,
              shape: "line",
            }))}
          />
          <div className="chart-svg-wrap">
            <svg
              ref={svgRef}
              className="chart-svg polar"
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              width="100%"
              role="img"
              aria-label={t("chart.angleSweep.aria")}
            >
              {/* Keyed by position, not value: a degenerate laminate collapses
                  the three rings onto one number. */}
              {rings.map((value, index) => (
                <circle
                  key={index}
                  cx={CENTRE}
                  cy={CENTRE}
                  r={radiusIn(leading, value)}
                  className="chart-gridline"
                  fill="none"
                />
              ))}
              {zeroRing !== null && (
                <circle cx={CENTRE} cy={CENTRE} r={zeroRing} className="chart-axis" fill="none" />
              )}
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
                const rad = (angle * Math.PI) / 180;
                return (
                  <line
                    key={angle}
                    x1={CENTRE}
                    y1={CENTRE}
                    x2={CENTRE + R_MAX * Math.cos(rad)}
                    y2={CENTRE - R_MAX * Math.sin(rad)}
                    className="chart-gridline"
                  />
                );
              })}
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
                const rad = (angle * Math.PI) / 180;
                return (
                  <text
                    key={angle}
                    x={CENTRE + (R_MAX + 16) * Math.cos(rad)}
                    y={CENTRE - (R_MAX + 16) * Math.sin(rad)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {angle}°
                  </text>
                );
              })}
              {/* The outer ring's value per matrix shown, so the picture has a
                  size and not only a shape. In the corner, not above the ring:
                  that is where the 90 degree label lives. */}
              {groups.map((group, index) => (
                <text key={group} x={4} y={14 + index * 13} textAnchor="start">
                  {group} ≤ {formatScientific(scales[group].max, 1, locale)}
                </text>
              ))}

              {paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  fill="none"
                  stroke={p.color}
                  strokeDasharray={DASH[p.group]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ))}

              {hoverIndex !== null && (
                <line
                  x1={CENTRE}
                  y1={CENTRE}
                  x2={CENTRE + R_MAX * Math.cos((data.angle_deg[hoverIndex] * Math.PI) / 180)}
                  y2={CENTRE - R_MAX * Math.sin((data.angle_deg[hoverIndex] * Math.PI) / 180)}
                  className="chart-axis"
                />
              )}
              <rect
                x={0}
                y={0}
                width={SIZE}
                height={SIZE}
                fill="transparent"
                pointerEvents="all"
                onPointerMove={handleMove}
                onPointerLeave={() => setHoverIndex(null)}
              />
            </svg>
            {hoverIndex !== null && (
              <ChartTooltip x={SIZE * 0.62} y={12}>
                <div>
                  <strong>{formatFixed(data.angle_deg[hoverIndex], 0, locale)}°</strong>
                </div>
                {shown.map((s) => (
                  <div className="chart-tooltip-row" key={s.key}>
                    <span className="chart-legend-swatch line" style={{ background: s.color }} />
                    <Sym {...s.sym} />: {formatScientific(data[s.key][hoverIndex], 2, locale)}
                  </div>
                ))}
              </ChartTooltip>
            )}
          </div>
          <p className="hint">{t("chart.angleSweep.hint")}</p>
          {groups.length > 1 && <p className="hint">{t("chart.angleSweep.scales.hint")}</p>}
        </>
      )}

      {showTable && shown.length > 0 && (
        <table className="chart-table">
          <thead>
            <tr>
              <th>{t("chart.angleSweep.column.angle")}</th>
              {shown.map((s) => (
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
                {shown.map((s) => (
                  <td key={s.key}>{formatScientific(data[s.key][i], 3, locale)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="chart-actions">
        <ChartSnapshotButton target={svgRef} name="winkelsweep" title={t("chart.angleSweep.title")} />
      </div>
    </div>
  );
});
