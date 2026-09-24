import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { materialsAtom } from "./materialsAtoms";
import {
  DEFAULT_BUDGET,
  defaultGeneticParameters,
  defaultOptimizationInput,
  optimizationInputAtom,
  optimizationStateAtom,
  optimizerAtom,
  runOptimizationAtom,
} from "./optimizationAtoms";
import { defaultMaterial } from "../lib/constants";
import { elamx } from "../lib/wasm";

// The search runs on the batch worker now (in this thread under Node, on the
// same evaluator). What must not change is its answer.
describe("the optimisation on the batch worker", () => {
  it("answers exactly what the core's optimize answers", async () => {
    const store = createStore();
    const material = defaultMaterial();
    store.set(materialsAtom, [material]);
    store.set(optimizationInputAtom, defaultOptimizationInput(material.id));
    store.set(optimizerAtom, "sequential");
    await store.set(runOptimizationAtom);
    const state = store.get(optimizationStateAtom);
    expect(state.status).toBe("done");
    const direct = JSON.parse(
      await elamx.optimize(
        JSON.stringify({
          materials: { [material.id]: material },
          input: { ...defaultOptimizationInput(material.id), n_candidates: 10 },
          optimizer: "sequential",
          genetic: defaultGeneticParameters(),
          budget: DEFAULT_BUDGET,
        }),
      ),
    );
    expect(state.result).toEqual(direct);
  });

  it("reports a search the core refuses as failed", async () => {
    const store = createStore();
    const material = defaultMaterial();
    store.set(materialsAtom, [material]);
    store.set(optimizationInputAtom, { ...defaultOptimizationInput(material.id), angles: [] });
    await store.set(runOptimizationAtom);
    expect(store.get(optimizationStateAtom).status).toBe("failed");
  });
});
