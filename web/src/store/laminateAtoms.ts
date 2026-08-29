// Per-laminate state, keyed by laminate id via an atomFamily - this is what
// makes multi-laminate support real (Phase 2) rather than the Phase 1
// prototype's single implicit laminate: editing laminate A's layers only
// ever touches laminateConfigFamily(A), so laminate B's derived CLT atoms
// (see derivedAtoms.ts) never recompute.
//
// Deliberately kept as ONE atom per laminate (not further split per field):
// the property that matters here is *cross*-laminate isolation. Field-level
// granularity *within* a single laminate's own editor was already
// demonstrated in Phase 1 and isn't the goal of this phase.
//
// Every atom here is persisted. Each laminate gets its own storage key rather
// than one blob for the whole project, so saving stays proportional to what
// actually changed - editing one laminate does not rewrite the others.
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { DEFAULT_LAMINATE_ID, defaultLayers, type LayerRow } from "../lib/constants";
import { DEFAULT_MATERIAL_ID } from "./materialsAtoms";
import { t } from "../i18n";

/** Load cases and module data an imported `.elamx` carried but this app does
 *  not model yet: further calculations beyond the first, further buckling
 *  analyses, and modules with no web counterpart at all (last-ply-failure,
 *  cutouts, pressure vessel, spring-in, stiffeners).
 *
 *  Kept verbatim so that opening a desktop project here and saving it again
 *  does not quietly delete the rest of the user's work. Nothing reads these
 *  except the exporter - see lib/projectFile.ts. */
export interface CarryOver {
  /** Name of the calculation this laminate's single load case came from. */
  calculationName?: string;
  /** Name of the buckling analysis its buckling input came from. */
  bucklingName?: string;
  extraCalculations?: unknown[];
  extraBucklings?: unknown[];
  unsupportedModules?: unknown[];
}

export interface LaminateConfig {
  id: string;
  name: string;
  layers: LayerRow[];
  symmetric: boolean;
  withMiddleLayer: boolean;
  invertZ: boolean;
  /** Reference-plane offset (z0 = tges/2 + offset), as in the file format. */
  offset: number;
  // Per-degree-of-freedom prescribed value (order matches DOF_NAMES/LOAD_FIELDS/STRAIN_FIELDS).
  dofValues: number[];
  // Per-degree-of-freedom flag: true prescribes the strain, false the load.
  useStrain: boolean[];
  deltaT: number;
  deltaH: number;
  carryOver?: CarryOver;
}

export function defaultLaminateConfig(id: string, name: string, materialId: string): LaminateConfig {
  return {
    id,
    name,
    layers: materialId ? defaultLayers(materialId) : [],
    symmetric: false,
    withMiddleLayer: false,
    invertZ: false,
    offset: 0,
    dofValues: [1000, 0, 0, 0, 0, 0],
    useStrain: [false, false, false, false, false, false],
    deltaT: 0,
    deltaH: 0,
  };
}

const storage = createJSONStorage<LaminateConfig>(() => localStorage);

export const laminateStorageKey = (id: string) => `elamx.laminate.${id}`;

export const laminateIdsAtom = atomWithStorage<string[]>("elamx.laminateIds", [DEFAULT_LAMINATE_ID]);

export const laminateConfigFamily = atomFamily((id: string) =>
  atomWithStorage<LaminateConfig>(
    laminateStorageKey(id),
    id === DEFAULT_LAMINATE_ID
      ? defaultLaminateConfig(id, t("default.laminateName", { nr: 1 }), DEFAULT_MATERIAL_ID)
      : defaultLaminateConfig(id, t("default.newLaminate"), ""),
    storage,
    // Without this the very first render returns the default and only swaps in
    // the stored value a tick later, which makes every panel flash the default
    // laminate on reload.
    { getOnInit: true },
  ),
);

/** Whether a laminate id is one this project actually has. A URL pointing at
 *  anything else has to be reported, not silently answered with a blank
 *  laminate that is in no list. */
export const laminateExistsFamily = atomFamily((id: string) =>
  atom((get) => get(laminateIdsAtom).includes(id)),
);

export const addLaminateAtom = atom(null, (get, set, materialId: string) => {
  const id = crypto.randomUUID();
  const name = t("default.laminateName", { nr: get(laminateIdsAtom).length + 1 });
  set(laminateConfigFamily(id), defaultLaminateConfig(id, name, materialId));
  set(laminateIdsAtom, (ids) => [...ids, id]);
  return id;
});

export const removeLaminateAtom = atom(null, (_get, set, id: string) => {
  set(laminateIdsAtom, (ids) => ids.filter((existing) => existing !== id));
  laminateConfigFamily.remove(id);
  // atomFamily.remove only drops the in-memory atom; the stored value would
  // otherwise outlive the laminate and reappear if the same id came back.
  forgetStoredLaminate(id);
});

/** Removes a laminate's persisted state. Exported because loading a project
 *  file has to clear the laminates it replaces, not just forget them. */
export function forgetStoredLaminate(id: string) {
  try {
    localStorage.removeItem(laminateStorageKey(id));
  } catch {
    // Private mode or blocked site data: nothing to clean up, and failing to
    // clean up must not stop the deletion the user asked for.
  }
}

// "Laminat kopieren" like the Java original: deep copy with a "Kopie"/"copy"
// name suffix; layers get fresh ids so later per-layer edits can't alias.
export const duplicateLaminateAtom = atom(null, (get, set, sourceId: string) => {
  const source = get(laminateConfigFamily(sourceId));
  const id = crypto.randomUUID();
  set(laminateConfigFamily(id), {
    ...source,
    id,
    name: t("default.copy", { name: source.name }),
    layers: source.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
    dofValues: [...source.dofValues],
    useStrain: [...source.useStrain],
  });
  set(laminateIdsAtom, (ids) => {
    const at = ids.indexOf(sourceId);
    return [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)];
  });
  return id;
});

// Which materials are referenced by any laminate's layers - drives the
// delete guard ("Material wird verwendet", like the Java original's warning).
export const usedMaterialIdsAtom = atom<Set<string>>((get) => {
  const used = new Set<string>();
  for (const laminateId of get(laminateIdsAtom)) {
    for (const layer of get(laminateConfigFamily(laminateId)).layers) {
      used.add(layer.materialId);
    }
  }
  return used;
});
