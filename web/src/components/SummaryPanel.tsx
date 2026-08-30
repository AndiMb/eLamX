import { memo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { summaryFamily } from "../store/derivedAtoms";
import { QuantityDisplay } from "./QuantityDisplay";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { useFmt, fmtExp } from "../lib/cltFormulas";
import { formatScientific } from "../lib/numberFormat";
import { Sym } from "./Sym";
import type { QuantityCategory } from "../lib/units";
import { useLocale, useT } from "../i18n";

function StatTile({ label, category, value }: { label: ReactNode; category: QuantityCategory; value: number }) {
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
  const t = useT();
  const locale = useLocale();
  const fmt = useFmt();
  const summary = useAtomValue(summaryFamily(laminateId));

  if (!summary) return null;
  const ec = summary.engineeringConstants;
  const abdInv = summary.abdInv;

  const exFormula = "E_x = \\dfrac{1}{(ABD^{-1})_{11}\\cdot t_{ges}}";
  const exSubstituted = `E_x = \\dfrac{1}{${fmtExp(abdInv[0][0], locale)} \\cdot ${fmt(summary.tges, 2)}} = ${fmt(ec.ex_simple, 1)}\\ \\text{MPa}`;

  const nuxyFormula = "\\nu_{xy} = -\\dfrac{(ABD^{-1})_{12}}{(ABD^{-1})_{11}}";
  const nuxySubstituted = `\\nu_{xy} = -\\dfrac{${fmtExp(abdInv[0][1], locale)}}{${fmtExp(abdInv[0][0], locale)}} = ${fmt(ec.nuxy_simple, 4)}`;

  return (
    <>
      <h3>{t("summary.title")}</h3>
      <div className="stat-tiles">
        <StatTile label={<Sym base="t" sub="ges" />} category="thickness" value={summary.tges} />
        <div className="stat-tile">
          <span className="label">{t("summary.symmetric")}</span>
          <span className="value">
            <span className={`chip ${summary.isSymmetric ? "ok" : ""}`}>
              {t(summary.isSymmetric ? "common.yes" : "common.no")}
            </span>
          </span>
        </div>
        <StatTile label={<Sym base="E" sub="x" />} category="stiffness" value={ec.ex_simple} />
        <StatTile label={<Sym base="E" sub="y" />} category="stiffness" value={ec.ey_simple} />
        <StatTile label={<Sym base="G" />} category="stiffness" value={ec.g_simple} />
        <StatTile label={<Sym base="ν" sub="xy" />} category="poissonRatio" value={ec.nuxy_simple} />
        <StatTile label={<Sym base="ν" sub="yx" />} category="poissonRatio" value={ec.nuyx_simple} />
        <div className="stat-tile">
          <span className="label">{t("summary.areaWeight")}</span>
          <span className="value">
            {formatScientific(summary.areaWeight, 3, locale)}
          </span>
        </div>
      </div>
      <HowWasThisComputed title={t("summary.ex.title")} formula={exFormula} substituted={exSubstituted}>
        <p className="hint">{t("summary.ex.hint")}</p>
      </HowWasThisComputed>
      <HowWasThisComputed title={t("summary.nuxy.title")} formula={nuxyFormula} substituted={nuxySubstituted} />
    </>
  );
});
