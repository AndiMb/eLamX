import { useAtom, useAtomValue } from "jotai";
import { laminateConfigFamily } from "../store/laminateAtoms";
import { solvedLoadsFamily, solvedStrainsFamily } from "../store/derivedAtoms";
import { DOF_NAMES, LOAD_FIELDS, STRAIN_FIELDS } from "../lib/constants";
import { SafeNumberInput } from "./SafeNumberInput";
import { Quantity } from "./Quantity";
import { AbdMatrixPanel } from "./AbdMatrixPanel";
import { useRenderCount } from "../lib/useRenderCount";

// Mirrors the classic CLT equation's spatial layout, as in the Java
// original: {N;M} + {N;M}_temp = [ABD] * {eps;kappa}. Replaces the old
// DOF-input table + Delta-T/Delta-H field-grid + the separate "Geloeste
// Lasten"/"Geloeste Verzerrungen" panels, which together used to repeat the
// same 12 numbers across three disconnected places.
//
// Each of the 6 load rows and 6 strain rows has a FIXED identity (N_x stays
// N_x); only which side of a given DOF is editable vs computed toggles with
// config.useStrain[i]. Clicking a computed (read-only-styled) value flips
// that DOF's prescription - replacing the old, spatially disconnected
// "Dehnung vorgeben" checkbox column, which had no natural place to live once
// the loads and strains columns moved to opposite ends of the equation row.
export function EquationPanel({ laminateId }: { laminateId: string }) {
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
        Gleichung <span className="render-count">(Renders: {renderCount})</span>
      </h2>
      <div className="equation-row">
        <div className="equation-block">
          <h3>Lasten</h3>
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
                    aria-label={`${names.load} stattdessen vorgeben`}
                    title={`${names.load} stattdessen vorgeben (aktuell berechnet)`}
                  >
                    {loads ? loads[LOAD_FIELDS[i]].toFixed(3) : "…"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <span className="equation-op">+</span>

        <div className="equation-block">
          <h3>Temperaturlasten</h3>
          <div className="equation-cell">
            <span className="equation-label">&Delta;T</span>
            <Quantity
              category="temperatureDelta"
              value={config.deltaT}
              onChange={(v) => setConfig((c) => ({ ...c, deltaT: v }))}
            />
          </div>
          <div className="equation-cell">
            <span className="equation-label">&Delta;H</span>
            <Quantity
              category="percent"
              value={config.deltaH}
              onChange={(v) => setConfig((c) => ({ ...c, deltaH: v }))}
            />
          </div>
        </div>

        <span className="equation-op">=</span>

        <div className="equation-block equation-abd">
          <AbdMatrixPanel laminateId={laminateId} />
        </div>

        <span className="equation-op">&times;</span>

        <div className="equation-block">
          <h3>Verzerrungen</h3>
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
                    aria-label={`${names.strain} stattdessen vorgeben`}
                    title={`${names.strain} stattdessen vorgeben (aktuell berechnet)`}
                  >
                    {strains ? strains[STRAIN_FIELDS[i]].toExponential(4) : "…"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
