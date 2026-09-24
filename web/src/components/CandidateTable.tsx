import { useState } from "react";
import { useAtomValue } from "jotai";
import { ArrowDown, ArrowUp, Wand2 } from "lucide-react";
import type { Candidate } from "../lib/generated/Candidate";
import { shortStackNotation } from "../lib/angleStack";
import { failureMetricAtom } from "../store/settingsAtoms";
import { isFailing, METRIC_LABEL_KEYS, toMetric } from "../lib/failureMetric";
import type { TableModel } from "../lib/export/table";
import { QuantityDisplay } from "./QuantityDisplay";
import { CompactRuleBadges } from "./StackingRuleBadges";
import { TableActions } from "./TableActions";
import { useT, type MessageKey } from "../i18n";

// The optimisation's best stacks side by side (F4.4): how thick, how heavy,
// how much margin, which design rules each keeps - and any of them can
// become a laminate. The search's own answer is rank 1; the others are what
// it had in hand when it stopped, so asking for them cost nothing extra.

type SortKey = "rank" | "plies" | "rf";

export function CandidateTable({
  candidates,
  density,
  onAdopt,
}: {
  candidates: Candidate[];
  /** Of the ply material, for the mass per area. */
  density: number;
  onAdopt: (candidate: Candidate) => void;
}) {
  const t = useT();
  const metric = useAtomValue(failureMetricAtom);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "rank", descending: false });

  const ranked = candidates.map((c, i) => ({ c, rank: i + 1 }));
  const value = (row: (typeof ranked)[number]) =>
    sort.key === "rank" ? row.rank : sort.key === "plies" ? row.c.layer_count : row.c.min_reserve_factor;
  const rows = [...ranked].sort((a, b) => (sort.descending ? value(b) - value(a) : value(a) - value(b)) || a.rank - b.rank);

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"} className="numeric">
        <button
          type="button"
          className="sort-button"
          onClick={() => setSort({ key, descending: active ? !sort.descending : key === "rf" })}
        >
          {label}
          {active && (sort.descending ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  const metricName = t(METRIC_LABEL_KEYS[metric]);
  const notation = (c: Candidate) => shortStackNotation(c.angles, c.symmetric, false);
  const table = (): TableModel => ({
    title: t("optimization.candidates"),
    columns: [
      { key: "rank", label: "#", decimals: 0 },
      { key: "stack", label: t("optimization.candidates.stack") },
      { key: "plies", label: t("optimization.layers"), decimals: 0 },
      { key: "thickness", label: t("optimization.thickness"), category: "thickness" },
      { key: "mass", label: t("optimization.candidates.mass"), category: "arealMass" },
      { key: "rf", label: metricName, category: "reserveFactor" },
    ],
    rows: rows.map(({ c, rank }) => [rank, notation(c), c.layer_count, c.thickness, c.thickness * density, toMetric(c.min_reserve_factor, metric)]),
  });

  return (
    <div className="candidate-table">
      <div className="study-result-head">
        <h3>{t("optimization.candidates")}</h3>
        <TableActions table={table} name="kandidaten" />
      </div>
      <div className="responsive-table-scroll">
        <table className="layer-results-table">
          <thead>
            <tr>
              {header("rank", "#")}
              <th scope="col">{t("optimization.candidates.stack")}</th>
              {header("plies", t("optimization.layers"))}
              <th scope="col" className="numeric">
                {t("optimization.thickness")}
              </th>
              <th scope="col" className="numeric">
                {t("optimization.candidates.mass")}
              </th>
              {header("rf", metricName)}
              <th scope="col">{t("optimization.candidates.rules")}</th>
              <th scope="col">
                <span className="visually-hidden">{t("optimization.adopt")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, rank }) => {
              const shown = toMetric(c.min_reserve_factor, metric);
              return (
                <tr key={c.angles.join("/") + (c.symmetric ? "s" : "")} className={rank === 1 ? "candidate-best" : undefined}>
                  <td className="numeric">{rank}</td>
                  <td>
                    <code>{notation(c)}</code>
                  </td>
                  <td className="numeric">{c.layer_count}</td>
                  <td className="numeric">
                    <QuantityDisplay category="thickness" value={c.thickness} />
                  </td>
                  <td className="numeric">
                    <QuantityDisplay category="arealMass" value={c.thickness * density} />
                  </td>
                  <td className={`numeric${isFailing(shown, metric) ? " failing" : ""}`}>
                    <QuantityDisplay category="reserveFactor" value={shown} />
                  </td>
                  <td>
                    <CompactRuleBadges angles={c.angles} symmetric={c.symmetric} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      title={t("optimization.adopt")}
                      aria-label={`${t("optimization.adopt")}: ${notation(c)}`}
                      onClick={() => onAdopt(c)}
                    >
                      <Wand2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{t(CANDIDATE_HINT)}</p>
    </div>
  );
}

const CANDIDATE_HINT: MessageKey = "optimization.candidates.hint";
