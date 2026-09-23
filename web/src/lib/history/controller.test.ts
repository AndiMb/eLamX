import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  checkpointHistory,
  historyAtom,
  historyStep,
  installHistory,
  redoLabel,
  redoProject,
  undoLabel,
  undoProject,
} from "./index";
import { emptyProject, loadProjectAtom, newProjectAtom, projectSnapshotV2Atom } from "../../store/projectAtoms";
import { laminateConfigFamily } from "../../store/laminateAtoms";
import { bucklingInputFamily, bucklingStorageKey, defaultBucklingInput } from "../../store/bucklingAtoms";
import { DEFAULT_LAMINATE_ID } from "../constants";

let clock = 0;
let inField = false;
let stop: (() => void) | null = null;

function setup() {
  localStorage.clear();
  const store = createStore();
  store.set(loadProjectAtom, emptyProject());
  stop = installHistory(store, { now: () => clock, fieldActive: () => inField });
  return store;
}

const lam = DEFAULT_LAMINATE_ID;

function setAngle(store: ReturnType<typeof createStore>, angle: number) {
  const config = store.get(laminateConfigFamily(lam));
  store.set(laminateConfigFamily(lam), {
    ...config,
    layers: config.layers.map((l, i) => (i === 0 ? { ...l, angle } : l)),
  });
}

const angle = (store: ReturnType<typeof createStore>) => store.get(laminateConfigFamily(lam)).layers[0].angle;

describe("die Historie am Store", () => {
  beforeEach(() => {
    clock = 1_000_000;
    inField = false;
  });
  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("nimmt eine Änderung zurück und stellt sie wieder her", () => {
    const store = setup();
    setAngle(store, 30);
    clock += 5000;
    setAngle(store, 60);
    expect(angle(store)).toBe(60);

    expect(undoProject()).toBe(true);
    expect(angle(store)).toBe(30);
    expect(undoProject()).toBe(true);
    expect(angle(store)).toBe(0);
    expect(undoProject()).toBe(false);

    expect(redoProject()).toBe(true);
    expect(redoProject()).toBe(true);
    expect(angle(store)).toBe(60);
    expect(redoProject()).toBe(false);
  });

  it("zeichnet das Zurücksetzen selbst nicht auf", () => {
    const store = setup();
    setAngle(store, 30);
    undoProject();
    const h = store.get(historyAtom)!;
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(1);
  });

  it("macht Tippen in einem Feld zu einem Schritt bis zum Checkpoint", () => {
    const store = setup();
    inField = true;
    setAngle(store, 4);
    clock += 3000;
    setAngle(store, 45);
    checkpointHistory();
    clock += 10;
    setAngle(store, 50);
    expect(store.get(historyAtom)!.past).toHaveLength(2);
    undoProject();
    expect(angle(store)).toBe(45);
    undoProject();
    expect(angle(store)).toBe(0);
  });

  it("benennt einen Schritt mit einem Label und bündelt ihn", () => {
    const store = setup();
    historyStep("Lagen verschoben", () => {
      setAngle(store, 10);
      setAngle(store, 20);
    });
    const h = store.get(historyAtom)!;
    expect(undoLabel(h)).toBe("Lagen verschoben");
    expect(h.past).toHaveLength(1);
    // The next edit is a step of its own, even straight away.
    setAngle(store, 30);
    expect(store.get(historyAtom)!.past).toHaveLength(2);
    undoProject();
    expect(redoLabel(store.get(historyAtom)!)).not.toBe("Lagen verschoben");
  });

  /// The snapshot has to depend on a module input that nothing was stored
  /// for yet, or configuring a module would be invisible to undo.
  it("sieht, wenn ein Modul zum ersten Mal eingerichtet wird", () => {
    const store = setup();
    expect(localStorage.getItem(bucklingStorageKey(lam))).toBeNull();
    store.set(bucklingInputFamily(lam), { ...defaultBucklingInput(), length: 800 });
    expect(store.get(historyAtom)!.past).toHaveLength(1);
    undoProject();
    expect(localStorage.getItem(bucklingStorageKey(lam))).toBeNull();
    expect(store.get(projectSnapshotV2Atom).modules[lam].buckling).toBeNull();
  });

  it("leert die Historie beim Öffnen und bei einem neuen Projekt", () => {
    const store = setup();
    setAngle(store, 30);
    expect(store.get(historyAtom)!.past).toHaveLength(1);
    store.set(loadProjectAtom, emptyProject());
    expect(store.get(historyAtom)!.past).toHaveLength(0);
    expect(undoProject()).toBe(false);

    setAngle(store, 15);
    store.set(newProjectAtom);
    expect(store.get(historyAtom)!.past).toHaveLength(0);
    expect(angle(store)).toBe(0);
  });
});
