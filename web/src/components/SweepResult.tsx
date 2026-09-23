import { useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { Wand2 } from "lucide-react";
import { useChartColors } from "../lib/chartColors";
import { failureMetricAtom } from "../store/settingsAtoms";
import { addLaminateAtom, laminateConfigFamily, laminateIdsAtom } from "../store/laminateAtoms";
import { bucklingInputFamily } from "../store/bucklingAtoms";
import { vibrationInputFamily } from "../store/vibrationAtoms";
import { deformationInputFamily } from "../store/deformationAtoms";
import { planMessages, studyProjectAtom } from "../store/studyRunAtoms";
import type { StudyRun } from "../store/studyAtoms";
import { historyStep } from "../lib/history";
import type { StudyDef } from "../lib/study/model";
import type { SweepLayout } from "../lib/study/sweep";
import { sweepVariant } from "../lib/study/sweep";
import type { StudyOutput } from "../lib/study/evaluate";
import { outputLabel, variationLabel, variationValue } from "../lib/study/outputs";
import { sweepTable } from "../lib/study/tables";
import { formatSignificant } from "../lib/numberFormat";
import { SweepChartView } from "./charts/SweepChart";
import { ChartSnapshotButton } from "./charts/ChartSnapshotButton";
import { TableActions } from "./TableActions";
import { useLocale, useT } from "../i18n";

// A sweep's results: one chart per output, since each has its own unit, and
// the table behind them. Picking a point offers it as a new laminate - after
// asking, and as one undo step.

type SweepStudy = Extract<StudyDef, { kind: "sweep" }>;

function OutputChart({
  study,
  layout,
  run,
  output,
  onPick,
}: {
  study: SweepStudy;
  layout: SweepLayout;
  run: StudyRun;
  output: StudyOutput;
  onPick: (i: number, j: number) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const metric = useAtomValue(failureMetricAtom);
  const colors = useChartColors();
  const svg = useRef<SVGSVGElement>(null);
  const label = outputLabel(output, metric, t);
  return (
    <div>
      <h3>{label}</h3>
      <SweepChartView
        layout={layout}
        points={run.points}
        output={output}
        metric={metric}
        locale={locale}
        colors={colors}
        svgRef={svg}
        onPick={onPick}
        labels={{
          aria: t("study.sweep.chartAria", { output: label }),
          x: variationLabel(layout.x.variation, t),
          y: label,
          series: (v) => (layout.y ? `${variationLabel(layout.y.variation, t).split(" [")[0]} = ${v}` : v),
          gap: t("study.gap"),
        }}
      />
      <div className="chart-actions">
        <ChartSnapshotButton
          target={svg}
          name={`sweep-${output}`}
          title={`${study.name}: ${label}`}
          data={() => sweepTable(study.name, layout, run.points, metric, t)}
        />
      </div>
    </div>
  );
}

export function SweepResult({ study, layout, run }: { study: SweepStudy; layout: SweepLayout; run: StudyRun }) {
  const t = useT();
  const locale = useLocale();
  const metric = useAtomValue(failureMetricAtom);
  const store = useStore();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<[number, number] | null>(null);

  const describe = ([i, j]: [number, number]) => {
    const fmt = (v: number) => formatSignificant(v, 4, locale);
    const x = `${variationLabel(layout.x.variation, t).split(" [")[0]} = ${fmt(variationValue(layout.x.variation, layout.x.values[i]))}`;
    const y = layout.y ? `, ${variationLabel(layout.y.variation, t).split(" [")[0]} = ${fmt(variationValue(layout.y.variation, layout.y.values[j]))}` : "";
    return x + y;
  };

  /** The picked point as a new laminate: the varied stack, the varied load
   *  case as its one load case, and - where the plate was varied - the plate
   *  modules set up with the varied edge. */
  const adopt = () => {
    if (!picked) return;
    const [i, j] = picked;
    const variant = sweepVariant(
      study.sweep,
      store.get(studyProjectAtom),
      layout.x.values[i],
      layout.y ? layout.y.values[j] : null,
      planMessages(t),
    );
    if (!variant) return;
    const name = `${variant.laminate.name} (${describe(picked)})`;
    const id = historyStep(t("study.adopt"), () => {
      const created = store.set(addLaminateAtom, variant.laminate.layers[0]?.materialId ?? "");
      store.set(laminateConfigFamily(created), {
        ...variant.laminate,
        id: created,
        name,
        layers: variant.laminate.layers.map((l, k) => ({ ...l, id: crypto.randomUUID(), name: l.name || `${k + 1}` })),
        loadCases: [{ ...variant.loadCase, id: crypto.randomUUID() }],
        carryOver: undefined,
      });
      const plateVaried = layout.x.variation.kind === "plate" || layout.y?.variation.kind === "plate";
      if (plateVaried) {
        store.set(bucklingInputFamily(created), variant.buckling);
        store.set(vibrationInputFamily(created), variant.vibration);
        store.set(deformationInputFamily(created), variant.deformation);
      }
      return created;
    });
    setPicked(null);
    if (store.get(laminateIdsAtom).includes(id)) navigate(`/laminates/${id}`);
  };

  const pickedPoint = picked ? run.points[picked[1] * layout.x.values.length + picked[0]] : undefined;

  return (
    <section className="panel">
      <div className="study-result-head">
        <h2>{t("study.results")}</h2>
        <TableActions table={() => sweepTable(study.name, layout, run.points, metric, t)} name="sweep" />
      </div>
      <div className="sweep-charts">
        {layout.outputs.map((o) => (
          <OutputChart key={o} study={study} layout={layout} run={run} output={o} onPick={(i, j) => setPicked([i, j])} />
        ))}
      </div>
      <p className="hint">{t("study.sweep.pickHint")}</p>
      {picked && (
        <div className="study-confirm-box" role="dialog" aria-label={t("study.adopt")}>
          <p>
            {pickedPoint && pickedPoint.ok
              ? t("study.adoptQuestion", { point: describe(picked) })
              : t("study.adoptGap", { point: describe(picked) })}
          </p>
          <div className="button-row">
            {pickedPoint?.ok && (
              <button type="button" className="btn-primary" onClick={adopt}>
                <Wand2 size={16} /> {t("study.adopt")}
              </button>
            )}
            <button type="button" onClick={() => setPicked(null)}>
              {t("batch.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
