import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { laminateConfigFamily, defaultLaminateConfig } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import {
  cutoutInputFamily,
  cutoutResponseFamily,
  cutoutStorageKey,
  defaultCutoutInput,
} from "./cutoutAtoms";
import { defaultMaterial, type LayerRow } from "../lib/constants";
import type { CutoutInputDto } from "../lib/types";

// Runs the real wasm core. The point is the shape of the request, and in
// particular the tagged `geometry` union: a renamed variant would compile on
// both sides and fail only at runtime.

const ID = "lam-cutout";

function layer(angle: number, id: string): LayerRow {
  return {
    id,
    name: `Lage ${id}`,
    angle,
    thickness: 0.25,
    materialId: "iso",
    criterionId: "puck",
  };
}

/** An isotropic plate, where the hole has a textbook answer. */
function storeWith(input?: Partial<CutoutInputDto>) {
  const store = createStore();
  const e = 70000;
  const nu = 0.3;
  store.set(materialsAtom, [
    {
      ...defaultMaterial(),
      id: "iso",
      e_par: e,
      e_nor: e,
      nue12: nu,
      g: e / (2 * (1 + nu)),
    },
  ]);
  store.set(laminateConfigFamily(ID), {
    ...defaultLaminateConfig(ID, "L", ""),
    layers: [layer(0, "a"), layer(0, "b"), layer(0, "c"), layer(0, "d")],
  });
  store.set(cutoutInputFamily(ID), { ...defaultCutoutInput(), ...input });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  laminateConfigFamily.remove(ID);
  cutoutInputFamily.remove(ID);
  cutoutResponseFamily.remove(ID);
});

describe("the cutout module against the real core", () => {
  it("gets Kirsch's factor of three through the whole stack", async () => {
    // The laminate is 1 mm of isotropic sheet, so a load of 100 N/mm is a
    // stress of 100 MPa and the edge should see three times that.
    const result = await storeWith({
      geometry: { shape: "circular", a: 5 },
      n_x: 100,
    }).get(cutoutResponseFamily(ID));

    expect(result.points).toHaveLength(721);
    expect(result.peak_n_theta / 100).toBeCloseTo(3, 4);
    expect(Math.min(Math.abs(result.peak_n_theta_alpha - 90), Math.abs(result.peak_n_theta_alpha - 270))).toBeLessThan(1);
  });

  it("carries each shape's own fields across the boundary", async () => {
    // An ellipse twice as wide as it is tall, pulled across its width:
    // Inglis gives 1 + 2b/a = 2.
    const ellipse = await storeWith({
      geometry: { shape: "elliptical", a: 10, b: 5 },
      n_x: 100,
    }).get(cutoutResponseFamily(ID));
    expect(ellipse.peak_n_theta / 100).toBeCloseTo(2, 2);

    // And a square, whose shape needs the term count to exist at all.
    const square = await storeWith({
      geometry: { shape: "square", a: 5, terms: 11 },
      n_x: 100,
    }).get(cutoutResponseFamily(ID));
    expect(square.peak_n_theta / 100).toBeGreaterThan(3);
  });

  it("reports the reason rather than a number where the theory breaks down", async () => {
    const store = storeWith({ geometry: { shape: "circular", a: 5 }, n_x: 100 });
    // A quasi-isotropic UNSYMMETRIC stack: two characteristic roots coincide
    // and the coupled solution has nothing to say. eLamX answers 4e12.
    store.set(materialsAtom, [
      { ...defaultMaterial(), id: "iso", e_par: 141000, e_nor: 9340, nue12: 0.35, g: 4500 },
    ]);
    store.set(laminateConfigFamily(ID), {
      ...defaultLaminateConfig(ID, "L", ""),
      layers: [layer(0, "a"), { ...layer(45, "b") }, { ...layer(-45, "c") }, { ...layer(90, "d") }],
    });
    await expect(store.get(cutoutResponseFamily(ID))).rejects.toThrow(/coincide/);
  });
});

describe("a stored input from an older session", () => {
  it("is filled in rather than sent to the core half-formed", () => {
    localStorage.setItem(
      cutoutStorageKey(ID),
      JSON.stringify({ n_x: 250, geometry: "circular" }),
    );
    const input = createStore().get(cutoutInputFamily(ID));
    expect(input.n_x).toBe(250);
    expect(input.geometry).toEqual({ shape: "circular", a: 1 });
    expect(input.values).toBe(721);
  });
});
