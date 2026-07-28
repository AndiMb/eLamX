import { useAtom } from "jotai";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Diamond, Plus } from "lucide-react";
import { materialsAtom } from "../store/materialsAtoms";
import { defaultMaterial } from "../lib/constants";
import { useT } from "../i18n";

// The mobile "Materialien" tab's landing screen - stands in for the desktop
// sidebar tree's materials section. Also reachable directly at /materials on
// desktop (unlinked there today, but harmless to leave routable).
export function MaterialListPage() {
  const t = useT();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const navigate = useNavigate();

  const handleAdd = () => {
    const newMaterial = { ...defaultMaterial(), name: t("default.materialName", { nr: materials.length + 1 }) };
    setMaterials((ms) => [...ms, newMaterial]);
    navigate(`/materials/${newMaterial.id}`);
  };

  return (
    <section className="panel">
      <h2>
        <Diamond size={16} strokeWidth={1.75} />
        {t("nav.materials")}
      </h2>
      <ul className="mobile-list">
        {materials.map((m) => (
          <li key={m.id}>
            <Link className="mobile-row" to={`/materials/${m.id}`}>
              <Diamond size={18} strokeWidth={1.75} />
              {m.name}
              <ChevronRight size={16} className="chevron" />
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleAdd}>
        <Plus size={16} /> {t("material.add")}
      </button>
    </section>
  );
}
