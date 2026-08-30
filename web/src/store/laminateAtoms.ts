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
import {
  DEFAULT_LAMINATE_ID,
  LOAD_FIELDS,
  STRAIN_FIELDS,
  defaultLayers,
  type LayerRow,
} from "../lib/constants";
import { DEFAULT_MATERIAL_ID } from "./materialsAtoms";
import { t } from "../i18n";

/** Module data an imported `.elamx` carried but this app does not model yet:
 *  further buckling / last-ply-failure analyses beyond the first, and modules
 *  with no web counterpart at all (cutouts, pressure vessel, spring-in,
 *  stiffeners).
 *
 *  Kept verbatim so that opening a desktop project here and saving it again
 *  does not quietly delete the rest of the user's work. Nothing reads these
 *  except the exporter - see lib/projectFile.ts. */
export interface CarryOver {
  /** Name of the buckling analysis its buckling input came from. */
  bucklingName?: string;
  /** Name of the last-ply-failure analysis its input came from. */
  lastPlyFailureName?: string;
  /** Name of the pressure-vessel analysis its input came from. */
  pressureVesselName?: string;
  /** Name of the deformation analysis its input came from. */
  deformationName?: string;
  extraBucklings?: unknown[];
  extraLastPlyFailures?: unknown[];
  extraPressureVessels?: unknown[];
  extraDeformations?: unknown[];
  unsupportedModules?: unknown[];
}

/** One named load case on a laminate - "Berechnung", "Berechnung2" in the
 *  original, and one `<calculation>` element in the file.
 *
 *  A laminate has several, because comparing load cases on one stack is the
 *  everyday job: the file format has always allowed it, the golden reference
 *  data uses it, and until now this app could hold exactly one and carried
 *  the rest through untouched. */
export interface LoadCase {
  id: string;
  name: string;
  /** Per-degree-of-freedom prescribed value (order matches DOF_NAMES/LOAD_FIELDS/STRAIN_FIELDS). */
  dofValues: number[];
  /** Per-degree-of-freedom flag: true prescribes the strain, false the load. */
  useStrain: boolean[];
  deltaT: number;
  deltaH: number;
}

export function defaultLoadCase(name: string): LoadCase {
  return {
    id: crypto.randomUUID(),
    name,
    dofValues: [1000, 0, 0, 0, 0, 0],
    useStrain: [false, false, false, false, false, false],
    deltaT: 0,
    deltaH: 0,
  };
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
  /** Always at least one - see `loadCasesOf`. */
  loadCases: LoadCase[];
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
    loadCases: [defaultLoadCase(t("default.loadCaseName", { nr: 1 }))],
  };
}

/** A laminate's load cases, guaranteed non-empty.
 *
 *  Everything downstream indexes into this list, so an empty one would mean a
 *  laminate with no load at all - which the UI has no way to produce and the
 *  file format has no way to express, but a hand-edited storage entry could. */
export function loadCasesOf(config: LaminateConfig): LoadCase[] {
  return config.loadCases.length > 0
    ? config.loadCases
    : [defaultLoadCase(t("default.loadCaseName", { nr: 1 }))];
}

/** The stored shape before load cases existed: the four load fields sat
 *  directly on the laminate. A session saved then still has to open. */
interface LegacyLaminateConfig {
  dofValues?: number[];
  useStrain?: boolean[];
  deltaT?: number;
  deltaH?: number;
  loadCases?: LoadCase[];
  carryOver?: CarryOver & { calculationName?: string; extraCalculations?: unknown[] };
}

function migrate(value: LaminateConfig): LaminateConfig {
  const legacy = value as LaminateConfig & LegacyLaminateConfig;
  if (Array.isArray(legacy.loadCases) && legacy.loadCases.length > 0) return value;

  const carry = legacy.carryOver;
  const first: LoadCase = {
    id: crypto.randomUUID(),
    name: carry?.calculationName ?? t("default.loadCaseName", { nr: 1 }),
    dofValues: legacy.dofValues ?? [1000, 0, 0, 0, 0, 0],
    useStrain: legacy.useStrain ?? [false, false, false, false, false, false],
    deltaT: legacy.deltaT ?? 0,
    deltaH: legacy.deltaH ?? 0,
  };

  // Calculations the old build could not model were carried through the file
  // untouched; now that there is somewhere to put them, they become real load
  // cases rather than staying invisible.
  const extra = (carry?.extraCalculations ?? []) as {
    name?: string;
    loads?: Record<string, number>;
    strains?: Record<string, number>;
    use_strain?: boolean[];
  }[];
  const recovered = extra.map((calculation, i) => {
    const useStrain = calculation.use_strain ?? [false, false, false, false, false, false];
    return {
      id: crypto.randomUUID(),
      name: calculation.name ?? t("default.loadCaseName", { nr: i + 2 }),
      dofValues: useStrain.map((flag, k) =>
        flag
          ? (calculation.strains?.[STRAIN_FIELDS[k]] ?? 0)
          : (calculation.loads?.[LOAD_FIELDS[k]] ?? 0),
      ),
      useStrain: [...useStrain],
      deltaT: calculation.loads?.delta_t ?? 0,
      deltaH: calculation.loads?.delta_h ?? 0,
    };
  });

  const { calculationName: _name, extraCalculations: _extra, ...keptCarry } = carry ?? {};
  return { ...value, loadCases: [first, ...recovered], carryOver: keptCarry };
}

const jsonStorage = createJSONStorage<LaminateConfig>(() => localStorage);

// Migration on read rather than a one-off upgrade pass: a stored laminate is
// only ever loaded through here, and a value written back is already in the
// current shape.
const storage = {
  ...jsonStorage,
  getItem: (key: string, initial: LaminateConfig) => migrate(jsonStorage.getItem(key, initial)),
};

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

/** Which load case the modules currently work on, per laminate.
 *
 *  Deliberately NOT part of the stored laminate: which case is open is a view
 *  state, and the comparison surface will name its own pairs anyway. Holds an
 *  id rather than an index, so adding or deleting a case does not silently
 *  move the selection to a different one. */
export const selectedLoadCaseFamily = atomFamily((_laminateId: string) =>
  atom<string | null>(null),
);

/** The selected load case, falling back to the first - the selection can name
 *  a case that has since been deleted, or none at all on first render. */
export const activeLoadCaseFamily = atomFamily((laminateId: string) =>
  atom((get): LoadCase => {
    const cases = loadCasesOf(get(laminateConfigFamily(laminateId)));
    const selected = get(selectedLoadCaseFamily(laminateId));
    return cases.find((c) => c.id === selected) ?? cases[0];
  }),
);

/** Adds a load case, copying the active one - a new case is nearly always a
 *  variation of the one being looked at, not a blank form. */
export const addLoadCaseAtom = atom(null, (get, set, laminateId: string) => {
  const config = get(laminateConfigFamily(laminateId));
  const cases = loadCasesOf(config);
  const source = get(activeLoadCaseFamily(laminateId));
  const copy: LoadCase = {
    ...source,
    id: crypto.randomUUID(),
    name: t("default.loadCaseName", { nr: cases.length + 1 }),
    dofValues: [...source.dofValues],
    useStrain: [...source.useStrain],
  };
  set(laminateConfigFamily(laminateId), { ...config, loadCases: [...cases, copy] });
  set(selectedLoadCaseFamily(laminateId), copy.id);
  return copy.id;
});

export const removeLoadCaseAtom = atom(
  null,
  (get, set, { laminateId, loadCaseId }: { laminateId: string; loadCaseId: string }) => {
    const config = get(laminateConfigFamily(laminateId));
    const cases = loadCasesOf(config);
    // The last one stays: a laminate without a load case has nothing to show.
    if (cases.length < 2) return;
    const remaining = cases.filter((c) => c.id !== loadCaseId);
    set(laminateConfigFamily(laminateId), { ...config, loadCases: remaining });
    if (get(selectedLoadCaseFamily(laminateId)) === loadCaseId) {
      set(selectedLoadCaseFamily(laminateId), remaining[0].id);
    }
  },
);

/** Writes a change into the ACTIVE load case, which is what every editor in a
 *  module page wants - none of them should have to know how cases are stored. */
export const updateActiveLoadCaseAtom = atom(
  null,
  (
    get,
    set,
    { laminateId, update }: { laminateId: string; update: (loadCase: LoadCase) => LoadCase },
  ) => {
    const config = get(laminateConfigFamily(laminateId));
    const active = get(activeLoadCaseFamily(laminateId));
    set(laminateConfigFamily(laminateId), {
      ...config,
      loadCases: loadCasesOf(config).map((c) => (c.id === active.id ? update(c) : c)),
    });
  },
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
    // Load cases are copied too, with fresh ids - a copied laminate carries
    // the same load cases, but they are its own from then on.
    loadCases: loadCasesOf(source).map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      dofValues: [...c.dofValues],
      useStrain: [...c.useStrain],
    })),
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
