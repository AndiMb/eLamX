// What the 3D plate view is showing, and the field behind it.
//
// Split along how often things change, the same split the GL scene is built
// on. The GEOMETRY is the deflection: it changes with the plate, its edges,
// the term count and the grid. The VALUES are whichever quantity is being
// displayed: they change every time the reader picks another one, and must
// not rebuild a body to do it. Both are sampled on the same grid, because the
// values are a colour per vertex - a field one resolution finer than the body
// would paint the plate with somebody else's numbers.
//
// The view state itself is persisted per laminate (FR-12): which quantity,
// which ply, which face of it, and which layers of annotation are switched on.
// Coming back to a module and finding it showing what it showed last time is
// the difference between a viewer and a toy.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { LayerPositionId, PlateFieldId, PlateFieldResponse } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily, layerContributionsFamily } from "./derivedAtoms";
import { deformationInputFamily, deformationResponseFamily } from "./deformationAtoms";

export interface PlateViewState {
  field: PlateFieldId;
  /** Index into the expanded stack. Clamped when drawn, not when written -
   *  removing a ply must not silently retarget a saved selection. */
  layer: number;
  position: LayerPositionId;
  /** Colour scale limits, or automatic from the field itself (FR-05). */
  bounds: [number, number] | "auto";
  visible: { supports: boolean; loads: boolean; reference: boolean };
}

export function defaultPlateViewState(): PlateViewState {
  return {
    field: "Deflection",
    layer: 0,
    position: "Upper",
    bounds: "auto",
    visible: { supports: true, loads: true, reference: true },
  };
}

const storage = createJSONStorage<PlateViewState>(() => localStorage);

export const plateViewStorageKey = (laminateId: string) => `elamx.plateview.${laminateId}`;

export const plateViewFamily = atomFamily((laminateId: string) =>
  atomWithStorage<PlateViewState>(
    plateViewStorageKey(laminateId),
    defaultPlateViewState(),
    storage,
    { getOnInit: true },
  ),
);

/**
 * Grid the plate is sampled on, for both the body and the field (CR-04).
 *
 * The design left this open for the reserve factor, which is the one quantity
 * that runs a failure criterion per point - 6561 evaluations for one picture,
 * where every other field is arithmetic on three curvatures. Measured in a
 * software-rendered browser, from the click to the new numbers on screen and
 * including the worker round trip: 40 ms at 41 x 41, 65 ms at 81 x 81, against
 * a budget of 150 ms (NFR-04). So there is no case for a second resolution,
 * and one grid means switching to the reserve factor does not rebuild the body
 * on the way.
 */
export const PLATE_SAMPLES = 81;

/** The pieces every field call needs, gathered once. */
const requestFamily = atomFamily((laminateId: string) =>
  atom(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const input = get(deformationInputFamily(laminateId));
    const solution = await get(deformationResponseFamily(laminateId));
    return { laminate, materials, input, coefficients: solution.coefficients };
  }),
);

interface FieldRequestBase {
  laminate: unknown;
  materials: unknown;
  input: unknown;
  coefficients: number[][];
}

/**
 * A field together with the selection it answers.
 *
 * The two travel as one because they are read as one: the legend takes its
 * name, its unit and its colour scale from the field, and its numbers from the
 * result. Reading the first from the live view state and the second from an
 * atom still catching up shows the previous quantity's numbers under the new
 * quantity's name - and, worse, paints the old values with the new scale.
 */
export interface PlateFieldSlice {
  field: PlateFieldId;
  layer: number;
  position: LayerPositionId;
  result: PlateFieldResponse;
}

async function fetchField(
  base: FieldRequestBase,
  field: PlateFieldId,
  layer: number,
  position: LayerPositionId,
  samples: number,
): Promise<PlateFieldSlice> {
  const json = await elamx.compute_deformation_field(
    JSON.stringify({ ...base, field, layer, position, samples }),
  );
  return { field, layer, position, result: JSON.parse(json) as PlateFieldResponse };
}

/**
 * The deflection at the current grid - the body's own shape.
 *
 * Deliberately not `DeformationResult::surface`: that one is sampled at a
 * fixed 41 and would put the body on a different grid from the values painted
 * on it the moment anything else is displayed.
 */
export const plateGeometryFamily = atomFamily((laminateId: string) =>
  atom<Promise<PlateFieldSlice>>(async (get) => {
    const base = await get(requestFamily(laminateId));
    return fetchField(base, "Deflection", 0, "Upper", PLATE_SAMPLES);
  }),
);

export const plateFieldFamily = atomFamily((laminateId: string) =>
  atom<Promise<PlateFieldSlice>>(async (get) => {
    const base = await get(requestFamily(laminateId));
    const view = get(plateViewFamily(laminateId));
    const plies = get(layerContributionsFamily(laminateId));
    // Clamped here rather than on write: a saved selection has to survive a
    // ply being removed and added back.
    const layer = Math.min(Math.max(0, view.layer), Math.max(0, (plies?.length ?? 1) - 1));
    return fetchField(base, view.field, layer, view.position, PLATE_SAMPLES);
  }),
);

export const loadablePlateGeometryFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(plateGeometryFamily(laminateId)),
);

export const loadablePlateFieldFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(plateFieldFamily(laminateId)),
);

export const plateFieldErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadablePlateFieldFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
