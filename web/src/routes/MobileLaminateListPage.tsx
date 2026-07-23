import { useAtomValue, useSetAtom } from "jotai";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { addLaminateAtom, laminateConfigFamily, laminateIdsAtom } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";

function LaminateRow({ id }: { id: string }) {
  const config = useAtomValue(laminateConfigFamily(id));
  return (
    <Link className="mobile-row" to={`/laminates/${id}`}>
      <Layers size={18} strokeWidth={1.75} />
      {config.name}
      <ChevronRight size={16} className="chevron" />
    </Link>
  );
}

// The mobile "Laminate" tab's landing screen - stands in for the desktop
// sidebar tree's laminate section, since that tree isn't shown on mobile.
export function MobileLaminateListPage() {
  const laminateIds = useAtomValue(laminateIdsAtom);
  const materials = useAtomValue(materialsAtom);
  const addLaminate = useSetAtom(addLaminateAtom);
  const navigate = useNavigate();

  const handleAdd = () => {
    const id = addLaminate(materials[0]?.id ?? "");
    navigate(`/laminates/${id}`);
  };

  return (
    <section className="panel">
      <h2>
        <Layers size={16} strokeWidth={1.75} />
        Laminate
      </h2>
      <ul className="mobile-list">
        {laminateIds.map((id) => (
          <li key={id}>
            <LaminateRow id={id} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleAdd}>
        <Plus size={16} /> Laminat
      </button>
    </section>
  );
}
