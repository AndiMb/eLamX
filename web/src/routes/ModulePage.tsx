import { useParams } from "react-router-dom";
import { MODULE_REGISTRY, type ModuleType } from "../lib/moduleRegistry";
import { FailureBodyModuleContent } from "../components/FailureBodyModuleContent";
import { ComparePage } from "./ComparePage";
import { CltModuleContent } from "../components/CltModuleContent";
import { BucklingModuleContent } from "../components/BucklingModuleContent";
import { LastPlyFailureModuleContent } from "../components/LastPlyFailureModuleContent";
import { ModuleContextBar } from "../components/ModuleContextBar";
import { PressureVesselModuleContent } from "../components/PressureVesselModuleContent";
import { DeformationModuleContent } from "../components/DeformationModuleContent";
import { useT } from "../i18n";

// Dispatches on :moduleId via MODULE_REGISTRY. A new module type gets a new
// branch here alongside its MODULE_REGISTRY entry; once this grows past a
// handful, a Record<ModuleType, Component> lookup beats the switch.
export function ModulePage() {
  const t = useT();
  const { laminateId, moduleId } = useParams<{ laminateId: string; moduleId: string }>();

  if (!laminateId || !moduleId || !(moduleId in MODULE_REGISTRY)) {
    return <p className="hint">{t("modules.unknown")}</p>;
  }
  // A module of another scope reached through a laminate URL is a wrong URL,
  // not a laminate without that module.
  if (MODULE_REGISTRY[moduleId as ModuleType].scope !== "laminate") {
    return <p className="hint">{t("modules.unknown")}</p>;
  }

  return (
    <>
      {/* Above every module, not inside each one: the laminate is what all of
          them are about, and it must not disappear when one is opened. */}
      <ModuleContextBar laminateId={laminateId} />
      <ModuleBody laminateId={laminateId} moduleId={moduleId as ModuleType} />
    </>
  );
}

/** The material-scope counterpart of ModulePage. */
export function MaterialModulePage() {
  const t = useT();
  const { materialId, moduleId } = useParams<{ materialId: string; moduleId: string }>();

  if (
    !materialId ||
    !moduleId ||
    !(moduleId in MODULE_REGISTRY) ||
    MODULE_REGISTRY[moduleId as ModuleType].scope !== "material"
  ) {
    return <p className="hint">{t("modules.unknown")}</p>;
  }

  switch (moduleId as ModuleType) {
    case "failureBody":
      return <FailureBodyModuleContent materialId={materialId} />;
    default:
      return <p className="hint">{t("modules.unknown")}</p>;
  }
}

/** The project-scope counterpart: no owner, just the module. */
export function ProjectModulePage() {
  const t = useT();
  const { moduleId } = useParams<{ moduleId: string }>();

  if (
    !moduleId ||
    !(moduleId in MODULE_REGISTRY) ||
    MODULE_REGISTRY[moduleId as ModuleType].scope !== "project"
  ) {
    return <p className="hint">{t("modules.unknown")}</p>;
  }

  switch (moduleId as ModuleType) {
    case "compare":
      return <ComparePage />;
    default:
      return <p className="hint">{t("modules.unknown")}</p>;
  }
}

function ModuleBody({ laminateId, moduleId }: { laminateId: string; moduleId: ModuleType }) {
  const t = useT();
  switch (moduleId) {
    case "clt":
      return <CltModuleContent laminateId={laminateId} />;
    case "buckling":
      return <BucklingModuleContent laminateId={laminateId} />;
    case "lastPlyFailure":
      return <LastPlyFailureModuleContent laminateId={laminateId} />;
    case "pressureVessel":
      return <PressureVesselModuleContent laminateId={laminateId} />;
    case "deformation":
      return <DeformationModuleContent laminateId={laminateId} />;
    default:
      return <p className="hint">{t("modules.unknown")}</p>;
  }
}
