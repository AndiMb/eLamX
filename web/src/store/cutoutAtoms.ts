// Cutout state and result, one instance per laminate.
//
// The most expensive thing this app computes per point: 721 samples, each an
// independent closed-form evaluation, and on an unsymmetric laminate each one
// also solves a complex 4x4 system. It still comes back in well under a
// second, so there is no resolution picker - unlike the laminate failure body,
// where the cost is in the sweep itself.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { CutoutInputDto, CutoutResponse } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/** Mirrors elamx-core's CutoutInput::default, which mirrors the Java one. */
export function defaultCutoutInput(): CutoutInputDto {
  return {
    geometry: { shape: "circular", a: 1 },
    n_x: 1,
    n_y: 0,
    n_xy: 0,
    m_x: 0,
    m_y: 0,
    m_xy: 0,
    values: 721,
  };
}

/**
 * A stored input from before a field existed, or with a shape stored in some
 * older form.
 *
 * `geometry` is a discriminated union on both sides of the wasm boundary, so a
 * shape without its tag would fail deserialisation in Rust with a message
 * about an unknown variant rather than about an old saved input.
 */
function normalise(input: CutoutInputDto): CutoutInputDto {
  const fallback = defaultCutoutInput();
  const shape = input?.geometry?.shape;
  const geometry =
    shape === "circular" || shape === "elliptical" || shape === "square" || shape === "rectangular"
      ? input.geometry
      : fallback.geometry;
  return { ...fallback, ...input, geometry };
}

const json = createJSONStorage<CutoutInputDto>(() => localStorage);
const storage = {
  ...json,
  getItem: (key: string, initial: CutoutInputDto) => normalise(json.getItem(key, initial)),
};

export const cutoutStorageKey = (laminateId: string) => `elamx.cutout.${laminateId}`;

export const cutoutInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<CutoutInputDto>(cutoutStorageKey(laminateId), defaultCutoutInput(), storage, {
    getOnInit: true,
  }),
);

export const cutoutResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<CutoutResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(cutoutInputFamily(laminateId));
    const json = await elamx.compute_cutout(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as CutoutResponse;
  }),
);

export const loadableCutoutFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(cutoutResponseFamily(laminateId)),
);

export const cutoutErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableCutoutFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
