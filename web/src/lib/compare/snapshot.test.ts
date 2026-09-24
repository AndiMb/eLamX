import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { compareValues, comparable, directionOf } from "./direction";
import { keyFiguresOf, snapshotCltRequest, takeSnapshot } from "./snapshot";
import { defaultMaterial } from "../constants";
import { buildCltRequest, columnKey, laminateDtoOf, variantResponseFamily } from "../../store/derivedAtoms";
import {
  addLaminateAtom,
  defaultLaminateConfig,
  laminateConfigFamily,
  laminateIdsAtom,
  removeLaminateAtom,
} from "../../store/laminateAtoms";
import { materialsAtom } from "../../store/materialsAtoms";
import {
  addSnapshotAtom,
  comparisonVariantsAtom,
  removeSnapshotAtom,
  snapshotsAtom,
  snapshotVariant,
} from "../../store/comparisonAtoms";
import { elamx } from "../wasm";
import { importProject, exportProject } from "../projectFile";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CltResponse } from "../types";

describe("which way is better", () => {
  it("higher for reserve factors, stiffness, buckling and frequency; lower for mass and deflection", () => {
    expect(compareValues(directionOf("minRf"), 1.4, 1.2)).toBe("better");
    expect(compareValues(directionOf("ex_simple"), 40000, 50000)).toBe("worse");
    expect(compareValues(directionOf("bucklingFactor"), 2, 1)).toBe("better");
    expect(compareValues(directionOf("fundamentalFrequency"), 80, 90)).toBe("worse");
    expect(compareValues(directionOf("areaWeight"), 1e-6, 2e-6)).toBe("better");
    expect(compareValues(directionOf("maxDeflection"), 3, 2)).toBe("worse");
    expect(compareValues(directionOf("failedPlies"), 0, 2)).toBe("better");
  });

  it("says nothing for inputs, rounding noise or a missing value", () => {
    expect(compareValues(directionOf("stack"), 1, 2)).toBe("neutral");
    expect(compareValues(directionOf("minRf"), 1.2, 1.2 * (1 + 1e-12))).toBe("same");
    expect(compareValues(directionOf("minRf"), null, 1)).toBe("neutral");
  });

  it("judges a deflection by its magnitude", () => {
    expect(compareValues(directionOf("maxDeflection"), comparable("maxDeflection", -3), comparable("maxDeflection", 1))).toBe("worse");
  });
});

describe("a snapshot", () => {
  const material = { ...defaultMaterial(), id: "cfk" };

  it("keeps its own copy and computes the same after the laminate is changed and deleted", async () => {
    const store = createStore();
    store.set(materialsAtom, [material, { ...defaultMaterial(), id: "unused", name: "unused" }]);
    const id = store.set(addLaminateAtom, "cfk");
    const config = store.get(laminateConfigFamily(id));
    const loadCase = config.loadCases[0];
    const before = JSON.parse(
      await elamx.compute_clt(JSON.stringify(buildCltRequest(laminateDtoOf(config), { cfk: material }, loadCase))),
    ) as CltResponse;
    const snapshot = takeSnapshot("Stand 1", config, loadCase, store.get(materialsAtom), keyFiguresOf(before));
    // Only the materials the stack uses are copied.
    expect(snapshot.materials.map((m) => m.id)).toEqual(["cfk"]);
    expect(snapshot.key_figures.min_rf).toBeGreaterThan(0);
    store.set(addSnapshotAtom, snapshot);
    expect(store.get(comparisonVariantsAtom)).toContainEqual(snapshotVariant(snapshot.id));

    // The laminate is edited, its material weakened, and then it is deleted.
    store.set(laminateConfigFamily(id), { ...config, layers: config.layers.map((l) => ({ ...l, angle: 45 })) });
    store.set(materialsAtom, [{ ...material, r_par_ten: 1 }]);
    store.set(removeLaminateAtom, id);
    expect(store.get(laminateIdsAtom)).not.toContain(id);

    const now = await store.get(variantResponseFamily(columnKey(snapshotVariant(snapshot.id))));
    expect(now?.layer_results).toEqual(before.layer_results);
    expect(now?.engineering_constants).toEqual(before.engineering_constants);
  });

  it("takes its columns with it when deleted", () => {
    const store = createStore();
    const snapshot = takeSnapshot("S", defaultLaminateConfig("l", "L", "cfk"), defaultLaminateConfig("l", "L", "cfk").loadCases[0], [material], {});
    store.set(addSnapshotAtom, snapshot);
    store.set(removeSnapshotAtom, snapshot.id);
    expect(store.get(snapshotsAtom)).toEqual([]);
    expect(store.get(comparisonVariantsAtom).some((v) => v.snapshotId)).toBe(false);
  });

  it("travels in the file, and so does its comparison column", async () => {
    const reference = readFileSync(
      fileURLToPath(new URL("../../../../elamx-core/core/tests/golden/reference.elamx", import.meta.url)),
      "utf8",
    );
    const opened = await importProject(reference);
    const laminate = opened.laminates[0];
    const snapshot = takeSnapshot("Vorher", laminate, laminate.loadCases[1], opened.materials, { min_rf: 1.5 }, new Date(0));
    const xml = await exportProject({
      ...opened,
      snapshots: [snapshot],
      comparison: [{ laminateId: laminate.id, loadCaseId: laminate.loadCases[0].id }, snapshotVariant(snapshot.id)],
    });
    const reopened = await importProject(xml);
    expect(reopened.snapshots).toEqual([snapshot]);
    expect(reopened.comparison[1]).toEqual(snapshotVariant(snapshot.id));
    expect(reopened.importNotices).toEqual([]);
    // Computable from the file alone.
    const clt = JSON.parse(await elamx.compute_clt(JSON.stringify(snapshotCltRequest(reopened.snapshots![0]))));
    expect(clt.layer_results.length).toBeGreaterThan(0);
    expect(await exportProject(reopened)).toBe(xml);
  });
});
