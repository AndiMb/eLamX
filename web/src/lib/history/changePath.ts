// What an edit changed, worked out afterwards from two snapshots.
//
// Every editor in the app writes its atom directly, and none of them has to
// announce what it did: the history compares the project before and after
// and names the difference. The name has two uses. As a PATH it decides
// whether two quick edits are one step - the keystrokes that turn "4" into
// "45" in one angle field are, an angle and then a thickness are not. As a
// LABEL it is what the undo button's tooltip says it would take back.

import equal from "fast-deep-equal";
import type { ProjectSnapshotV2 } from "../../store/projectAtoms";
import type { LaminateConfig } from "../../store/laminateAtoms";
import { t } from "../../i18n";

export interface Change {
  path: string;
  label: string;
}

type Keyed = { id: string };

/** The one entry of a list whose content changed, if exactly one did and the
 *  list still has the same entries in the same order. */
function singleChanged<T extends Keyed>(before: T[], after: T[]): { before: T; after: T; index: number } | null {
  if (before.length !== after.length) return null;
  let found: { before: T; after: T; index: number } | null = null;
  for (let i = 0; i < after.length; i++) {
    if (before[i].id !== after[i].id) return null;
    if (before[i] === after[i] || equal(before[i], after[i])) continue;
    if (found) return null;
    found = { before: before[i], after: after[i], index: i };
  }
  return found;
}

/** The one field of two objects that differs, if exactly one does. */
function singleField(before: object, after: object): string | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let field: string | null = null;
  for (const key of keys) {
    if (equal((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key])) continue;
    if (field !== null) return null;
    field = key;
  }
  return field;
}

function laminateChange(before: LaminateConfig, after: LaminateConfig): Change {
  const name = after.name || before.name;
  const base = `lam:${after.id}`;
  const field = singleField(before, after);
  if (field === "layers") {
    const layer = singleChanged(before.layers, after.layers);
    if (layer) {
      const layerField = singleField(layer.before, layer.after);
      return {
        path: `${base}:layer:${layer.after.id}:${layerField ?? "*"}`,
        label: t("history.label.layer", { name, nr: layer.index + 1 }),
      };
    }
    return { path: `${base}:layers`, label: t("history.label.layers", { name }) };
  }
  if (field === "loadCases") {
    const loadCase = singleChanged(before.loadCases, after.loadCases);
    return {
      path: loadCase ? `${base}:loadCase:${loadCase.after.id}` : `${base}:loadCases`,
      label: t("history.label.loadCases", { name }),
    };
  }
  if (field === "name") return { path: `${base}:name`, label: t("history.label.rename", { name }) };
  return { path: `${base}:${field ?? "*"}`, label: t("history.label.laminate", { name }) };
}

/**
 * The change from `before` to `after`, for a pair that is known to differ.
 * Falls back to the coarsest honest description when several things changed
 * at once - an edit that did that was one action, and gets one step.
 */
export function describeChange(before: ProjectSnapshotV2, after: ProjectSnapshotV2): Change {
  const keys = (Object.keys(after) as (keyof ProjectSnapshotV2)[]).filter(
    (key) => before[key] !== after[key] && !equal(before[key], after[key]),
  );
  if (keys.length !== 1) return { path: "project", label: t("history.label.project") };
  const key = keys[0];

  switch (key) {
    case "laminates": {
      const laminate = singleChanged(before.laminates, after.laminates);
      if (laminate) return laminateChange(laminate.before, laminate.after);
      return { path: "laminates", label: t("history.label.laminates") };
    }
    case "modules": {
      const ids = Object.keys(after.modules).filter(
        (id) => !equal(before.modules[id], after.modules[id]),
      );
      if (ids.length === 1) {
        const id = ids[0];
        const module = singleField(before.modules[id] ?? {}, after.modules[id]);
        const name = after.laminates.find((l) => l.id === id)?.name ?? "";
        return { path: `module:${id}:${module ?? "*"}`, label: t("history.label.analysis", { name }) };
      }
      return { path: "modules", label: t("history.label.project") };
    }
    case "materials": {
      const material = singleChanged(before.materials, after.materials);
      if (material) {
        const field = singleField(material.before, material.after);
        return {
          path: `material:${material.after.id}:${field ?? "*"}`,
          label: t("history.label.material", { name: material.after.name }),
        };
      }
      return { path: "materials", label: t("history.label.materials") };
    }
    case "fibres":
    case "matrices":
      return { path: key, label: t("history.label.constituents") };
    case "optimization":
      return { path: "optimization", label: t("history.label.optimization") };
    case "comparison":
      return { path: "comparison", label: t("history.label.comparison") };
    case "snapshots":
      return { path: "snapshots", label: t("history.label.snapshots") };
    case "stackingRuleSettings":
      return { path: "stackingRuleSettings", label: t("history.label.ruleSettings") };
    case "studies": {
      // Coalesced per study, so typing a range is one step.
      const study = singleChanged(before.studies ?? [], after.studies ?? []);
      return study
        ? { path: `study:${study.after.id}`, label: t("history.label.study", { name: study.after.name }) }
        : { path: "studies", label: t("history.label.studies") };
    }
    default:
      return { path: key, label: t("history.label.project") };
  }
}
