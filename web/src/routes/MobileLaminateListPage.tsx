import { useAtomValue, useSetAtom } from "jotai";
import { Link, useNavigate } from "react-router-dom";
import { ChartSpline, ChevronRight, FolderKanban, Grid3x3, Layers, Plus } from "lucide-react";
import { addLaminateAtom, laminateConfigFamily, laminateIdsAtom } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { useT } from "../i18n";
import { modulePath, modulesOfScope } from "../lib/moduleRegistry";
import { addStudyAtom, studiesAtom } from "../store/studyAtoms";
import { historyStep } from "../lib/history";

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
  const t = useT();
  const laminateIds = useAtomValue(laminateIdsAtom);
  const materials = useAtomValue(materialsAtom);
  const addLaminate = useSetAtom(addLaminateAtom);
  const navigate = useNavigate();

  const handleAdd = () => {
    const id = addLaminate(materials[0]?.id ?? "");
    navigate(`/laminates/${id}`);
  };

  return (
    <>
    <section className="panel">
      <h2>
        <Layers size={16} strokeWidth={1.75} />
        {t("nav.laminates")}
      </h2>
      <ul className="mobile-list">
        {laminateIds.map((id) => (
          <li key={id}>
            <LaminateRow id={id} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleAdd}>
        <Plus size={16} /> {t("laminate.add")}
      </button>
    </section>
    <MobileProjectSection />
    </>
  );
}

/** The project's own entries - the comparison, the optimisation and the
 *  studies - which the desktop keeps in the sidebar tree. */
function MobileProjectSection() {
  const t = useT();
  const studies = useAtomValue(studiesAtom);
  const laminateIds = useAtomValue(laminateIdsAtom);
  const addStudy = useSetAtom(addStudyAtom);
  const navigate = useNavigate();
  const add = (kind: "matrix" | "sweep") => {
    const id = historyStep(t("history.label.studies"), () => addStudy({ kind, laminateId: laminateIds[0] ?? "" }));
    navigate(`/studies/${id}`);
  };
  return (
    <section className="panel">
      <h2>
        <FolderKanban size={16} strokeWidth={1.75} />
        {t("nav.project")}
      </h2>
      <ul className="mobile-list">
        {modulesOfScope("project").map((mod) => {
          const Icon = mod.icon;
          return (
            <li key={mod.id}>
              <Link className="mobile-row" to={modulePath(mod)}>
                <Icon size={18} strokeWidth={1.75} />
                {t(mod.labelKey)}
                <ChevronRight size={16} className="chevron" />
              </Link>
            </li>
          );
        })}
        {studies.map((study) => (
          <li key={study.id}>
            <Link className="mobile-row" to={`/studies/${study.id}`}>
              {study.kind === "sweep" ? <ChartSpline size={18} strokeWidth={1.75} /> : <Grid3x3 size={18} strokeWidth={1.75} />}
              {study.name}
              <ChevronRight size={16} className="chevron" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" onClick={() => add("matrix")}>
          <Plus size={16} /> {t("study.newMatrix")}
        </button>
        <button type="button" onClick={() => add("sweep")}>
          <Plus size={16} /> {t("study.newSweep")}
        </button>
      </div>
    </section>
  );
}
