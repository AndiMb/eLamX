import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  addVariantAtom,
  comparisonVariantsAtom,
  MAX_VARIANTS,
  removeVariantAtom,
} from "./comparisonAtoms";

const variant = (laminateId: string, loadCaseId: string) => ({ laminateId, loadCaseId });

describe("the comparison's variants", () => {
  it("keeps the order they were added in - the first column is the reference", () => {
    const store = createStore();
    store.set(addVariantAtom, variant("a", "1"));
    store.set(addVariantAtom, variant("b", "1"));
    expect(store.get(comparisonVariantsAtom)).toEqual([variant("a", "1"), variant("b", "1")]);
  });

  it("refuses a duplicate pair, which would compare a column with itself", () => {
    const store = createStore();
    store.set(addVariantAtom, variant("a", "1"));
    store.set(addVariantAtom, variant("a", "1"));
    expect(store.get(comparisonVariantsAtom)).toHaveLength(1);
  });

  it("treats another load case of the same laminate as its own variant", () => {
    const store = createStore();
    store.set(addVariantAtom, variant("a", "1"));
    store.set(addVariantAtom, variant("a", "2"));
    expect(store.get(comparisonVariantsAtom)).toHaveLength(2);
  });

  it("stops at the column limit instead of growing unreadably wide", () => {
    const store = createStore();
    for (let i = 0; i < MAX_VARIANTS + 3; i++) {
      store.set(addVariantAtom, variant("a", String(i)));
    }
    expect(store.get(comparisonVariantsAtom)).toHaveLength(MAX_VARIANTS);
  });

  it("removes by position, so the right column goes", () => {
    const store = createStore();
    store.set(addVariantAtom, variant("a", "1"));
    store.set(addVariantAtom, variant("b", "1"));
    store.set(addVariantAtom, variant("c", "1"));
    store.set(removeVariantAtom, 1);
    expect(store.get(comparisonVariantsAtom)).toEqual([variant("a", "1"), variant("c", "1")]);
  });
});
