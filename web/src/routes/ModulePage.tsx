import { useParams } from "react-router-dom";
import { MODULE_REGISTRY, type ModuleType } from "../lib/moduleRegistry";
import { CltModuleContent } from "../components/CltModuleContent";
import { useT } from "../i18n";

// Dispatches on :moduleId via MODULE_REGISTRY. Only "clt" exists today; new
// module types get a new branch here (or, once there are several, a
// Record<ModuleType, Component> lookup) alongside a new MODULE_REGISTRY entry.
export function ModulePage() {
  const t = useT();
  const { laminateId, moduleId } = useParams<{ laminateId: string; moduleId: string }>();

  if (!laminateId || !moduleId || !(moduleId in MODULE_REGISTRY)) {
    return <p className="hint">{t("modules.unknown")}</p>;
  }

  switch (moduleId as ModuleType) {
    case "clt":
      return <CltModuleContent laminateId={laminateId} />;
    default:
      return <p className="hint">{t("modules.unknown")}</p>;
  }
}
