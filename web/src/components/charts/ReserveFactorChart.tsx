import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { layerResultsFamily } from "../../store/derivedAtoms";
import type { FailureType } from "../../lib/types";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { formatFixed } from "../../lib/numberFormat";
import { failureModeLabel, useLocale, useT } from "../../i18n";
import type { MessageKey } from "../../i18n";

const WIDTH = 600;
const HEIGHT = 240;
const MARGIN = { top: 10, right: 10, bottom: 30, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const BAR_MAX_W = 20;

// Undamaged is a real state marker (pass), so it wears the status "good"
// token; the three actual failure modes are identity (which kind of
// failure), so they wear fixed categorical slots - see the dataviz skill's
// color-formula.md "collision rule".
const FAILURE_COLORS: Record<FailureType, string> = {
  Undamaged: "var(--viz-status-good)",
  FiberFailure: "var(--viz-series-6)",
  MatrixFailure: "var(--viz-series-8)",
  GeneralMaterialFailure: "var(--viz-series-5)",
};

// The FailureType enum values double as message keys ("failureType.<variant>"),
// so a new variant in the Rust core surfaces as a missing-key compile error
// here rather than as an untranslated label at runtime.
const FAILURE_LABEL_KEYS: Record<FailureType, MessageKey> = {
  Undamaged: "failureType.Undamaged",
  FiberFailure: "failureType.FiberFailure",
  MatrixFailure: "failureType.MatrixFailure",
  GeneralMaterialFailure: "failureType.GeneralMaterialFailure",
};

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const ReserveFactorChart = memo(function ReserveFactorChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const [hover, setHover] = useState<{
    layerNumber: number;
    position: "lower" | "upper";
    value: number;
    failureType: FailureType;
    failureName: string;
    x: number;
    y: number;
  } | null>(null);

  const scale = useMemo(() => {
    if (!layerResults || layerResults.length === 0) return null;
    const values = layerResults.flatMap((l) => [l.rr_lower.minimal_reserve_factor, l.rr_upper.minimal_reserve_factor]);
    const vMax = Math.max(...values, 1) * 1.1;
    return { vMax, yScale: (v: number) => PLOT_H - (Math.min(v, vMax) / vMax) * PLOT_H };
  }, [layerResults]);

  if (!layerResults || layerResults.length === 0 || !scale) return null;
  const { vMax, yScale } = scale;

  const usedTypes = Array.from(
    new Set(layerResults.flatMap((l) => [l.rr_lower.failure_type, l.rr_upper.failure_type])),
  );

  const groupW = PLOT_W / layerResults.length;
  const barW = Math.min(BAR_MAX_W, groupW / 2 - 4);

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.reserveFactor.title")}</p>
      <ChartLegend
        items={usedTypes.map((ft) => ({ key: ft, label: t(FAILURE_LABEL_KEYS[ft]), color: FAILURE_COLORS[ft] }))}
      />
      <div className="chart-svg-wrap">
        <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={t("chart.reserveFactor.aria")}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Keyed by position: vMax collapses onto 1 whenever no layer has
                a reserve factor above 1. */}
            {[0, 1, vMax].map((v, tickIndex) => (
              <g key={tickIndex}>
                <line x1={0} x2={PLOT_W} y1={yScale(v)} y2={yScale(v)} className={v === 1 ? "chart-axis" : "chart-gridline"} />
                <text x={-8} y={yScale(v)} textAnchor="end" dominantBaseline="middle">
                  {formatFixed(v, 1, locale)}
                </text>
              </g>
            ))}
            {layerResults.map((l, i) => {
              const groupX = i * groupW + groupW / 2;
              const bars: { position: "lower" | "upper"; rf: typeof l.rr_lower; x: number }[] = [
                { position: "lower", rf: l.rr_lower, x: groupX - barW - 2 },
                { position: "upper", rf: l.rr_upper, x: groupX + 2 },
              ];
              return (
                <g key={l.layer_number}>
                  <text x={groupX} y={PLOT_H + 16} textAnchor="middle">
                    {l.layer_number}
                  </text>
                  {bars.map((b) => (
                    <rect
                      key={b.position}
                      x={b.x}
                      y={yScale(b.rf.minimal_reserve_factor)}
                      width={barW}
                      height={Math.max(1, PLOT_H - yScale(b.rf.minimal_reserve_factor))}
                      rx={2}
                      fill={FAILURE_COLORS[b.rf.failure_type]}
                      onPointerMove={(e) => {
                        const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                        setHover({
                          layerNumber: l.layer_number,
                          position: b.position,
                          value: b.rf.minimal_reserve_factor,
                          failureType: b.rf.failure_type,
                          failureName: b.rf.failure_name,
                          x: e.clientX - rect.left + 12,
                          y: e.clientY - rect.top + 12,
                        });
                      }}
                      onPointerLeave={() => setHover((h) => (h?.layerNumber === l.layer_number && h?.position === b.position ? null : h))}
                    />
                  ))}
                </g>
              );
            })}
          </g>
        </svg>
        {hover && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <div>
              <strong>
                {t("chart.layer", { nr: hover.layerNumber })} ({t(hover.position === "lower" ? "common.bottom" : "common.top")})
              </strong>
            </div>
            <div>RF: {formatFixed(hover.value, 3, locale)}</div>
            <div>
              {t(FAILURE_LABEL_KEYS[hover.failureType])}
              {hover.failureName ? ` (${failureModeLabel(locale, hover.failureName)})` : ""}
            </div>
          </ChartTooltip>
        )}
      </div>
    </div>
  );
});
