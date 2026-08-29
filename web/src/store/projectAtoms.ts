// Opening and saving a whole project.
//
// The individual atoms already persist themselves to browser storage, which is
// what keeps a session alive across a reload. This module is about the other
// half: moving a project in and out as an `.elamx` file, so work can leave the
// browser and be opened in eLamX on the desktop.
import { atom } from "jotai";
import type { BucklingInputDto, LastPlyFailureInputDto } from "../lib/types";
import type { ProjectSnapshot } from "../lib/projectFile";
import { bucklingInputFamily, bucklingStorageKey } from "./bucklingAtoms";
import { lastPlyFailureInputFamily, lastPlyFailureStorageKey } from "./lastPlyFailureAtoms";
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

/** Everything needed to write the current session out as `.elamx`. */
export const projectSnapshotAtom = atom<ProjectSnapshot>((get) => {
  const ids = get(laminateIdsAtom);
  const laminates: LaminateConfig[] = ids.map((id) => get(laminateConfigFamily(id)));
  const bucklings: Record<string, BucklingInputDto> = {};
  const lastPlyFailures: Record<string, LastPlyFailureInputDto> = {};
  for (const id of ids) {
    bucklings[id] = get(bucklingInputFamily(id));
    lastPlyFailures[id] = get(lastPlyFailureInputFamily(id));
  }
  return {
    materials: get(materialsAtom),
    laminates,
    bucklings,
    lastPlyFailures,
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
    forgetStoredLaminate(id);
    forgetStored(bucklingStorageKey(id));
    forgetStored(lastPlyFailureStorageKey(id));
  }

  set(materialsAtom, project.materials);
  set(projectVersionAtom, project.version);

  for (const config of project.laminates) {
    set(laminateConfigFamily(config.id), config);
    const buckling = project.bucklings[config.id];
    if (buckling) set(bucklingInputFamily(config.id), buckling);
    const lastPlyFailure = project.lastPlyFailures[config.id];
    if (lastPlyFailure) set(lastPlyFailureInputFamily(config.id), lastPlyFailure);
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
