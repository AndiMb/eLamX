// Opening and saving a whole project.
//
// The individual atoms already persist themselves to browser storage, which is
// what keeps a session alive across a reload. This module is about the other
// half: moving a project in and out as an `.elamx` file, so work can leave the
// browser and be opened in eLamX on the desktop.
import { atom } from "jotai";
import type {
  BucklingInputDto,
  DeformationInputDto,
  LastPlyFailureInputDto,
  PressureVesselInputDto,
} from "../lib/types";
import type { ProjectSnapshot } from "../lib/projectFile";
import { bucklingInputFamily, bucklingStorageKey } from "./bucklingAtoms";
import { lastPlyFailureInputFamily, lastPlyFailureStorageKey } from "./lastPlyFailureAtoms";
import { pressureVesselInputFamily, pressureVesselStorageKey } from "./pressureVesselAtoms";
import { deformationInputFamily, deformationStorageKey } from "./deformationAtoms";
import {
  forgetStoredLaminate,
  laminateConfigFamily,
  laminateIdsAtom,
  type LaminateConfig,
} from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";

/** Format generation of the file the session was loaded from, written back
 *  unchanged so opening and saving does not silently migrate a file. */
export const projectVersionAtom = atom<string>("1");

/** Name suggested when saving; taken from the opened file. */
export const projectNameAtom = atom<string>("eLamX");

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
  }
  return {
    materials: get(materialsAtom),
    laminates,
    bucklings,
    lastPlyFailures,
    pressureVessels,
    deformations,
    version: get(projectVersionAtom),
  };
});

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
    forgetStoredLaminate(id);
    forgetStored(bucklingStorageKey(id));
    forgetStored(lastPlyFailureStorageKey(id));
    forgetStored(pressureVesselStorageKey(id));
    forgetStored(deformationStorageKey(id));
  }

  set(materialsAtom, project.materials);
  set(projectVersionAtom, project.version);

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
  }
  set(
    laminateIdsAtom,
    project.laminates.map((l) => l.id),
  );
});

function forgetStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Blocked site data: nothing stored, nothing to clean up.
  }
}
