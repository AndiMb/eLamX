// Opening and saving a whole project.
//
// The individual atoms already persist themselves to browser storage, which is
// what keeps a session alive across a reload. This module is about the other
// half: moving a project in and out as an `.elamx` file, so work can leave the
// browser and be opened in eLamX on the desktop.
import { atom, type Getter, type Setter, type WritableAtom } from "jotai";
import { RESET } from "jotai/utils";
import equal from "fast-deep-equal";
import type {
  BucklingInputDto,
  DeformationInputDto,
  VibrationInputDto,
  LastPlyFailureInputDto,
  PressureVesselInputDto,
  SpringInInputDto,
  CutoutInputDto,
} from "../lib/types";
import type { OptimizationInputDto, OptimizerKindId } from "../lib/types";
import type { ProjectSnapshot } from "../lib/projectFile";
import type { Variant } from "./comparisonAtoms";
import {
  EMPTY_WEB_EXTENSION_CARRY,
  type ImportNotice,
  type WebExtensionCarry,
} from "../lib/webExtension";
import { comparisonVariantsAtom } from "./comparisonAtoms";
import { bucklingInputFamily, bucklingStorageKey } from "./bucklingAtoms";
import { fibresAtom, matricesAtom } from "./micromechanicsAtoms";
import { cutoutInputFamily, cutoutStorageKey } from "./cutoutAtoms";
import {
  OPTIMIZATION_STORAGE_KEY,
  optimizationInputAtom,
  optimizationMetaAtom,
  optimizerAtom,
  resolvedOptimizationInputAtom,
} from "./optimizationAtoms";
import { springInInputFamily, springInStorageKey } from "./springInAtoms";
import { vibrationInputFamily, vibrationStorageKey } from "./vibrationAtoms";
import { lastPlyFailureInputFamily, lastPlyFailureStorageKey } from "./lastPlyFailureAtoms";
import { pressureVesselInputFamily, pressureVesselStorageKey } from "./pressureVesselAtoms";
import { deformationInputFamily, deformationStorageKey } from "./deformationAtoms";
import {
  defaultLaminateConfig,
  forgetStoredLaminate,
  laminateConfigFamily,
  laminateIdsAtom,
  type LaminateConfig,
} from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import { DEFAULT_LAMINATE_ID, DEFAULT_MATERIAL_ID, defaultMaterial } from "../lib/constants";
import { t } from "../i18n";

/** Format generation of the file the session was loaded from, written back
 *  unchanged so opening and saving does not silently migrate a file. */
export const projectVersionAtom = atom<string>("1");

/** Name suggested when saving; taken from the opened file. */
export const projectNameAtom = atom<string>("eLamX");

/**
 * Where the open project came from, or null when it did not come from a file
 * with a path - which is every browser tab, since a page never learns one.
 *
 * Deliberately NOT persisted: a path is a fact about this machine and this
 * session, and restoring one after a reload would offer to overwrite a file
 * the reader may no longer have in mind.
 */
export const projectFilePathAtom = atom<string | null>(null);

/** Project-level sections of the opened file that no module here answers to,
 *  as raw XML. They are the user's data: without carrying them, opening a
 *  desktop project and saving it deleted whatever the desktop had put there.
 *  Session state, not persisted - a reload starts from an empty project
 *  anyway. */
export const projectSectionsAtom = atom<unknown[]>([]);

/** Optimisations past the first, which the module does not show. Carried for
 *  the same reason, and session state for the same reason. */
export const extraOptimizationsAtom = atom<unknown[]>([]);

/** The parts of the file's `<webExtension>` that no feature of this build
 *  edits yet. Carried for the same reason as the sections above, and session
 *  state for the same reason. */
export const webExtensionCarryAtom = atom<WebExtensionCarry>(EMPTY_WEB_EXTENSION_CARRY);

/** What could not be used when the open project was read, for the user to be
 *  told about. Replaced by every open; dismissing empties it. */
export const importNoticesAtom = atom<ImportNotice[]>([]);

/** Whether a laminate has a stored input for a module.
 *
 *  A module's input atom answers with its default whether or not the laminate
 *  ever had that analysis, so asking the atom would write a plate-buckling
 *  analysis into every laminate of a saved file - including the ones the user
 *  never opened the module for. Storage answers the real question: a value is
 *  written when the module is edited, and when a file that had one was opened.
 */
function hasStoredInput(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    // Blocked site data: nothing is stored, so nothing was configured.
    return false;
  }
}

/** Everything needed to write the current session out as `.elamx`. */
export const projectSnapshotAtom = atom<ProjectSnapshot>((get) => {
  const ids = get(laminateIdsAtom);
  const laminates: LaminateConfig[] = ids.map((id) => get(laminateConfigFamily(id)));
  const bucklings: Record<string, BucklingInputDto> = {};
  const lastPlyFailures: Record<string, LastPlyFailureInputDto> = {};
  const pressureVessels: Record<string, PressureVesselInputDto> = {};
  const deformations: Record<string, DeformationInputDto> = {};
  const vibrations: Record<string, VibrationInputDto> = {};
  const springIns: Record<string, SpringInInputDto> = {};
  const cutouts: Record<string, CutoutInputDto> = {};
  for (const id of ids) {
    if (hasStoredInput(bucklingStorageKey(id))) {
      bucklings[id] = get(bucklingInputFamily(id));
    }
    if (hasStoredInput(lastPlyFailureStorageKey(id))) {
      lastPlyFailures[id] = get(lastPlyFailureInputFamily(id));
    }
    if (hasStoredInput(pressureVesselStorageKey(id))) {
      pressureVessels[id] = get(pressureVesselInputFamily(id));
    }
    if (hasStoredInput(deformationStorageKey(id))) {
      deformations[id] = get(deformationInputFamily(id));
    }
    if (hasStoredInput(vibrationStorageKey(id))) {
      vibrations[id] = get(vibrationInputFamily(id));
    }
    if (hasStoredInput(springInStorageKey(id))) {
      springIns[id] = get(springInInputFamily(id));
    }
    if (hasStoredInput(cutoutStorageKey(id))) {
      cutouts[id] = get(cutoutInputFamily(id));
    }
  }
  const meta = get(optimizationMetaAtom);
  return {
    materials: get(materialsAtom),
    fibres: get(fibresAtom),
    matrices: get(matricesAtom),
    laminates,
    bucklings,
    lastPlyFailures,
    pressureVessels,
    deformations,
    vibrations,
    springIns,
    cutouts,
    optimization: hasStoredInput(OPTIMIZATION_STORAGE_KEY)
      ? {
          name: meta.name,
          optimizer: get(optimizerAtom),
          angle_type: meta.angleType,
          // The resolved input and not the stored one: the material a saved
          // search names can have been deleted since, and what belongs in the
          // file is what the module would search with now.
          input: get(resolvedOptimizationInputAtom),
        }
      : undefined,
    extraOptimizations: get(extraOptimizationsAtom),
    version: get(projectVersionAtom),
    unsupportedSections: get(projectSectionsAtom),
    comparison: get(comparisonVariantsAtom),
    webExtensionCarry: get(webExtensionCarryAtom),
  };
});

/** Counts the projects opened in this session - a file, or a new one. The
 *  undo history listens to it: what was done to the previous project cannot
 *  be undone into this one. */
export const projectGenerationAtom = atom(0);

/** Replaces the whole session with a project read from a file.
 *
 *  Replaces rather than merges: two projects can name different materials the
 *  same way and reuse ids, so merging would produce a laminate silently
 *  pointing at the wrong material. Opening a file is opening a document. */
export const loadProjectAtom = atom(null, (get, set, project: ProjectSnapshot) => {
  for (const id of get(laminateIdsAtom)) {
    laminateConfigFamily.remove(id);
    bucklingInputFamily.remove(id);
    lastPlyFailureInputFamily.remove(id);
    pressureVesselInputFamily.remove(id);
    deformationInputFamily.remove(id);
    vibrationInputFamily.remove(id);
    springInInputFamily.remove(id);
    cutoutInputFamily.remove(id);
    forgetStoredLaminate(id);
    forgetStored(bucklingStorageKey(id));
    forgetStored(lastPlyFailureStorageKey(id));
    forgetStored(pressureVesselStorageKey(id));
    forgetStored(deformationStorageKey(id));
    forgetStored(vibrationStorageKey(id));
    forgetStored(springInStorageKey(id));
    forgetStored(cutoutStorageKey(id));
  }

  set(materialsAtom, project.materials);
  set(fibresAtom, project.fibres);
  set(matricesAtom, project.matrices);
  set(projectVersionAtom, project.version);
  set(projectSectionsAtom, project.unsupportedSections);
  set(extraOptimizationsAtom, project.extraOptimizations);
  // The file's comparison, or none: the columns of the project that was open
  // before point at laminates this one does not have.
  set(comparisonVariantsAtom, project.comparison ?? []);
  set(webExtensionCarryAtom, project.webExtensionCarry ?? EMPTY_WEB_EXTENSION_CARRY);
  set(importNoticesAtom, project.importNotices ?? []);
  if (project.optimization) {
    set(optimizationInputAtom, project.optimization.input);
    set(optimizerAtom, project.optimization.optimizer);
    set(optimizationMetaAtom, {
      name: project.optimization.name,
      angleType: project.optimization.angle_type,
    });
  }

  for (const config of project.laminates) {
    set(laminateConfigFamily(config.id), config);
    const buckling = project.bucklings[config.id];
    if (buckling) set(bucklingInputFamily(config.id), buckling);
    const lastPlyFailure = project.lastPlyFailures[config.id];
    if (lastPlyFailure) set(lastPlyFailureInputFamily(config.id), lastPlyFailure);
    const pressureVessel = project.pressureVessels[config.id];
    if (pressureVessel) set(pressureVesselInputFamily(config.id), pressureVessel);
    const deformation = project.deformations[config.id];
    if (deformation) set(deformationInputFamily(config.id), deformation);
    const vibration = project.vibrations[config.id];
    if (vibration) set(vibrationInputFamily(config.id), vibration);
    const springIn = project.springIns[config.id];
    if (springIn) set(springInInputFamily(config.id), springIn);
    const cutout = project.cutouts[config.id];
    if (cutout) set(cutoutInputFamily(config.id), cutout);
  }
  set(
    laminateIdsAtom,
    project.laminates.map((l) => l.id),
  );
  set(projectGenerationAtom, (n) => n + 1);
});

/** A project as a first start has it: one material, one laminate, nothing
 *  else. */
export function emptyProject(): ProjectSnapshot {
  return {
    materials: [defaultMaterial()],
    fibres: [],
    matrices: [],
    laminates: [
      defaultLaminateConfig(
        DEFAULT_LAMINATE_ID,
        t("default.laminateName", { nr: 1 }),
        DEFAULT_MATERIAL_ID,
      ),
    ],
    bucklings: {},
    lastPlyFailures: {},
    pressureVessels: {},
    deformations: {},
    vibrations: {},
    springIns: {},
    cutouts: {},
    extraOptimizations: [],
    version: "1",
    unsupportedSections: [],
    comparison: [],
    webExtensionCarry: EMPTY_WEB_EXTENSION_CARRY,
  };
}

/** Starts over with an empty project - opening a document that has nothing
 *  in it yet, with everything that opening means for the session. */
export const newProjectAtom = atom(null, (_get, set) => {
  set(loadProjectAtom, emptyProject());
  // Opening a file keeps a search when the file has none; a new project has
  // none, full stop.
  set(optimizationInputAtom, RESET);
  set(optimizerAtom, RESET);
  set(optimizationMetaAtom, RESET);
  set(projectNameAtom, "eLamX");
  set(projectFilePathAtom, null);
});

function forgetStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Blocked site data: nothing stored, nothing to clean up.
  }
}

// ---------------------------------------------------------------------------
// The whole project as one value, and putting one back: what undo works with.
// ---------------------------------------------------------------------------

/** One laminate's analysis inputs, by module. `null` is "not configured": the
 *  laminate never had that analysis, which is a state of its own - the input
 *  atom would answer with its default either way (see `hasStoredInput`). */
export interface ModuleInputs {
  buckling: BucklingInputDto | null;
  lastPlyFailure: LastPlyFailureInputDto | null;
  pressureVessel: PressureVesselInputDto | null;
  deformation: DeformationInputDto | null;
  vibration: VibrationInputDto | null;
  springIn: SpringInInputDto | null;
  cutout: CutoutInputDto | null;
}

type ModuleKey = keyof ModuleInputs;

// A family's atom, typed loosely enough to share one table: every module's
// input atom is an atomWithStorage that takes a value or RESET.
type InputAtom = WritableAtom<unknown, [unknown], void>;

interface ModuleStore {
  family: (id: string) => InputAtom;
  remove: (id: string) => void;
  key: (id: string) => string;
}

function moduleStore<T>(
  family: ((id: string) => WritableAtom<T, never[], void>) & { remove: (id: string) => void },
  key: (id: string) => string,
): ModuleStore {
  return {
    family: family as unknown as (id: string) => InputAtom,
    remove: (id) => family.remove(id),
    key,
  };
}

const MODULES: Record<ModuleKey, ModuleStore> = {
  buckling: moduleStore(bucklingInputFamily, bucklingStorageKey),
  lastPlyFailure: moduleStore(lastPlyFailureInputFamily, lastPlyFailureStorageKey),
  pressureVessel: moduleStore(pressureVesselInputFamily, pressureVesselStorageKey),
  deformation: moduleStore(deformationInputFamily, deformationStorageKey),
  vibration: moduleStore(vibrationInputFamily, vibrationStorageKey),
  springIn: moduleStore(springInInputFamily, springInStorageKey),
  cutout: moduleStore(cutoutInputFamily, cutoutStorageKey),
};

const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/**
 * The project as the user edits it, in one value.
 *
 * Unlike `ProjectSnapshot`, which is shaped for writing a file, this is shaped
 * for putting back: every module input of every laminate with "not
 * configured" as its own value, the optimisation as stored rather than as
 * resolved, and the web-only parts of the project beside them. What it leaves
 * out on purpose is everything about the session rather than the project -
 * the file path, the project name, what is selected and shown.
 */
export interface ProjectSnapshotV2 {
  materials: ProjectSnapshot["materials"];
  fibres: ProjectSnapshot["fibres"];
  matrices: ProjectSnapshot["matrices"];
  laminates: LaminateConfig[];
  /** By laminate id. */
  modules: Record<string, ModuleInputs>;
  optimization: {
    /** `null` when no search was ever set up - see `hasStoredInput`. */
    input: OptimizationInputDto | null;
    optimizer: OptimizerKindId;
    meta: { name: string; angleType: number };
  };
  extraOptimizations: unknown[];
  unsupportedSections: unknown[];
  version: string;
  comparison: Variant[];
  /** Placeholders for layer criteria, studies, snapshots, report templates
   *  and rule settings until their features exist. */
  webExtensionCarry: WebExtensionCarry;
}

function readModules(get: Getter, id: string): ModuleInputs {
  const inputs: Partial<Record<ModuleKey, unknown>> = {};
  for (const module of MODULE_KEYS) {
    const { family, key } = MODULES[module];
    // Read even when nothing is stored, and only then ask storage. A derived
    // atom depends on what it read last time: skipping the read for an
    // unconfigured module would leave the snapshot deaf to the edit that
    // configures it, and undo would never see that step.
    const value = get(family(id));
    inputs[module] = hasStoredInput(key(id)) ? value : null;
  }
  return inputs as ModuleInputs;
}

export const projectSnapshotV2Atom = atom<ProjectSnapshotV2>((get) => {
  const ids = get(laminateIdsAtom);
  const modules: Record<string, ModuleInputs> = {};
  for (const id of ids) modules[id] = readModules(get, id);
  // Read unconditionally, for the same reason as a module's input.
  const searchInput = get(optimizationInputAtom);
  return {
    materials: get(materialsAtom),
    fibres: get(fibresAtom),
    matrices: get(matricesAtom),
    laminates: ids.map((id) => get(laminateConfigFamily(id))),
    modules,
    optimization: {
      input: hasStoredInput(OPTIMIZATION_STORAGE_KEY) ? searchInput : null,
      optimizer: get(optimizerAtom),
      meta: get(optimizationMetaAtom),
    },
    extraOptimizations: get(extraOptimizationsAtom),
    unsupportedSections: get(projectSectionsAtom),
    version: get(projectVersionAtom),
    comparison: get(comparisonVariantsAtom),
    webExtensionCarry: get(webExtensionCarryAtom),
  };
});

/** Sets an atom only if the value differs, by content. */
function setIfChanged<T>(get: Getter, set: Setter, target: WritableAtom<T, [T], void>, value: T) {
  if (!equal(get(target), value)) set(target, value);
}

/** Puts one module input back: a value, or "not configured". */
function restoreInput(get: Getter, set: Setter, module: ModuleKey, id: string, value: unknown) {
  const { family, key } = MODULES[module];
  const stored = hasStoredInput(key(id));
  if (value === null) {
    // RESET removes the storage key, which is what "not configured" is.
    if (stored) set(family(id), RESET);
  } else if (!stored || !equal(get(family(id)), value)) {
    set(family(id), value);
  }
}

/**
 * Puts a `ProjectSnapshotV2` back - the undo counterpart of `loadProjectAtom`.
 *
 * Two differences from opening a file. It sets only what differs, compared by
 * content: every atom set is a recomputation downstream, and an undo that
 * touched every laminate would re-run every open module, buckling included.
 * And it leaves the session alone - file path, project name, what is shown,
 * the import notices - because an undo changes the project, not where it
 * came from.
 */
export const restoreProjectAtom = atom(null, (get, set, snapshot: ProjectSnapshotV2) => {
  setIfChanged(get, set, materialsAtom, snapshot.materials);
  setIfChanged(get, set, fibresAtom, snapshot.fibres);
  setIfChanged(get, set, matricesAtom, snapshot.matrices);
  setIfChanged(get, set, projectVersionAtom, snapshot.version);
  setIfChanged(get, set, projectSectionsAtom, snapshot.unsupportedSections);
  setIfChanged(get, set, extraOptimizationsAtom, snapshot.extraOptimizations);
  setIfChanged(get, set, comparisonVariantsAtom, snapshot.comparison);
  setIfChanged(get, set, webExtensionCarryAtom, snapshot.webExtensionCarry);

  const optimization = snapshot.optimization;
  const searchStored = hasStoredInput(OPTIMIZATION_STORAGE_KEY);
  if (optimization.input === null) {
    if (searchStored) set(optimizationInputAtom, RESET);
  } else if (!searchStored || !equal(get(optimizationInputAtom), optimization.input)) {
    set(optimizationInputAtom, optimization.input);
  }
  setIfChanged(get, set, optimizerAtom, optimization.optimizer);
  setIfChanged(get, set, optimizationMetaAtom, optimization.meta);

  // Laminates the snapshot does not have go the way a deleted one goes.
  const keep = new Set(snapshot.laminates.map((l) => l.id));
  for (const id of get(laminateIdsAtom)) {
    if (keep.has(id)) continue;
    laminateConfigFamily.remove(id);
    forgetStoredLaminate(id);
    for (const module of MODULE_KEYS) {
      MODULES[module].remove(id);
      forgetStored(MODULES[module].key(id));
    }
  }

  // Before the id list, so a laminate brought back has its data by the time
  // anything lists it.
  for (const config of snapshot.laminates) {
    setIfChanged(get, set, laminateConfigFamily(config.id), config);
    const modules = snapshot.modules[config.id];
    for (const module of MODULE_KEYS) {
      restoreInput(get, set, module, config.id, modules?.[module] ?? null);
    }
  }
  setIfChanged(
    get,
    set,
    laminateIdsAtom,
    snapshot.laminates.map((l) => l.id),
  );
});
