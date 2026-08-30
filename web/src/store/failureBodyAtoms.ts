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
