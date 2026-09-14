// Plate-vibration state and results, one instance per laminate.
//
// Deliberately the same shape as `bucklingAtoms`: both solve an eigenvalue
// problem on the same Ritz stiffness matrix, return a list of modes with a
// shape each, and sample one of those shapes on demand for the 3D view. What
// differs is only what stands beside the stiffness matrix - a geometric
// stiffness there, a mass matrix here - and that difference lives entirely in
// the core.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import { withStiffeners } from "../lib/stiffeners";
import type { VibrationInputDto, VibrationResponse } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/** Grid resolution of the sampled mode-shape surface, as for buckling. */
const SURFACE_SAMPLES = 41;

/**
 * How many modes to offer. All m*n come back, but past the lowest dozen the
 * Ritz series is describing its own truncation rather than the plate - the
 * same reason the buckling module stops there.
 */
const SELECTABLE_MODES = 12;

// Mirrors elamx-core's VibrationInput::default, which mirrors the Java one.
export function defaultVibrationInput(): VibrationInputDto {
  return {
    length: 500,
    width: 500,
    bc_x: "SS",
    bc_y: "SS",
    m: 10,
    n: 10,
    d_matrix: "standard",
    stiffeners: [],
  };
}

const json = createJSONStorage<VibrationInputDto>(() => localStorage);
const storage = {
  ...json,
  getItem: (key: string, initial: VibrationInputDto) => withStiffeners(json.getItem(key, initial)),
};

export const vibrationStorageKey = (laminateId: string) => `elamx.vibration.${laminateId}`;

export const vibrationInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<VibrationInputDto>(
    vibrationStorageKey(laminateId),
    defaultVibrationInput(),
    storage,
    { getOnInit: true },
  ),
);

export const vibrationResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<VibrationResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(vibrationInputFamily(laminateId));
    const json = await elamx.compute_vibration(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as VibrationResponse;
  }),
);

export const loadableVibrationFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(vibrationResponseFamily(laminateId)),
);

function selectFromResult<T>(laminateId: string, selector: (r: VibrationResponse) => T) {
  return selectAtom(
    loadableVibrationFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

/** The headline number, without the shapes. */
export const vibrationSummaryFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) => ({
    fundamentalFrequency: r.fundamental_frequency,
    symmetryWarning: r.symmetry_warning,
  })),
);

/** The modes worth offering, frequency and eigenvalue only. */
export const vibrationModeListFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) =>
    r.modes.slice(0, SELECTABLE_MODES).map((mode) => ({
      frequency: mode.frequency,
      eigenvalue: mode.eigenvalue,
    })),
  ),
);

export const vibrationErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableVibrationFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);

/** Which mode the 3D view is showing. Session state, not part of the document -
 *  and not clamped on write, for the same reason the buckling module gives. */
export const selectedVibrationModeFamily = atomFamily((_laminateId: string) => atom(0));

/** The selected mode's surface, sampled by the core on the grid the view draws
 *  on. Async because it is a second call: the mode list travels without
 *  surfaces, so switching modes costs one sampling and not one solve. */
export const vibrationSurfaceFamily = atomFamily((laminateId: string) =>
  atom<Promise<number[][] | null>>(async (get) => {
    const response = await get(vibrationResponseFamily(laminateId));
    const input = get(vibrationInputFamily(laminateId));
    const index = Math.min(get(selectedVibrationModeFamily(laminateId)), response.modes.length - 1);
    const mode = response.modes[index];
    if (!mode) return null;
    const json = await elamx.compute_vibration_surface(
      JSON.stringify({ input, shape: mode.shape, samples: SURFACE_SAMPLES }),
    );
    return JSON.parse(json) as number[][];
  }),
);

export const loadableVibrationSurfaceFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(vibrationSurfaceFamily(laminateId)),
);
