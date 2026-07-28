// A plain object, not a plugin loader: this is a single bundled app with a
// small, known set of calculation modules (unlike Java eLamX's
// Lookup/NetBeans-module plugin mechanism, which existed to let separately
// deployed .nbm files register new module types at runtime - not a
// constraint this app has). New module types (e.g. buckling "Beulen" ->
// Waves, pressure vessel "Drucktank" -> Cylinder, Spring-In -> TriangleRight,
// optimization -> Target, once the Rust core supports them) are added here as
// a new entry - the sidebar tree, the module list on the laminate page and
// the mobile navigation all render from this registry, so a new module needs
// no UI changes beyond its own page (see UI-Konzept §7).
import type { LucideIcon } from "lucide-react";
import { Calculator } from "lucide-react";
import type { MessageKey } from "../i18n";

export type ModuleType = "clt";

export interface ModuleDefinition {
  id: ModuleType;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** One-line beginner-facing description, shown in the module list. */
  descriptionKey: MessageKey;
}

export const MODULE_REGISTRY: Record<ModuleType, ModuleDefinition> = {
  clt: {
    id: "clt",
    labelKey: "module.clt.label",
    icon: Calculator,
    descriptionKey: "module.clt.description",
  },
};

export const MODULE_LIST: ModuleDefinition[] = Object.values(MODULE_REGISTRY);
