import { memo } from "react";
import { useAtomValue } from "jotai";
import { abdMatrixFamily } from "../store/derivedAtoms";
import { useRenderCount } from "../lib/useRenderCount";
import { ResponsiveTable } from "./ResponsiveTable";
import { isFiniteResult, NO_VALUE } from "../lib/numberFormat";
import { useT } from "../i18n";

// Matches the heatmap's AXIS_LABELS convention (A/D block indices 1,2,6).
const AXIS_LABELS = ["1", "2", "6", "1", "2", "6"];

// Block tinting like the Java original's Berechnung view (a beloved teaching
// element): A red, B green, D blue - background tint only, values stay in
// the normal text color. Tint values live in App.css (.block-a/-b/-d).
const blockClass = (i: number, j: number) => {
  const rowBlock = i < 3 ? "a" : "d";
  const colBlock = j < 3 ? "a" : "d";
  if (rowBlock === "a" && colBlock === "a") return "block-a";
  if (rowBlock === "d" && colBlock === "d") return "block-d";
  return "block-b";
};

// memo() matters here, not just as a perf nicety: without it, every re-render
// of the parent (ResultsSection, which subscribes to the loadable atom to
// track loading/error state) would re-invoke this component regardless of
// whether abdMatrixFamily(laminateId)'s own value actually changed, hiding the
// selectAtom deep-equal optimization behind React's default "always re-render
// children" behavior.
export const AbdMatrixPanel = memo(function AbdMatrixPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const abd = useAtomValue(abdMatrixFamily(laminateId));
  const renderCount = useRenderCount();

  if (!abd) return null;

  return (
    <>
      <h3>
        {t("abd.title")} <span className="render-count">{t("common.renders", { count: renderCount })}</span>
      </h3>
      <ResponsiveTable variant="matrix">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              {AXIS_LABELS.map((label, j) => (
                <th key={`col-${j}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {abd.map((row, i) => (
              <tr key={`row-${i}`}>
                <th scope="row">{AXIS_LABELS[i]}</th>
                {row.map((value, j) => (
                  <td key={`cell-${i}-${j}`} className={blockClass(i, j)}>
                    {isFiniteResult(value) ? value.toExponential(3) : NO_VALUE}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
      <div className="abd-block-legend">
        <span>
          <span className="swatch" style={{ background: "rgba(227,73,72,0.35)" }} />
          {t("abd.legend.a")}
        </span>
        <span>
          <span className="swatch" style={{ background: "rgba(27,175,122,0.35)" }} />
          {t("abd.legend.b")}
        </span>
        <span>
          <span className="swatch" style={{ background: "rgba(42,120,214,0.35)" }} />
          {t("abd.legend.d")}
        </span>
      </div>
    </>
  );
});
