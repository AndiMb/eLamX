import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { throughThicknessFamily, type ThroughThicknessLayer } from "../../store/derivedAtoms";
import { ChartTooltip } from "./ChartTooltip";
import { useT } from "../../i18n";
import { symText, type SymbolSpec } from "../../lib/symbols";

// WIDTH matches AngleSweepChart/ReserveFactorChart (both 600) so all three
// charts share the same viewBox-to-rendered-width scale factor when placed
// in equally-wide containers - otherwise .chart-svg text's fixed font-size
// renders at inconsistent on-screen sizes across charts (this one used to be
// 320, rendering its text ~1.9x larger than its siblings).
const WIDTH = 600;
const HEIGHT = 340;
const MARGIN = { top: 10, right: 16, bottom: 24, left: 54 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

type FieldKey = "stressLocal" | "stressGlobal" | "strainLocal" | "strainGlobal";

// Only the reference frame ("local"/"global") is a word and therefore
// translatable - the symbols themselves are notation and stay as-is. The
// component list is kept at module scope in this symbol+frame form and the
// user-visible label is assembled per language inside the component.
//
// These labels are consumed by <option> content and an aria-label, both of
// which are plain-text-only slots, so they go through symText() rather than
// <Sym> - the indices used to be a mix of Unicode subscripts (σ₁, τ₁₂) and
// bare adjacency (σx, τxy); see lib/symbols.ts for why adjacency won.
const COMPONENTS: { key: string; field: FieldKey; idx: 0 | 1 | 2; sym: SymbolSpec; frame: "local" | "global"; unit: string }[] = [
  { key: "sl0", field: "stressLocal", idx: 0, sym: { base: "σ", sub: "1" }, frame: "local", unit: "MPa" },
  { key: "sl1", field: "stressLocal", idx: 1, sym: { base: "σ", sub: "2" }, frame: "local", unit: "MPa" },
  { key: "sl2", field: "stressLocal", idx: 2, sym: { base: "τ", sub: "12" }, frame: "local", unit: "MPa" },
  { key: "sg0", field: "stressGlobal", idx: 0, sym: { base: "σ", sub: "x" }, frame: "global", unit: "MPa" },
  { key: "sg1", field: "stressGlobal", idx: 1, sym: { base: "σ", sub: "y" }, frame: "global", unit: "MPa" },
  { key: "sg2", field: "stressGlobal", idx: 2, sym: { base: "τ", sub: "xy" }, frame: "global", unit: "MPa" },
  { key: "el0", field: "strainLocal", idx: 0, sym: { base: "ε", sub: "1" }, frame: "local", unit: "" },
  { key: "el1", field: "strainLocal", idx: 1, sym: { base: "ε", sub: "2" }, frame: "local", unit: "" },
  { key: "el2", field: "strainLocal", idx: 2, sym: { base: "γ", sub: "12" }, frame: "local", unit: "" },
  { key: "eg0", field: "strainGlobal", idx: 0, sym: { base: "ε", sub: "x" }, frame: "global", unit: "" },
  { key: "eg1", field: "strainGlobal", idx: 1, sym: { base: "ε", sub: "y" }, frame: "global", unit: "" },
  { key: "eg2", field: "strainGlobal", idx: 2, sym: { base: "γ", sub: "xy" }, frame: "global", unit: "" },
];

function valueOf(layer: ThroughThicknessLayer, field: FieldKey, idx: 0 | 1 | 2, which: "lower" | "upper") {
  return layer[field][which][idx];
}

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const ThroughThicknessChart = memo(function ThroughThicknessChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const layers = useAtomValue(throughThicknessFamily(laminateId));
  const [componentKey, setComponentKey] = useState(COMPONENTS[0].key);
  const [hoverLayer, setHoverLayer] = useState<{ layer: ThroughThicknessLayer; x: number; y: number } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const components = useMemo(
    () =>
      COMPONENTS.map((c) => ({
        ...c,
        label: `${symText(c.sym)} (${t(c.frame === "local" ? "common.local" : "common.global")})`,
      })),
    [t],
  );

  const component = components.find((c) => c.key === componentKey)!;
  const { field, idx } = component;

  // Depends on the selected field/index, not on the `component` object, whose
  // identity changes on every language switch - the numbers plotted do not.
  const scales = useMemo(() => {
    if (!layers || layers.length === 0) return null;
    const zMin = Math.min(...layers.map((l) => l.zLower));
    const zMax = Math.max(...layers.map((l) => l.zUpper));
    const values = layers.flatMap((l) => [valueOf(l, field, idx, "lower"), valueOf(l, field, idx, "upper")]);
    const vMin = Math.min(...values, 0);
    const vMax = Math.max(...values, 0);
    const zScale = (z: number) => PLOT_H - ((z - zMin) / (zMax - zMin || 1)) * PLOT_H;
    const vScale = (v: number) => ((v - vMin) / (vMax - vMin || 1)) * PLOT_W;
    return { zMin, zMax, vMin, vMax, zScale, vScale };
  }, [layers, field, idx]);

  if (!layers || layers.length === 0 || !scales) return null;
  const { zScale, vScale, zMin, zMax, vMin, vMax } = scales;

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.throughThickness.title")}</p>
      <div className="chart-controls">
        <select value={componentKey} onChange={(e) => setComponentKey(e.target.value)}>
          {components.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {t(showTable ? "chart.showChart" : "chart.showTable")}
        </button>
      </div>
      {!showTable && (
        <div className="chart-svg-wrap">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            role="img"
            aria-label={t("chart.throughThickness.aria", { component: component.label })}
          >
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {/* Keyed by position: all three collapse onto 0 for a laminate
                  with no layers or zero thickness. */}
              {[zMin, (zMin + zMax) / 2, zMax].map((z, tickIndex) => (
                <g key={tickIndex}>
                  <line x1={0} x2={PLOT_W} y1={zScale(z)} y2={zScale(z)} className="chart-gridline" />
                  <text x={-8} y={zScale(z)} textAnchor="end" dominantBaseline="middle">
                    {z.toFixed(2)}
                  </text>
                </g>
              ))}
              {layers.slice(1).map((l) => (
                <line key={l.layerNumber} x1={0} x2={PLOT_W} y1={zScale(l.zLower)} y2={zScale(l.zLower)} className="chart-gridline" />
              ))}
              <line x1={vScale(0)} x2={vScale(0)} y1={0} y2={PLOT_H} className="chart-axis" />
              {[vMin, vMax].map((v, tickIndex) => (
                <text key={tickIndex} x={vScale(v)} y={PLOT_H + 16} textAnchor="middle">
                  {v.toExponential(1)}
                </text>
              ))}
              {layers.map((l) => {
                const lower = valueOf(l, field, idx, "lower");
                const upper = valueOf(l, field, idx, "upper");
                return (
                  <g key={l.layerNumber}>
                    <line
                      x1={vScale(lower)}
                      y1={zScale(l.zLower)}
                      x2={vScale(upper)}
                      y2={zScale(l.zUpper)}
                      stroke="var(--viz-series-1)"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <rect
                      x={0}
                      y={zScale(l.zUpper)}
                      width={PLOT_W}
                      height={Math.max(1, zScale(l.zLower) - zScale(l.zUpper))}
                      fill="transparent"
                      pointerEvents="all"
                      onPointerMove={(e) => {
                        const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                        setHoverLayer({ layer: l, x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
                      }}
                      onPointerLeave={() => setHoverLayer((h) => (h?.layer === l ? null : h))}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          {hoverLayer && (
            <ChartTooltip x={hoverLayer.x} y={hoverLayer.y}>
              <div>
                <strong>{t("chart.layer", { nr: hoverLayer.layer.layerNumber })}</strong>
              </div>
              <div>
                {t("common.bottom")} (z={hoverLayer.layer.zLower.toFixed(3)}):{" "}
                {valueOf(hoverLayer.layer, field, idx, "lower").toExponential(3)} {component.unit}
              </div>
              <div>
                {t("common.top")} (z={hoverLayer.layer.zUpper.toFixed(3)}):{" "}
                {valueOf(hoverLayer.layer, field, idx, "upper").toExponential(3)} {component.unit}
              </div>
            </ChartTooltip>
          )}
        </div>
      )}
      {showTable && (
        <table className="chart-table">
          <thead>
            <tr>
              <th>{t("chart.throughThickness.column.layer")}</th>
              <th>{t("chart.throughThickness.column.zLower")}</th>
              <th>{t("chart.throughThickness.column.valueLower")}</th>
              <th>{t("chart.throughThickness.column.zUpper")}</th>
              <th>{t("chart.throughThickness.column.valueUpper")}</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((l) => (
              <tr key={l.layerNumber}>
                <td>{l.layerNumber}</td>
                <td>{l.zLower.toFixed(3)}</td>
                <td>{valueOf(l, field, idx, "lower").toExponential(3)}</td>
                <td>{l.zUpper.toFixed(3)}</td>
                <td>{valueOf(l, field, idx, "upper").toExponential(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
