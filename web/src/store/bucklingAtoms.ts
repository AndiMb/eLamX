// Plate-buckling state and results, one instance per laminate.
//
// Kept in its own family rather than inside laminateConfigFamily: the buckling
// input is module-specific (plate geometry, edge conditions, Ritz term counts)
// and editing it must not invalidate the CLT chain, which knows nothing about
// plates. The laminate itself is read from cltRequestFamily so the layup and
// materials stay a single source of truth.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import type { BucklingInputDto, BucklingResponse } from "../lib/types";
import { loadElamxWasm } from "../lib/wasm";
import { cltRequestFamily } from "./derivedAtoms";

/** Grid resolution of the returned mode-shape surface. */
const SURFACE_SAMPLES = 41;
/** How many mode shapes to sample. Only the critical one is plotted today. */
const SURFACE_MODES = 1;

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

export const bucklingInputFamily = atomFamily((_laminateId: string) =>
  atom<BucklingInputDto>(defaultBucklingInput()),
);

// Async like cltResponseFamily, and for the same reason: only the very first
// wasm load is actually asynchronous. The solve itself is synchronous, but it
// is an (m*n)^3 eigenvalue problem - at the 20x20 maximum that is a 400x400
// matrix, so this is the first calculation in the app expensive enough that
// moving it to a Web Worker may become worthwhile. Keeping it behind the same
// loadable shape means that change would not touch any call site.
export const bucklingResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<BucklingResponse>>(async (get) => {
    const { laminate, materials } = get(cltRequestFamily(laminateId));
    const input = get(bucklingInputFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_buckling(
      JSON.stringify({
        laminate,
        materials,
        input,
        surface_samples: SURFACE_SAMPLES,
        surface_modes: SURFACE_MODES,
      }),
    );
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

/** The critical mode's sampled surface, or null if nothing buckled. */
export const bucklingShapeFamily = atomFamily((laminateId: string) =>
  selectFromBuckling(laminateId, (r) => r.modes.find((m) => m.surface != null)?.surface ?? null),
);

/**
 * The lowest few positive load factors, for the "further modes" list. Negative
 * eigenvalues correspond to buckling under the REVERSED load and are dropped -
 * showing them next to the critical one invites reading them as a lower
 * margin than they are.
 */
export const bucklingModeListFamily = atomFamily((laminateId: string) =>
  selectFromBuckling(laminateId, (r) =>
    r.modes
      .map((m) => m.eigenvalue)
      .filter((v) => v >= 0 && Number.isFinite(v))
      .slice(0, 6),
  ),
);

export const bucklingErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableBucklingFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
