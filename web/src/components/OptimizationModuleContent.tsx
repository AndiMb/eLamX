import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { ListChecks } from "lucide-react";
import { CriteriaPopover } from "./CriteriaPopover";
import { criterionName } from "../lib/types";
import { useNavigate } from "react-router-dom";
import { Play, Square, Trash2, Wand2 } from "lucide-react";
import {
  defaultConstraint,
  geneticParametersAtom,
  optimizationInputAtom,
  optimizationStateAtom,
  optimizerAtom,
  resolvedOptimizationInputAtom,
  runOptimizationAtom,
  cancelOptimizationAtom,
  candidateCountAtom,
} from "../store/optimizationAtoms";
import { CandidateTable } from "./CandidateTable";
import { historyStep } from "../lib/history";
import type { Candidate } from "../lib/generated/Candidate";
import { materialsAtom } from "../store/materialsAtoms";
import { addLaminateAtom, laminateConfigFamily } from "../store/laminateAtoms";
import { useStore } from "jotai";
import {
  BOUNDARY_CONDITIONS,
  CONSTRAINT_KINDS,
  CRITERIA,
  OPTIMIZERS,
  RADIUS_TYPES,
  type BoundaryConditionId,
  type ConstraintDto,
  type ConstraintKindId,
  type CriterionId,
  type OptimizerKindId,
  type RadiusTypeId,
} from "../lib/types";
import { SafeNumberInput } from "./SafeNumberInput";
import { Quantity } from "./Quantity";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { formatSignificant } from "../lib/numberFormat";
import { useLocale, useT, type MessageKey } from "../i18n";

// The one module that searches instead of reporting.
//
// It is also the one that does not run on every keystroke: a search is
// hundreds to thousands of full analyses, so there is a button. Everything
// else in this app updates live, and the difference is deliberate rather than
// an omission - which is why the button says what it is about to cost.

/** The angle sets eLamX offers, plus whatever the user types. */
const ANGLE_PRESETS = [
  { key: "standard", labelKey: "optimization.angles.standard", angles: [0, 45, -45, 90] },
  {
    key: "fine",
    labelKey: "optimization.angles.fine",
    angles: [0, 15, 30, 45, 60, 75, 90, -15, -30, -45, -60, -75],
  },
  { key: "crossPly", labelKey: "optimization.angles.crossPly", angles: [0, 90] },
  { key: "angleP1y", labelKey: "optimization.angles.angleP1y", angles: [45, -45] },
] as const satisfies readonly { key: string; labelKey: MessageKey; angles: readonly number[] }[];

export function OptimizationModuleContent() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [input, setInput] = useAtom(optimizationInputAtom);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [optimizer, setOptimizer] = useAtom(optimizerAtom);
  const [genetic, setGenetic] = useAtom(geneticParametersAtom);
  const state = useAtomValue(optimizationStateAtom);
  const run = useSetAtom(runOptimizationAtom);
  const cancel = useSetAtom(cancelOptimizationAtom);
  const [candidateCount, setCandidateCount] = useAtom(candidateCountAtom);
  const materials = useAtomValue(materialsAtom);
  const addLaminate = useSetAtom(addLaminateAtom);
  const store = useStore();

  // The same resolution the search itself does, so the form shows the material
  // that will actually be used - see `resolvedOptimizationInputAtom`.
  const materialId = useAtomValue(resolvedOptimizationInputAtom).material_id;

  const update = <K extends keyof typeof input>(key: K, value: (typeof input)[K]) =>
    setInput((current) => ({ ...current, [key]: value }));

  const updateConstraint = (index: number, next: ConstraintDto) =>
    setInput((current) => ({
      ...current,
      constraints: current.constraints.map((c, i) => (i === index ? next : c)),
    }));

  const result = state.result;

  /**
   * Turns the answer into a laminate of the project.
   *
   * The whole point of the module: a stacking sequence that stays on this page
   * is a picture of an answer, not an answer. The stored sequence and the
   * symmetry flag go across as they are, so a symmetric result becomes a
   * symmetric laminate with half the plies written down - which is how it
   * would have been typed in.
   */
  const adopt = (chosen: Pick<Candidate, "angles" | "symmetric"> | undefined = result ?? undefined) => {
    if (!chosen) return;
    const id = historyStep(t("optimization.adopt"), () => adoptInto(chosen));
    navigate(`/laminates/${id}`);
  };

  const adoptInto = (result: Pick<Candidate, "angles" | "symmetric">) => {
    const id = addLaminate(materialId);
    const config = store.get(laminateConfigFamily(id));
    store.set(laminateConfigFamily(id), {
      ...config,
      symmetric: result.symmetric,
      withMiddleLayer: false,
      layers: result.angles.map((angle, index) => ({
        id: crypto.randomUUID(),
        name: t("default.layerName", { nr: index + 1 }),
        angle,
        thickness: input.thickness,
        materialId,
        criterionId: input.criterion_id as CriterionId,
        ...((input.extra_criteria ?? []).length > 0
          ? { extraCriteria: input.extra_criteria as CriterionId[] }
          : {}),
      })),
    });
    return id;
  };

  return (
    <>
      <BackLink to="/" label={t("nav.project")} />
      <p className="hint">{t("optimization.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("optimization.input.title")}</h2>

          <h3>{t("optimization.ply")}</h3>
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("layers.column.material")}</span>
              <select
                value={materialId}
                onChange={(e) => update("material_id", e.target.value)}
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="wide">
              <label htmlFor="optimization-criterion" className="field-label">
                {t("layers.column.criterion")}
              </label>
              {/* The primary criterion, and - as for a ply - further ones
                  every candidate is checked against (F2.1). */}
              <span className="criterion-cell">
                <select
                  id="optimization-criterion"
                  value={input.criterion_id}
                  onChange={(e) =>
                    setInput((c) => ({
                      ...c,
                      criterion_id: e.target.value as CriterionId,
                      extra_criteria: (c.extra_criteria ?? []).filter((x) => x !== e.target.value),
                    }))
                  }
                >
                  {CRITERIA.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(c.labelKey)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={(input.extra_criteria ?? []).length > 0 ? "criteria-count has-extra" : "criteria-count"}
                  onClick={() => setEditingCriteria(true)}
                  aria-label={t("optimization.criteria.open", {
                    list: [input.criterion_id, ...(input.extra_criteria ?? [])].map((id) => criterionName(id, t)).join(", "),
                  })}
                  title={[input.criterion_id, ...(input.extra_criteria ?? [])].map((id) => criterionName(id, t)).join(", ")}
                >
                  {(input.extra_criteria ?? []).length > 0 ? (
                    `+${(input.extra_criteria ?? []).length}`
                  ) : (
                    <ListChecks size={14} aria-hidden="true" />
                  )}
                </button>
              </span>
              {editingCriteria && (
                <CriteriaPopover
                  title={t("optimization.criteria.title")}
                  initial={[input.criterion_id, ...(input.extra_criteria ?? [])] as CriterionId[]}
                  onApply={(list) => {
                    setInput((c) => ({ ...c, criterion_id: list[0], extra_criteria: list.slice(1) }));
                    setEditingCriteria(false);
                  }}
                  onClose={() => setEditingCriteria(false)}
                />
              )}
            </div>
            <label>
              <span className="field-label">
                <Sym base="t" />
              </span>
              <Quantity
                category="thickness"
                value={input.thickness}
                onChange={(v) => update("thickness", v)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={input.symmetric}
                onChange={(e) => update("symmetric", e.target.checked)}
              />
              <span>{t("optimization.symmetric")}</span>
            </label>
          </div>

          <h3>{t("optimization.angles")}</h3>
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("optimization.angles.preset")}</span>
              <select
                value=""
                onChange={(e) => {
                  const preset = ANGLE_PRESETS.find((p) => p.key === e.target.value);
                  if (preset) update("angles", [...preset.angles]);
                }}
              >
                <option value="">{t("optimization.angles.pick")}</option>
                {ANGLE_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {t(preset.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span className="field-label">{t("optimization.angles.list")}</span>
              <input
                type="text"
                value={input.angles.join(", ")}
                onChange={(e) => {
                  const parsed = e.target.value
                    .split(/[,;\s]+/)
                    .map((piece) => Number(piece))
                    .filter((value) => Number.isFinite(value));
                  update("angles", parsed);
                }}
              />
            </label>
          </div>
          <p className="hint">{t("optimization.angles.hint")}</p>

          <h3>{t("optimization.constraints")}</h3>
          {input.constraints.map((constraint, index) => (
            <div className="constraint-card" key={index}>
              <div className="constraint-head">
                <strong>
                  {t(
                    CONSTRAINT_KINDS.find((k) => k.id === constraint.kind)?.labelKey ??
                      "constraint.clt",
                  )}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("optimization.constraint.remove")}
                  title={t("optimization.constraint.remove")}
                  onClick={() =>
                    update(
                      "constraints",
                      input.constraints.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <ConstraintEditor
                constraint={constraint}
                onChange={(next) => updateConstraint(index, next)}
              />
            </div>
          ))}
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("optimization.constraint.add")}</span>
              <select
                value=""
                onChange={(e) => {
                  const kind = e.target.value as ConstraintKindId;
                  if (!kind) return;
                  update("constraints", [...input.constraints, defaultConstraint(kind)]);
                }}
              >
                <option value="">{t("optimization.constraint.pick")}</option>
                {CONSTRAINT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {t(k.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">{t("optimization.constraints.hint")}</p>

          <h3>{t("optimization.method")}</h3>
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("optimization.optimizer")}</span>
              <select
                value={optimizer}
                onChange={(e) => setOptimizer(e.target.value as OptimizerKindId)}
              >
                {OPTIMIZERS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            {optimizer === "genetic" && (
              <>
                <label>
                  <span className="field-label">{t("optimization.generations")}</span>
                  <SafeNumberInput
                    value={genetic.max_generations}
                    onChange={(v) =>
                      setGenetic({ ...genetic, max_generations: Math.max(1, Math.round(v)) })
                    }
                  />
                </label>
                <label>
                  <span className="field-label">{t("optimization.seed")}</span>
                  <SafeNumberInput
                    value={genetic.seed}
                    onChange={(v) => setGenetic({ ...genetic, seed: Math.max(0, Math.round(v)) })}
                  />
                </label>
              </>
            )}
          </div>
          <p className="hint">
            {t(OPTIMIZERS.find((o) => o.id === optimizer)?.hintKey ?? "optimizer.sequential.hint")}
          </p>
          <div className="field-grid">
            <label>
              <span className="field-label">{t("optimization.candidates.count")}</span>
              <SafeNumberInput
                value={candidateCount}
                onChange={(v) => setCandidateCount(Math.min(50, Math.max(1, Math.round(v))))}
              />
            </label>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => run()} disabled={state.status === "running"}>
              <Play size={16} />{" "}
              {state.status === "running" ? t("optimization.running") : t("optimization.run")}
            </button>
            {state.status === "running" && (
              <button type="button" onClick={() => cancel()}>
                <Square size={16} /> {t("batch.cancel")}
              </button>
            )}
          </div>
          <p className="hint">{t("optimization.run.hint")}</p>
        </section>

        <div className="module-results">
          {state.status === "failed" && (
            <p className="error">{t("optimization.error", { message: state.error ?? "" })}</p>
          )}
          {state.status === "running" && (
            // The search reports no progress of its own, so the bar says only
            // that it is working; it runs in its own worker and every other
            // view keeps computing meanwhile.
            <div className="report-progress" role="status">
              <span>{t("optimization.running")}</span>
              <progress aria-label={t("optimization.running")} />
            </div>
          )}
          {state.status === "cancelled" && <p className="hint">{t("optimization.cancelled")}</p>}

          {result && (
            <section className="panel">
              <h2>{t("optimization.result.title")}</h2>

              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">{t("optimization.layers")}</span>
                  <span className="value">{result.layer_count}</span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("optimization.thickness")}</span>
                  <span className="value">
                    {formatSignificant(result.thickness, 4, locale)}
                    <span className="quantity-unit"> mm</span>
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("optimization.reserve")}</span>
                  <span className="value">
                    {formatSignificant(result.min_reserve_factor, 4, locale)}
                  </span>
                </div>
              </div>

              <p className="stacking">
                {stackingNotation(result.angles, result.symmetric, locale)}
              </p>

              <p className="hint">
                {t("optimization.cost", {
                  checked: result.checked_laminates,
                  evaluations: result.constraint_evaluations,
                  seconds: formatSignificant((state.took ?? 0) / 1000, 2, locale),
                })}
              </p>
              {result.last_improvement !== null && result.last_improvement !== undefined && (
                <p className="hint">
                  {t("optimization.lastImprovement", {
                    generation: result.last_improvement,
                    total: genetic.max_generations,
                  })}
                </p>
              )}

              <div className="button-row">
                <button type="button" onClick={() => adopt()}>
                  <Wand2 size={16} /> {t("optimization.adopt")}
                </button>
              </div>
              {optimizer === "sequential" ? (
                <p className="hint">{t("optimization.candidates.sequential")}</p>
              ) : (
                result.candidates.length > 1 && (
                  <CandidateTable
                    candidates={result.candidates}
                    density={materials.find((m) => m.id === materialId)?.rho ?? 0}
                    onAdopt={(c) => adopt(c)}
                  />
                )
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** How a stacking sequence is written down: `[0/45/-45/90]s`. */
function stackingNotation(angles: number[], symmetric: boolean, locale: string): string {
  const inner = angles.map((a) => formatSignificant(a, 4, locale)).join("/");
  return `[${inner}]${symmetric ? "s" : ""}`;
}

/** The fields of one constraint, by kind. */
function ConstraintEditor({
  constraint,
  onChange,
}: {
  constraint: ConstraintDto;
  onChange: (next: ConstraintDto) => void;
}) {
  const t = useT();

  if (constraint.kind === "clt") {
    const fields: [keyof typeof constraint.loads, string, string][] = [
      ["n_x", "n", "x"],
      ["n_y", "n", "y"],
      ["n_xy", "n", "xy"],
      ["m_x", "m", "x"],
      ["m_y", "m", "y"],
      ["m_xy", "m", "xy"],
    ];
    return (
      <div className="field-grid">
        {fields.map(([key, base, sub]) => (
          <label key={key}>
            <span className="field-label">
              <Sym base={base} sub={sub} />
            </span>
            <SafeNumberInput
              value={constraint.loads[key] as number}
              onChange={(v) =>
                onChange({ ...constraint, loads: { ...constraint.loads, [key]: v } })
              }
            />
          </label>
        ))}
      </div>
    );
  }

  if (constraint.kind === "pressure_vessel") {
    return (
      <div className="field-grid">
        <label>
          <span className="field-label">{t("vessel.pressure")}</span>
          <SafeNumberInput
            value={constraint.input.pressure}
            onChange={(v) => onChange({ ...constraint, input: { ...constraint.input, pressure: v } })}
          />
        </label>
        <label>
          <span className="field-label">{t("vessel.radiusType")}</span>
          <Quantity
            category="thickness"
            value={constraint.input.radius}
            onChange={(v) => onChange({ ...constraint, input: { ...constraint.input, radius: v } })}
          />
        </label>
        <label className="wide">
          <span className="field-label">{t("vessel.radiusType")}</span>
          <select
            value={constraint.input.radius_type}
            onChange={(e) =>
              onChange({
                ...constraint,
                input: { ...constraint.input, radius_type: e.target.value as RadiusTypeId },
              })
            }
          >
            {RADIUS_TYPES.map((r) => (
              <option key={r.id} value={r.id}>
                {t(r.labelKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  // Buckling and deformation share their plate geometry and edges.
  const plate = constraint.input;
  const setPlate = (patch: Record<string, unknown>) =>
    onChange({ ...constraint, input: { ...plate, ...patch } } as ConstraintDto);

  return (
    <div className="field-grid">
      <label>
        <span className="field-label">
          <Sym base="a" sub="x" />
        </span>
        <Quantity category="thickness" value={plate.length} onChange={(v) => setPlate({ length: v })} />
      </label>
      <label>
        <span className="field-label">
          <Sym base="b" sub="y" />
        </span>
        <Quantity category="thickness" value={plate.width} onChange={(v) => setPlate({ width: v })} />
      </label>
      <label>
        <span className="field-label">{t("buckling.bcX")}</span>
        <select
          value={plate.bc_x}
          onChange={(e) => setPlate({ bc_x: e.target.value as BoundaryConditionId })}
        >
          {BOUNDARY_CONDITIONS.map((bc) => (
            <option key={bc} value={bc}>
              {bc}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="field-label">{t("buckling.bcY")}</span>
        <select
          value={plate.bc_y}
          onChange={(e) => setPlate({ bc_y: e.target.value as BoundaryConditionId })}
        >
          {BOUNDARY_CONDITIONS.map((bc) => (
            <option key={bc} value={bc}>
              {bc}
            </option>
          ))}
        </select>
      </label>

      {constraint.kind === "buckling" ? (
        <>
          <label>
            <span className="field-label">
              <Sym base="n" sub="x" />
            </span>
            <SafeNumberInput
              value={constraint.input.n_x}
              onChange={(v) => setPlate({ n_x: v })}
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="n" sub="y" />
            </span>
            <SafeNumberInput
              value={constraint.input.n_y}
              onChange={(v) => setPlate({ n_y: v })}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <span className="field-label">
              <Sym base="q" />
            </span>
            <SafeNumberInput
              value={surfaceForce(constraint)}
              onChange={(v) =>
                setPlate({ loads: [{ kind: "Surface", name: "q", force: v }] })
              }
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="w" sub="zul" />
            </span>
            <Quantity
              category="thickness"
              value={constraint.input.max_displacement_z}
              onChange={(v) => setPlate({ max_displacement_z: v })}
            />
          </label>
        </>
      )}
    </div>
  );
}

function surfaceForce(constraint: Extract<ConstraintDto, { kind: "deformation" }>): number {
  const load = constraint.input.loads[0];
  return load && load.kind === "Surface" ? load.force : 0;
}
