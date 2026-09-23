import { memo, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  layerContributionsFamily,
  layerResultsFamily,
  solvedStrainsFamily,
} from "../store/derivedAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { failureMetricAtom } from "../store/settingsAtoms";
import { hoverZFamily } from "../store/uiAtoms";
import {
  criticalLayerIndex,
  isFailing,
  metricLimit,
  METRIC_LABEL_KEYS,
  toMetric,
  type FailureMetric,
} from "../lib/failureMetric";
import {
  metricRange,
  plyAt,
  valueAt,
  valueRange,
  verticalScale,
  type SheetAxis,
  type SheetPly,
  type SheetSystem,
  sheetPlies,
} from "../lib/throughThicknessSheet";
import { angleColor } from "../lib/stackLayout";
import { symText, type SymbolSpec } from "../lib/symbols";
import { formatFixed, formatScientific, formatSignificant } from "../lib/numberFormat";
import { criterionName, type FailureType } from "../lib/types";
import { QuantityDisplay } from "./QuantityDisplay";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { failureModeLabel, useLocale, useT } from "../i18n";

// The sampling-point sheet (F2.6): the stack and its state on one shared
// z-axis - the plies, a strain component, a stress component and the
// reserve in the chosen metric - with one crosshair that runs through all
// columns. It replaces the separate through-thickness chart and ply bar
// chart on the CLT page (O4); both stay in the code base as building blocks.
//
// Everything is the core's (N4): every value is one of the two surface
// values the core computed for a ply, or the straight line between them, on
// which strain and stress lie within a ply in CLT.

type ColumnKey = "stack" | "strain" | "stress" | "metric";
const COLUMN_KEYS: ColumnKey[] = ["stack", "strain", "stress", "metric"];

interface SheetOptions {
  component: 0 | 1 | 2;
  system: SheetSystem;
  axis: SheetAxis;
  columns: Record<ColumnKey, boolean>;
}

// A preference about the drawing, like the stack drawing's: remembered, but
// not part of the project and not undone.
const sheetOptionsAtom = atomWithStorage<SheetOptions>(
  "elamx.throughThicknessSheet",
  { component: 0, system: "local", axis: "z", columns: { stack: true, strain: true, stress: true, metric: true } },
  undefined,
  { getOnInit: true },
);

const STRAIN_SYMBOLS: Record<SheetSystem, SymbolSpec[]> = {
  local: [
    { base: "ε", sub: "1" },
    { base: "ε", sub: "2" },
    { base: "γ", sub: "12" },
  ],
  global: [
    { base: "ε", sub: "x" },
    { base: "ε", sub: "y" },
    { base: "γ", sub: "xy" },
  ],
};
const STRESS_SYMBOLS: Record<SheetSystem, SymbolSpec[]> = {
  local: [
    { base: "σ", sub: "1" },
    { base: "σ", sub: "2" },
    { base: "τ", sub: "12" },
  ],
  global: [
    { base: "σ", sub: "x" },
    { base: "σ", sub: "y" },
    { base: "τ", sub: "xy" },
  ],
};

// --- the drawing ------------------------------------------------------------

const PLOT_H = 300;
const TOP = 26;
const BOTTOM = 30;
const LEFT = 46;
const RIGHT = 10;
const COL_W = 230;
const STACK_W = 150;

/** The shape of a failure type's marker - the second signal beside the
 *  colour (N7). */
function TypeMarker({ type, x, y, failing, clipped }: { type: FailureType; x: number; y: number; failing: boolean; clipped: boolean }) {
  const fill = clipped ? "none" : failing ? "var(--danger)" : "var(--viz-series-1)";
  const stroke = failing ? "var(--danger)" : "var(--viz-series-1)";
  const r = 4.5;
  switch (type) {
    case "FiberFailure":
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    case "MatrixFailure":
      return (
        <polygon
          points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
        />
      );
    case "GeneralMaterialFailure":
      return (
        <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} fill={fill} stroke={stroke} strokeWidth={1.5} />
      );
    case "Undamaged":
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
  }
}

export interface ThroughThicknessSheetViewProps {
  plies: SheetPly[];
  options: SheetOptions;
  metric: FailureMetric;
  /** Index into `plies` of the governing ply, or -1. */
  critical: number;
  hoverZ: number | null;
  onHoverZ: (z: number | null) => void;
  locale: string;
  labels: { stack: string; strain: string; stress: string; metric: string; z: string; aria: string };
}

/** The sheet itself: pure, everything through its props. */
export function ThroughThicknessSheetView({
  plies,
  options,
  metric,
  critical,
  hoverZ,
  onHoverZ,
  locale,
  labels,
}: ThroughThicknessSheetViewProps) {
  const scale = useMemo(() => verticalScale(plies, options.axis, PLOT_H), [plies, options.axis]);
  if (plies.length === 0) return null;
  const { component, system } = options;
  const zTop = Math.max(...plies.map((p) => p.zUpper));
  const zBottom = Math.min(...plies.map((p) => p.zLower));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const box = svg.getBoundingClientRect();
    const viewHeight = svg.viewBox.baseVal.height;
    const y = ((e.clientY - box.top) / box.height) * viewHeight - TOP;
    if (y < 0 || y > PLOT_H) {
      onHoverZ(null);
      return;
    }
    onHoverZ(scale.z(y));
  };

  const zAxis = (
    <g className="tt-zaxis">
      {options.axis === "z"
        ? [zTop, 0, zBottom].map((z, i) => (
            <text key={i} x={LEFT - 6} y={TOP + scale.y(z)} textAnchor="end" dominantBaseline="middle">
              {formatFixed(z, 2, locale)}
            </text>
          ))
        : scale.bands.map((b) => (
            <text key={b.ply.number} x={LEFT - 6} y={TOP + (b.top + b.bottom) / 2} textAnchor="end" dominantBaseline="middle">
              {b.ply.number}
            </text>
          ))}
      <text x={4} y={TOP - 10} className="tt-axis-title">
        {labels.z}
      </text>
    </g>
  );

  const interfaces = scale.bands.slice(1).map((b) => (
    <line key={b.ply.number} x1={LEFT} x2={COL_W - RIGHT} y1={TOP + b.top} y2={TOP + b.top} className="chart-gridline" />
  ));

  const crosshair = (width: number) =>
    hoverZ !== null && hoverZ <= zTop && hoverZ >= zBottom ? (
      <line x1={LEFT} x2={width - RIGHT} y1={TOP + scale.y(hoverZ)} y2={TOP + scale.y(hoverZ)} className="tt-crosshair" />
    ) : null;

  const svgProps = (width: number, title: string) => ({
    className: "chart-svg tt-svg",
    viewBox: `0 0 ${width} ${TOP + PLOT_H + BOTTOM}`,
    width: "100%",
    role: "img" as const,
    "aria-label": `${labels.aria}: ${title}`,
    onPointerMove: onMove,
    onPointerLeave: () => onHoverZ(null),
  });

  const valueColumn = (quantity: "strain" | "stress", title: string) => {
    const [lo, hi] = valueRange(plies, quantity, system, component);
    const x = (v: number) => LEFT + ((v - lo) / (hi - lo)) * (COL_W - LEFT - RIGHT);
    const fmt = (v: number) => (quantity === "strain" ? formatScientific(v, 1, locale) : formatSignificant(v, 3, locale));
    const hoverPly = hoverZ !== null ? plyAt(plies, hoverZ) : null;
    return (
      <svg {...svgProps(COL_W, title)}>
        <text x={LEFT} y={14} className="tt-col-title">
          {title}
        </text>
        {zAxis}
        {interfaces}
        <line x1={x(0)} x2={x(0)} y1={TOP} y2={TOP + PLOT_H} className="chart-axis" />
        {[lo, hi].map((v, i) => (
          <text key={i} x={x(v)} y={TOP + PLOT_H + 16} textAnchor={i === 0 ? "start" : "end"}>
            {fmt(v)}
          </text>
        ))}
        {plies.map((p) => {
          const lower = p[quantity][system].lower[component];
          const upper = p[quantity][system].upper[component];
          return (
            <line
              key={p.number}
              x1={x(lower)}
              x2={x(upper)}
              y1={TOP + scale.y(p.zLower)}
              y2={TOP + scale.y(p.zUpper)}
              className="tt-line"
            />
          );
        })}
        {crosshair(COL_W)}
        {hoverPly && hoverZ !== null && (
          <circle cx={x(valueAt(hoverPly, quantity, system, component, hoverZ))} cy={TOP + scale.y(hoverZ)} r={3.5} className="tt-hover-dot" />
        )}
      </svg>
    );
  };

  const stackColumn = (
    <svg {...svgProps(STACK_W, labels.stack)}>
      <text x={LEFT} y={14} className="tt-col-title">
        {labels.stack}
      </text>
      {zAxis}
      {scale.bands.map((b) => {
        const h = b.bottom - b.top;
        const index = plies.indexOf(b.ply);
        return (
          <g key={b.ply.number}>
            <rect x={LEFT} y={TOP + b.top} width={STACK_W - LEFT - RIGHT} height={Math.max(h - 1, 0.5)} rx={2} fill={angleColor(b.ply.angle)} opacity={0.35} />
            {h >= 11 && (
              <text x={LEFT + (STACK_W - LEFT - RIGHT) / 2} y={TOP + b.top + h / 2} textAnchor="middle" dominantBaseline="central">
                {b.ply.angle}°
              </text>
            )}
            {index === critical && h >= 9 && (
              // The governing ply: a crosshair symbol, not only a colour (N7).
              <g className="tt-critical" transform={`translate(${STACK_W - RIGHT - 9}, ${TOP + b.top + h / 2})`}>
                <circle r={5} fill="none" />
                <line x1={-7} x2={7} y1={0} y2={0} />
                <line x1={0} x2={0} y1={-7} y2={7} />
              </g>
            )}
          </g>
        );
      })}
      {zTop > 0 && zBottom < 0 && (
        <line x1={LEFT} x2={STACK_W - RIGHT} y1={TOP + scale.y(0)} y2={TOP + scale.y(0)} className="tt-midplane" />
      )}
      {crosshair(STACK_W)}
    </svg>
  );

  const metricColumn = (() => {
    const [lo, hi] = metricRange(plies, metric);
    const limit = metricLimit(metric);
    const x = (v: number) => LEFT + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (COL_W - LEFT - RIGHT);
    return (
      <svg {...svgProps(COL_W, labels.metric)}>
        <text x={LEFT} y={14} className="tt-col-title">
          {labels.metric}
        </text>
        {zAxis}
        {interfaces}
        <line x1={x(limit)} x2={x(limit)} y1={TOP} y2={TOP + PLOT_H} className="tt-limit" />
        {Array.from(new Set([lo, limit, hi])).map((v, i) => (
          <text key={i} x={x(v)} y={TOP + PLOT_H + 16} textAnchor={v === lo ? "start" : v === hi ? "end" : "middle"}>
            {formatFixed(v, 1, locale)}
          </text>
        ))}
        {plies.map((p) => {
          const points = (["lower", "upper"] as const).map((side) => {
            const rf = p.rf[side];
            const value = toMetric(rf.minimal_reserve_factor, metric);
            return {
              side,
              value,
              type: rf.failure_type,
              y: TOP + scale.y(side === "lower" ? p.zLower : p.zUpper),
              clipped: !Number.isFinite(value) || value > hi || value < lo,
            };
          });
          return (
            <g key={p.number}>
              <line x1={x(points[0].value)} x2={x(points[1].value)} y1={points[0].y} y2={points[1].y} className="tt-metric-line" />
              {points.map((pt) => (
                <TypeMarker
                  key={pt.side}
                  type={pt.type}
                  x={x(pt.value)}
                  y={pt.y}
                  failing={isFailing(pt.value, metric)}
                  clipped={pt.clipped}
                />
              ))}
            </g>
          );
        })}
        {crosshair(COL_W)}
      </svg>
    );
  })();

  const columns: Record<ColumnKey, ReactNode> = {
    stack: stackColumn,
    strain: valueColumn("strain", labels.strain),
    stress: valueColumn("stress", labels.stress),
    metric: metricColumn,
  };

  // Up/Down step the crosshair ply by ply, so the readout is reachable
  // without a pointer.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Escape") return;
    e.preventDefault();
    if (e.key === "Escape") {
      onHoverZ(null);
      return;
    }
    const bands = scale.bands;
    const current = hoverZ === null ? -1 : bands.findIndex((b) => hoverZ <= b.ply.zUpper && hoverZ >= b.ply.zLower);
    const next = Math.max(0, Math.min(bands.length - 1, current + (e.key === "ArrowDown" ? 1 : current < 0 ? 1 : -1)));
    const ply = bands[next].ply;
    onHoverZ((ply.zUpper + ply.zLower) / 2);
  };

  return (
    <div className="tt-sheet viz" tabIndex={0} onKeyDown={onKey} aria-label={labels.aria}>
      {COLUMN_KEYS.filter((k) => options.columns[k]).map((k) => (
        <div key={k} className={`tt-col tt-col-${k}`}>
          {columns[k]}
        </div>
      ))}
    </div>
  );
}

// --- the connected sheet ------------------------------------------------------

export const ThroughThicknessSheet = memo(function ThroughThicknessSheet({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const contributions = useAtomValue(layerContributionsFamily(laminateId));
  const results = useAtomValue(layerResultsFamily(laminateId));
  const strains = useAtomValue(solvedStrainsFamily(laminateId));
  const metric = useAtomValue(failureMetricAtom);
  const [hoverZ, setHoverZ] = useAtom(hoverZFamily(laminateId));
  const [options, setOptions] = useAtom(sheetOptionsAtom);
  useAtomValue(materialsAtom);

  const plies = useMemo(
    () => (contributions && results && contributions.length === results.length ? sheetPlies(contributions, results) : []),
    [contributions, results],
  );
  if (plies.length === 0 || !results) return null;

  const critical = criticalLayerIndex(results);
  const strainSym = STRAIN_SYMBOLS[options.system][options.component];
  const stressSym = STRESS_SYMBOLS[options.system][options.component];
  const metricName = t(METRIC_LABEL_KEYS[metric]);
  const hoverPly = hoverZ !== null ? plyAt(plies, hoverZ) : null;

  // The worked example for "how": the hovered ply, or the governing one, at
  // its upper surface, in the global x direction where eps0 + z kappa holds
  // component by component.
  const example = hoverPly ?? plies[Math.max(critical, 0)];
  const zExample = hoverPly && hoverZ !== null ? hoverZ : example.zUpper;
  const epsX = example.strain.global.lower[0] + ((zExample - example.zLower) / (example.zUpper - example.zLower || 1)) * (example.strain.global.upper[0] - example.strain.global.lower[0]);
  const sig = (v: number) => formatSignificant(v, 4, locale);

  const setOption = <K extends keyof SheetOptions>(key: K, value: SheetOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  return (
    <div className="chart tt-panel">
      <p className="chart-title">{t("sheet.title")}</p>
      <div className="chart-controls tt-controls">
        <div className="segmented" role="radiogroup" aria-label={t("sheet.component")}>
          {([0, 1, 2] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={options.component === c}
              className={options.component === c ? "active" : undefined}
              onClick={() => setOption("component", c)}
            >
              {STRESS_SYMBOLS[options.system][c].sub}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("sheet.system")}>
          {(["local", "global"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={options.system === s}
              className={options.system === s ? "active" : undefined}
              onClick={() => setOption("system", s)}
            >
              {t(s === "local" ? "sheet.system.local" : "sheet.system.global")}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("sheet.axis")}>
          {(["z", "ply"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={options.axis === a}
              className={options.axis === a ? "active" : undefined}
              onClick={() => setOption("axis", a)}
            >
              {t(a === "z" ? "sheet.axis.z" : "sheet.axis.ply")}
            </button>
          ))}
        </div>
        <span className="tt-column-toggles">
          {COLUMN_KEYS.map((k) => (
            <label key={k} className="inline-check">
              <input
                type="checkbox"
                checked={options.columns[k]}
                onChange={(e) => setOption("columns", { ...options.columns, [k]: e.target.checked })}
              />
              {k === "metric" ? metricName : t(`sheet.column.${k}`)}
            </label>
          ))}
        </span>
      </div>

      <ThroughThicknessSheetView
        plies={plies}
        options={options}
        metric={metric}
        critical={critical}
        hoverZ={hoverZ}
        onHoverZ={setHoverZ}
        locale={locale}
        labels={{
          stack: t("sheet.column.stack"),
          strain: `${symText(strainSym)} (${t(options.system === "local" ? "common.local" : "common.global")})`,
          stress: `${symText(stressSym)} [MPa]`,
          metric: metricName,
          z: t(options.axis === "z" ? "sheet.zLabel" : "sheet.plyLabel"),
          aria: t("sheet.aria"),
        }}
      />

      <SheetReadout plies={plies} hoverZ={hoverZ} options={options} metric={metric} />
      <p className="hint tt-legend">
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" className="tt-legend-mark" /></svg>
          {t("failureType.FiberFailure")}
        </span>
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><polygon points="6,1 11,11 1,11" className="tt-legend-mark" /></svg>
          {t("failureType.MatrixFailure")}
        </span>
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><polygon points="6,1 11,6 6,11 1,6" className="tt-legend-mark" /></svg>
          {t("failureType.GeneralMaterialFailure")}
        </span>
        <span>{t("sheet.hint")}</span>
      </p>

      {strains && (
        <HowWasThisComputed
          title={t("sheet.howTitle")}
          formula={"\\varepsilon(z) = \\varepsilon^0 + z\\,\\kappa, \\qquad \\sigma(z) = \\bar{Q}\\,\\varepsilon(z)"}
          substituted={`\\varepsilon_x(${sig(zExample)}) = ${sig(strains.epsilon_x)} + (${sig(zExample)}) \\cdot (${sig(strains.kappa_x)}) = ${sig(epsX)}`}
        >
          <p className="hint">{t("sheet.howHint", { nr: example.number })}</p>
        </HowWasThisComputed>
      )}
    </div>
  );
});

/** The values at the crosshair, as text - what the pointer points at, for
 *  anyone who cannot read it off the lines. */
function SheetReadout({
  plies,
  hoverZ,
  options,
  metric,
}: {
  plies: SheetPly[];
  hoverZ: number | null;
  options: SheetOptions;
  metric: FailureMetric;
}) {
  const t = useT();
  const locale = useLocale();
  const ply = hoverZ !== null ? plyAt(plies, hoverZ) : null;
  if (!ply || hoverZ === null) {
    return <p className="hint tt-readout">{t("sheet.readout.none")}</p>;
  }
  const { component, system } = options;
  const strainSym = STRAIN_SYMBOLS[system][component];
  const stressSym = STRESS_SYMBOLS[system][component];
  const metricName = t(METRIC_LABEL_KEYS[metric]);
  return (
    <div className="tt-readout" aria-live="polite">
      <span>
        z = <QuantityDisplay category="thickness" value={hoverZ} />
      </span>
      <span>{t("sheet.readout.ply", { nr: ply.number, angle: formatFixed(ply.angle, 0, locale) })}</span>
      <span>
        {symText(strainSym)} = <QuantityDisplay category="strain" value={valueAt(ply, "strain", system, component, hoverZ)} />
      </span>
      <span>
        {symText(stressSym)} = <QuantityDisplay category="stress" value={valueAt(ply, "stress", system, component, hoverZ)} />
      </span>
      {(["upper", "lower"] as const).map((side) => (
        <span key={side}>
          {metricName} {t(side === "upper" ? "common.top" : "common.bottom")} ={" "}
          <QuantityDisplay category="reserveFactor" value={toMetric(ply.rf[side].minimal_reserve_factor, metric)} />{" "}
          ({criterionName(ply.criterion[side], t)}, {failureModeLabel(locale, ply.rf[side].failure_name) || "–"})
        </span>
      ))}
    </div>
  );
}
