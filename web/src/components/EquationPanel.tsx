import { useAtom, useAtomValue } from "jotai";
import { laminateConfigFamily } from "../store/laminateAtoms";
import { solvedLoadsFamily, solvedStrainsFamily } from "../store/derivedAtoms";
import { DOF_NAMES, HYGROTHERMAL_FIELDS, LOAD_FIELDS, STRAIN_FIELDS } from "../lib/constants";
import { SafeNumberInput } from "./SafeNumberInput";
import { Quantity } from "./Quantity";
import { AbdMatrixPanel } from "./AbdMatrixPanel";
import { useRenderCount } from "../lib/useRenderCount";
import { isFiniteResult, NO_VALUE } from "../lib/numberFormat";
import { useT } from "../i18n";

// Mirrors the classic CLT equation's spatial layout, as in the Java
// original's CalculationPanel:
//
//     {n;m}_mech + {n;m}_hygrotherm = [ABD] * {eps;kappa}
//
// Replaces the old DOF-input table + the separate "Geloeste Lasten"/"Geloeste
// Verzerrungen" panels, which together used to repeat the same 12 numbers
// across three disconnected places.
//
// dT/dH deliberately sit OUTSIDE the equation row: they are not operands of
// it. They are the state change from which the core derives the hygrothermal
// vector (via each layer's alpha/beta), so they belong above the equation as
// its parameters - putting them into the "+" slot, as an earlier version did,
// claimed a spot in the equation that the hygrothermal vector itself owns.
//
// Each of the 6 load rows and 6 strain rows has a FIXED identity (N_x stays
// N_x); only which side of a given DOF is editable vs computed toggles with
// config.useStrain[i]. Clicking a computed (read-only-styled) value flips
// that DOF's prescription - replacing the old, spatially disconnected
// "prescribe strain" checkbox column, which had no natural place to live once
// the loads and strains columns moved to opposite ends of the equation row.
export function EquationPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const [config, setConfig] = useAtom(laminateConfigFamily(laminateId));
  const loads = useAtomValue(solvedLoadsFamily(laminateId));
  const strains = useAtomValue(solvedStrainsFamily(laminateId));
  const renderCount = useRenderCount();

  const updateDofValue = (index: number, value: number) => {
    setConfig((c) => ({ ...c, dofValues: c.dofValues.map((v, i) => (i === index ? value : v)) }));
  };

  const setPrescribed = (index: number, useStrain: boolean) => {
    setConfig((c) => ({ ...c, useStrain: c.useStrain.map((f, i) => (i === index ? useStrain : f)) }));
  };

  return (
    <section className="panel">
      <h2>
        {t("equation.title")}{" "}
        <span className="render-count">{t("common.renders", { count: renderCount })}</span>
      </h2>

      <div className="equation-state">
        <span className="equation-state-title">{t("equation.hygrothermalState")}</span>
        <div className="equation-state-field">
          <span className="equation-label">&Delta;T</span>
          <Quantity
            category="temperatureDelta"
            value={config.deltaT}
            onChange={(v) => setConfig((c) => ({ ...c, deltaT: v }))}
          />
        </div>
        <div className="equation-state-field">
          <span className="equation-label">&Delta;H</span>
          <Quantity
            category="percent"
            value={config.deltaH}
            onChange={(v) => setConfig((c) => ({ ...c, deltaH: v }))}
          />
        </div>
      </div>
      <p className="hint equation-state-hint">{t("equation.hygrothermalState.hint")}</p>

      <div className="equation-row">
        <div className="equation-block">
          <h3>{t("equation.loads")}</h3>
          {/* Keeps the six value rows level with the ABD matrix's body rows,
              which sit one row lower because of its column-index header. */}
          <div className="equation-head-spacer" aria-hidden="true" />
          {DOF_NAMES.map((names, i) => {
            const editable = !config.useStrain[i];
            return (
              <div className="equation-cell" key={names.load}>
                <span className="equation-label">{names.load}</span>
                {editable ? (
                  <SafeNumberInput value={config.dofValues[i]} onChange={(v) => updateDofValue(i, v)} />
                ) : (
                  <button
                    type="button"
                    className="equation-computed"
                    onClick={() => setPrescribed(i, false)}
                    aria-label={t("equation.prescribe", { name: names.load })}
                    title={t("equation.prescribe.title", { name: names.load })}
                  >
                    {!loads ? "…" : isFiniteResult(loads[LOAD_FIELDS[i]]) ? loads[LOAD_FIELDS[i]].toFixed(3) : NO_VALUE}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <span className="equation-op">+</span>

        {/* Purely derived - unlike the load/strain columns there is nothing to
            prescribe here, so these are plain read-only values rather than the
            clickable .equation-computed buttons. */}
        <div className="equation-block">
          <h3>{t("equation.hygrothermalLoads")}</h3>
          <div className="equation-head-spacer" aria-hidden="true" />
          {DOF_NAMES.map((names, i) => (
            <div className="equation-cell" key={names.load}>
              <span className="equation-label">{names.load}</span>
              <span className="equation-derived">
                {!loads
                  ? "…"
                  : isFiniteResult(loads[HYGROTHERMAL_FIELDS[i]])
                    ? loads[HYGROTHERMAL_FIELDS[i]].toFixed(3)
                    : NO_VALUE}
              </span>
            </div>
          ))}
        </div>

        <span className="equation-op">=</span>

        <div className="equation-block equation-abd">
          <AbdMatrixPanel laminateId={laminateId} />
        </div>

        <span className="equation-op">&times;</span>

        <div className="equation-block">
          <h3>{t("equation.strains")}</h3>
          <div className="equation-head-spacer" aria-hidden="true" />
          {DOF_NAMES.map((names, i) => {
            const editable = config.useStrain[i];
            return (
              <div className="equation-cell" key={names.strain}>
                <span className="equation-label">{names.strain}</span>
                {editable ? (
                  <SafeNumberInput value={config.dofValues[i]} onChange={(v) => updateDofValue(i, v)} />
                ) : (
                  <button
                    type="button"
                    className="equation-computed"
                    onClick={() => setPrescribed(i, true)}
                    aria-label={t("equation.prescribe", { name: names.strain })}
                    title={t("equation.prescribe.title", { name: names.strain })}
                  >
                    {!strains
                      ? "…"
                      : isFiniteResult(strains[STRAIN_FIELDS[i]])
                        ? strains[STRAIN_FIELDS[i]].toExponential(4)
                        : NO_VALUE}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint equation-hygro-hint">{t("equation.hygrothermalLoads.hint")}</p>
    </section>
  );
}
