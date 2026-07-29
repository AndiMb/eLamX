import { memo, useState } from "react";
import { useAtomValue } from "jotai";
import { abdMatrixFamily } from "../../store/derivedAtoms";
import { ChartTooltip } from "./ChartTooltip";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";
import type { SymbolSpec } from "../../lib/symbols";
import { Sym } from "../Sym";

const CELL = 40;
const GAP = 2;
const BLOCK_GAP = 8;

const AXIS_LABELS = ["1", "2", "6", "1", "2", "6"];
const BLOCK_OF = (i: number) => (i < 3 ? "A" : "D"); // row-block; column-block uses the same function

function lerpChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function lerpColor(hexA: string, hexB: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = pa.map((ca, i) => lerpChannel(ca, pb[i], t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Diverging blue<->red, neutral gray midpoint, normalized PER BLOCK (A, B, D):
// the three blocks differ by orders of magnitude (A ~ N/mm, B ~ N, D ~ N*mm),
// so one global scale would render B and D as uniformly "cold" regardless of
// their own internal structure - normalizing each block to its own max
// magnitude keeps every block's relative pattern (e.g. bend-twist coupling in
// D16/D26) visible.
function cellColor(value: number, blockMax: number, neg: string, mid: string, pos: string) {
  if (blockMax === 0) return mid;
  const t = Math.max(-1, Math.min(1, value / blockMax));
  return t >= 0 ? lerpColor(mid, pos, t) : lerpColor(mid, neg, -t);
}

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
// The raw ABD values are already shown as an exact table in AbdMatrixPanel
// right above this chart, so every value here is reachable without hovering.
export const AbdHeatmap = memo(function AbdHeatmap({ laminateId }: { laminateId: string }) {
  const t = useT();
  const abd = useAtomValue(abdMatrixFamily(laminateId));
  const [hover, setHover] = useState<{ i: number; j: number; x: number; y: number } | null>(null);
  const colors = useChartColors();

  if (!abd) return null;

  const blockMax = (rows: number[], cols: number[]) =>
    Math.max(...rows.flatMap((i) => cols.map((j) => Math.abs(abd[i][j]))), 1e-30);

  const maxA = blockMax([0, 1, 2], [0, 1, 2]);
  const maxB = blockMax([0, 1, 2], [3, 4, 5]);
  const maxD = blockMax([3, 4, 5], [3, 4, 5]);

  const { neg: negVar, mid: midVar, pos: posVar } = colors.diverging;

  const size = 6 * CELL + 5 * GAP + BLOCK_GAP * 2;

  const posFor = (index: number) => index * (CELL + GAP) + (index >= 3 ? BLOCK_GAP : 0);

  const blockSymbol = (i: number, j: number): SymbolSpec => {
    const rowBlock = BLOCK_OF(i);
    const colBlock = BLOCK_OF(j);
    const sub = `${AXIS_LABELS[i]}${AXIS_LABELS[j]}`;
    if (rowBlock === "A" && colBlock === "A") return { base: "A", sub };
    if (rowBlock === "D" && colBlock === "D") return { base: "D", sub };
    return { base: "B", sub };
  };

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.abdHeatmap.title")}</p>
      <div className="chart-svg-wrap">
        <svg
          className="chart-svg"
          viewBox={`0 0 ${size} ${size}`}
          width={Math.min(size, 320)}
          role="img"
          aria-label={t("chart.abdHeatmap.aria")}
        >
          {abd.map((row, i) =>
            row.map((value, j) => {
              const max = BLOCK_OF(i) === "A" && BLOCK_OF(j) === "A" ? maxA : BLOCK_OF(i) === "D" && BLOCK_OF(j) === "D" ? maxD : maxB;
              return (
                <rect
                  key={`${i}-${j}`}
                  x={posFor(j)}
                  y={posFor(i)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={cellColor(value, max, negVar, midVar, posVar)}
                  stroke={hover?.i === i && hover?.j === j ? "var(--viz-text-primary)" : "transparent"}
                  strokeWidth={1.5}
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover({ i, j, x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
                  }}
                  onPointerLeave={() => setHover((h) => (h?.i === i && h?.j === j ? null : h))}
                />
              );
            }),
          )}
        </svg>
        {hover && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <strong>
              <Sym {...blockSymbol(hover.i, hover.j)} />
            </strong>
            : {abd[hover.i][hover.j].toExponential(3)}
          </ChartTooltip>
        )}
      </div>
    </div>
  );
});
