// Plate-deformation state and results, one instance per laminate.
//
// The response carries the Ritz coefficients and a deflection field sampled at
// a fixed resolution. The 3D view uses neither: it asks `plateViewAtoms` for a
// field at the grid it actually draws on, because the body and the values
// painted on it have to share one grid. What stays here is the solve and the
// headline numbers that come straight out of it.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import type { DeformationInputDto, DeformationResponse, NamedLoadDto } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

// Mirrors elamx-core's DeformationInput::default, which mirrors the Java one -
// with a surface load already in place, so the module has something to show
// the moment it is opened.
export function defaultDeformationInput(): DeformationInputDto {
  return {
    length: 500,
    width: 500,
    bc_x: "SS",
    bc_y: "SS",
    m: 10,
    n: 10,
    d_matrix: "standard",
    loads: [{ kind: "Surface", name: "q", force: 0.01 }],
  };
}

const storage = createJSONStorage<DeformationInputDto>(() => localStorage);

export const deformationStorageKey = (laminateId: string) => `elamx.deformation.${laminateId}`;

export const deformationInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<DeformationInputDto>(
    deformationStorageKey(laminateId),
    defaultDeformationInput(),
    storage,
    { getOnInit: true },
  ),
);

export const deformationResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<DeformationResponse>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(deformationInputFamily(laminateId));
    const json = await elamx.compute_deformation(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as DeformationResponse;
  }),
);

export const loadableDeformationFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(deformationResponseFamily(laminateId)),
);

function selectFromResult<T>(laminateId: string, selector: (r: DeformationResponse) => T) {
  return selectAtom(
    loadableDeformationFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

/** The headline numbers, without the field itself. */
export const deformationSummaryFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) => ({
    maxDeflection: r.max_deflection,
    minDeflection: r.min_deflection,
    maxAt: r.max_at,
    symmetryWarning: r.symmetry_warning,
  })),
);

export const deformationErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableDeformationFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);

/** Adds a load of the given kind, named after how many there already are. */
export const addDeformationLoadAtom = atom(
  null,
  (get, set, { laminateId, kind }: { laminateId: string; kind: NamedLoadDto["kind"] }) => {
    const input = get(deformationInputFamily(laminateId));
    const nr = input.loads.length + 1;
    const load: NamedLoadDto =
      kind === "Surface"
        ? { kind: "Surface", name: `q${nr}`, force: 0.01 }
        : { kind: "Point", name: `F${nr}`, x: 0, y: 0, force: 100 };
    set(deformationInputFamily(laminateId), { ...input, loads: [...input.loads, load] });
  },
);

export const removeDeformationLoadAtom = atom(
  null,
  (get, set, { laminateId, index }: { laminateId: string; index: number }) => {
    const input = get(deformationInputFamily(laminateId));
    set(deformationInputFamily(laminateId), {
      ...input,
      loads: input.loads.filter((_, i) => i !== index),
    });
  },
);
