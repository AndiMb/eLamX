import { useAtomValue } from "jotai";
import { abdMatrixFamily, layerContributionsFamily } from "../store/derivedAtoms";
import { laminateConfigFamily } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { aMatrixFormula, localQFormula, qBarFormula, howProps } from "../lib/formulas";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { useLocale, useT } from "../i18n";

// A worked example for the FIRST layer only (rather than every layer, which
// would be overwhelming) - explains local Q -> global Q-bar -> A11. Kept as
// its own component (not nested inside AbdMatrixPanel) so it can read the
// laminate's layers/materials directly without widening AbdMatrixPanel's own
// render-isolation guarantees (see AbdMatrixPanel.tsx / the Phase 1-2 render
// count verification) - this is exposition content, opened on demand, not a
// live numeric result that needs the same re-render discipline.
export function AbdExplanation({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const abd = useAtomValue(abdMatrixFamily(laminateId));
  const contributions = useAtomValue(layerContributionsFamily(laminateId));
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const materials = useAtomValue(materialsAtom);

  if (!abd || !contributions || contributions.length === 0) return null;

  const firstLayer = contributions[0];
  const firstLayerConfig = config.layers[0];
  const material = materials.find((m) => m.id === firstLayerConfig?.materialId);
  if (!material) return null;

  const ctx = { t, locale };
  const localQ = localQFormula(material, ctx);
  const qBar = qBarFormula(firstLayer, material, ctx);
  const aMatrix = aMatrixFormula(contributions, abd, ctx);

  return (
    <>
      <HowWasThisComputed
        {...howProps(localQ)}
      >
        <p className="hint">{t("abdExplanation.localQ.hint", { material: material.name })}</p>
      </HowWasThisComputed>
      <HowWasThisComputed
        {...howProps(qBar)}
      >
        <p className="hint">{t("abdExplanation.qBar.hint")}</p>
      </HowWasThisComputed>
      <HowWasThisComputed
        {...howProps(aMatrix)}
      >
        <p className="hint">{t("abdExplanation.aMatrix.hint")}</p>
      </HowWasThisComputed>
    </>
  );
}
