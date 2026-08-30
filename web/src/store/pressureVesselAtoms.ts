// Pressure-vessel state and results, one instance per laminate.
//
// Same shape as the other module families: the input persisted per laminate,
// the laminate itself read from laminateRequestFamily. No load case is
// involved - the vessel's load IS its pressure and radius, and the wall's
// curvature is prescribed rather than loaded.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import type { PressureVesselInputDto, PressureVesselResponse } from "../lib/types";
import { loadElamxWasm } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

// Mirrors elamx-core's PressureVesselInput::default, which mirrors the Java
// field initialisers - except for the radius, where 1 mm is a placeholder
// rather than a vessel. 200 mm is a tube someone might actually wind.
export function defaultPressureVesselInput(): PressureVesselInputDto {
  return {
    pressure: 0.5,
    radius: 200,
    radius_type: "Mean",
  };
}

const storage = createJSONStorage<PressureVesselInputDto>(() => localStorage);

export const pressureVesselStorageKey = (laminateId: string) => `elamx.vessel.${laminateId}`;

export const pressureVesselInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<PressureVesselInputDto>(
    pressureVesselStorageKey(laminateId),
    defaultPressureVesselInput(),
    storage,
    { getOnInit: true },
  ),
);

export const pressureVesselResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<PressureVesselResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(pressureVesselInputFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_pressure_vessel(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as PressureVesselResponse;
  }),
);

export const loadablePressureVesselFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(pressureVesselResponseFamily(laminateId)),
);

function selectFromResult<T>(laminateId: string, selector: (r: PressureVesselResponse) => T) {
  return selectAtom(
    loadablePressureVesselFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

/** The headline numbers: what the wall carries and how far it moves. */
export const pressureVesselSummaryFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) => ({
    meanRadius: r.mean_radius,
    axialFlow: r.loads.n_x,
    hoopFlow: r.loads.n_y,
    axialStrain: r.strains.epsilon_x,
    hoopStrain: r.strains.epsilon_y,
    /** The governing reserve factor over every ply and both ply surfaces. */
    minReserveFactor: r.layer_results.reduce(
      (min, layer) =>
        Math.min(min, layer.rr_lower.minimal_reserve_factor, layer.rr_upper.minimal_reserve_factor),
      Infinity,
    ),
    failedPlies: r.layer_results.filter((l) => l.failed).length,
    plies: r.layer_results.length,
  })),
);

export const pressureVesselLayersFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) => r.layer_results),
);

export const pressureVesselErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadablePressureVesselFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
