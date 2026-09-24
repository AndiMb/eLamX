import { useAtomValue } from "jotai";
import { cltErrorFamily, loadableCltResponseFamily } from "../store/derivedAtoms";
import { SummaryPanel } from "./SummaryPanel";
import { VerdictPanel } from "./VerdictPanel";
import { MobileCollapse } from "./MobileCollapse";
import { LayerResultsPanel } from "./LayerResultsPanel";
import { LaminateInfoPanel } from "./LaminateInfoPanel";
import { AbdExplanation } from "./AbdExplanation";
import { AngleSweepChart } from "./charts/AngleSweepChart";
import { AbdHeatmap } from "./charts/AbdHeatmap";
import { ThroughThicknessSheet } from "./ThroughThicknessSheet";
import { StrainShapeView } from "./charts/StrainShapeView";
import { solvedStrainsFamily } from "../store/derivedAtoms";
import { Panel } from "./Panel";
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
        <div className="dash">
          {/* The answer first. Everything below explains it - which is the
              order a phone needs and a wide screen does not mind. */}
          <VerdictPanel laminateId={laminateId} />

          <MobileCollapse title={t("results.derivation")}>
            <div className="how-group">
              <AbdExplanation laminateId={laminateId} />
            </div>
          </MobileCollapse>

          <SummaryPanel laminateId={laminateId} />

          {/* What this load case does ply by ply comes before what the
              laminate is regardless of the load: the verdict above points at
              a ply, and the next thing a reader looks for is that ply. */}
          {/* Behind a tap on a narrow screen for the same reason the ABD is:
              this one GROWS with the stack. Sixteen plies were 2800 px of
              cards between the load and the next thing worth reading. */}
          <MobileCollapse title={t("layerResults.title")}>
            <LayerResultsPanel laminateId={laminateId} />
          </MobileCollapse>
          {/* The sheet replaces the through-thickness chart and the ply bar
              chart that stood here (O4): both showed one column of it, on
              axes of their own. They remain as components. */}
          <MobileCollapse title={t("sheet.title")}>
            <ThroughThicknessSheet laminateId={laminateId} />
          </MobileCollapse>

          {/* Three views of the laminate's stiffness side by side, each in a
              card of a third: none of them needs more, and as full-width
              cards the heatmap took a quarter of its card and the deformed
              square a fifth of a 3.6:1 canvas. The deformed square is the one
              load-case view among them - it draws the six numbers the ABD
              produced, nothing per ply - which is why it stands here. */}
          <MobileCollapse title={t("results.abdVisualization")}>
            <AbdHeatmap laminateId={laminateId} />
          </MobileCollapse>
          <MobileCollapse title={t("chart.angleSweep.card")}>
            <AngleSweepChart laminateId={laminateId} />
          </MobileCollapse>
          <MobileCollapse title={t("strainShape.title")}>
            <Panel className="span-4 strain-card" title={t("strainShape.title")}>
              <DeformedSquare laminateId={laminateId} />
            </Panel>
          </MobileCollapse>

          <MobileCollapse title={t("results.laminateInfo")}>
            <LaminateInfoPanel laminateId={laminateId} />
          </MobileCollapse>
        </div>
      )}
    </>
  );
}

/** Reads the solved strains and hands them to the view. Split out so the view
 *  itself stays a pure function of six numbers - it is memoised, and a panel
 *  that also subscribed would defeat that. */
function DeformedSquare({ laminateId }: { laminateId: string }) {
  const strains = useAtomValue(solvedStrainsFamily(laminateId));
  if (!strains) return null;
  return <StrainShapeView strains={strains} />;
}
