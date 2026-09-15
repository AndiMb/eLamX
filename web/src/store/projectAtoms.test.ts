import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { loadProjectAtom, projectSnapshotAtom } from "./projectAtoms";
import {
  OPTIMIZATION_STORAGE_KEY,
  defaultOptimizationInput,
  optimizationMetaAtom,
  optimizerAtom,
} from "./optimizationAtoms";
import { defaultMaterial } from "../lib/constants";
import type { ProjectSnapshot } from "../lib/projectFile";

// The optimisation is the only module that hangs off the project rather than
// off a laminate, so it is the only one whose state does not travel with a
// laminate id. What has to hold is the same thing: what an opened file put
// into the module comes back out when the project is saved.

const MATERIAL = { ...defaultMaterial(), id: "m-cfk" };

function emptySnapshot(): ProjectSnapshot {
  return {
    materials: [MATERIAL],
    fibres: [],
    matrices: [],
    laminates: [],
    bucklings: {},
    lastPlyFailures: {},
    pressureVessels: {},
    deformations: {},
    vibrations: {},
    springIns: {},
    cutouts: {},
    extraOptimizations: [],
    version: "1",
    unsupportedSections: [],
  };
}

describe("das Projekt und die Optimierung", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("schreibt keine Optimierung in ein Projekt, in dem nie eine eingerichtet wurde", () => {
    const store = createStore();
    store.set(loadProjectAtom, emptySnapshot());
    expect(store.get(projectSnapshotAtom).optimization).toBeUndefined();
  });

  it("führt eine geöffnete Optimierung in das Modul und wieder zurück in die Datei", () => {
    const store = createStore();
    const input = {
      ...defaultOptimizationInput("m-cfk"),
      angles: [0, 30, -30, 90],
      thickness: 0.25,
      symmetric: true,
    };
    store.set(loadProjectAtom, {
      ...emptySnapshot(),
      optimization: { name: "Aus der Datei", optimizer: "genetic", angle_type: 3, input },
      // Everything past the first is carried, not shown: the module has room
      // for one search.
      extraOptimizations: [{ name: "Zweite", optimizer: "todoroki", angle_type: 0, input }],
    });

    expect(store.get(optimizerAtom)).toBe("genetic");
    expect(store.get(optimizationMetaAtom)).toEqual({ name: "Aus der Datei", angleType: 3 });

    const saved = store.get(projectSnapshotAtom);
    expect(saved.optimization).toEqual({
      name: "Aus der Datei",
      optimizer: "genetic",
      angle_type: 3,
      input,
    });
    expect(saved.extraOptimizations).toHaveLength(1);
  });

  it("ersetzt das Material einer Optimierung, das es im Projekt nicht mehr gibt", () => {
    const store = createStore();
    store.set(loadProjectAtom, {
      ...emptySnapshot(),
      optimization: {
        name: "Optimierung",
        optimizer: "sequential",
        angle_type: 0,
        // A project can be saved after the material a search named was
        // deleted; what belongs in the file is what would be searched with.
        input: defaultOptimizationInput("gibt-es-nicht"),
      },
      extraOptimizations: [],
    });

    expect(store.get(projectSnapshotAtom).optimization?.input.material_id).toBe("m-cfk");
  });

  it("merkt sich, dass eine Optimierung eingerichtet wurde, an ihrem Speicherschlüssel", () => {
    const store = createStore();
    store.set(loadProjectAtom, emptySnapshot());
    expect(localStorage.getItem(OPTIMIZATION_STORAGE_KEY)).toBeNull();

    store.set(loadProjectAtom, {
      ...emptySnapshot(),
      optimization: {
        name: "Optimierung",
        optimizer: "sequential",
        angle_type: 0,
        input: defaultOptimizationInput("m-cfk"),
      },
      extraOptimizations: [],
    });
    expect(localStorage.getItem(OPTIMIZATION_STORAGE_KEY)).not.toBeNull();
  });
});
