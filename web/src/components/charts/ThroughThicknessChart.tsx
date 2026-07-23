import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { throughThicknessFamily, type ThroughThicknessLayer } from "../../store/derivedAtoms";
import { ChartTooltip } from "./ChartTooltip";

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

const COMPONENTS: { key: string; field: FieldKey; idx: 0 | 1 | 2; label: string; unit: string }[] = [
  { key: "sl0", field: "stressLocal", idx: 0, label: "σ₁ (lokal)", unit: "MPa" },
  { key: "sl1", field: "stressLocal", idx: 1, label: "σ₂ (lokal)", unit: "MPa" },
  { key: "sl2", field: "stressLocal", idx: 2, label: "τ₁₂ (lokal)", unit: "MPa" },
  { key: "sg0", field: "stressGlobal", idx: 0, label: "σx (global)", unit: "MPa" },
  { key: "sg1", field: "stressGlobal", idx: 1, label: "σy (global)", unit: "MPa" },
  { key: "sg2", field: "stressGlobal", idx: 2, label: "τxy (global)", unit: "MPa" },
  { key: "el0", field: "strainLocal", idx: 0, label: "ε₁ (lokal)", unit: "" },
  { key: "el1", field: "strainLocal", idx: 1, label: "ε₂ (lokal)", unit: "" },
  { key: "el2", field: "strainLocal", idx: 2, label: "γ₁₂ (lokal)", unit: "" },
  { key: "eg0", field: "strainGlobal", idx: 0, label: "εx (global)", unit: "" },
  { key: "eg1", field: "strainGlobal", idx: 1, label: "εy (global)", unit: "" },
  { key: "eg2", field: "strainGlobal", idx: 2, label: "γxy (global)", unit: "" },
];

function valueOf(layer: ThroughThicknessLayer, field: FieldKey, idx: 0 | 1 | 2, which: "lower" | "upper") {
  return layer[field][which][idx];
}

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const ThroughThicknessChart = memo(function ThroughThicknessChart({ laminateId }: { laminateId: string }) {
  const layers = useAtomValue(throughThicknessFamily(laminateId));
  const [componentKey, setComponentKey] = useState(COMPONENTS[0].key);
  const [hoverLayer, setHoverLayer] = useState<{ layer: ThroughThicknessLayer; x: number; y: number } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const component = COMPONENTS.find((c) => c.key === componentKey)!;

  const scales = useMemo(() => {
    if (!layers || layers.length === 0) return null;
    const zMin = Math.min(...layers.map((l) => l.zLower));
    const zMax = Math.max(...layers.map((l) => l.zUpper));
    const values = layers.flatMap((l) => [
      valueOf(l, component.field, component.idx, "lower"),
      valueOf(l, component.field, component.idx, "upper"),
    ]);
    const vMin = Math.min(...values, 0);
    const vMax = Math.max(...values, 0);
    const zScale = (z: number) => PLOT_H - ((z - zMin) / (zMax - zMin || 1)) * PLOT_H;
    const vScale = (v: number) => ((v - vMin) / (vMax - vMin || 1)) * PLOT_W;
    return { zMin, zMax, vMin, vMax, zScale, vScale };
  }, [layers, component]);

  if (!layers || layers.length === 0 || !scales) return null;
  const { zScale, vScale, zMin, zMax, vMin, vMax } = scales;

  return (
    <div className="chart viz">
      <p className="chart-title">Dickenverlauf: Spannung / Dehnung</p>
      <div className="chart-controls">
        <select value={componentKey} onChange={(e) => setComponentKey(e.target.value)}>
          {COMPONENTS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="chart-table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Diagramm anzeigen" : "Tabelle anzeigen"}
        </button>
      </div>
      {!showTable && (
        <div className="chart-svg-wrap">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            role="img"
            aria-label={`Dickenverlauf ${component.label}`}
          >
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {[zMin, (zMin + zMax) / 2, zMax].map((z) => (
                <g key={z}>
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
              {[vMin, vMax].map((v) => (
                <text key={v} x={vScale(v)} y={PLOT_H + 16} textAnchor="middle">
                  {v.toExponential(1)}
                </text>
              ))}
              {layers.map((l) => {
                const lower = valueOf(l, component.field, component.idx, "lower");
                const upper = valueOf(l, component.field, component.idx, "upper");
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
                <strong>Lage {hoverLayer.layer.layerNumber}</strong>
              </div>
              <div>
                unten (z={hoverLayer.layer.zLower.toFixed(3)}):{" "}
                {valueOf(hoverLayer.layer, component.field, component.idx, "lower").toExponential(3)} {component.unit}
              </div>
              <div>
                oben (z={hoverLayer.layer.zUpper.toFixed(3)}):{" "}
                {valueOf(hoverLayer.layer, component.field, component.idx, "upper").toExponential(3)} {component.unit}
              </div>
            </ChartTooltip>
          )}
        </div>
      )}
      {showTable && (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Lage</th>
              <th>z unten</th>
              <th>Wert unten</th>
              <th>z oben</th>
              <th>Wert oben</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((l) => (
              <tr key={l.layerNumber}>
                <td>{l.layerNumber}</td>
                <td>{l.zLower.toFixed(3)}</td>
                <td>{valueOf(l, component.field, component.idx, "lower").toExponential(3)}</td>
                <td>{l.zUpper.toFixed(3)}</td>
                <td>{valueOf(l, component.field, component.idx, "upper").toExponential(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
