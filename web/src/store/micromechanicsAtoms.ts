// Fibres, matrices, and keeping the materials built from them up to date.
//
// A fibre and a matrix are not ply materials: they exist only to be combined
// into one, which is why they are their own catalogs rather than entries in
// `materialsAtom`. eLamX keeps them apart the same way, in their own
// `<fibres>` and `<matrices>` sections of the project file.
//
// The five properties a micromechanic material predicts are stored ON the
// material, not computed where they are read. That is the original's own
// arrangement - the file carries the computed numbers - and it is what keeps
// every analysis in the app able to ignore micromechanics entirely. What it
// costs is this module's second job: whenever a fibre, a matrix or a model
// choice changes, the materials that depend on it have to be recomputed.
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import equal from "fast-deep-equal";
import { elamx } from "../lib/wasm";
import { materialsAtom } from "./materialsAtoms";
import type { FibreDto, MatrixMaterialDto, MaterialDto } from "../lib/types";

export const fibresAtom = atomWithStorage<FibreDto[]>("elamx.fibres", []);
export const matricesAtom = atomWithStorage<MatrixMaterialDto[]>("elamx.matrices", []);

/**
 * Recomputes every micromechanic material and writes the result back, or does
 * nothing if nothing moved.
 *
 * The comparison before writing is what stops this from looping: it runs after
 * a material changes, and writing an identical list would make it run again.
 *
 * A material whose fibre or matrix has been deleted makes the core refuse the
 * whole call. It is left alone rather than reset - the numbers it last had are
 * the last ones that meant anything, and the material page says which
 * constituent is missing.
 */
export const recomputeMicromechanicsAtom = atom(null, async (get, set) => {
  const materials = get(materialsAtom);
  if (!materials.some((m) => m.micro)) return;

  const request = JSON.stringify({
    materials,
    fibres: get(fibresAtom),
    matrices: get(matricesAtom),
  });

  let resolved: MaterialDto[];
  try {
    resolved = JSON.parse(await elamx.resolve_micromechanics(request)) as MaterialDto[];
  } catch (error) {
    if (import.meta.env?.DEV) console.error("resolve_micromechanics", error);
    return;
  }

  if (!equal(resolved, materials)) {
    set(materialsAtom, resolved);
  }
});

/** Which materials are built on this fibre or matrix - what a delete has to
 *  warn about, and what a rename is visible in. */
export const dependentMaterialsAtom = atom((get) => {
  const materials = get(materialsAtom);
  return (constituentId: string) =>
    materials.filter(
      (m) => m.micro?.fibre_id === constituentId || m.micro?.matrix_id === constituentId,
    );
});
