// Plate-buckling state and results, one instance per laminate.
//
// Kept in its own family rather than inside laminateConfigFamily: the buckling
// input is module-specific (plate geometry, edge conditions, Ritz term counts)
// and editing it must not invalidate the CLT chain, which knows nothing about
// plates. The laminate itself is read from laminateRequestFamily so the layup and
// materials stay a single source of truth.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import type { BucklingInputDto, BucklingResponse } from "../lib/types";
import { loadElamxWasm } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/** Grid resolution of the sampled mode-shape surface. */
const SURFACE_SAMPLES = 41;

/**
 * How many buckling modes to offer for display. All m*n eigenvalues are
 * solved for, but only the lowest few are physically interesting - past those
 * the Ritz series is describing its own truncation more than the plate.
 */
const SELECTABLE_MODES = 12;

// Mirrors elamx-core's BucklingInput::default, which in turn mirrors the Java
// BucklingInput no-arg constructor.
export function defaultBucklingInput(): BucklingInputDto {
  return {
    length: 500,
    width: 500,
    n_x: -1,
    n_y: 0,
    n_xy: 0,
    bc_x: "SS",
    bc_y: "SS",
    m: 10,
    n: 10,
    d_matrix: "standard",
  };
}

const storage = createJSONStorage<BucklingInputDto>(() => localStorage);

export const bucklingStorageKey = (laminateId: string) => `elamx.buckling.${laminateId}`;

// Persisted per laminate, like the laminate itself: a plate geometry and its
// edge conditions are user input, and losing them on reload is losing work.
export const bucklingInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<BucklingInputDto>(
    bucklingStorageKey(laminateId),
    defaultBucklingInput(),
    storage,
    { getOnInit: true },
  ),
);

// Async like cltResponseFamily, and for the same reason: only the very first
// wasm load is actually asynchronous. The solve itself is synchronous, but it
// is an (m*n)^3 eigenvalue problem - at the 20x20 maximum that is a 400x400
// matrix, so this is the first calculation in the app expensive enough that
// moving it to a Web Worker may become worthwhile. Keeping it behind the same
// loadable shape means that change would not touch any call site.
export const bucklingResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<BucklingResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(bucklingInputFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_buckling(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as BucklingResponse;
  }),
);

export const loadableBucklingFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(bucklingResponseFamily(laminateId)),
);

function selectFromBuckling<T>(laminateId: string, selector: (r: BucklingResponse) => T) {
  return selectAtom(
    loadableBucklingFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

/** Headline numbers: critical load factor, the scaled load flows, the warning. */
export const bucklingSummaryFamily = atomFamily((laminateId: string) =>
  selectFromBuckling(laminateId, (r) => ({
    criticalFactor: r.critical_factor,
    nCrit: r.n_crit,
    symmetryWarning: r.symmetry_warning,
  })),
);

/**
 * The selectable modes: the lowest positive load factors with their modal
 * amplitudes. Negative eigenvalues correspond to buckling under the REVERSED
 * load and are dropped - listing them beside the critical one invites reading
 * them as a smaller margin than they are.
 */
export const bucklingModeListFamily = atomFamily((laminateId: string) =>
  selectFromBuckling(laminateId, (r) =>
    r.modes
      .filter((m) => m.eigenvalue >= 0 && Number.isFinite(m.eigenvalue))
      .slice(0, SELECTABLE_MODES)
      .map((m, index) => ({ index, eigenvalue: m.eigenvalue, shape: m.shape })),
  ),
);

/**
 * Which mode the 3D view shows, as an index into bucklingModeListFamily.
 * Deliberately NOT reset when the input changes: someone comparing mode 3
 * across two plate widths wants to stay on mode 3. It is clamped at the point
 * of use instead, since the list can get shorter.
 */
export const selectedBucklingModeFamily = atomFamily((_laminateId: string) => atom(0));

/**
 * The selected mode's displacement field, sampled by the core. Split from the
 * eigenvalue solve so switching the displayed mode re-samples a grid instead
 * of re-solving the whole problem, and so the solve's response does not carry
 * grid data for modes nobody is looking at.
 */
export const bucklingSurfaceFamily = atomFamily((laminateId: string) =>
  atom<Promise<number[][] | null>>(async (get) => {
    const modes = get(bucklingModeListFamily(laminateId));
    if (!modes || modes.length === 0) return null;
    const selected = Math.min(get(selectedBucklingModeFamily(laminateId)), modes.length - 1);
    const input = get(bucklingInputFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_buckling_surface(
      JSON.stringify({ input, shape: modes[selected].shape, samples: SURFACE_SAMPLES }),
    );
    return JSON.parse(json) as number[][];
  }),
);

export const loadableBucklingSurfaceFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(bucklingSurfaceFamily(laminateId)),
);

export const bucklingErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableBucklingFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
