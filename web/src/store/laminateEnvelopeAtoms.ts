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
import { activeLoadCaseFamily, type LoadCase } from "./laminateAtoms";
import type { LaminateEnvelopeRay } from "../lib/generated/LaminateEnvelopeRay";

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
      key,
    );
    return JSON.parse(json) as LaminateEnvelopeResponse;
  }),
);

export const loadableLaminateEnvelopeFamily = atomFamily((key: string) =>
  loadableWithLastValue(laminateEnvelopeFamily(key)),
);

/** Whether the active load case can be drawn in the surface's space (F2.4).
 *
 *  The surface lives in (n_x, n_y, n_xy) and nothing else. A load case with a
 *  moment or a prescribed strain is a point somewhere else, and projecting it
 *  onto the membrane space would draw a load that is not the one computed -
 *  so there is no marker then, only the reason. A temperature or moisture
 *  change the surface does not know either, but the mechanical load is still
 *  its point, so that one is drawn with a note. */
export type RayCase =
  | { kind: "ray"; load: [number, number, number]; hygrothermal: boolean; loadCase: LoadCase }
  | { kind: "unsupported"; reason: "moments" | "strains" | "zero"; loadCase: LoadCase };

export function rayCaseOf(loadCase: LoadCase): RayCase {
  if (loadCase.useStrain.some(Boolean)) return { kind: "unsupported", reason: "strains", loadCase };
  if (loadCase.dofValues.slice(3).some((v) => v !== 0)) {
    return { kind: "unsupported", reason: "moments", loadCase };
  }
  const load = loadCase.dofValues.slice(0, 3) as [number, number, number];
  if (load.every((v) => v === 0)) return { kind: "unsupported", reason: "zero", loadCase };
  return { kind: "ray", load, hygrothermal: loadCase.deltaT !== 0 || loadCase.deltaH !== 0, loadCase };
}

/** `${laminateId}|${kind}`: the ray does not depend on the grid resolution. */
export const laminateEnvelopeRayKey = (laminateId: string, kind: LaminateFailureKindId): string =>
  `${laminateId}|${kind}`;

export const laminateEnvelopeRayFamily = atomFamily((key: string) =>
  atom<Promise<{ ray: LaminateEnvelopeRay | null; rayCase: RayCase }>>(async (get) => {
    const [laminateId, kind] = key.split("|") as [string, LaminateFailureKindId];
    const rayCase = rayCaseOf(get(activeLoadCaseFamily(laminateId)));
    if (rayCase.kind !== "ray") return { ray: null, rayCase };
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const json = await elamx.compute_laminate_envelope_ray(
      JSON.stringify({ laminate, materials, kind, load: rayCase.load }),
      `ray:${key}`,
    );
    return { ray: JSON.parse(json) as LaminateEnvelopeRay, rayCase };
  }),
);

export const loadableLaminateEnvelopeRayFamily = atomFamily((key: string) =>
  loadableWithLastValue(laminateEnvelopeRayFamily(key)),
);
