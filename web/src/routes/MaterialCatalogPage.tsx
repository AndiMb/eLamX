import { useMemo, useState } from "react";
import { useAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { Check, Diamond } from "lucide-react";
import { materialsAtom } from "../store/materialsAtoms";
import { defaultMaterial } from "../lib/constants";
import { MATERIAL_CATALOG, type CatalogKind, type CatalogMaterial } from "../lib/materialCatalog";
import type { MaterialDto } from "../lib/types";
import { ResponsiveTable } from "../components/ResponsiveTable";
import { BackLink } from "../components/BackLink";
import { Sym } from "../components/Sym";
import { formatSignificant } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// eLamX's bundled material catalogue, as a page to pick from.
//
// The original puts it behind Materials > Import as a modal with a NetBeans
// outline view: 33 rows, six descriptive columns, a property sheet beside it
// and multi-select. A modal is the wrong shape here - the list is wide, it is
// worth reading rather than dismissing, and on a phone a modal table is
// unusable - so it is a route, and the columns that identify a ply are simply
// in the table.
//
// The numbers themselves come from `lib/materialCatalog.ts`, which is
// generated from the Java. Nothing is computed on this page.

const KIND_ORDER: CatalogKind[] = ["ud", "fabric", "ncf", "unknown"];

export function MaterialCatalogPage() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CatalogKind | "all">("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MATERIAL_CATALOG.map((material, index) => ({ material, index })).filter(
      ({ material }) => {
        if (kind !== "all" && material.kind !== kind) return false;
        if (!needle) return true;
        // Searching the whole descriptive line rather than the name alone:
        // "PEEK" is in the matrix type, "AS4" in the fibre name, and the user
        // does not know which field their word lives in.
        return `${material.name} ${material.fibreType} ${material.fibreName} ${material.matrixType} ${material.matrixName}`
          .toLowerCase()
          .includes(needle);
      },
    );
  }, [query, kind]);

  const kinds = useMemo(() => {
    const present = new Set(MATERIAL_CATALOG.map((m) => m.kind));
    return KIND_ORDER.filter((k) => present.has(k));
  }, []);

  const toggle = (index: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  const adopt = () => {
    const chosen = [...picked].sort((a, b) => a - b).map((i) => MATERIAL_CATALOG[i]);
    if (chosen.length === 0) return;
    // The catalogue's names are not unique - three entries are called
    // `C-'T300' | EP-'-'`. eLamX imports them under that name regardless and
    // leaves the user with three identical rows in its tree; here a name that
    // would collide gains the one figure that actually separates them, the
    // fibre volume fraction. Only on a collision, so a single pick still comes
    // out under exactly the original's name.
    const taken = new Set(materials.map((m) => m.name));
    const created = chosen.map((entry) => {
      const material = toMaterial(entry);
      material.name = unusedName(material.name, taken, (n) =>
        t("catalog.nameWithPhi", { name: n, phi: formatSignificant(entry.phi, 3, locale) }),
      );
      taken.add(material.name);
      return material;
    });
    setMaterials((ms) => [...ms, ...created]);
    // One material: straight to its page, which is where the user was heading.
    // Several: back to the list, because there is no single page to land on.
    navigate(created.length === 1 ? `/materials/${created[0].id}` : "/materials");
  };

  return (
    <>
      <BackLink to="/materials" label={t("nav.materials")} />
      <p className="hint">{t("catalog.intro")}</p>

      <section className="panel">
        <h2>
          <Diamond size={16} strokeWidth={1.75} />
          {t("catalog.title")}
        </h2>

        <div className="field-grid">
          <label className="wide">
            <span className="field-label">{t("catalog.search")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("catalog.search.placeholder")}
            />
          </label>
          <label>
            <span className="field-label">{t("catalog.kind")}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as CatalogKind | "all")}>
              <option value="all">{t("catalog.kind.all")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`catalog.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <p className="empty-note">{t("catalog.empty")}</p>
        ) : (
          <ResponsiveTable
            variant="records"
            className="catalog-table"
            columns={[
              {
                key: "pick",
                label: t("catalog.column.pick"),
                render: ({ index }) => (
                  <input
                    type="checkbox"
                    checked={picked.has(index)}
                    onChange={() => toggle(index)}
                    aria-label={t("catalog.pick.aria", { name: MATERIAL_CATALOG[index].name })}
                  />
                ),
              },
              {
                key: "name",
                label: t("catalog.column.name"),
                render: ({ material }) => material.name,
              },
              {
                key: "kind",
                label: t("catalog.column.kind"),
                render: ({ material }) => t(`catalog.kind.${material.kind}`),
              },
              {
                key: "phi",
                label: t("catalog.column.phi"),
                numeric: true,
                render: ({ material }) =>
                  material.phi > 0 ? `${formatSignificant(material.phi, 3, locale)} %` : "–",
              },
              {
                key: "e_par",
                label: t("catalog.column.ePar"),
                numeric: true,
                render: ({ material }) =>
                  formatSignificant(material.properties.e_par, 4, locale),
              },
              {
                key: "e_nor",
                label: t("catalog.column.eNor"),
                numeric: true,
                render: ({ material }) =>
                  formatSignificant(material.properties.e_nor, 4, locale),
              },
              {
                key: "r_par_ten",
                label: t("catalog.column.rParTen"),
                numeric: true,
                render: ({ material }) =>
                  formatSignificant(material.properties.r_par_ten, 4, locale),
              },
              {
                key: "rho",
                label: t("catalog.column.rho"),
                numeric: true,
                render: ({ material }) =>
                  formatSignificant(material.properties.rho * 1e12, 3, locale),
              },
            ]}
            rows={rows}
            rowKey={({ index }) => index}
            rowClassName={({ index }) => (picked.has(index) ? "selected" : undefined)}
            cardSummary={({ material }) => (
              <>
                {material.name} — <Sym base="E" sub="∥" />{" "}
                {formatSignificant(material.properties.e_par, 4, locale)} MPa
              </>
            )}
          />
        )}

        <p className="hint">{t("catalog.hint")}</p>

        <div className="button-row">
          <button type="button" onClick={adopt} disabled={picked.size === 0}>
            <Check size={16} /> {t("catalog.adopt", { count: picked.size })}
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * A name nothing in the project uses yet.
 *
 * The fibre volume fraction is tried first because it is what usually tells
 * two same-named entries apart. Usually, not always: of the three
 * `C-'T300' | EP-'-'` entries two are both at 60%, differing only in their
 * stiffness, so a counter has to finish the job. Putting the stiffness in the
 * name instead would make it unreadable for a difference the user is about to
 * see on the material's own page anyway.
 */
function unusedName(base: string, taken: Set<string>, withPhi: (name: string) => string): string {
  if (!taken.has(base)) return base;
  const qualified = withPhi(base);
  if (!taken.has(qualified)) return qualified;
  for (let n = 2; ; n++) {
    const numbered = `${qualified} (${n})`;
    if (!taken.has(numbered)) return numbered;
  }
}

/**
 * A catalogue entry as a material of this project.
 *
 * Built on `defaultMaterial()` rather than from nothing, so the criterion
 * parameters (Puck's inclinations, Tsai-Wu's F12*, the max-strain limits) come
 * out at their defaults instead of zero - the catalogue has none, and the
 * original's `ExtendedDefaultMaterial` inherits them the same way.
 *
 * The two transverse shear moduli go the other way and come out ZERO, which
 * is not an oversight: the catalogue lists none, `DefaultMaterial` starts them
 * at 0.0, and the original's import leaves them there. Carrying the app's own
 * default across instead would be inventing a measurement.
 */
function toMaterial(entry: CatalogMaterial): MaterialDto {
  return {
    ...defaultMaterial(),
    id: crypto.randomUUID(),
    name: entry.name,
    ...entry.properties,
    g13: 0,
    g23: 0,
  };
}
