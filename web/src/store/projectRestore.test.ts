import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { RESET } from "jotai/utils";
import {
  loadProjectAtom,
  projectFilePathAtom,
  projectNameAtom,
  projectSnapshotAtom,
  projectSnapshotV2Atom,
  restoreProjectAtom,
} from "./projectAtoms";
import { bucklingInputFamily, bucklingStorageKey, defaultBucklingInput } from "./bucklingAtoms";
import { defaultVibrationInput, vibrationInputFamily, vibrationStorageKey } from "./vibrationAtoms";
import { defaultLaminateConfig, laminateConfigFamily, laminateIdsAtom } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import { comparisonVariantsAtom } from "./comparisonAtoms";
import { reportTemplatesAtom } from "./reportAtoms";
import { addStudyAtom, studiesAtom, updateStudyAtom } from "./studyAtoms";
import { describeChange } from "../lib/history";
import { defaultReportTemplate } from "../lib/report/model";
import { OPTIMIZATION_STORAGE_KEY, optimizationInputAtom, defaultOptimizationInput } from "./optimizationAtoms";
import { defaultMaterial } from "../lib/constants";
import type { ProjectSnapshot } from "../lib/projectFile";

// Undo puts back a whole-project snapshot. Two things decide whether that is
// usable: that "this laminate never had a buckling analysis" comes back as
// exactly that, not as a default analysis, and that putting back a snapshot
// touches only what differs - otherwise every undo re-runs every module.

const MATERIAL = { ...defaultMaterial(), id: "m-cfk" };

function project(): ProjectSnapshot {
  return {
    materials: [MATERIAL],
    fibres: [],
    matrices: [],
    laminates: [
      defaultLaminateConfig("lam-a", "A", "m-cfk"),
      defaultLaminateConfig("lam-b", "B", "m-cfk"),
    ],
    bucklings: { "lam-a": { ...defaultBucklingInput(), length: 700 } },
    lastPlyFailures: {},
    pressureVessels: {},
    deformations: {},
    vibrations: {},
    springIns: {},
    cutouts: {},
    extraOptimizations: [],
    version: "1",
    unsupportedSections: [],
    comparison: [{ laminateId: "lam-a", loadCaseId: "x" }],
  };
}

const stored = (key: string) => localStorage.getItem(key) !== null;

function opened() {
  const store = createStore();
  store.set(loadProjectAtom, project());
  return store;
}

describe("ProjectSnapshotV2 und restoreProjectAtom", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hält „nicht eingerichtet“ als null fest", () => {
    const snapshot = opened().get(projectSnapshotV2Atom);
    expect(snapshot.modules["lam-a"].buckling?.length).toBe(700);
    expect(snapshot.modules["lam-b"].buckling).toBeNull();
    expect(snapshot.modules["lam-a"].vibration).toBeNull();
    expect(snapshot.optimization.input).toBeNull();
    expect(snapshot.comparison).toEqual([{ laminateId: "lam-a", loadCaseId: "x" }]);
  });

  it("nimmt Report-Vorlagen in den Stand auf und bringt sie zurück", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);
    expect(before.reportTemplates).toEqual([]);
    store.set(reportTemplatesAtom, [{ ...defaultReportTemplate(), name: "Prüfbericht" }]);
    expect(store.get(projectSnapshotV2Atom).reportTemplates?.[0].name).toBe("Prüfbericht");
    store.set(restoreProjectAtom, before);
    expect(store.get(reportTemplatesAtom)).toEqual([]);
  });

  it("nimmt Studien in den Stand auf, benennt die Änderung und bringt sie zurück", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);
    expect(before.studies).toEqual([]);
    const id = store.set(addStudyAtom, { kind: "sweep", laminateId: "lam-a" });
    const added = store.get(projectSnapshotV2Atom);
    expect(added.studies?.map((s) => s.id)).toEqual([id]);
    const study = store.get(studiesAtom)[0];
    store.set(updateStudyAtom, { ...study, name: "Winkelstudie" });
    const renamed = store.get(projectSnapshotV2Atom);
    // One study changed: a step of its own, named after it.
    expect(describeChange(added, renamed).path).toBe(`study:${id}`);
    store.set(restoreProjectAtom, before);
    expect(store.get(studiesAtom)).toEqual([]);
    store.set(restoreProjectAtom, renamed);
    expect(store.get(studiesAtom)[0].name).toBe("Winkelstudie");
  });

  it("bringt den Stand zurück, auch „nicht eingerichtet“ und gelöschte Laminate", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);

    // A handful of edits of every kind.
    store.set(laminateConfigFamily("lam-a"), { ...before.laminates[0], name: "A2" });
    store.set(bucklingInputFamily("lam-a"), RESET);
    store.set(vibrationInputFamily("lam-b"), defaultVibrationInput());
    store.set(optimizationInputAtom, defaultOptimizationInput("m-cfk"));
    store.set(laminateIdsAtom, ["lam-b"]);
    store.set(comparisonVariantsAtom, []);
    expect(stored(bucklingStorageKey("lam-a"))).toBe(false);
    expect(stored(vibrationStorageKey("lam-b"))).toBe(true);

    store.set(restoreProjectAtom, before);

    expect(store.get(projectSnapshotV2Atom)).toEqual(before);
    // `hasStoredInput` reads storage, so storage has to say the same.
    expect(stored(bucklingStorageKey("lam-a"))).toBe(true);
    expect(stored(vibrationStorageKey("lam-b"))).toBe(false);
    expect(stored(OPTIMIZATION_STORAGE_KEY)).toBe(false);
    // And the file a save would write agrees.
    const file = store.get(projectSnapshotAtom);
    expect(Object.keys(file.bucklings)).toEqual(["lam-a"]);
    expect(file.vibrations).toEqual({});
    expect(file.optimization).toBeUndefined();
  });

  it("entfernt ein Laminat, das es im Stand noch nicht gab, samt seiner Eingaben", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);
    store.set(laminateConfigFamily("lam-c"), defaultLaminateConfig("lam-c", "C", "m-cfk"));
    store.set(bucklingInputFamily("lam-c"), defaultBucklingInput());
    store.set(laminateIdsAtom, ["lam-a", "lam-b", "lam-c"]);

    store.set(restoreProjectAtom, before);
    expect(store.get(laminateIdsAtom)).toEqual(["lam-a", "lam-b"]);
    expect(stored(bucklingStorageKey("lam-c"))).toBe(false);
  });

  it("setzt nur die Atome, die sich unterscheiden", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);
    store.set(laminateConfigFamily("lam-a"), { ...before.laminates[0], offset: 0.5 });

    // Checked by identity rather than with subscriptions: subscribing mounts
    // the storage atoms, and in the test environment some of them re-read a
    // storage that is not there on mount, which is a write of its own.
    const current = () => ({
      materials: store.get(materialsAtom),
      ids: store.get(laminateIdsAtom),
      lamB: store.get(laminateConfigFamily("lam-b")),
      bucklingA: store.get(bucklingInputFamily("lam-a")),
      comparison: store.get(comparisonVariantsAtom),
      optimization: store.get(optimizationInputAtom),
    });
    const untouched = current();
    const lamA = store.get(laminateConfigFamily("lam-a"));

    store.set(restoreProjectAtom, before);
    const after = current();
    for (const key of Object.keys(untouched) as (keyof typeof untouched)[]) {
      expect(after[key], key).toBe(untouched[key]);
    }
    expect(store.get(laminateConfigFamily("lam-a"))).not.toBe(lamA);
    expect(store.get(laminateConfigFamily("lam-a")).offset).toBe(before.laminates[0].offset);
  });

  /// An undo changes the project, not where it came from.
  it("lässt Dateipfad und Projektnamen in Ruhe", () => {
    const store = opened();
    const before = store.get(projectSnapshotV2Atom);
    store.set(projectFilePathAtom, "C:/p.elamx");
    store.set(projectNameAtom, "p");
    store.set(restoreProjectAtom, before);
    expect(store.get(projectFilePathAtom)).toBe("C:/p.elamx");
    expect(store.get(projectNameAtom)).toBe("p");
  });
});
