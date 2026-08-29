import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { layerContributionsFamily, layerResultsFamily } from "../store/derivedAtoms";
import { failureBodyKey, loadableFailureBodyFamily } from "../store/failureBodyAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { CRITERIA } from "../lib/types";
import { formatScientific } from "../lib/numberFormat";
import { FailureBody3D, type StressMarker } from "./charts/FailureBody3D";
import { QuantityDisplay } from "./QuantityDisplay";
import { failureModeLabel, useLocale, useT } from "../i18n";

// What the Java original showed when you opened a ply's failure view: the
// criterion's failure body, and the ply's own stress state sitting inside or
// outside it. The table above says "RF = 0.83"; this says which way the ply
// left the body, and how far.
export function LayerDetailPanel({
  laminateId,
  index,
  onClose,
}: {
  laminateId: string;
  /** Position in the EXPANDED stack, i.e. the index in layer_results. */
  index: number;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const results = useAtomValue(layerResultsFamily(laminateId));
  const contributions = useAtomValue(layerContributionsFamily(laminateId));
  const materials = useAtomValue(materialsAtom);

  const result = results?.[index];
  const ply = contributions?.[index];
  const criterionId = ply?.criterion_id ?? null;

  // Hooks may not be conditional, so the body is requested with a key that is
  // only ever used when both halves are present.
  const key = failureBodyKey(ply?.material_id ?? "", criterionId ?? "");
  const body = useAtomValue(loadableFailureBodyFamily(key));

  if (!result || !ply || !criterionId) return null;

  const material = materials.find((m) => m.id === ply.material_id);
  const criterionLabel = CRITERIA.find((c) => c.id === criterionId)?.labelKey;

  const markers: StressMarker[] = [
    {
      stress: result.sss_upper.stress,
      reserveFactor: result.rr_upper.minimal_reserve_factor,
      label: t("common.top"),
    },
    {
      stress: result.sss_lower.stress,
      reserveFactor: result.rr_lower.minimal_reserve_factor,
      label: t("common.bottom"),
    },
  ];

  return (
    <section className="panel layer-detail">
      <h3>
        {t("layerDetail.title", { nr: result.layer_number })}
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          title={t("layerDetail.close")}
          aria-label={t("layerDetail.close")}
        >
          <X size={16} />
        </button>
      </h3>

      <p className="hint">
        {t("layerDetail.subtitle", {
          material: material?.name ?? ply.material_id,
          criterion: criterionLabel ? t(criterionLabel) : criterionId,
          angle: ply.angle_deg,
        })}
      </p>

      <div className="grid">
        <div>
          {body.state === "hasError" && (
            <p className="error">{t("layerDetail.error", { message: String(body.error) })}</p>
          )}
          {body.state === "loading" && <p className="hint">{t("results.computing")}</p>}
          {body.state === "hasData" && (
            <FailureBody3D points={body.data.points} markers={markers} />
          )}
          <p className="hint">{t("layerDetail.hint")}</p>
        </div>

        <div>
          <table className="chart-table">
            <thead>
              <tr>
                <th />
                <th>σ∥</th>
                <th>σ⊥</th>
                <th>τ</th>
                <th>{t("layerDetail.rf")}</th>
                <th>{t("layerResults.modeUpper")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["common.top", result.sss_upper, result.rr_upper],
                  ["common.bottom", result.sss_lower, result.rr_lower],
                ] as const
              ).map(([labelKey, state, rf]) => (
                <tr key={labelKey} className={rf.minimal_reserve_factor < 1 ? "failed" : undefined}>
                  <th scope="row">{t(labelKey)}</th>
                  {state.stress.map((value, i) => (
                    <td key={i}>{formatScientific(value, 3, locale)}</td>
                  ))}
                  <td>
                    <QuantityDisplay category="reserveFactor" value={rf.minimal_reserve_factor} />
                  </td>
                  <td>{failureModeLabel(locale, rf.failure_name) || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
