import { useState } from "react";
import { useAtomValue } from "jotai";
import { materialsAtom } from "../store/materialsAtoms";
import { failureBodyKey, loadableFailureBodyFamily } from "../store/failureBodyAtoms";
import { CRITERIA, type CriterionId } from "../lib/types";
import { DEFAULT_CRITERION_ID } from "../lib/constants";
import { FailureBody3D } from "./charts/FailureBody3D";
import { BackLink } from "./BackLink";
import { useT } from "../i18n";

// The failure body of a MATERIAL, independent of any laminate - the Java
// original's "Versagenskörper 3D" on a material, and the first module in this
// app that is about a material rather than a stack.
//
// The same surface the ply detail draws, without a stress state in it: there
// is no ply here and therefore no load. What it is for is comparing criteria -
// switching between Puck and Tsai-Wu on the same material shows, in one
// picture, how differently they judge the same stress state.
export function FailureBodyModuleContent({ materialId }: { materialId: string }) {
  const t = useT();
  const materials = useAtomValue(materialsAtom);
  const [criterionId, setCriterionId] = useState<CriterionId>(DEFAULT_CRITERION_ID);
  const body = useAtomValue(loadableFailureBodyFamily(failureBodyKey(materialId, criterionId)));

  const material = materials.find((m) => m.id === materialId);
  if (!material) return <p className="hint">{t("material.unknown")}</p>;

  return (
    <>
      <BackLink to={`/materials/${materialId}`} label={t("nav.material")} />
      <p className="hint">{t("failureBody.intro")}</p>

      <section className="panel">
        <h2>{t("failureBody.title", { material: material.name })}</h2>

        <div className="field-grid">
          <label>
            <span className="field-label">{t("failureBody.criterion")}</span>
            <select
              value={criterionId}
              onChange={(e) => setCriterionId(e.target.value as CriterionId)}
            >
              {CRITERIA.map((criterion) => (
                <option key={criterion.id} value={criterion.id}>
                  {t(criterion.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {body.state === "hasError" && (
          <p className="error">{t("layerDetail.error", { message: String(body.error) })}</p>
        )}
        {body.state === "loading" && <p className="hint">{t("results.computing")}</p>}
        {body.state === "hasData" && <FailureBody3D points={body.data.points} markers={[]} />}

        <p className="hint">{t("failureBody.hint")}</p>
      </section>
    </>
  );
}
