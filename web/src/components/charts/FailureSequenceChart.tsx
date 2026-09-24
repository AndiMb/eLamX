import { memo, useRef, useState, type Ref } from "react";
import { useAtomValue } from "jotai";
import { lastPlyFailurePathFamily, lastPlyFailureSummaryFamily } from "../../store/lastPlyFailureAtoms";
import { layerContributionsFamily } from "../../store/derivedAtoms";
import type { FailureType } from "../../lib/types";
import { criterionName } from "../../lib/types";
import { ChartTooltip } from "./ChartTooltip";
import { ChartSnapshotButton } from "./ChartSnapshotButton";
import { lpfPathTable } from "../../lib/tables";
import { formatFixed, formatSignificant } from "../../lib/numberFormat";
import { failureModeLabel, useLocale, useT, type MessageKey } from "../../i18n";
import { useChartWidth } from "../../lib/useChartWidth";

// The order in which the plies give way (F2.5): one row per ply of the
// expanded stack, the load factor of each degradation step on the x-axis, a
// mark where that step's ply failed - its shape the failure type, so the
// sequence reads without colour (N7) - and the first-ply and last-ply
// failure as vertical lines. The step table below stays; this is the same
// path drawn so that "which ply, in which order, how far apart" is one look.
//
// The x-value of a mark is the step's reserve factor as the core reports it
// (N4): the factor on the fixed applied load at which that ply fails with the
// stiffnesses of that step, an inter-fibre one already multiplied by j_A.

export interface SequenceEvent {
  step: number;
  layerNumber: number;
  rf: number;
  type: FailureType;
  failureName: string;
  criterion: string;
}

export interface FailureSequenceChartViewProps {
  /** The expanded stack, top ply first. */
  plies: { number: number; angle: number }[];
  events: SequenceEvent[];
  /** First-ply failure: the first step's load factor. */
  fpf: number | null;
  /** Last-ply failure: the largest load factor along the path (EF_LPF). */
  lpf: number | null;
  locale: string;
  labels: {
    aria: string;
    xAxis: string;
    ply: (nr: number, angle: string) => string;
    fpf: string;
    lpf: string;
    type: (type: FailureType) => string;
    step: (nr: number) => string;
    criterion: (id: string) => string;
    mode: (name: string) => string;
  };
  svgRef?: Ref<SVGSVGElement>;
  /** Drawn at this width instead of the width it has on screen - the report. */
  width?: number;
}

const DEFAULT_WIDTH = 600;
const ROW = 18;
const MARGIN = { top: 22, right: 16, bottom: 30, left: 78 };

function Mark({ type, x, y }: { type: FailureType; x: number; y: number }) {
  const r = 5;
  switch (type) {
    case "FiberFailure":
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} className="seq-mark ff" />;
    case "MatrixFailure":
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} className="seq-mark iff" />;
    case "GeneralMaterialFailure":
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} className="seq-mark gmf" />;
    case "Undamaged":
      return <circle cx={x} cy={y} r={r} className="seq-mark none" />;
  }
}

/** Pure: everything through its props, so the report can draw it too. */
export function FailureSequenceChartView({ plies, events, fpf, lpf, locale, labels, svgRef, width }: FailureSequenceChartViewProps) {
  const [hover, setHover] = useState<{ event: SequenceEvent; x: number; y: number } | null>(null);
  const { ref: boxRef, width: WIDTH } = useChartWidth(DEFAULT_WIDTH, width);
  if (plies.length === 0 || events.length === 0) return null;
  const plotH = plies.length * ROW;
  const height = MARGIN.top + plotH + MARGIN.bottom;
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const finite = events.map((e) => e.rf).filter(Number.isFinite);
  const xMax = Math.max(...finite, lpf ?? 0, fpf ?? 0, 1) * 1.08;
  const x = (v: number) => MARGIN.left + (Math.min(Math.max(v, 0), xMax) / xMax) * plotW;
  const rowOf = new Map(plies.map((p, i) => [p.number, i]));
  const y = (layerNumber: number) => MARGIN.top + ((rowOf.get(layerNumber) ?? 0) + 0.5) * ROW;
  // Round ticks - 1, 2 or 5 times a power of ten - about four of them.
  const rough = xMax / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const ticks = Array.from({ length: Math.floor(xMax / step) + 1 }, (_, i) => i * step);

  // Each ply's own sequence, joined, so a ply that cracks and later breaks
  // reads as one story.
  const byPly = new Map<number, SequenceEvent[]>();
  for (const e of events) byPly.set(e.layerNumber, [...(byPly.get(e.layerNumber) ?? []), e]);

  return (
    <div className="chart-svg-wrap" ref={boxRef}>
      <svg
        ref={svgRef}
        className="chart-svg seq-chart"
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label={labels.aria}
      >
        {plies.map((p, i) => (
          <g key={p.number}>
            {i % 2 === 0 && <rect x={MARGIN.left} y={MARGIN.top + i * ROW} width={plotW} height={ROW} className="seq-band" />}
            <text x={MARGIN.left - 6} y={MARGIN.top + (i + 0.5) * ROW} textAnchor="end" dominantBaseline="middle">
              {labels.ply(p.number, formatFixed(p.angle, 0, locale))}
            </text>
          </g>
        ))}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={x(v)} x2={x(v)} y1={MARGIN.top} y2={MARGIN.top + plotH} className="chart-gridline" />
            <text x={x(v)} y={MARGIN.top + plotH + 14} textAnchor="middle">
              {formatSignificant(v, 2, locale)}
            </text>
          </g>
        ))}
        <text x={MARGIN.left + plotW} y={MARGIN.top + plotH + 26} textAnchor="end" className="seq-axis-title">
          {labels.xAxis}
        </text>
        {x(1) <= MARGIN.left + plotW && (
          <line x1={x(1)} x2={x(1)} y1={MARGIN.top} y2={MARGIN.top + plotH} className="chart-axis" />
        )}
        {[...byPly.entries()].map(([layer, list]) =>
          list.length > 1 ? (
            <line key={layer} x1={x(list[0].rf)} x2={x(list[list.length - 1].rf)} y1={y(layer)} y2={y(layer)} className="seq-join" />
          ) : null,
        )}
        {fpf !== null && (
          <g className="seq-line fpf">
            <line x1={x(fpf)} x2={x(fpf)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} />
            <text x={x(fpf)} y={MARGIN.top - 8} textAnchor="middle">
              {labels.fpf}
            </text>
          </g>
        )}
        {lpf !== null && (
          <g className="seq-line lpf">
            <line x1={x(lpf)} x2={x(lpf)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} />
            <text x={x(lpf)} y={MARGIN.top - 8} textAnchor="middle">
              {labels.lpf}
            </text>
          </g>
        )}
        {events.map((e) => (
          <g
            key={e.step}
            onPointerMove={(ev) => {
              const rect = ev.currentTarget.ownerSVGElement!.getBoundingClientRect();
              setHover({ event: e, x: ev.clientX - rect.left + 12, y: ev.clientY - rect.top + 12 });
            }}
            onPointerLeave={() => setHover((h) => (h?.event.step === e.step ? null : h))}
          >
            <Mark type={e.type} x={x(e.rf)} y={y(e.layerNumber)} />
            <text x={x(e.rf) + 8} y={y(e.layerNumber) - 5} className="seq-step">
              {e.step + 1}
            </text>
          </g>
        ))}
      </svg>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div>
            <strong>{labels.step(hover.event.step + 1)}</strong>
          </div>
          <div>{labels.type(hover.event.type)}</div>
          <div>
            {labels.criterion(hover.event.criterion)}
            {hover.event.failureName ? `, ${labels.mode(hover.event.failureName)}` : ""}
          </div>
          <div>RF = {formatFixed(hover.event.rf, 3, locale)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

const TYPE_KEYS: Record<FailureType, MessageKey> = {
  FiberFailure: "failureType.FiberFailure",
  MatrixFailure: "failureType.MatrixFailure",
  GeneralMaterialFailure: "failureType.GeneralMaterialFailure",
  Undamaged: "failureType.Undamaged",
};

export const FailureSequenceChart = memo(function FailureSequenceChart({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const path = useAtomValue(lastPlyFailurePathFamily(laminateId));
  const summary = useAtomValue(lastPlyFailureSummaryFamily(laminateId));
  const contributions = useAtomValue(layerContributionsFamily(laminateId));
  if (!path || path.length === 0 || !summary) return null;

  // The stack's angles come from the CLT response of the same laminate: the
  // last-ply analysis numbers the same expanded stack.
  const plyCount = path[0].plyCount;
  const plies = Array.from({ length: plyCount }, (_, i) => ({
    number: i + 1,
    angle: contributions?.find((c) => c.layer_number === i + 1)?.angle_deg ?? 0,
  }));
  const events: SequenceEvent[] = path.map((r) => ({
    step: r.index,
    layerNumber: r.layerNumber,
    rf: r.reserveFactor,
    type: r.failureType,
    failureName: r.failureName,
    criterion: r.criterionId,
  }));

  return (
    <div className="chart viz">
      <p className="chart-title">{t("lpf.sequence.title")}</p>
      <p className="hint seq-legend">
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" className="seq-mark ff" /></svg>
          {t("failureType.FiberFailure")}
        </span>
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><polygon points="6,1 11,11 1,11" className="seq-mark iff" /></svg>
          {t("failureType.MatrixFailure")}
        </span>
        <span className="tt-legend-item">
          <svg width="12" height="12" aria-hidden="true"><polygon points="6,1 11,6 6,11 1,6" className="seq-mark gmf" /></svg>
          {t("failureType.GeneralMaterialFailure")}
        </span>
      </p>
      <FailureSequenceChartView
        svgRef={svgRef}
        plies={plies}
        events={events}
        fpf={path[0].reserveFactor}
        lpf={summary.exceedanceFactor?.reserve_factor ?? null}
        locale={locale}
        labels={{
          aria: t("lpf.sequence.aria"),
          xAxis: t("lpf.sequence.xAxis"),
          ply: (nr, angle) => t("lpf.sequence.ply", { nr, angle }),
          fpf: t("lpf.sequence.fpf"),
          lpf: t("lpf.sequence.lpf"),
          type: (type) => t(TYPE_KEYS[type]),
          step: (nr) => t("lpf.sequence.step", { nr }),
          criterion: (id) => criterionName(id, t),
          mode: (name) => failureModeLabel(locale, name),
        }}
      />
      <p className="hint">{t("lpf.sequence.hint")}</p>
      <div className="chart-actions">
        <ChartSnapshotButton
          target={svgRef}
          name="versagensreihenfolge"
          title={t("lpf.sequence.title")}
          data={() => lpfPathTable(path, t, locale)}
        />
      </div>
    </div>
  );
});
