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
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { defaultLayers, type LayerRow } from "../lib/constants";
import { DEFAULT_MATERIAL_ID } from "./materialsAtoms";

export interface LaminateConfig {
  id: string;
  name: string;
  layers: LayerRow[];
  symmetric: boolean;
  withMiddleLayer: boolean;
  invertZ: boolean;
  // Per-degree-of-freedom prescribed value (order matches DOF_NAMES/LOAD_FIELDS/STRAIN_FIELDS).
  dofValues: number[];
  // Per-degree-of-freedom flag: true prescribes the strain, false the load.
  useStrain: boolean[];
  deltaT: number;
  deltaH: number;
}

function defaultLaminateConfig(id: string, name: string, materialId: string): LaminateConfig {
  return {
    id,
    name,
    layers: materialId ? defaultLayers(materialId) : [],
    symmetric: false,
    withMiddleLayer: false,
    invertZ: false,
    dofValues: [1000, 0, 0, 0, 0, 0],
    useStrain: [false, false, false, false, false, false],
    deltaT: 0,
    deltaH: 0,
  };
}

const initialLaminateId = crypto.randomUUID();

export const laminateIdsAtom = atom<string[]>([initialLaminateId]);

export const laminateConfigFamily = atomFamily((id: string) =>
  atom<LaminateConfig>(
    id === initialLaminateId
      ? defaultLaminateConfig(id, "Laminat 1", DEFAULT_MATERIAL_ID)
      : defaultLaminateConfig(id, "Neues Laminat", ""),
  ),
);

export const addLaminateAtom = atom(null, (get, set, materialId: string) => {
  const id = crypto.randomUUID();
  const name = `Laminat ${get(laminateIdsAtom).length + 1}`;
  set(laminateConfigFamily(id), defaultLaminateConfig(id, name, materialId));
  set(laminateIdsAtom, (ids) => [...ids, id]);
  return id;
});

export const removeLaminateAtom = atom(null, (_get, set, id: string) => {
  set(laminateIdsAtom, (ids) => ids.filter((existing) => existing !== id));
  laminateConfigFamily.remove(id);
});

// "Laminat kopieren" like the Java original: deep copy with a "Kopie" name
// suffix; layers get fresh ids so later per-layer edits can't alias.
export const duplicateLaminateAtom = atom(null, (get, set, sourceId: string) => {
  const source = get(laminateConfigFamily(sourceId));
  const id = crypto.randomUUID();
  set(laminateConfigFamily(id), {
    ...source,
    id,
    name: `${source.name} Kopie`,
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
