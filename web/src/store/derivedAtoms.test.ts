import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { cltRequestFamily, laminateRequestFamily, namedLaminateRequestFamily } from "./derivedAtoms";
import { laminateConfigFamily, defaultLaminateConfig } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import { defaultMaterial, type LayerRow } from "../lib/constants";

// Every open module recomputes when the request it reads changes, and jotai
// decides "changed" by reference. These pin down that editing what no result
// depends on - a name, a material no ply uses - leaves the request alone.

const ID = "lam-requests";

function layer(id: string, materialId: string): LayerRow {
  return { id, name: `Lage ${id}`, angle: 0, thickness: 0.25, materialId, criterionId: "puck" };
}

function storeWith() {
  const store = createStore();
  store.set(materialsAtom, [
    { ...defaultMaterial(), id: "used", name: "CFK" },
    { ...defaultMaterial(), id: "unused", name: "GFK" },
  ]);
  store.set(laminateConfigFamily(ID), {
    ...defaultLaminateConfig(ID, "L", ""),
    layers: [layer("a", "used"), layer("b", "used")],
  });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  laminateConfigFamily.remove(ID);
  laminateRequestFamily.remove(ID);
  namedLaminateRequestFamily.remove(ID);
  cltRequestFamily.remove(ID);
});

describe("the calculation request", () => {
  it("is the same object after a name changes", () => {
    const store = storeWith();
    const before = store.get(laminateRequestFamily(ID));
    const clt = store.get(cltRequestFamily(ID));

    const config = store.get(laminateConfigFamily(ID));
    store.set(laminateConfigFamily(ID), {
      ...config,
      name: "Umbenannt",
      layers: config.layers.map((l) => ({ ...l, name: `${l.name}!` })),
      loadCases: config.loadCases.map((c) => ({ ...c, name: "Anders" })),
    });
    store.set(
      materialsAtom,
      store.get(materialsAtom).map((m) => ({ ...m, name: `${m.name} neu` })),
    );

    expect(store.get(laminateRequestFamily(ID))).toBe(before);
    expect(store.get(cltRequestFamily(ID))).toBe(clt);
  });

  it("does not change with a material no ply uses", () => {
    const store = storeWith();
    const before = store.get(laminateRequestFamily(ID));
    expect(Object.keys(before.materials)).toEqual(["used"]);
    store.set(
      materialsAtom,
      store.get(materialsAtom).map((m) => (m.id === "unused" ? { ...m, e_par: 1 } : m)),
    );
    expect(store.get(laminateRequestFamily(ID))).toBe(before);
  });

  it("changes with anything a result depends on", () => {
    const store = storeWith();
    const before = store.get(laminateRequestFamily(ID));
    const config = store.get(laminateConfigFamily(ID));
    store.set(laminateConfigFamily(ID), {
      ...config,
      layers: config.layers.map((l, i) => (i === 0 ? { ...l, angle: 45 } : l)),
    });
    const after = store.get(laminateRequestFamily(ID));
    expect(after).not.toBe(before);
    expect(after.laminate.layers[0].angle).toBe(45);

    store.set(
      materialsAtom,
      store.get(materialsAtom).map((m) => (m.id === "used" ? { ...m, e_par: 1 } : m)),
    );
    expect(store.get(laminateRequestFamily(ID))).not.toBe(after);
  });

  it("keeps the names for what writes them out", () => {
    const store = storeWith();
    const named = store.get(namedLaminateRequestFamily(ID));
    expect(named.laminate.layers[0].name).toBe("Lage a");
    expect(named.materials.unused.name).toBe("GFK");
  });
});
