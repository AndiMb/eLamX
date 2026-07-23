import { memo } from "react";
import { useAtomValue } from "jotai";
import { summaryFamily } from "../store/derivedAtoms";
import { useRenderCount } from "../lib/useRenderCount";
import { QuantityDisplay } from "./QuantityDisplay";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { fmt, fmtExp } from "../lib/cltFormulas";
import type { QuantityCategory } from "../lib/units";

function StatTile({ label, category, value }: { label: string; category: QuantityCategory; value: number }) {
  return (
    <div className="stat-tile">
      <span className="label">{label}</span>
      <span className="value">
        <QuantityDisplay category={category} value={value} />
      </span>
    </div>
  );
}

// See AbdMatrixPanel.tsx for why memo() is required here.
export const SummaryPanel = memo(function SummaryPanel({ laminateId }: { laminateId: string }) {
  const summary = useAtomValue(summaryFamily(laminateId));
  const renderCount = useRenderCount();

  if (!summary) return null;
  const ec = summary.engineeringConstants;
  const abdInv = summary.abdInv;

  const exFormula = "E_x = \\dfrac{1}{(ABD^{-1})_{11}\\cdot t_{ges}}";
  const exSubstituted = `E_x = \\dfrac{1}{${fmtExp(abdInv[0][0])} \\cdot ${fmt(summary.tges, 2)}} = ${fmt(ec.ex_simple, 1)}\\ \\text{MPa}`;

  const nuxyFormula = "\\nu_{xy} = -\\dfrac{(ABD^{-1})_{12}}{(ABD^{-1})_{11}}";
  const nuxySubstituted = `\\nu_{xy} = -\\dfrac{${fmtExp(abdInv[0][1])}}{${fmtExp(abdInv[0][0])}} = ${fmt(ec.nuxy_simple, 4)}`;

  return (
    <>
      <h3>
        Kennzahlen <span className="render-count">(Renders: {renderCount})</span>
      </h3>
      <div className="stat-tiles">
        <StatTile label="t_ges" category="thickness" value={summary.tges} />
        <div className="stat-tile">
          <span className="label">symmetrisch (B≈0)</span>
          <span className="value">
            <span className={`chip ${summary.isSymmetric ? "ok" : ""}`}>{summary.isSymmetric ? "ja" : "nein"}</span>
          </span>
        </div>
        <StatTile label="E_x" category="stiffness" value={ec.ex_simple} />
        <StatTile label="E_y" category="stiffness" value={ec.ey_simple} />
        <StatTile label="G" category="stiffness" value={ec.g_simple} />
        <StatTile label="ν_xy" category="poissonRatio" value={ec.nuxy_simple} />
        <StatTile label="ν_yx" category="poissonRatio" value={ec.nuyx_simple} />
        <div className="stat-tile">
          <span className="label">Flächengewicht</span>
          <span className="value">{summary.areaWeight.toExponential(3)}</span>
        </div>
      </div>
      <HowWasThisComputed
        title="Ingenieurskonstante E_x (Poisson-frei, „simple“)"
        formula={exFormula}
        substituted={exSubstituted}
      >
        <p className="hint">
          (ABD<sup>-1</sup>) ist die Inverse der vollen 6&times;6-ABD-Matrix - sie berücksichtigt auch die
          Kopplung zwischen Dehnung und Krümmung (B-Block). Analog für E_y, G und &nu;yx.
        </p>
      </HowWasThisComputed>
      <HowWasThisComputed title="Querkontraktionszahl &nu;xy" formula={nuxyFormula} substituted={nuxySubstituted} />
    </>
  );
});
