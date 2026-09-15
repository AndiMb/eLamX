import { useAtom, useAtomValue } from "jotai";
import { carpetErrorFamily, carpetValueAtom, loadableCarpetPlotFamily } from "../store/carpetAtoms";
import type { CarpetValueId } from "../lib/types";
import { CarpetPlotChart } from "./charts/CarpetPlotChart";
import { BackLink } from "./BackLink";
import { useT } from "../i18n";

// What this material can be made into, before there is a laminate at all.
//
// Every other module here answers a question about a stack. This one answers
// the question that comes first: given this material, what stiffness is
// reachable, and at what price in the other directions? It is a material
// module for that reason - it has no thicknesses, no stacking order and no
// bending, only the shares of 0, +-45 and 90 degree plies.

const VALUES: { id: CarpetValueId; labelKey: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { id: "ex", labelKey: "carpet.value.ex" },
  { id: "nu_xy", labelKey: "carpet.value.nuXy" },
  { id: "g_xy", labelKey: "carpet.value.gXy" },
];

export function CarpetPlotModuleContent({ materialId }: { materialId: string }) {
  const t = useT();
  const [value, setValue] = useAtom(carpetValueAtom);
  const state = useAtomValue(loadableCarpetPlotFamily(materialId));
  const error = useAtomValue(carpetErrorFamily(materialId));
  const plot = state.state === "hasData" ? state.data : null;

  return (
    <>
      <BackLink to={`/materials/${materialId}`} label={t("nav.material")} />
      <p className="hint">{t("carpet.intro")}</p>

      <section className="panel">
        <h2>{t("carpet.title")}</h2>
        <label className="inline-field">
          <span className="field-label">{t("carpet.value")}</span>
          <select value={value} onChange={(e) => setValue(e.target.value as CarpetValueId)}>
            {VALUES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(entry.labelKey)}
              </option>
            ))}
          </select>
        </label>

        {error ? (
          <p className="error">{error}</p>
        ) : plot ? (
          <CarpetPlotChart plot={plot} />
        ) : (
          <p className="hint">{t("results.computing")}</p>
        )}
      </section>
    </>
  );
}
