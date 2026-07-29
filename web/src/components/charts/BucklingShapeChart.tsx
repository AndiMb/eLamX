import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { bucklingShapeFamily } from "../../store/bucklingAtoms";
import { bucklingInputFamily } from "../../store/bucklingAtoms";
import { ChartTooltip } from "./ChartTooltip";
import { useChartColors } from "../../lib/chartColors";
import { useT } from "../../i18n";

// The buckle drawn as a filled contour plot with the zero line picked out.
// A diverging scale is the right call here and a sequential one would be
// wrong: the sign of w is meaningful (which way the plate bulges), the
// interesting structure is where it CHANGES sign, and 0 is a real neutral
// point rather than just the bottom of the range.
const CELLS = 40;

function lerpChannel(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function lerpColor(hexA: string, hexB: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = pa.map((ca, i) => lerpChannel(ca, pb[i], t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const BucklingShapeChart = memo(function BucklingShapeChart({
  laminateId,
}: {
  laminateId: string;
}) {
  const t = useT();
  const surface = useAtomValue(bucklingShapeFamily(laminateId));
  const input = useAtomValue(bucklingInputFamily(laminateId));
  const colors = useChartColors();
  const [hover, setHover] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);

  // The plate is drawn to scale, so an elongated plate reads as elongated -
  // its aspect ratio is a first-order driver of which mode wins.
  const aspect = input.width > 0 ? input.length / input.width : 1;
  const plotW = aspect >= 1 ? CELLS * aspect : CELLS;
  const plotH = aspect >= 1 ? CELLS : CELLS / aspect;

  const cells = useMemo(() => {
    if (!surface || surface.length < 2) return null;
    const rows = surface.length;
    const cols = surface[0].length;
    const { neg, mid, pos } = colors.diverging;
    const out: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Math.max(-1, Math.min(1, surface[r][c]));
        out.push({
          x: (c / cols) * plotW,
          y: (r / rows) * plotH,
          // +0.6 rather than +1: neighbouring cells overlap slightly so the
          // fill has no hairline seams at fractional device pixels.
          w: plotW / cols + 0.6,
          h: plotH / rows + 0.6,
          fill: v >= 0 ? lerpColor(mid, pos, v) : lerpColor(mid, neg, -v),
        });
      }
    }
    return out;
  }, [surface, colors, plotW, plotH]);

  if (!surface || !cells) return null;

  const rows = surface.length;
  const cols = surface[0].length;

  return (
    <div className="chart viz">
      <p className="chart-title">{t("buckling.shape.title")}</p>
      <div className="chart-svg-wrap">
        <svg
          className="chart-svg"
          viewBox={`-2 -2 ${plotW + 4} ${plotH + 4}`}
          width="100%"
          role="img"
          aria-label={t("buckling.shape.aria")}
        >
          {cells.map((cell, i) => (
            <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill={cell.fill} />
          ))}
          <rect
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            fill="none"
            stroke="var(--viz-text-primary)"
            strokeWidth={0.4}
          />
          <rect
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            fill="transparent"
            pointerEvents="all"
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const fx = (e.clientX - box.left) / box.width;
              const fy = (e.clientY - box.top) / box.height;
              const sx = Math.min(cols - 1, Math.max(0, Math.floor(fx * cols)));
              const sy = Math.min(rows - 1, Math.max(0, Math.floor(fy * rows)));
              setHover({ x: e.clientX - box.left + 12, y: e.clientY - box.top + 12, sx, sy });
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <div>
              x = {((hover.sx / (cols - 1)) * input.length).toFixed(0)} mm, y ={" "}
              {((hover.sy / (rows - 1)) * input.width).toFixed(0)} mm
            </div>
            <div>
              {t("buckling.shape.relativeDeflection")}: {surface[hover.sy][hover.sx].toFixed(3)}
            </div>
          </ChartTooltip>
        )}
      </div>
      <p className="hint">{t("buckling.shape.hint")}</p>
    </div>
  );
});
