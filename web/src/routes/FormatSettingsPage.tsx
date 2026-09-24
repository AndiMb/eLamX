import { useAtom } from "jotai";
import { delimitedDefaults } from "../lib/export/table";
import { tableExportSettingsAtom, type TableExportSettings } from "../store/settingsAtoms";
import { Ruler } from "lucide-react";
import { CATEGORY_DEFINITIONS, unitLabel, type QuantityCategory } from "../lib/units";
import { formatConfigFamily } from "../store/formatAtoms";
import { useLocale, useT } from "../i18n";

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

  // Units beside the table export: the units table is 780 px of a
  // 1270 px card, and the export settings were three selects below its end.
  return (
    <div className="dash">
    <section className="panel span-8">
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
    <TableExportSettingsPanel />
    </div>
  );
}

/** How copied and saved tables are written (F3.1, O5). */
function TableExportSettingsPanel() {
  const t = useT();
  const locale = useLocale();
  const [settings, setSettings] = useAtom(tableExportSettingsAtom);
  const defaults = delimitedDefaults(locale);
  const set = <K extends keyof TableExportSettings>(key: K, value: TableExportSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const auto = (value: string) => t("format.export.auto", { value });

  return (
    <section className="panel span-4">
      <h2>{t("format.export.title")}</h2>
      <p className="hint">{t("format.export.hint")}</p>
      <div className="format-export-settings">
        <label>
          <span>{t("format.export.precision")}</span>
          <select value={settings.precision} onChange={(e) => set("precision", e.target.value as TableExportSettings["precision"])}>
            <option value="full">{t("format.export.precision.full")}</option>
            <option value="display">{t("format.export.precision.display")}</option>
          </select>
        </label>
        <label>
          <span>{t("format.export.separator")}</span>
          <select value={settings.separator} onChange={(e) => set("separator", e.target.value as TableExportSettings["separator"])}>
            <option value="auto">{auto(defaults.sep)}</option>
            <option value=";">;</option>
            <option value=",">,</option>
            <option value="tab">{t("format.export.tab")}</option>
          </select>
        </label>
        <label>
          <span>{t("format.export.decimal")}</span>
          <select value={settings.decimal} onChange={(e) => set("decimal", e.target.value as TableExportSettings["decimal"])}>
            <option value="auto">{auto(defaults.decimal)}</option>
            <option value=",">,</option>
            <option value=".">.</option>
          </select>
        </label>
      </div>
    </section>
  );
}
