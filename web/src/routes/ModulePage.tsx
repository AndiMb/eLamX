import { useParams } from "react-router-dom";
import { MODULE_REGISTRY, type ModuleType } from "../lib/moduleRegistry";
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

  return (
    <>
      {/* Above every module, not inside each one: the laminate is what all of
          them are about, and it must not disappear when one is opened. */}
      <ModuleContextBar laminateId={laminateId} />
      <ModuleBody laminateId={laminateId} moduleId={moduleId as ModuleType} />
    </>
  );
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
