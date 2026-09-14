// The failure body of one material/criterion pair.
//
// Keyed by the pair rather than by laminate or ply: the surface depends on
// nothing else, so two plies of the same material with the same criterion
// share one computation - which matters, because a symmetric 16-ply stack
// otherwise recomputes the same 1800 criterion evaluations sixteen times.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { loadableWithLastValue } from "../lib/loadable";
import type { FailureEnvelopeResponse } from "../lib/types";
import { elamx } from "../lib/wasm";
import { materialsAtom } from "./materialsAtoms";

/** Sample density handed to the core; 1.0 is the Java view's default. */
export const ENVELOPE_QUALITY = 1.0;

/** `${materialId}|${criterionId}` - atomFamily keys have to be primitives. */
export type FailureBodyKey = string;

export const failureBodyKey = (materialId: string, criterionId: string): FailureBodyKey =>
  `${materialId}|${criterionId}`;

export const failureBodyFamily = atomFamily((key: FailureBodyKey) =>
  atom<Promise<FailureEnvelopeResponse>>(async (get) => {
    const [materialId, criterionId] = key.split("|");
    const material = get(materialsAtom).find((m) => m.id === materialId);
    if (!material) throw new Error(`material '${materialId}' not found`);

    const json = await elamx.compute_failure_envelope(
      JSON.stringify({ material, criterion_id: criterionId, quality: ENVELOPE_QUALITY }),
    );
    return JSON.parse(json) as FailureEnvelopeResponse;
  }),
);

export const loadableFailureBodyFamily = atomFamily((key: FailureBodyKey) =>
  loadableWithLastValue(failureBodyFamily(key)),
);

/** `${materialId}|${criterionId},${criterionId},...` - several at once. */
export const failureBodiesKey = (materialId: string, criterionIds: readonly string[]): string =>
  `${materialId}|${criterionIds.join(",")}`;

/**
 * Several criteria's bodies for one material, in the order asked for.
 *
 * A family over the whole selection rather than one atom per criterion in the
 * component, because the component cannot call a hook per selected criterion -
 * the count changes as the user ticks boxes, and React needs it fixed. Going
 * through one atom moves the variable-length part into the store, where it
 * belongs, and costs nothing: this reads the per-pair atoms above, so ticking
 * a fourth criterion computes the fourth and reuses the three already there.
 */
export const failureBodiesFamily = atomFamily((key: string) =>
  atom<Promise<FailureEnvelopeResponse[]>>(async (get) => {
    const at = key.indexOf("|");
    const materialId = key.slice(0, at);
    const criterionIds = key.slice(at + 1).split(",").filter(Boolean);
    return Promise.all(
      criterionIds.map((id) => get(failureBodyFamily(failureBodyKey(materialId, id)))),
    );
  }),
);

export const loadableFailureBodiesFamily = atomFamily((key: string) =>
  loadableWithLastValue(failureBodiesFamily(key)),
);
