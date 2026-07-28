import { useAtomValue } from "jotai";
import { cltErrorFamily, loadableCltResponseFamily } from "../store/derivedAtoms";
import { SummaryPanel } from "./SummaryPanel";
import { LayerResultsPanel } from "./LayerResultsPanel";
import { AbdExplanation } from "./AbdExplanation";
import { AngleSweepChart } from "./charts/AngleSweepChart";
import { AbdHeatmap } from "./charts/AbdHeatmap";
import { ThroughThicknessChart } from "./charts/ThroughThicknessChart";
import { ReserveFactorChart } from "./charts/ReserveFactorChart";
import { useT } from "../i18n";

// Grouped into separate cards by topic (Kennzahlen / ABD-Visualisierung /
// Lagenergebnisse) rather than one long flat list - the ABD-Matrix table
// itself now lives in EquationPanel (the "=" operand), these are the
// follow-up material: worked-example derivations, engineering constants, the
// ABD matrix's graphical views, and the per-layer stress/failure results.
// Each panel subscribes only to its own selectAtom slice of that laminate's
// family (see store/derivedAtoms.ts), so editing e.g. the failure criterion
// only re-renders LayerResultsPanel, not SummaryPanel/etc.
export function ResultsSection({ laminateId }: { laminateId: string }) {
  const t = useT();
  const loadableState = useAtomValue(loadableCltResponseFamily(laminateId));
  const error = useAtomValue(cltErrorFamily(laminateId));

  return (
    <>
      {/* The error TEXT itself comes from the Rust core / the browser and is
          not translated - it is diagnostic detail, and mistranslating it
          would make it harder, not easier, to report. */}
      {error && <p className="error">{t("results.error", { message: error })}</p>}
      {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}
      {loadableState.state === "hasData" && (
        <>
          <AbdExplanation laminateId={laminateId} />

          <section className="panel">
            <SummaryPanel laminateId={laminateId} />
          </section>

          <section className="panel">
            <h2>{t("results.abdVisualization")}</h2>
            <div className="grid">
              <AbdHeatmap laminateId={laminateId} />
              <AngleSweepChart laminateId={laminateId} />
            </div>
          </section>

          <section className="panel">
            <LayerResultsPanel laminateId={laminateId} />
            <div className="grid">
              <ReserveFactorChart laminateId={laminateId} />
              <ThroughThicknessChart laminateId={laminateId} />
            </div>
          </section>
        </>
      )}
    </>
  );
}
