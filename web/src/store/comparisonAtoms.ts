// Which variants the comparison surface shows.
//
// A variant is a (laminate, load case) pair, because that is the unit people
// actually compare: the same stack under two loads, or two stacks under the
// same one.
//
// Persisted, after all. The first version treated a comparison as a question
// asked right now rather than part of the project, and every reload emptied
// it - which is exactly what the spreadsheet this surface exists to beat does
// not do. It is in the `.elamx` file too, in the `<webExtension>` element
// eLamX 3.x carries without reading (see lib/projectFile.ts), so a comparison
// set up for a project travels with it.
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { Snapshot } from "../lib/compare/snapshot";

export interface Variant {
  laminateId: string;
  loadCaseId: string;
  /** Set when the column is a snapshot rather than a laminate of the project
   *  (F4.3, O6); the two ids above are empty then - as in the file. */
  snapshotId?: string;
}

/** A column that is a snapshot. */
export function snapshotVariant(snapshotId: string): Variant {
  return { laminateId: "", loadCaseId: "", snapshotId };
}

/** Two columns showing the same thing. */
export function sameVariant(a: Variant, b: Variant): boolean {
  return a.snapshotId || b.snapshotId
    ? a.snapshotId === b.snapshotId
    : a.laminateId === b.laminateId && a.loadCaseId === b.loadCaseId;
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
  const already = current.some((v) => sameVariant(v, variant));
  if (already) return;
  set(comparisonVariantsAtom, [...current, variant]);
});

export const removeVariantAtom = atom(null, (get, set, index: number) => {
  set(
    comparisonVariantsAtom,
    get(comparisonVariantsAtom).filter((_, i) => i !== index),
  );
});

// ---------------------------------------------------------------------------
// Snapshots (F4.3): pinned states, a second source of comparison columns.
// ---------------------------------------------------------------------------

export const SNAPSHOTS_STORAGE_KEY = "elamx.snapshots";

export const snapshotsAtom = atomWithStorage<Snapshot[]>(
  SNAPSHOTS_STORAGE_KEY,
  [],
  createJSONStorage<Snapshot[]>(() => localStorage),
  { getOnInit: true },
);

/** Keeps a snapshot, and shows it as a column where there is room. */
export const addSnapshotAtom = atom(null, (get, set, snapshot: Snapshot) => {
  set(snapshotsAtom, [...get(snapshotsAtom), snapshot]);
  set(addVariantAtom, snapshotVariant(snapshot.id));
});

export const renameSnapshotAtom = atom(null, (get, set, { id, name }: { id: string; name: string }) => {
  set(
    snapshotsAtom,
    get(snapshotsAtom).map((s) => (s.id === id ? { ...s, name } : s)),
  );
});

/** Deletes a snapshot and every column showing it. */
export const removeSnapshotAtom = atom(null, (get, set, id: string) => {
  set(
    snapshotsAtom,
    get(snapshotsAtom).filter((s) => s.id !== id),
  );
  set(
    comparisonVariantsAtom,
    get(comparisonVariantsAtom).filter((v) => v.snapshotId !== id),
  );
});
