import { useAtomValue } from "jotai";
import { Check, TriangleAlert } from "lucide-react";
import { layerResultsFamily, summaryFamily } from "../store/derivedAtoms";
import { QuantityDisplay } from "./QuantityDisplay";
import { Sym } from "./Sym";
import { failureModeLabel, useLocale, useT } from "../i18n";

// The answer, before the evidence: does it hold, by how much, and which ply
// decides. Everything below this panel explains it.
//
// It exists because of what the phone measurements showed - a CLT page is five
// screen heights there, and the one number someone actually came for was
// somewhere in the middle of them. On a wide screen it costs one row and
// still saves scanning the ply table for the smallest reserve factor.
export function VerdictPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const summary = useAtomValue(summaryFamily(laminateId));

  if (!layerResults || layerResults.length === 0) return null;

  // The governing ply: the smallest reserve factor over every ply and both of
  // its surfaces.
  let governing = layerResults[0];
  let minimal = Infinity;
  let failureName = "";
  for (const layer of layerResults) {
    for (const rf of [layer.rr_lower, layer.rr_upper]) {
      if (rf.minimal_reserve_factor < minimal) {
        minimal = rf.minimal_reserve_factor;
        governing = layer;
        failureName = rf.failure_name;
      }
    }
  }

  const holds = minimal >= 1;
  const failedCount = layerResults.filter((l) => l.failed).length;

  return (
    <section className={`panel verdict ${holds ? "holds" : "fails"}`}>
      <div className="verdict-headline">
        <span className={`chip ${holds ? "ok" : "danger"}`}>
          {holds ? <Check size={14} /> : <TriangleAlert size={14} />}
          {t(holds ? "verdict.holds" : "verdict.fails")}
        </span>
        <span className="verdict-detail">
          {t("verdict.governing", {
            nr: governing.layer_number,
            mode: failureModeLabel(locale, failureName) || "–",
          })}
        </span>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="label">{t("verdict.minRf")}</span>
          <span className="value">
            <QuantityDisplay category="reserveFactor" value={minimal} />
          </span>
        </div>
        <div className="stat-tile">
          <span className="label">{t("verdict.failedPlies")}</span>
          <span className="value">
            {failedCount} / {layerResults.length}
          </span>
        </div>
        {summary && (
          <>
            <div className="stat-tile">
              <span className="label">
                <Sym base="t" sub="ges" />
              </span>
              <span className="value">
                <QuantityDisplay category="thickness" value={summary.tges} />
              </span>
            </div>
            <div className="stat-tile">
              <span className="label">
                <Sym base="E" sub="x" />
              </span>
              <span className="value">
                <QuantityDisplay
                  category="stiffness"
                  value={summary.engineeringConstants.ex_simple}
                />
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
