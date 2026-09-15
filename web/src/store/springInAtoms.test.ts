import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { laminateConfigFamily, defaultLaminateConfig } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import {
  defaultSpringInInput,
  springInInputFamily,
  springInResponseFamily,
  springInStorageKey,
} from "./springInAtoms";
import { defaultMaterial, type LayerRow } from "../lib/constants";
import type { SpringInInputDto } from "../lib/types";

// Runs the real wasm core (vitest has no worker, so `lib/wasm` loads it
// in-thread). The reason to do it here rather than stub a number is the one
// thing this module cannot check on its own: that the shape of the input the
// frontend builds - and in particular the tagged `model` union - is the shape
// the Rust side deserialises. A renamed variant would compile on both sides
// and fail only at runtime.

const ID = "lam-spring";

function layer(angle: number): LayerRow {
  return {
    id: `l${angle}`,
    name: `Lage ${angle}`,
    angle,
    thickness: 0.125,
    materialId: "m",
    criterionId: "puck",
  };
}

/** A symmetric unidirectional stack, whose expansion in x IS the ply's own. */
function storeWith(input?: Partial<SpringInInputDto>) {
  const store = createStore();
  store.set(materialsAtom, [
    { ...defaultMaterial(), id: "m", alpha_t_par: 1e-6, alpha_t_nor: 3e-5 },
  ]);
  store.set(laminateConfigFamily(ID), {
    ...defaultLaminateConfig(ID, "L", ""),
    layers: [layer(0), layer(0), layer(0), layer(0)],
  });
  store.set(springInInputFamily(ID), { ...defaultSpringInInput(), ...input });
  return store;
}

beforeEach(() => {
  localStorage.clear();
  laminateConfigFamily.remove(ID);
  springInInputFamily.remove(ID);
  springInResponseFamily.remove(ID);
});

describe("the spring-in module against the real core", () => {
  it("computes the amount a right-angled carbon corner closes by", async () => {
    const result = await storeWith().get(springInResponseFamily(ID));

    // The same worked example the Rust unit test carries: alpha_x is the ply's
    // 1e-6, the cure runs from 180 to 25, and Radford's formula gives 0.4064
    // degrees on a 90 degree bend.
    expect(result.alpha_circumferential).toBeCloseTo(1e-6, 12);
    expect(result.delta_t).toBe(-155);
    expect(result.delta_angle).toBeCloseTo(0.40644, 5);
    expect(result.final_angle).toBeCloseTo(90.40644, 5);
    expect(result.thickness).toBeCloseTo(0.5, 12);
  });

  it("carries the enhanced model's two strains across the boundary", async () => {
    const result = await storeWith({
      model: { model: "enhanced_radford", eps_circumferential: 0, eps_thickness: -0.01 },
    }).get(springInResponseFamily(ID));

    // Cure shrinkage adds to the thermal part rather than cancelling it - the
    // sign that eLamX's own field labels would get backwards.
    expect(result.chemical_angle).toBeCloseTo((90 * 0.01) / 0.99, 10);
    expect(result.delta_angle).toBeGreaterThan(result.thermal_angle);
  });

  it("reports the reason rather than a number when the model does not apply", async () => {
    const store = storeWith();
    store.set(laminateConfigFamily(ID), {
      ...defaultLaminateConfig(ID, "L", ""),
      layers: [layer(0), layer(45)],
    });
    await expect(store.get(springInResponseFamily(ID))).rejects.toThrow(/symmetric laminate/);
  });
});

describe("a stored input from an older session", () => {
  it("is filled in rather than sent to the core half-formed", () => {
    // What a session would hold if the model had been stored as a bare string,
    // or a field added since. Both come back as the default, and `model` in
    // particular has to be an object or deserialisation fails on the Rust side
    // with a message about an unknown variant.
    localStorage.setItem(
      springInStorageKey(ID),
      JSON.stringify({ angle: 120, model: "simple_radford" }),
    );
    const input = createStore().get(springInInputFamily(ID));
    expect(input.angle).toBe(120);
    expect(input.model).toEqual({ model: "simple_radford" });
    expect(input.hardening_temp).toBe(180);
  });
});
