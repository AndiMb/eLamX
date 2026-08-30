import { memo } from "react";
import { useAtomValue } from "jotai";
import { abdMatrixFamily } from "../store/derivedAtoms";
import { ResponsiveTable } from "./ResponsiveTable";
import { formatMatrixEntry, matrixScale } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

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
  const locale = useLocale();
  const abd = useAtomValue(abdMatrixFamily(laminateId));

  if (!abd) return null;

  // The B block of a symmetric laminate is zero by construction but comes back
  // as ~1e-13; scaled against the matrix's own largest entry, it prints as 0.
  const scale = matrixScale(abd);

  return (
    <>
      <h3>{t("abd.title")}</h3>
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
                    {formatMatrixEntry(value, scale, 3, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
      <div className="abd-block-legend">
        <span>
          <span className="swatch block-a" />
          {t("abd.legend.a")}
        </span>
        <span>
          <span className="swatch block-b" />
          {t("abd.legend.b")}
        </span>
        <span>
          <span className="swatch block-d" />
          {t("abd.legend.d")}
        </span>
      </div>
    </>
  );
});
