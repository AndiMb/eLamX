// Which variants the comparison surface shows.
//
// A variant is a (laminate, load case) pair, because that is the unit people
// actually compare: the same stack under two loads, or two stacks under the
// same one.
//
// Persisted, after all. The first version treated a comparison as a question
// asked right now rather than part of the project, and every reload emptied
// it - which is exactly what the spreadsheet this surface exists to beat does
// not do. It stays in browser storage rather than in the `.elamx` file: the
// file format has no place for it, and a comparison is about the session, not
// something to hand to eLamX 3.x.
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

export interface Variant {
  laminateId: string;
  loadCaseId: string;
}

/** Beyond this the columns get too narrow to read on any screen, and the
 *  question being asked is usually a different one ("which of these many" -
 *  that is what the optimisation module is for). */
export const MAX_VARIANTS = 4;

// An explicit storage rather than the default one: jotai's default reaches for
// `window` and quietly becomes a no-op without it, which is exactly the
// environment the tests run in - see src/test/setup.ts.
const storage = createJSONStorage<Variant[]>(() => localStorage);

export const comparisonVariantsAtom = atomWithStorage<Variant[]>("elamx.comparison", [], storage, {
  // Without this the page paints an empty comparison first and fills it a tick
  // later, which reads as "your columns are gone" on every reload.
  getOnInit: true,
});

/** Whether the narrow layout shows every row or only the headline ones. */
export const compareShowAllRowsAtom = atom(false);

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
