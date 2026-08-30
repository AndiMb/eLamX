import { useAtomValue, useSetAtom } from "jotai";
import {
  activeLoadCaseFamily,
  updateActiveLoadCaseAtom,
  type LoadCase,
} from "../store/laminateAtoms";
import { solvedLoadsFamily, solvedStrainsFamily } from "../store/derivedAtoms";
import { DOF_NAMES, HYGROTHERMAL_FIELDS, LOAD_FIELDS, STRAIN_FIELDS } from "../lib/constants";
import { MobileCollapse } from "./MobileCollapse";
import { SafeNumberInput } from "./SafeNumberInput";
import { Quantity } from "./Quantity";
import { AbdMatrixPanel } from "./AbdMatrixPanel";
import { useRenderCount } from "../lib/useRenderCount";
import { symText } from "../lib/symbols";
import { Sym } from "./Sym";
import { formatFixed, formatScientific, isFiniteResult, NO_VALUE } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

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
  const locale = useLocale();
  // Every edit here goes into the ACTIVE load case, not into the laminate:
  // the laminate is the stack, a load case is one thing done to it.
  const config = useAtomValue(activeLoadCaseFamily(laminateId));
  const updateLoadCase = useSetAtom(updateActiveLoadCaseAtom);
  const loads = useAtomValue(solvedLoadsFamily(laminateId));
  const strains = useAtomValue(solvedStrainsFamily(laminateId));
  const renderCount = useRenderCount();

  const setConfig = (update: (loadCase: LoadCase) => LoadCase) =>
    updateLoadCase({ laminateId, update });

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
            aria-label="delta T"
            value={config.deltaT}
            onChange={(v) => setConfig((c) => ({ ...c, deltaT: v }))}
          />
        </div>
        <div className="equation-state-field">
          <span className="equation-label">&Delta;H</span>
          <Quantity
            category="percent"
            aria-label="delta H"
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
              <div className="equation-cell" key={symText(names.load)}>
                <span className="equation-label"><Sym {...names.load} /></span>
                {editable ? (
                  <SafeNumberInput
                    value={config.dofValues[i]}
                    aria-label={symText(names.load)}
                    onChange={(v) => updateDofValue(i, v)}
                  />
                ) : (
                  <button
                    type="button"
                    className="equation-computed"
                    onClick={() => setPrescribed(i, false)}
                    aria-label={t("equation.prescribe", { name: symText(names.load) })}
                    title={t("equation.prescribe.title", { name: symText(names.load) })}
                  >
                    {!loads ? "…" : formatFixed(loads[LOAD_FIELDS[i]], 3, locale)}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* On a phone the equation metaphor is already gone - the row stacks
            into a linear form, and the ABD matrix has to scroll sideways. What
            is left of it there is the two things a phone is for: the load
            column and the strain column. The middle - the operators, the
            derived hygrothermal loads and the matrix - goes behind one tap. */}
        <MobileCollapse title={t("equation.middle")}>
          <span className="equation-op">+</span>

          {/* Purely derived - unlike the load/strain columns there is nothing
              to prescribe here, so these are plain read-only values rather
              than the clickable .equation-computed buttons. */}
          <div className="equation-block">
          <h3>{t("equation.hygrothermalLoads")}</h3>
          <div className="equation-head-spacer" aria-hidden="true" />
          {DOF_NAMES.map((names, i) => (
            <div className="equation-cell" key={symText(names.load)}>
              <span className="equation-label"><Sym {...names.load} /></span>
              <span className="equation-derived">
                {!loads
                  ? "…"
                  : isFiniteResult(loads[HYGROTHERMAL_FIELDS[i]])
                    ? formatFixed(loads[HYGROTHERMAL_FIELDS[i]], 3, locale)
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
        </MobileCollapse>

        {/* Output, unless a degree of freedom is prescribed as a strain - and
            then it is the input, so the collapse steps aside. Six read-only
            rows are about 380 px on a phone, which is most of the distance
            between a load and the verdict below. */}
        <MobileCollapse
          title={t("equation.strains")}
          disabled={config.useStrain.some(Boolean)}
        >
        <div className="equation-block">
          <h3>{t("equation.strains")}</h3>
          <div className="equation-head-spacer" aria-hidden="true" />
          {DOF_NAMES.map((names, i) => {
            const editable = config.useStrain[i];
            return (
              <div className="equation-cell" key={symText(names.strain)}>
                <span className="equation-label"><Sym {...names.strain} /></span>
                {editable ? (
                  <SafeNumberInput
                    value={config.dofValues[i]}
                    aria-label={symText(names.strain)}
                    onChange={(v) => updateDofValue(i, v)}
                  />
                ) : (
                  <button
                    type="button"
                    className="equation-computed"
                    onClick={() => setPrescribed(i, true)}
                    aria-label={t("equation.prescribe", { name: symText(names.strain) })}
                    title={t("equation.prescribe.title", { name: symText(names.strain) })}
                  >
                    {!strains
                      ? "…"
                      : isFiniteResult(strains[STRAIN_FIELDS[i]])
                        ? formatScientific(strains[STRAIN_FIELDS[i]], 4, locale)
                        : NO_VALUE}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        </MobileCollapse>
      </div>
      <p className="hint equation-hygro-hint">{t("equation.hygrothermalLoads.hint")}</p>
    </section>
  );
}
