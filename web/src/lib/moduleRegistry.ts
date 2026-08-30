// A plain object, not a plugin loader: this is a single bundled app with a
// small, known set of calculation modules (unlike Java eLamX's
// Lookup/NetBeans-module plugin mechanism, which existed to let separately
// deployed .nbm files register new module types at runtime - not a
// constraint this app has). New module types (e.g. Spring-In ->
// TriangleRight, optimization -> Target, once the Rust core supports them)
// are added here as a new entry -
// the sidebar tree, the module list on the laminate page and the mobile
// navigation all render from this registry, so a new module needs no UI
// changes beyond its own page (see UI-Konzept §7).
import type { LucideIcon } from "lucide-react";
import { Calculator, Columns3, Cylinder, Diamond, Layers2, Spline, Waves } from "lucide-react";
import type { MessageKey } from "../i18n";

export type ModuleType =
  | "clt"
  | "buckling"
  | "deformation"
  | "lastPlyFailure"
  | "pressureVessel"
  | "failureBody"
  | "compare";

/**
 * What a module is ABOUT. The original has modules at four levels and this
 * registry knew only one, which is why a material could have no modules at all
 * and the comparison surface had to be a route of its own.
 *
 * - `laminate`: the classic case, a calculation on one stack.
 * - `material`: about the material itself, whatever laminates use it.
 * - `project`: about several laminates at once.
 */
export type ModuleScope = "laminate" | "material" | "project";

export interface ModuleDefinition {
  id: ModuleType;
  scope: ModuleScope;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** One-line beginner-facing description, shown in the module list. */
  descriptionKey: MessageKey;
}

export const MODULE_REGISTRY: Record<ModuleType, ModuleDefinition> = {
  clt: {
    id: "clt",
    scope: "laminate",
    labelKey: "module.clt.label",
    icon: Calculator,
    descriptionKey: "module.clt.description",
  },
  buckling: {
    id: "buckling",
    scope: "laminate",
    labelKey: "module.buckling.label",
    icon: Waves,
    descriptionKey: "module.buckling.description",
  },
  deformation: {
    id: "deformation",
    scope: "laminate",
    labelKey: "module.deformation.label",
    icon: Spline,
    descriptionKey: "module.deformation.description",
  },
  lastPlyFailure: {
    id: "lastPlyFailure",
    scope: "laminate",
    labelKey: "module.lastPlyFailure.label",
    icon: Layers2,
    descriptionKey: "module.lastPlyFailure.description",
  },
  pressureVessel: {
    id: "pressureVessel",
    scope: "laminate",
    labelKey: "module.pressureVessel.label",
    icon: Cylinder,
    descriptionKey: "module.pressureVessel.description",
  },
  failureBody: {
    id: "failureBody",
    scope: "material",
    labelKey: "module.failureBody.label",
    icon: Diamond,
    descriptionKey: "module.failureBody.description",
  },
  compare: {
    id: "compare",
    scope: "project",
    labelKey: "module.compare.label",
    icon: Columns3,
    descriptionKey: "module.compare.description",
  },
};

export const MODULE_LIST: ModuleDefinition[] = Object.values(MODULE_REGISTRY);

/** The modules of one scope, in registry order. */
export function modulesOfScope(scope: ModuleScope): ModuleDefinition[] {
  return MODULE_LIST.filter((mod) => mod.scope === scope);
}

/**
 * Where a module lives. The owner id is the laminate or material the module is
 * about; a project module has none.
 */
export function modulePath(mod: ModuleDefinition, ownerId?: string): string {
  switch (mod.scope) {
    case "laminate":
      return `/laminates/${ownerId}/modules/${mod.id}`;
    case "material":
      return `/materials/${ownerId}/modules/${mod.id}`;
    case "project":
      return `/modules/${mod.id}`;
  }
}
