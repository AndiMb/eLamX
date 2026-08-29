// Last-ply-failure state and results, one instance per laminate.
//
// Same shape as bucklingAtoms: module-specific input in its own persisted
// family, the laminate itself read from cltRequestFamily so the layup and
// materials stay a single source of truth.
//
// Note that the analysis ignores three parts of that shared state on purpose,
// because eLamX does (see elamx-core's clt::last_ply_failure): the materials'
// criterion parameters, their expansion coefficients, and the laminate's
// reference-plane offset. The module page says so - a user who changes p_spd
// and sees nothing move deserves an explanation rather than a puzzle.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import equal from "fast-deep-equal";
import { loadableWithLastValue } from "../lib/loadable";
import { emptyLoads, type LastPlyFailureInputDto, type LastPlyFailureResponse } from "../lib/types";
import { loadElamxWasm } from "../lib/wasm";
import { cltRequestFamily } from "./derivedAtoms";

// The degradation parameters mirror elamx-core's LastPlyFailureInput::default,
// which in turn mirrors the Java LastPlyFailureInput field initialisers. The
// load does not: Java starts at zero, which here would open the page on an
// analysis where nothing fails and nothing is degraded. 1000 N/mm is what the
// layer-by-layer module starts with too (see defaultLaminateConfig), so the two
// modules open on the same load case.
export function defaultLastPlyFailureInput(): LastPlyFailureInputDto {
  return {
    loads: { ...emptyLoads(), n_x: 1000 },
    degradation_factor: 0.000001,
    epsilon_crit: 0.003,
    j_a: 1.0,
    degrade_all_on_fibre_failure: true,
  };
}

const storage = createJSONStorage<LastPlyFailureInputDto>(() => localStorage);

export const lastPlyFailureStorageKey = (laminateId: string) => `elamx.lpf.${laminateId}`;

export const lastPlyFailureInputFamily = atomFamily((laminateId: string) =>
  atomWithStorage<LastPlyFailureInputDto>(
    lastPlyFailureStorageKey(laminateId),
    defaultLastPlyFailureInput(),
    storage,
    { getOnInit: true },
  ),
);

// Async for the same reason as the other calculation families: only the first
// wasm load actually awaits anything. The analysis itself is a loop of up to
// 2n CLT solves, which is cheap next to the buckling eigenvalue problem.
export const lastPlyFailureResponseFamily = atomFamily((laminateId: string) =>
  atom<Promise<LastPlyFailureResponse>>(async (get) => {
    const { laminate, materials } = get(cltRequestFamily(laminateId));
    const input = get(lastPlyFailureInputFamily(laminateId));
    const wasm = await loadElamxWasm();
    const json = wasm.compute_last_ply_failure(JSON.stringify({ laminate, materials, input }));
    return JSON.parse(json) as LastPlyFailureResponse;
  }),
);

export const loadableLastPlyFailureFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(lastPlyFailureResponseFamily(laminateId)),
);

function selectFromResult<T>(laminateId: string, selector: (r: LastPlyFailureResponse) => T) {
  return selectAtom(
    loadableLastPlyFailureFamily(laminateId),
    (state) => (state.state === "hasData" ? selector(state.data) : null),
    equal,
  );
}

/** The headline load factors, without the per-iteration detail. */
export const lastPlyFailureSummaryFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) => ({
    firstFibreFailure: r.first_fibre_failure,
    firstMatrixFailure: r.first_matrix_failure,
    firstEpsilon: r.first_epsilon,
    exceedanceFactor: r.exceedance_factor,
    fibreBeforeMatrixFailure: r.fibre_before_matrix_failure,
    steps: r.iterations.length,
  })),
);

/** The degradation path, one row per step - the per-ply results stay out of
 *  this selector so a re-render of the table does not depend on them. */
export const lastPlyFailurePathFamily = atomFamily((laminateId: string) =>
  selectFromResult(laminateId, (r) =>
    r.iterations.map((iteration, index) => ({
      index,
      layerNumber: iteration.layer_number,
      reserveFactor: iteration.reserve_factor,
      failureName: iteration.failure_name,
      failureType: iteration.failure_type,
      /** How many plies have lost their matrix / their fibres by this step. */
      matrixFailedCount: iteration.matrix_failed.filter(Boolean).length,
      fibreFailedCount: iteration.fibre_failed.filter(Boolean).length,
      plyCount: iteration.matrix_failed.length,
    })),
  ),
);

export const lastPlyFailureErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableLastPlyFailureFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
