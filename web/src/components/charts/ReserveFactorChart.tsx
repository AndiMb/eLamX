import { memo, useMemo, useState, useRef, type Ref } from "react";
import { useAtomValue } from "jotai";
import { layerResultsFamily } from "../../store/derivedAtoms";
import { failureMetricAtom } from "../../store/settingsAtoms";
import { criticalLayerIndex, metricLimit, METRIC_LABEL_KEYS, toMetric, type FailureMetric } from "../../lib/failureMetric";
import type { FailureType, LayerResultDto } from "../../lib/types";
import type { Translate } from "../../lib/tables";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { formatFixed } from "../../lib/numberFormat";
import { failureModeLabel, useLocale, useT, type Locale } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { ChartSnapshotButton } from "./ChartSnapshotButton";
import { layerResultsTable } from "../../lib/tables";

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

export interface ReserveFactorChartViewProps {
  layerResults: readonly LayerResultDto[] | null;
  metric: FailureMetric;
  locale: Locale;
  t: Translate;
  svgRef?: Ref<SVGSVGElement>;
}

/** The chart itself - title, legend and bars - pure, everything through its
 *  props, so the report can draw it for any laminate and load case. */
export function ReserveFactorChartView({ layerResults, metric, locale, t, svgRef }: ReserveFactorChartViewProps) {
  const [hover, setHover] = useState<{
    layerNumber: number;
    position: "lower" | "upper";
    value: number;
    failureType: FailureType;
    failureName: string;
    x: number;
    y: number;
  } | null>(null);

  // The bars show the chosen metric (F2.2), on an axis that always holds the
  // limit line - 1 for RF and IRF, 0 for MoS - and, for a negative margin,
  // reaches below zero. An infinite reserve is drawn to the top of the axis,
  // as before.
  const scale = useMemo(() => {
    if (!layerResults || layerResults.length === 0) return null;
    const values = layerResults
      .flatMap((l) => [l.rr_lower.minimal_reserve_factor, l.rr_upper.minimal_reserve_factor])
      .map((rf) => toMetric(rf, metric))
      .filter(Number.isFinite);
    const limit = metricLimit(metric);
    const vMax = Math.max(...values, limit, 0) * 1.1 || 1;
    const vMin = Math.min(...values, 0) * 1.1;
    const clamp = (v: number) => Math.max(vMin, Math.min(v, vMax));
    return { vMax, vMin, limit, yScale: (v: number) => PLOT_H - ((clamp(v) - vMin) / (vMax - vMin)) * PLOT_H };
  }, [layerResults, metric]);

  if (!layerResults || layerResults.length === 0 || !scale) return null;
  const { vMax, vMin, limit, yScale } = scale;
  const critical = criticalLayerIndex(layerResults);
  const metricName = t(METRIC_LABEL_KEYS[metric]);

  const usedTypes = Array.from(
    new Set(layerResults.flatMap((l) => [l.rr_lower.failure_type, l.rr_upper.failure_type])),
  );

  const groupW = PLOT_W / layerResults.length;
  const barW = Math.min(BAR_MAX_W, groupW / 2 - 4);

  return (
    <div className="chart viz">
      <p className="chart-title">{t("chart.reserveFactor.titleMetric", { metric: metricName })}</p>
      <ChartLegend
        items={usedTypes.map((ft) => ({ key: ft, label: t(FAILURE_LABEL_KEYS[ft]), color: FAILURE_COLORS[ft] }))}
      />
      <div className="chart-svg-wrap">
        <svg
          ref={svgRef}
          className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={t("chart.reserveFactor.aria")}>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Keyed by position: vMax collapses onto 1 whenever no layer has
                a reserve factor above 1. */}
            {/* The limit first, so a tick crowding it is the one dropped. */}
            {[limit, vMax, 0, vMin]
              .reduce<number[]>(
                (kept, v) => (kept.some((k) => Math.abs(yScale(k) - yScale(v)) < 12) ? kept : [...kept, v]),
                [],
              )
              .map((v, tickIndex) => (
              <g key={tickIndex}>
                <line x1={0} x2={PLOT_W} y1={yScale(v)} y2={yScale(v)} className={v === limit ? "chart-axis" : "chart-gridline"} />
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
                  <text
                    x={groupX}
                    y={PLOT_H + 16}
                    textAnchor="middle"
                    className={i === critical ? "chart-critical-label" : undefined}
                  >
                    {/* The governing ply carries a marker beside its number,
                        not only a colour (N7). */}
                    {i === critical ? `⌖ ${l.layer_number}` : l.layer_number}
                  </text>
                  {bars.map((b) => {
                    const shown = toMetric(b.rf.minimal_reserve_factor, metric);
                    const top = Math.min(yScale(shown), yScale(0));
                    const height = Math.max(1, Math.abs(yScale(0) - yScale(shown)));
                    return (
                    <rect
                      key={b.position}
                      x={b.x}
                      y={top}
                      width={barW}
                      height={height}
                      rx={2}
                      fill={FAILURE_COLORS[b.rf.failure_type]}
                      onPointerMove={(e) => {
                        const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                        setHover({
                          layerNumber: l.layer_number,
                          position: b.position,
                          value: shown,
                          failureType: b.rf.failure_type,
                          failureName: b.rf.failure_name,
                          x: e.clientX - rect.left + 12,
                          y: e.clientY - rect.top + 12,
                        });
                      }}
                      onPointerLeave={() => setHover((h) => (h?.layerNumber === l.layer_number && h?.position === b.position ? null : h))}
                    />
                    );
                  })}
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
            <div>
              {metricName}: {formatFixed(hover.value, 3, locale)}
            </div>
            <div>
              {t(FAILURE_LABEL_KEYS[hover.failureType])}
              {hover.failureName ? ` (${failureModeLabel(locale, hover.failureName)})` : ""}
            </div>
          </ChartTooltip>
        )}
      </div>
    </div>
  );
}

// See AbdMatrixPanel.tsx for why memo() matters for a laminate-scoped panel.
export const ReserveFactorChart = memo(function ReserveFactorChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const metric = useAtomValue(failureMetricAtom);
  if (!layerResults || layerResults.length === 0) return null;
  return (
    <>
      <ReserveFactorChartView layerResults={layerResults} metric={metric} locale={locale} t={t} svgRef={svgRef} />
      <div className="chart-actions">
        <ChartSnapshotButton
          target={svgRef}
          name="reservefaktoren"
          title={t("chart.reserveFactor.title")}
          data={() => layerResultsTable(layerResults, { metric, minOnly: false, t, locale })}
        />
      </div>
    </>
  );
});
