// Which variants the comparison surface shows.
//
// A variant is a (laminate, load case) pair, because that is the unit people
// actually compare: the same stack under two loads, or two stacks under the
// same one. Held in memory rather than persisted - a comparison is a question
// being asked right now, not part of the project.
import { atom } from "jotai";

export interface Variant {
  laminateId: string;
  loadCaseId: string;
}

/** Beyond this the columns get too narrow to read on any screen, and the
 *  question being asked is usually a different one ("which of these many" -
 *  that is what the optimisation module is for). */
export const MAX_VARIANTS = 4;

export const comparisonVariantsAtom = atom<Variant[]>([]);

export const addVariantAtom = atom(null, (get, set, variant: Variant) => {
  const current = get(comparisonVariantsAtom);
  if (current.length >= MAX_VARIANTS) return;
  const already = current.some(
    (v) => v.laminateId === variant.laminateId && v.loadCaseId === variant.loadCaseId,
  );
  if (already) return;
  set(comparisonVariantsAtom, [...current, variant]);
});

export const removeVariantAtom = atom(null, (get, set, index: number) => {
  set(
    comparisonVariantsAtom,
    get(comparisonVariantsAtom).filter((_, i) => i !== index),
  );
});
