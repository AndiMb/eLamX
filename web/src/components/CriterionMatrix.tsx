import { memo } from "react";
import { useAtomValue } from "jotai";
import { CircleDot } from "lucide-react";
import { layerResultsFamily } from "../store/derivedAtoms";
import { failureMetricAtom } from "../store/settingsAtoms";
import { criterionName, type LayerResultDto } from "../lib/types";
import { isFailing, METRIC_LABEL_KEYS, toMetric } from "../lib/failureMetric";
import { formatFixed } from "../lib/numberFormat";
import { QuantityDisplay } from "./QuantityDisplay";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { useLocale, useT } from "../i18n";
import { criterionMatrixTable } from "../lib/tables";
import { TableActions } from "./TableActions";

// Every criterion's own reserve factor per ply (F2.3): the plies as rows, all
// criteria any ply is checked against as columns, the one that governs the
// ply marked. It answers "why this criterion" - which the ply table, showing
// only the minimum, cannot.
//
// Straight from the core's `by_criterion` (N4): each cell is that criterion's
// smaller surface value, the same minimum the core takes per criterion. Shown
// only when some ply has more than one criterion; with one each, the matrix
// would be the ply table again.

/** A ply's value for one criterion: its smaller surface. */
function criterionRf(layer: LayerResultDto, id: string): number | null {
  const entry = layer.by_criterion.find((b) => b.id === id);
  if (!entry) return null;
  return Math.min(entry.rr_lower.minimal_reserve_factor, entry.rr_upper.minimal_reserve_factor);
}

/** The criterion governing the ply as a whole: the one behind its smaller
 *  surface, lower on a tie - as `governingSurface` decides it. */
function governingOf(layer: LayerResultDto): string {
  return layer.rr_upper.minimal_reserve_factor < layer.rr_lower.minimal_reserve_factor
    ? layer.governing_upper
    : layer.governing_lower;
}

export const CriterionMatrix = memo(function CriterionMatrix({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const metric = useAtomValue(failureMetricAtom);
  if (!layerResults || !layerResults.some((l) => l.by_criterion.length > 0)) return null;

  // Columns in the order the criteria first appear, primary ones first.
  const ids: string[] = [];
  for (const layer of layerResults) {
    const own = layer.by_criterion.length > 0 ? layer.by_criterion.map((b) => b.id) : [governingOf(layer)];
    for (const id of own) if (!ids.includes(id)) ids.push(id);
  }

  // The worked example for "how": the ply with the most criteria.
  const example = layerResults.reduce((a, b) => (b.by_criterion.length > a.by_criterion.length ? b : a));
  const values = example.by_criterion.map((b) => {
    const value = Math.min(b.rr_lower.minimal_reserve_factor, b.rr_upper.minimal_reserve_factor);
    return Number.isFinite(value) ? formatFixed(value, 3, locale) : "\\infty";
  });
  const governing = Math.min(example.rr_lower.minimal_reserve_factor, example.rr_upper.minimal_reserve_factor);

  return (
    <details className="criterion-matrix">
      <summary>{t("criterionMatrix.title")}</summary>
      <div className="table-toolbar">
        <TableActions table={() => criterionMatrixTable(layerResults, { metric, t })} name="kriterienmatrix" />
      </div>
      <div className="responsive-table-scroll">
        <table className="layer-results-table criterion-matrix-table">
          <caption className="visually-hidden">
            {t("criterionMatrix.caption", { metric: t(METRIC_LABEL_KEYS[metric]) })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("layers.column.nr")}</th>
              {ids.map((id) => (
                <th key={id} scope="col" className="numeric">
                  {criterionName(id, t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layerResults.map((layer) => {
              const governs = governingOf(layer);
              return (
                <tr key={layer.layer_number}>
                  <th scope="row">{layer.layer_number}</th>
                  {ids.map((id) => {
                    // A ply with one criterion has no by_criterion list; its
                    // own RF is that criterion's.
                    const rf =
                      layer.by_criterion.length > 0
                        ? criterionRf(layer, id)
                        : id === governs
                          ? Math.min(layer.rr_lower.minimal_reserve_factor, layer.rr_upper.minimal_reserve_factor)
                          : null;
                    if (rf === null) {
                      return (
                        <td key={id} className="numeric muted" aria-label={t("criterionMatrix.notChecked")}>
                          –
                        </td>
                      );
                    }
                    const shown = toMetric(rf, metric);
                    const isGoverning = id === governs;
                    const classes = ["numeric", isGoverning ? "governing" : null, isFailing(shown, metric) ? "failing" : null]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={id} className={classes}>
                        {isGoverning && (
                          <CircleDot size={11} className="governing-mark" aria-label={t("criterionMatrix.governing")} />
                        )}
                        <QuantityDisplay category="reserveFactor" value={shown} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        <CircleDot size={11} aria-hidden="true" /> {t("criterionMatrix.hint")}
      </p>
      <HowWasThisComputed
        title={t("criterionMatrix.howTitle")}
        formula={`RF_{\\text{${t("criterionMatrix.word.layer")}}} = \\min_{k\\,\\in\\,\\text{${t("criterionMatrix.word.criteria")}}} \\min\\left(RF_k^{\\text{${t("criterionMatrix.word.bottom")}}},\\; RF_k^{\\text{${t("criterionMatrix.word.top")}}}\\right)`}
        substituted={`RF_{${example.layer_number}} = \\min\\left(${values.join(",\\; ")}\\right) = ${
          Number.isFinite(governing) ? formatFixed(governing, 3, locale) : "\\infty"
        }`}
      >
        <p className="hint">{t("criterionMatrix.howHint")}</p>
      </HowWasThisComputed>
    </details>
  );
});
