import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { Play, Square, Trash2, TriangleAlert } from "lucide-react";
import { removeStudyAtom, studiesAtom, studyResultsFamily, updateStudyAtom } from "../store/studyAtoms";
import { cancelStudyAtom, runStudyAtom, studyPlanFamily, studyStaleFamily } from "../store/studyRunAtoms";
import { laminateConfigFamily, laminateIdsAtom, loadCasesOf, selectedLoadCaseFamily } from "../store/laminateAtoms";
import { failureMetricAtom } from "../store/settingsAtoms";
import { historyStep } from "../lib/history";
import { CRITERIA, criterionName, type CriterionId } from "../lib/types";
import type { MatrixDef, StudyDef } from "../lib/study/model";
import type { MatrixLayout, PlanProblem, StudyPlan } from "../lib/study/plan";
import { matrixTable } from "../lib/study/tables";
import { formatDuration } from "../lib/study/cost";
import { MatrixView } from "../components/MatrixView";
import { SweepEditor } from "../components/SweepEditor";
import { SweepResult } from "../components/SweepResult";
import { TableActions } from "../components/TableActions";
import { useLocale, useT, type MessageKey } from "../i18n";
import type { StudyRun } from "../store/studyAtoms";

// A study: its definition, what running it will cost, and its results.
//
// The results are computed when the page is visited and the study has none -
// unless the estimate says it takes long, in which case the page says so and
// waits for the button. A study whose inputs changed since its last run shows
// the old results marked as outdated and is recomputed on request, not by
// itself: a sweep can take minutes, and nobody should pay for that because
// they renamed a ply.

export function StudyPage() {
  const t = useT();
  const { studyId = "" } = useParams<{ studyId: string }>();
  const study = useAtomValue(studiesAtom).find((s) => s.id === studyId);
  if (!study) return <p className="empty-note">{t("study.missing")}</p>;
  return <StudyBody key={study.id} study={study} />;
}

function StudyBody({ study }: { study: StudyDef }) {
  const t = useT();
  const navigate = useNavigate();
  const update = useSetAtom(updateStudyAtom);
  const remove = useSetAtom(removeStudyAtom);
  const plan = useAtomValue(studyPlanFamily(study.id));
  const run = useAtomValue(studyResultsFamily(study.id));
  const start = useSetAtom(runStudyAtom);

  // First visit: compute, if it is quick.
  useEffect(() => {
    if (run === null && plan && plan.points.length > 0 && plan.cost.level === "ok") void start(study.id);
    // Only on arrival: later plan changes mark the results outdated instead.
  }, [study.id]); // oxlint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <input
            className="study-name"
            value={study.name}
            aria-label={t("study.name")}
            onChange={(e) => update({ ...study, name: e.target.value })}
          />
          <p className="page-header-sub">{t(study.kind === "matrix" ? "study.matrix.intro" : study.kind === "sweep" ? "study.sweep.intro" : "study.unknown")}</p>
        </div>
        <button
          type="button"
          className="icon-button danger"
          title={t("study.delete")}
          aria-label={t("study.delete")}
          onClick={() => {
            historyStep(t("history.label.studies"), () => remove(study.id));
            navigate("/");
          }}
        >
          <Trash2 size={16} />
        </button>
      </header>

      {study.kind === "matrix" && <MatrixEditor study={study} />}
      {study.kind === "sweep" && <SweepEditor study={study} />}

      {plan && study.kind !== "unknown" && <RunPanel studyId={study.id} plan={plan} run={run} />}

      {study.kind === "matrix" && plan?.layout?.kind === "matrix" && run && (
        <MatrixResult study={study} layout={plan.layout} run={run} />
      )}
      {study.kind === "sweep" && plan?.layout?.kind === "sweep" && run && (
        <SweepResult study={study} layout={plan.layout} run={run} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const PROBLEM_KEYS: Record<PlanProblem["kind"], MessageKey> = {
  laminateMissing: "study.problem.laminateMissing",
  empty: "study.problem.empty",
  unknownKind: "study.problem.unknownKind",
  termsCapped: "study.problem.termsCapped",
  noLayers: "study.problem.noLayers",
};

function RunPanel({ studyId, plan, run }: { studyId: string; plan: StudyPlan; run: StudyRun | null }) {
  const t = useT();
  const locale = useLocale();
  const start = useSetAtom(runStudyAtom);
  const cancel = useSetAtom(cancelStudyAtom);
  const stale = useAtomValue(studyStaleFamily(studyId));
  const [confirming, setConfirming] = useState(false);
  const running = run?.status === "running";
  const cost = plan.cost;

  const onRun = () => {
    if (cost.level === "confirm" && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void start(studyId);
  };

  return (
    <section className="panel study-run">
      <p className="study-cost">
        {t("study.cost", { points: cost.points, time: formatDuration(cost.ms, locale) })}
        {cost.level !== "ok" && (
          <span className="chip warn">
            <TriangleAlert size={12} aria-hidden="true" /> {t(cost.level === "confirm" ? "study.cost.long" : "study.cost.warn")}
          </span>
        )}
      </p>
      {plan.problems.map((problem, i) => (
        <p key={i} className="hint">
          {t(PROBLEM_KEYS[problem.kind], problem.kind === "termsCapped" ? { max: problem.max } : problem.kind === "laminateMissing" ? { id: problem.id } : undefined)}
        </p>
      ))}
      {stale && !running && (
        <p className="study-stale" role="status">
          <TriangleAlert size={14} aria-hidden="true" /> {t("study.stale")}
        </p>
      )}
      {confirming && (
        <p className="study-confirm" role="alert">
          {t("study.confirm", { time: formatDuration(cost.ms, locale) })}
        </p>
      )}
      <div className="button-row">
        <button type="button" className={confirming ? "btn-primary" : undefined} onClick={onRun} disabled={running || plan.points.length === 0}>
          <Play size={16} /> {t(confirming ? "study.confirmRun" : run ? "study.rerun" : "study.run")}
        </button>
        {confirming && (
          <button type="button" onClick={() => setConfirming(false)}>
            {t("batch.cancel")}
          </button>
        )}
        {running && (
          <button type="button" onClick={() => cancel(studyId)}>
            <Square size={16} /> {t("batch.cancel")}
          </button>
        )}
      </div>
      {running && run && (
        <div className="report-progress" role="status">
          <span>{t("study.progress", { done: run.done, total: run.total })}</span>
          <progress max={run.total} value={run.done} />
        </div>
      )}
      {run?.status === "cancelled" && <p className="hint">{t("study.cancelled", { done: run.done, total: run.total })}</p>}
      {run?.status === "failed" && <p className="error">{t("study.failed", { message: run.error ?? "" })}</p>}
      {run?.status === "done" && run.took !== undefined && (
        <p className="hint">{t("study.took", { time: formatDuration(run.took, locale), points: run.total })}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

function LaminateName({ id }: { id: string }) {
  return <>{useAtomValue(laminateConfigFamily(id)).name}</>;
}

function LoadCaseChecks({
  laminateId,
  isOn,
  toggle,
}: {
  laminateId: string;
  isOn: (loadCaseId: string) => boolean;
  toggle: (loadCaseId: string) => void;
}) {
  const config = useAtomValue(laminateConfigFamily(laminateId));
  return (
    <>
      {loadCasesOf(config).map((c) => (
        <label key={c.id} className="inline-check">
          <input type="checkbox" checked={isOn(c.id)} onChange={() => toggle(c.id)} />
          {config.name} · {c.name}
        </label>
      ))}
    </>
  );
}

function LoadCaseOptions({ laminateId }: { laminateId: string }) {
  const config = useAtomValue(laminateConfigFamily(laminateId));
  return (
    <>
      {loadCasesOf(config).map((c) => (
        <option key={c.id} value={`${laminateId}|${c.id}`}>
          {config.name} · {c.name}
        </option>
      ))}
    </>
  );
}

function MatrixEditor({ study }: { study: Extract<StudyDef, { kind: "matrix" }> }) {
  const t = useT();
  const update = useSetAtom(updateStudyAtom);
  const ids = useAtomValue(laminateIdsAtom);
  const def = study.matrix;
  const set = (patch: Partial<MatrixDef>) => update({ ...study, matrix: { ...def, ...patch } });
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <section className="panel study-editor">
      <h2>{t("study.definition")}</h2>
      <fieldset>
        <legend>{t("study.matrix.rows")}</legend>
        <label className="inline-check">
          <input type="checkbox" checked={def.laminates.length === 0} onChange={() => set({ laminates: def.laminates.length === 0 ? [...ids] : [] })} />
          {t("study.all")}
        </label>
        {def.laminates.length > 0 && (
          <div className="report-checks">
            {ids.map((id) => (
              <label key={id} className="inline-check">
                <input type="checkbox" checked={def.laminates.includes(id)} onChange={() => set({ laminates: toggle(def.laminates, id) })} />
                <LaminateName id={id} />
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="field-grid">
        <label>
          <span className="field-label">{t("study.matrix.columns")}</span>
          <select value={def.columns} onChange={(e) => set({ columns: e.target.value as MatrixDef["columns"], loadCases: [] })}>
            <option value="load_case">{t("study.matrix.columns.loadCase")}</option>
            <option value="criterion">{t("study.matrix.columns.criterion")}</option>
          </select>
        </label>
        <label>
          <span className="field-label">{t("study.matrix.output")}</span>
          <select value={def.output} onChange={(e) => set({ output: e.target.value as MatrixDef["output"] })}>
            <option value="min_rf">{t("study.output.min_rf")}</option>
            <option value="lpf">{t("study.output.lpf")}</option>
          </select>
        </label>
      </div>
      <label className="inline-check study-second">
        <input type="checkbox" checked={def.transpose} onChange={(e) => set({ transpose: e.target.checked })} />
        {t("study.matrix.transpose")}
      </label>

      {def.columns === "load_case" ? (
        <fieldset>
          <legend>{t("study.matrix.loadCases")}</legend>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={def.loadCases.length === 0}
              onChange={() => set({ loadCases: [] })}
              disabled={def.loadCases.length === 0}
            />
            {t("study.matrix.allLoadCases")}
          </label>
          <div className="report-checks">
            {ids.map((id) => (
              <LoadCaseChecks
                key={id}
                laminateId={id}
                isOn={(loadCaseId) => def.loadCases.some((s) => s.laminateId === id && s.loadCaseId === loadCaseId)}
                toggle={(loadCaseId) => {
                  const on = def.loadCases.some((s) => s.laminateId === id && s.loadCaseId === loadCaseId);
                  set({
                    loadCases: on
                      ? def.loadCases.filter((s) => !(s.laminateId === id && s.loadCaseId === loadCaseId))
                      : [...def.loadCases, { laminateId: id, loadCaseId }],
                  });
                }}
              />
            ))}
          </div>
          <p className="hint">{t("study.matrix.loadCasesHint")}</p>
        </fieldset>
      ) : (
        <fieldset>
          <legend>{t("study.matrix.criteria")}</legend>
          <div className="report-checks">
            {CRITERIA.map((c) => (
              <label key={c.id} className="inline-check">
                <input
                  type="checkbox"
                  checked={def.criteria.includes(c.id as CriterionId)}
                  onChange={() => set({ criteria: toggle(def.criteria, c.id as CriterionId) })}
                />
                {criterionName(c.id, t)}
              </label>
            ))}
          </div>
          <label className="study-inline-field">
            <span className="field-label">{t("study.matrix.judgedUnder")}</span>
            <select
              value={def.loadCases[0] ? `${def.loadCases[0].laminateId}|${def.loadCases[0].loadCaseId}` : ""}
              onChange={(e) => {
                const [laminateId, loadCaseId] = e.target.value.split("|");
                set({ loadCases: e.target.value ? [{ laminateId, loadCaseId }] : [] });
              }}
            >
              <option value="">{t("study.matrix.eachFirst")}</option>
              {ids.map((id) => (
                <LoadCaseOptions key={id} laminateId={id} />
              ))}
            </select>
          </label>
          <p className="hint">{t("study.matrix.criteriaHint")}</p>
        </fieldset>
      )}
    </section>
  );
}

function MatrixResult({
  study,
  layout,
  run,
}: {
  study: Extract<StudyDef, { kind: "matrix" }>;
  layout: MatrixLayout;
  run: StudyRun;
}) {
  const t = useT();
  const metric = useAtomValue(failureMetricAtom);
  const navigate = useNavigate();
  const store = useStore();
  const transpose = study.matrix.transpose;
  const corner = transpose
    ? t(layout.cols[0]?.criterion ? "study.matrix.criterion" : "study.matrix.loadCase")
    : t("study.matrix.laminate");

  // A cell opens its laminate's module - on the cell's load case, where that
  // is one of the laminate's own.
  const open = (row: number, col: number) => {
    const laminateId = layout.rows[row].laminateId!;
    const column = layout.cols[col];
    const loadCaseId = column.loadCaseId ?? layout.rowLoadCase[row] ?? null;
    const own = loadCasesOf(store.get(laminateConfigFamily(laminateId)));
    if (loadCaseId && own.some((c) => c.id === loadCaseId)) store.set(selectedLoadCaseFamily(laminateId), loadCaseId);
    navigate(`/laminates/${laminateId}/modules/${layout.output === "lpf" ? "lastPlyFailure" : "clt"}`);
  };

  return (
    <section className="panel">
      <div className="study-result-head">
        <h2>{t("study.results")}</h2>
        <TableActions table={() => matrixTable(study.name, layout, run.points, metric, transpose, t)} name="matrix" />
      </div>
      <MatrixView layout={layout} points={run.points} metric={metric} transpose={transpose} corner={corner} onOpen={open} />
      <p className="hint">{t("study.matrix.hint")}</p>
    </section>
  );
}

export default StudyPage;
