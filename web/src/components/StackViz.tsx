import { useAtomValue } from "jotai";
import { materialsAtom } from "../store/materialsAtoms";
import type { LayerRow } from "../lib/constants";
import { useT } from "../i18n";

const WIDTH = 320;
const MAX_HEIGHT = 150;
const MIN_BAR = 4;

// Material identity -> fixed categorical slot (never re-assigned by current
// filter state; index in the materials catalog is stable per session).
const SLOT_VARS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-5)",
  "var(--viz-series-6)",
  "var(--viz-series-8)",
];

// Small teaching aid beyond the Java original (which only had the table):
// the stack drawn to scale - bar height proportional to thickness, fill by
// material, angle as text, dashed midplane, mirrored half at reduced opacity
// when the laminate is symmetric. Layer 0 is drawn at the TOP, matching the
// Rust core's z-convention (first layer at +tges/2).
export function StackViz({
  layers,
  symmetric,
  withMiddleLayer,
}: {
  layers: LayerRow[];
  symmetric: boolean;
  withMiddleLayer: boolean;
}) {
  const t = useT();
  const materials = useAtomValue(materialsAtom);
  if (layers.length === 0) return null;

  const materialIndex = (id: string) => Math.max(0, materials.findIndex((m) => m.id === id));

  const mirrored = symmetric ? [...layers].reverse().slice(withMiddleLayer ? 1 : 0) : [];
  const all = [
    ...layers.map((l) => ({ layer: l, mirror: false })),
    ...mirrored.map((l) => ({ layer: l, mirror: true })),
  ];

  const totalT = all.reduce((s, e) => s + Math.max(e.layer.thickness, 1e-9), 0);
  const scale = MAX_HEIGHT / totalT;

  let y = 0;
  const bars = all.map((entry, i) => {
    const h = Math.max(MIN_BAR, entry.layer.thickness * scale);
    const bar = (
      <g key={`${entry.layer.id}-${entry.mirror ? "m" : "o"}-${i}`} opacity={entry.mirror ? 0.35 : 1}>
        <rect
          x={0}
          y={y}
          width={WIDTH}
          height={h - 1}
          rx={2}
          fill={SLOT_VARS[materialIndex(entry.layer.materialId) % SLOT_VARS.length]}
          opacity={0.35}
        />
        {h >= 11 && (
          <text x={WIDTH / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central">
            {entry.layer.angle}°
          </text>
        )}
      </g>
    );
    y += h;
    return bar;
  });

  const totalHeight = y;
  const midY = symmetric ? totalHeight / 2 : null;

  return (
    <svg
      className="stack-viz viz"
      viewBox={`0 0 ${WIDTH} ${totalHeight}`}
      width="100%"
      style={{ maxWidth: 320 }}
      role="img"
      aria-label={t("layers.viz.aria")}
    >
      {bars}
      {midY !== null && (
        <line
          x1={0}
          x2={WIDTH}
          y1={midY}
          y2={midY}
          stroke="var(--viz-text-muted)"
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      )}
      <style>{`.stack-viz text { fill: var(--viz-text-primary); font-size: 10px; }`}</style>
    </svg>
  );
}
