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
import { atom } from "jotai";
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
import { loadElamxWasm } from "../lib/wasm";
import { laminateConfigFamily } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";

export const cltRequestFamily = atomFamily((laminateId: string) =>
  atom<CltRequest>((get) => {
    const config = get(laminateConfigFamily(laminateId));
    const materials = get(materialsAtom);

    const laminate: LaminateDto = {
      id: config.id,
      name: config.name,
      layers: config.layers.map((l) => ({
        id: l.id,
        name: l.name,
        angle: l.angle,
        thickness: l.thickness,
        material_id: l.materialId,
        criterion_id: l.criterionId,
      })),
      symmetric: config.symmetric,
      with_middle_layer: config.withMiddleLayer,
      invert_z: config.invertZ,
      offset: 0,
    };

    const loads = emptyLoads();
    const strains = emptyStrains();
    config.dofValues.forEach((value, i) => {
      if (config.useStrain[i]) {
        strains[STRAIN_FIELDS[i]] = value;
      } else {
        loads[LOAD_FIELDS[i]] = value;
      }
    });
    loads.delta_t = config.deltaT;
    loads.delta_h = config.deltaH;

    return {
      laminate,
      materials: Object.fromEntries(materials.map((m) => [m.id, m])),
      loads,
      strains,
      use_strain: config.useStrain as CltRequest["use_strain"],
    };
  }),
);

// Calls into the WASM core. Async only because loading the wasm module the
// very first time is async; the actual computation is synchronous. Wrapped in
// loadableWithLastValue() below so components never need to <Suspense> - and
// so swapping this for a Web Worker call later (for genuinely expensive
// computations) won't change any call site.
export const cltResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<CltResponse>>(async (get) => {
    const request = get(cltRequestFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_clt(JSON.stringify(request));
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
    const wasm = await loadElamxWasm();
    const json = wasm.compute_angle_sweep(JSON.stringify({ laminate, materials }), 5);
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
