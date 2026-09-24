// The reactive computation chain, now one instance per laminate id:
// laminateConfigFamily(id) (pure derive) -> cltRequestFamily(id) (pure derive)
// -> cltResponseFamily(id) (async, calls into the WASM core) -> a handful of
// selectAtom-derived "slice" atoms, one per result panel, all keyed by id.
//
// Why slice atoms with a deep-equal comparator: `compute_clt` returns a fresh
// JSON string on every call, so `JSON.parse` always yields new object/array
// references even when a given slice's *values* didn't change (e.g. switching
// the failure criterion changes `layer_results` but not `abd`). Without an
// explicit deep-equal comparator, every edit would spuriously invalidate every
// panel. `selectAtom(..., equal)` keeps the previous reference when the newly
// computed slice is deep-equal to it, so only genuinely affected panels re-render.
//
// Why atomFamily: keying every atom in this chain by laminate id is what
// guarantees editing laminate A never recomputes laminate B - each family
// member is an independent atom graph that merely happens to also read the
// shared materialsAtom.
import { atom, type Getter } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { LOAD_FIELDS, STRAIN_FIELDS } from "../lib/constants";
import { loadableWithLastValue } from "../lib/loadable";
import {
  emptyLoads,
  emptyStrains,
  type AngleSweepResponse,
  type CltRequest,
  type CltResponse,
  type LaminateDto,
} from "../lib/types";
import { elamx } from "../lib/wasm";
import {
  activeLoadCaseFamily,
  laminateConfigFamily,
  loadCasesOf,
  type LaminateConfig,
  type LoadCase,
} from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import { snapshotsAtom } from "./comparisonAtoms";
import { snapshotCltRequest } from "../lib/compare/snapshot";

/** A laminate as the core takes it - pure, for whoever needs a request
 *  without the store (the report). */
export function laminateDtoOf(config: LaminateConfig): LaminateDto {
  return {
    id: config.id,
    name: config.name,
    layers: config.layers.map((l) => ({
      id: l.id,
      name: l.name,
      angle: l.angle,
      thickness: l.thickness,
      material_id: l.materialId,
      criterion_id: l.criterionId,
      extra_criteria: l.extraCriteria ?? [],
    })),
    symmetric: config.symmetric,
    with_middle_layer: config.withMiddleLayer,
    invert_z: config.invertZ,
    offset: config.offset,
  };
}

/**
 * A derived atom that keeps its previous value while the new one is deep-equal.
 *
 * Jotai tells dependents about a change by reference, and a request built
 * afresh is a new object even when not one number in it moved - so without
 * this, whatever reads it recomputes anyway. For a request that sits in front
 * of a buckling solve (0.8 s at twenty terms) and every other open module,
 * that is the difference between typing a name and waiting on it.
 */
function stableAtom<T>(read: (get: Getter) => T) {
  let last: T | undefined;
  return atom((get) => {
    const next = read(get);
    if (last !== undefined && equal(last, next)) return last;
    last = next;
    return next;
  });
}

/** The laminate and every material, names and all - for what writes them out
 *  (the solver deck) rather than computes with them. */
export const namedLaminateRequestFamily = atomFamily((laminateId: string) =>
  atom((get) => {
    const config = get(laminateConfigFamily(laminateId));
    const materials = get(materialsAtom);
    return {
      laminate: laminateDtoOf(config),
      materials: Object.fromEntries(materials.map((m) => [m.id, m])),
    };
  }),
);

/** The laminate and its materials, without any load case - as far as a
 *  calculation reads them.
 *
 *  Split out because the plate modules need exactly this and nothing else:
 *  reading the full CLT request there would make a buckling analysis recompute
 *  whenever a load case is edited, which has no bearing on it. For the same
 *  reason the names are left out - no result depends on what a ply, the
 *  laminate or a material is called, and each keystroke in a name field would
 *  otherwise re-run every open module - and so are the materials no ply uses.
 *  The ids stay: they are what the core resolves and reports errors by. */
export const laminateRequestFamily = atomFamily((laminateId: string) =>
  stableAtom((get) => {
    const config = get(laminateConfigFamily(laminateId));
    const used = new Set(config.layers.map((l) => l.materialId));
    const named = laminateDtoOf(config);
    const laminate: LaminateDto = {
      ...named,
      name: "",
      layers: named.layers.map((layer) => ({ ...layer, name: "" })),
    };
    const materials = get(materialsAtom)
      .filter((m) => used.has(m.id))
      .map((m) => [m.id, { ...m, name: "" }] as const);
    return { laminate, materials: Object.fromEntries(materials) };
  }),
);

/** Puts a laminate and one load case together into a core request.
 *
 *  A load case prescribes either the load or the strain per degree of freedom,
 *  so each stored value lands in whichever of the two vectors its flag selects.
 *  Pure, because the comparison surface needs the same request for a load case
 *  that is not the active one. */
export function buildCltRequest(
  laminate: LaminateDto,
  materials: CltRequest["materials"],
  loadCase: LoadCase,
): CltRequest {
  const loads = emptyLoads();
  const strains = emptyStrains();
  loadCase.dofValues.forEach((value, i) => {
    if (loadCase.useStrain[i]) {
      strains[STRAIN_FIELDS[i]] = value;
    } else {
      loads[LOAD_FIELDS[i]] = value;
    }
  });
  loads.delta_t = loadCase.deltaT;
  loads.delta_h = loadCase.deltaH;

  return {
    laminate,
    materials,
    loads,
    strains,
    use_strain: loadCase.useStrain as CltRequest["use_strain"],
  };
}

// Stable as well: a load case carries its name, which the request does not.
export const cltRequestFamily = atomFamily((laminateId: string) =>
  stableAtom<CltRequest>((get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    return buildCltRequest(laminate, materials, get(activeLoadCaseFamily(laminateId)));
  }),
);

/** `${laminateId}|${loadCaseId}` - the comparison surface's variant key. */
export const variantKey = (laminateId: string, loadCaseId: string) =>
  `${laminateId}|${loadCaseId}`;

/** The first half of a snapshot column's key: `snapshot|${id}`. */
const SNAPSHOT_KEY = "snapshot";

/** The key of any comparison column, a laminate's or a snapshot's. */
export const columnKey = (variant: { laminateId: string; loadCaseId: string; snapshotId?: string }) =>
  variant.snapshotId ? `${SNAPSHOT_KEY}|${variant.snapshotId}` : variantKey(variant.laminateId, variant.loadCaseId);

/** A CLT result for ANY of a laminate's load cases, not just the active one.
 *
 *  Separate from `cltResponseFamily` on purpose: the module pages follow the
 *  active case and must not recompute when a comparison column is added, and
 *  the comparison columns must not change under the user because someone
 *  switched the active case in another tab of the app. */
export const variantResponseFamily = atomFamily((key: string) =>
  atom<Promise<CltResponse | null>>(async (get) => {
    const [laminateId, loadCaseId] = key.split("|");
    if (laminateId === SNAPSHOT_KEY) {
      // A snapshot's column: computed from the snapshot's own copies, so it
      // answers the same after the laminate is changed or deleted.
      const snapshot = get(snapshotsAtom).find((s) => s.id === loadCaseId);
      if (!snapshot) return null;
      const json = await elamx.compute_clt(JSON.stringify(snapshotCltRequest(snapshot)), key);
      return JSON.parse(json) as CltResponse;
    }
    const config = get(laminateConfigFamily(laminateId));
    const loadCase = loadCasesOf(config).find((c) => c.id === loadCaseId);
    if (!loadCase) return null;

    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    // Keyed by the variant, not the laminate: a comparison column must not
    // supersede another column of the same laminate under a different case.
    const json = await elamx.compute_clt(
      JSON.stringify(buildCltRequest(laminate, materials, loadCase)),
      key,
    );
    return JSON.parse(json) as CltResponse;
  }),
);

export const loadableVariantFamily = atomFamily((key: string) =>
  loadableWithLastValue(variantResponseFamily(key)),
);

// Calls into the WASM core, which now answers from a worker (see lib/wasm.ts).
// The CLT itself is cheap - 0.3 ms for sixteen plies - and would not need one;
// it goes the same way because one core instance beats two, and because
// loadableWithLastValue() below already means components never <Suspense>.
export const cltResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<CltResponse>>(async (get) => {
    const request = get(cltRequestFamily(laminateId));
    const json = await elamx.compute_clt(JSON.stringify(request), laminateId);
    return JSON.parse(json) as CltResponse;
  }),
);

export const loadableCltResponseFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(cltResponseFamily(laminateId)),
);

function selectFromResponse<T>(laminateId: string, selector: (r: CltResponse) => T) {
  return selectAtom(
    loadableCltResponseFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

export const abdMatrixFamily = atomFamily((laminateId: string) => selectFromResponse(laminateId, (r) => r.abd));

export const summaryFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r) => ({
    tges: r.tges,
    isSymmetric: r.is_symmetric,
    areaWeight: r.area_weight,
    engineeringConstants: r.engineering_constants,
    abdInv: r.abd_inv,
  })),
);

// Everything the original's "Informationen" window shows beyond the headline
// figures. Its own slice rather than part of summaryFamily, so the tile row at
// the top of a result does not re-render when only the detail panel's numbers
// move.
export const laminateInfoFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r) => ({
    abdInv: r.abd_inv,
    engineeringConstants: r.engineering_constants,
    alphaGlobal: r.alpha_global,
    betaGlobal: r.beta_global,
    massMoments: r.mass_moments,
    isSymmetric: r.is_symmetric,
  })),
);

// Per-layer A/B/D build-up (see elamx-core's LayerContribution) - used by the
// "how was this computed" ABD/Q-bar explanations so they can show the exact
// numbers the Rust core itself produced, rather than re-deriving them in TS.
export const layerContributionsFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r) => r.layer_contributions),
);

export const solvedLoadsFamily = atomFamily((laminateId: string) => selectFromResponse(laminateId, (r) => r.loads));
export const solvedStrainsFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r) => r.strains),
);
export const layerResultsFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r) => r.layer_results),
);

export const cltErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableCltResponseFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);

// Angle-sweep visualization data: how A11/A22/A66 would read if the laminate's
// reference axes were rotated. Only depends on the layup + materials (not
// loads/strains), so it's derived from cltRequestFamily's laminate/materials
// fields rather than needing its own separate config subscription.
export const angleSweepFamily = atomFamily((laminateId: string) =>
  atom<Promise<AngleSweepResponse>>(async (get) => {
    const { laminate, materials } = get(cltRequestFamily(laminateId));
    const json = await elamx.compute_angle_sweep(
      JSON.stringify({ laminate, materials }),
      5,
      laminateId,
    );
    return JSON.parse(json) as AngleSweepResponse;
  }),
);

export const loadableAngleSweepFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(angleSweepFamily(laminateId)),
);

export interface ThroughThicknessLayer {
  layerNumber: number;
  zLower: number;
  zUpper: number;
  stressLocal: { lower: [number, number, number]; upper: [number, number, number] };
  stressGlobal: { lower: [number, number, number]; upper: [number, number, number] };
  strainLocal: { lower: [number, number, number]; upper: [number, number, number] };
  strainGlobal: { lower: [number, number, number]; upper: [number, number, number] };
}

// Joins layer_contributions (z-coordinates) with layer_results (stress/strain
// at top/bottom) by array position - both come from the same wasm response,
// iterating the same stacking order, so a single combined slice atom (rather
// than the ThroughThicknessChart subscribing to both families separately)
// keeps that component's render-isolation to one deep-equal-guarded value.
export const throughThicknessFamily = atomFamily((laminateId: string) =>
  selectFromResponse(laminateId, (r): ThroughThicknessLayer[] =>
    r.layer_contributions.map((contribution, i) => {
      const result = r.layer_results[i];
      return {
        layerNumber: contribution.layer_number,
        zLower: contribution.zm - contribution.thickness / 2,
        zUpper: contribution.zm + contribution.thickness / 2,
        stressLocal: { lower: result.sss_lower.stress, upper: result.sss_upper.stress },
        stressGlobal: { lower: result.sss_lower_global.stress, upper: result.sss_upper_global.stress },
        strainLocal: { lower: result.sss_lower.strain, upper: result.sss_upper.strain },
        strainGlobal: { lower: result.sss_lower_global.strain, upper: result.sss_upper_global.strain },
      };
    }),
  ),
);
