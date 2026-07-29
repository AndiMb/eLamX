import { useParams } from "react-router-dom";
import { MODULE_REGISTRY, type ModuleType } from "../lib/moduleRegistry";
import { CltModuleContent } from "../components/CltModuleContent";
import { BucklingModuleContent } from "../components/BucklingModuleContent";
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

  switch (moduleId as ModuleType) {
    case "clt":
      return <CltModuleContent laminateId={laminateId} />;
    case "buckling":
      return <BucklingModuleContent laminateId={laminateId} />;
    default:
      return <p className="hint">{t("modules.unknown")}</p>;
  }
}
