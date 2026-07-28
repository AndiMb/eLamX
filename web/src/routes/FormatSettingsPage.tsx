import { useAtom } from "jotai";
import { Ruler } from "lucide-react";
import { CATEGORY_DEFINITIONS, unitLabel, type QuantityCategory } from "../lib/units";
import { formatConfigFamily } from "../store/formatAtoms";
import { useT } from "../i18n";

const DECIMALS_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

function CategoryRow({ category }: { category: QuantityCategory }) {
  const t = useT();
  const def = CATEGORY_DEFINITIONS[category];
  const [format, setFormat] = useAtom(formatConfigFamily(category));

  return (
    <tr>
      <td>{t(def.labelKey)}</td>
      <td>
        {def.units ? (
          <select value={format.unitId ?? ""} onChange={(e) => setFormat((f) => ({ ...f, unitId: e.target.value }))}>
            {def.units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitLabel(u, t)}
              </option>
            ))}
          </select>
        ) : (
          <span className="hint">{t("format.dimensionless")}</span>
        )}
      </td>
      <td>
        <select value={format.decimals} onChange={(e) => setFormat((f) => ({ ...f, decimals: Number(e.target.value) }))}>
          {DECIMALS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={format.notation}
          onChange={(e) => setFormat((f) => ({ ...f, notation: e.target.value as "fixed" | "scientific" }))}
        >
          <option value="fixed">{t("format.notation.fixed")}</option>
          <option value="scientific">{t("format.notation.scientific")}</option>
        </select>
      </td>
    </tr>
  );
}

export function FormatSettingsPage() {
  const t = useT();
  const categories = Object.keys(CATEGORY_DEFINITIONS) as QuantityCategory[];

  return (
    <section className="panel">
      <h2>
        <Ruler size={16} strokeWidth={1.75} />
        {t("nav.formatSettings")}
      </h2>
      <p className="hint">{t("format.hint")}</p>
      <table className="format-settings-table">
        <thead>
          <tr>
            <th>{t("format.column.quantity")}</th>
            <th>{t("format.column.unit")}</th>
            <th>{t("format.column.decimals")}</th>
            <th>{t("format.column.notation")}</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <CategoryRow key={c} category={c} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
