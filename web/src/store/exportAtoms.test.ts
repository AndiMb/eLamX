import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { laminateConfigFamily, defaultLaminateConfig, laminateIdsAtom } from "./laminateAtoms";
import { materialsAtom } from "./materialsAtoms";
import {
  deckFamily,
  defaultSolverSettings,
  exportOptionsAtom,
  exportTargetAtom,
  solverSettingsAtom,
} from "./exportAtoms";
import { defaultMaterial, type LayerRow } from "../lib/constants";

// Runs the real wasm core, like the other store tests here. The point is the
// request shape - the target is a TAGGED union, and a tag that does not match
// the Rust enum fails at runtime rather than at build time, which is exactly
// the class of mistake a type-checked front end cannot catch on its own.

const ID = "lam-export";

function layer(angle: number, id: string): LayerRow {
  return {
    id,
    name: `Lage ${id}`,
    angle,
    thickness: 0.25,
    materialId: "cfk",
    criterionId: "puck",
  };
}

function storeWithLaminate() {
  const store = createStore();
  store.set(materialsAtom, [
    {
      ...defaultMaterial(),
      id: "cfk",
      name: "CFK",
      e_par: 141000,
      e_nor: 9340,
      nue12: 0.35,
      g: 4500,
      rho: 1.7e-9,
    },
  ]);
  store.set(laminateConfigFamily(ID), {
    ...defaultLaminateConfig(ID, "Export", "cfk"),
    layers: [layer(0, "a"), layer(90, "b")],
  });
  store.set(laminateIdsAtom, [ID]);
  return store;
}

describe("der FE-Export", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("baut aus den Einstellungen die Variante, die der Kern erwartet", () => {
    const store = createStore();
    expect(store.get(exportTargetAtom)).toEqual({ solver: "nastran", format: "small" });

    store.set(solverSettingsAtom, { ...defaultSolverSettings(), solver: "abaqus" });
    expect(store.get(exportTargetAtom)).toEqual({ solver: "abaqus" });

    store.set(solverSettingsAtom, {
      ...defaultSolverSettings(),
      solver: "ls_dyna",
      lsDynaCard: "mat54",
      mass: 1000,
      length: 0.001,
      time: 1,
    });
    expect(store.get(exportTargetAtom)).toEqual({
      solver: "ls_dyna",
      card: "mat54",
      mass: 1000,
      length: 0.001,
      time: 1,
    });
  });

  /// Eine gespeicherte Einstellung aus einer Zeit vor einem neuen Feld darf die
  /// Anfrage nicht unvollständig machen - deshalb wird sie über den Vorgaben
  /// zusammengesetzt.
  it("ergänzt eine unvollständig gespeicherte Einstellung aus den Vorgaben", () => {
    const store = createStore();
    store.set(solverSettingsAtom, { solver: "ansys" } as never);
    expect(store.get(exportTargetAtom)).toEqual({ solver: "ansys", layout: "real" });
  });

  it("schreibt für jeden Solver ein Deck, das der Kern gebaut hat", async () => {
    const store = storeWithLaminate();

    const nastran = await store.get(deckFamily(ID));
    expect(nastran).toContain("MAT8");
    expect(nastran).toContain("PCOMP");

    store.set(solverSettingsAtom, { ...defaultSolverSettings(), solver: "abaqus" });
    const abaqus = await store.get(deckFamily(ID));
    expect(abaqus).toContain("*SHELL GENERAL SECTION, ELSET=SET1, COMPOSITE");
    expect(abaqus).toContain("0.25, , mat1, 90.0");

    store.set(solverSettingsAtom, { ...defaultSolverSettings(), solver: "ansys" });
    expect(await store.get(deckFamily(ID))).toContain("RMODIF,1,13,1,0.0,0.25");

    store.set(solverSettingsAtom, { ...defaultSolverSettings(), solver: "ls_dyna" });
    const lsDyna = await store.get(deckFamily(ID));
    expect(lsDyna).toContain("*MAT_LAMINATED_COMPOSITE_FABRIC");
    expect(lsDyna).toContain("*INTEGRATION_SHELL");
  });

  it("nimmt die Ausgabeoptionen in das Deck auf", async () => {
    const store = storeWithLaminate();
    store.set(solverSettingsAtom, { ...defaultSolverSettings(), solver: "abaqus" });
    store.set(exportOptionsAtom, { hygrothermal: true, strength: true, offset: "bot" });

    const deck = await store.get(deckFamily(ID));
    expect(deck).toContain("*FAIL STRESS");
    expect(deck).toContain("*EXPANSION,TYPE=ORTHO");
    expect(deck).toContain(" OFFSET=SNEG");
  });
});
