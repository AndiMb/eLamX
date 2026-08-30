// One number out of one module, for one laminate - the shape the comparison
// surface needs.
//
// This is an atom rather than a hook on purpose. A hook has to call the same
// hooks in the same order every render, so the comparison's cell component
// read all three module summaries whichever module its row was about, and read
// them even for a laminate that has no such analysis - the guard hid the
// value, not the computation. Opening a comparison whose first column carried
// a twenty-term buckling analysis therefore also solved a deformation and a
// last-ply-failure nobody asked for.
//
// Inside an atom a branch is just a branch: jotai records exactly the atoms a
// computation actually read, so an unconfigured figure never touches a
// summary atom at all, and a buckling row never touches the deformation one.
import { atom, type Atom } from "jotai";
import { atomFamily } from "jotai-family";
import { bucklingInputFamily, bucklingStorageKey, bucklingSummaryFamily } from "./bucklingAtoms";
import {
  deformationInputFamily,
  deformationStorageKey,
  deformationSummaryFamily,
} from "./deformationAtoms";
import {
  lastPlyFailureInputFamily,
  lastPlyFailureStorageKey,
  lastPlyFailureSummaryFamily,
} from "./lastPlyFailureAtoms";
import { comparisonVariantsAtom } from "./comparisonAtoms";

export type ModuleFigureId =
  | "bucklingFactor"
  | "maxDeflection"
  | "lpfFirstMatrix"
  | "lpfFinal";

type ModuleId = "buckling" | "deformation" | "lastPlyFailure";

export const MODULE_FIGURES: readonly { id: ModuleFigureId; module: ModuleId }[] = [
  { id: "bucklingFactor", module: "buckling" },
  { id: "maxDeflection", module: "deformation" },
  { id: "lpfFirstMatrix", module: "lastPlyFailure" },
  { id: "lpfFinal", module: "lastPlyFailure" },
];

const STORAGE_KEY: Record<ModuleId, (laminateId: string) => string> = {
  buckling: bucklingStorageKey,
  deformation: deformationStorageKey,
  lastPlyFailure: lastPlyFailureStorageKey,
};

// Typed as "some atom", because all this needs from it is the subscription -
// three different input shapes, one purpose.
const INPUT_FAMILY: Record<ModuleId, (laminateId: string) => Atom<unknown>> = {
  buckling: bucklingInputFamily,
  deformation: deformationInputFamily,
  lastPlyFailure: lastPlyFailureInputFamily,
};

/** `${module}|${laminateId}` - atomFamily keys on one string. */
type ConfiguredKey = string;

export const configuredKey = (module: ModuleId, laminateId: string): ConfiguredKey =>
  `${module}|${laminateId}`;

/**
 * Whether this laminate has that analysis set up at all.
 *
 * Storage rather than the input atom's value, for the reason projectAtoms
 * gives: an input atom answers with its default whether or not anyone ever
 * opened the module, so reading it would report a buckling factor for a
 * 500x500 plate nobody defined.
 *
 * It still READS the input atom, without using the value: that subscription is
 * what makes this reactive. Editing a module writes its key, so the moment the
 * input changes this recomputes and finds the key it did not find before. A
 * bare `localStorage.getItem` in a component's render - which is what this
 * replaces - never noticed.
 */
export const moduleConfiguredFamily = atomFamily((key: ConfiguredKey) =>
  atom((get) => {
    const [module, laminateId] = splitKey(key);
    get(INPUT_FAMILY[module](laminateId));
    try {
      return localStorage.getItem(STORAGE_KEY[module](laminateId)) !== null;
    } catch {
      // Blocked site data: nothing was stored, so nothing was configured.
      return false;
    }
  }),
);

/** `${figureId}|${laminateId}`. */
export const figureKey = (figure: ModuleFigureId, laminateId: string): string =>
  `${figure}|${laminateId}`;

/** The figure itself, or `null` when the module is not set up for this
 *  laminate. Reading it computes that module and no other. */
export const moduleFigureFamily = atomFamily((key: string) =>
  atom((get): number | null => {
    const at = key.indexOf("|");
    const figure = key.slice(0, at) as ModuleFigureId;
    const laminateId = key.slice(at + 1);
    const module = MODULE_FIGURES.find((f) => f.id === figure)?.module;
    if (!module) return null;
    if (!get(moduleConfiguredFamily(configuredKey(module, laminateId)))) return null;

    switch (figure) {
      case "bucklingFactor":
        return get(bucklingSummaryFamily(laminateId))?.criticalFactor ?? null;
      case "maxDeflection":
        return get(deformationSummaryFamily(laminateId))?.maxDeflection ?? null;
      case "lpfFirstMatrix":
        return (
          get(lastPlyFailureSummaryFamily(laminateId))?.firstMatrixFailure?.reserve_factor ??
          null
        );
      case "lpfFinal":
        return (
          get(lastPlyFailureSummaryFamily(laminateId))?.exceedanceFactor?.reserve_factor ?? null
        );
    }
  }),
);

/** Which figures any variant currently in the comparison has set up. A row of
 *  dashes says nothing and costs a line. */
export const visibleModuleFiguresAtom = atom((get) => {
  const variants = get(comparisonVariantsAtom);
  return MODULE_FIGURES.filter(({ module }) =>
    variants.some((v) => get(moduleConfiguredFamily(configuredKey(module, v.laminateId)))),
  ).map((f) => f.id);
});

function splitKey(key: string): [ModuleId, string] {
  const at = key.indexOf("|");
  return [key.slice(0, at) as ModuleId, key.slice(at + 1)];
}
