// The failure surface of a whole laminate, in load space.
//
// Keyed by the laminate AND the failure definition, because the two surfaces
// are two separate computations and a reader switching between them wants the
// one they already waited for to still be there.
//
// This is by far the most expensive thing the app computes: one criterion
// evaluation per ply, per ply surface, per direction on the sphere - and for
// final failure, per degradation step on top of that. The resolution below is
// therefore a deliberate fraction of the original's 200 x 200, and the module
// lets it be raised.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { loadableWithLastValue } from "../lib/loadable";
import type { LaminateEnvelopeResponse, LaminateFailureKindId } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/**
 * How finely the sphere is swept, by name.
 *
 * `coarse` is what the module opens with: at 40 x 80 it is 3321 directions,
 * which for a four-ply stack is about 27 000 criterion evaluations and comes
 * back in well under a second. `fine` is four times that and is worth the wait
 * once the picture is the one being read rather than one being flipped
 * through.
 */
export const ENVELOPE_RESOLUTIONS = {
  coarse: { alpha_steps: 40, beta_steps: 80 },
  fine: { alpha_steps: 80, beta_steps: 160 },
} as const;

export type EnvelopeResolutionId = keyof typeof ENVELOPE_RESOLUTIONS;

/** `${laminateId}|${kind}|${resolution}`. */
export const laminateEnvelopeKey = (
  laminateId: string,
  kind: LaminateFailureKindId,
  resolution: EnvelopeResolutionId,
): string => `${laminateId}|${kind}|${resolution}`;

export const laminateEnvelopeFamily = atomFamily((key: string) =>
  atom<Promise<LaminateEnvelopeResponse>>(async (get) => {
    const [laminateId, kind, resolution] = key.split("|") as [
      string,
      LaminateFailureKindId,
      EnvelopeResolutionId,
    ];
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const json = await elamx.compute_laminate_envelope(
      JSON.stringify({
        laminate,
        materials,
        input: { kind, ...ENVELOPE_RESOLUTIONS[resolution] },
      }),
    );
    return JSON.parse(json) as LaminateEnvelopeResponse;
  }),
);

export const loadableLaminateEnvelopeFamily = atomFamily((key: string) =>
  loadableWithLastValue(laminateEnvelopeFamily(key)),
);
