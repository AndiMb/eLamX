import { useAtom } from "jotai";
import { Ruler } from "lucide-react";
import { CATEGORY_DEFINITIONS, type QuantityCategory } from "../lib/units";
import { formatConfigFamily } from "../store/formatAtoms";

const DECIMALS_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

function CategoryRow({ category }: { category: QuantityCategory }) {
  const def = CATEGORY_DEFINITIONS[category];
  const [format, setFormat] = useAtom(formatConfigFamily(category));

  return (
    <tr>
      <td>{def.label}</td>
      <td>
        {def.units ? (
          <select value={format.unitId ?? ""} onChange={(e) => setFormat((f) => ({ ...f, unitId: e.target.value }))}>
            {def.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="hint">dimensionslos</span>
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
          <option value="fixed">Festkomma</option>
          <option value="scientific">Wissenschaftlich</option>
        </select>
      </td>
    </tr>
  );
}

export function FormatSettingsPage() {
  const categories = Object.keys(CATEGORY_DEFINITIONS) as QuantityCategory[];

  return (
    <section className="panel">
      <h2>
        <Ruler size={16} strokeWidth={1.75} />
        Zahlenformate &amp; Einheiten
      </h2>
      <p className="hint">
        Änderungen wirken sofort auf alle Anzeigen und Eingabefelder - kein Speichern nötig. Interne Berechnungen
        verwenden immer das kanonische Einheitensystem (MPa, mm, °) unabhängig von dieser Auswahl.
      </p>
      <table className="format-settings-table">
        <thead>
          <tr>
            <th>Größe</th>
            <th>Einheit</th>
            <th>Nachkommastellen</th>
            <th>Notation</th>
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
