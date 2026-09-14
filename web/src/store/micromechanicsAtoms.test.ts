import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { materialsAtom } from "./materialsAtoms";
import {
  dependentMaterialsAtom,
  fibresAtom,
  matricesAtom,
  recomputeMicromechanicsAtom,
} from "./micromechanicsAtoms";
import { defaultFibre, defaultMaterial, defaultMatrix, defaultMicroMechanics } from "../lib/constants";
import type { MaterialDto } from "../lib/types";

// These run the real wasm module (vitest has no worker, so `lib/wasm` falls
// back to loading it in-thread), which is the point: what is being checked is
// that the frontend's idea of a micromechanic material and the core's agree.

function storeWith(materials: MaterialDto[]) {
  const store = createStore();
  store.set(materialsAtom, materials);
  store.set(fibresAtom, [defaultFibre("f1", "Faser")]);
  store.set(matricesAtom, [defaultMatrix("x1", "Matrix")]);
  return store;
}

function derived(): MaterialDto {
  return {
    ...defaultMaterial(),
    // Numbers that cannot survive: whatever comes back was computed.
    e_par: 1,
    e_nor: 1,
    nue12: 1,
    g: 1,
    rho: 1,
    micro: defaultMicroMechanics("f1", "x1"),
  };
}

describe("recomputeMicromechanicsAtom", () => {
  it("fills a derived material from its fibre and matrix", async () => {
    const store = storeWith([derived()]);
    await store.set(recomputeMicromechanicsAtom);

    const [material] = store.get(materialsAtom);
    // The rule of mixtures at phi = 0.6 on the default carbon/epoxy pair.
    expect(material.e_par).toBeCloseTo(230000 * 0.6 + 3400 * 0.4, 6);
    expect(material.rho).toBeCloseTo(1.78e-9 * 0.6 + 1.2e-9 * 0.4, 15);
    expect(material.e_nor).toBeGreaterThan(3400);
    expect(material.e_nor).toBeLessThan(15000);
  });

  it("leaves a plain material alone", async () => {
    const plain = defaultMaterial();
    const store = storeWith([plain]);
    await store.set(recomputeMicromechanicsAtom);
    expect(store.get(materialsAtom)[0]).toEqual(plain);
  });

  it("keeps a property whose model is manual", async () => {
    const material = derived();
    material.micro = { ...defaultMicroMechanics("f1", "x1"), g_model: "manual" };
    material.g = 4321;
    const store = storeWith([material]);
    await store.set(recomputeMicromechanicsAtom);
    expect(store.get(materialsAtom)[0].g).toBe(4321);
  });

  it("settles: a second pass changes nothing", async () => {
    // The effect that drives this reruns whenever the materials change, so a
    // recompute that kept writing would loop forever.
    const store = storeWith([derived()]);
    await store.set(recomputeMicromechanicsAtom);
    const first = store.get(materialsAtom);
    await store.set(recomputeMicromechanicsAtom);
    expect(store.get(materialsAtom)).toBe(first);
  });

  it("leaves the last computed values alone when the fibre is gone", async () => {
    const store = storeWith([derived()]);
    await store.set(recomputeMicromechanicsAtom);
    const computed = store.get(materialsAtom)[0];

    store.set(fibresAtom, []);
    await store.set(recomputeMicromechanicsAtom);
    expect(store.get(materialsAtom)[0]).toEqual(computed);
  });
});

describe("dependentMaterialsAtom", () => {
  it("finds the materials a constituent feeds, and only those", () => {
    const store = storeWith([derived(), defaultMaterial()]);
    const dependents = store.get(dependentMaterialsAtom);
    expect(dependents("f1")).toHaveLength(1);
    expect(dependents("x1")).toHaveLength(1);
    expect(dependents("nobody")).toHaveLength(0);
  });
});
