import { memo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { summaryFamily } from "../store/derivedAtoms";
import { QuantityDisplay } from "./QuantityDisplay";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { exFormula, nuxyFormula } from "../lib/formulas";
import { Sym } from "./Sym";
import { Panel } from "./Panel";
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
  const summary = useAtomValue(summaryFamily(laminateId));

  if (!summary) return null;
  const ec = summary.engineeringConstants;
  const abdInv = summary.abdInv;

  const ex = exFormula(abdInv, summary.tges, ec, { t, locale });
  const nuxy = nuxyFormula(abdInv, ec, { t, locale });

  return (
    <Panel title={t("summary.title")}>
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
        <StatTile label={t("summary.areaWeight")} category="arealMass" value={summary.areaWeight} />
      </div>
      <HowWasThisComputed title={ex.title} formula={ex.tex} substituted={ex.substituted}>
        <p className="hint">{t("summary.ex.hint")}</p>
      </HowWasThisComputed>
      <HowWasThisComputed title={nuxy.title} formula={nuxy.tex} substituted={nuxy.substituted} />
    </Panel>
  );
});
