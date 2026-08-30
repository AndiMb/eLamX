import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  activeLoadCaseFamily,
  addLoadCaseAtom,
  defaultLaminateConfig,
  laminateConfigFamily,
  laminateStorageKey,
  loadCasesOf,
  removeLoadCaseAtom,
  selectedLoadCaseFamily,
  updateActiveLoadCaseAtom,
} from "./laminateAtoms";

const ID = "lam-test";

beforeEach(() => {
  localStorage.clear();
  laminateConfigFamily.remove(ID);
  selectedLoadCaseFamily.remove(ID);
  activeLoadCaseFamily.remove(ID);
});

describe("the migration from the single-load-case shape", () => {
  it("turns the four load fields into the first load case", () => {
    // What a session stored before load cases existed.
    localStorage.setItem(
      laminateStorageKey(ID),
      JSON.stringify({
        id: ID,
        name: "Alt",
        layers: [],
        symmetric: false,
        withMiddleLayer: false,
        invertZ: false,
        offset: 0,
        dofValues: [1234, 0, 0, 0, 0, 0],
        useStrain: [false, true, false, false, false, false],
        deltaT: -50,
        deltaH: 0.3,
        carryOver: { calculationName: "Berechnung", bucklingName: "Beulen" },
      }),
    );

    const store = createStore();
    const config = store.get(laminateConfigFamily(ID));
    const cases = loadCasesOf(config);

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe("Berechnung");
    expect(cases[0].dofValues).toEqual([1234, 0, 0, 0, 0, 0]);
    expect(cases[0].useStrain[1]).toBe(true);
    expect(cases[0].deltaT).toBe(-50);
    expect(cases[0].deltaH).toBe(0.3);
    // The other module's carry-over survives; the load case's own name does
    // not need to be carried any more, because it is now stored on the case.
    expect(config.carryOver?.bucklingName).toBe("Beulen");
    expect((config.carryOver as { calculationName?: string }).calculationName).toBeUndefined();
  });

  it("recovers load cases the old build could only carry through", () => {
    localStorage.setItem(
      laminateStorageKey(ID),
      JSON.stringify({
        ...defaultLaminateConfig(ID, "Alt", ""),
        loadCases: undefined,
        dofValues: [100, 0, 0, 0, 0, 0],
        useStrain: [false, false, false, false, false, false],
        deltaT: 0,
        deltaH: 0,
        carryOver: {
          calculationName: "Zug",
          extraCalculations: [
            {
              name: "Schub",
              loads: { n_x: 0, n_y: 0, n_xy: 250, m_x: 0, m_y: 0, m_xy: 0, delta_t: -20, delta_h: 0 },
              strains: { epsilon_x: 0, epsilon_y: 0, gamma_xy: 0, kappa_x: 0, kappa_y: 0, kappa_xy: 0 },
              use_strain: [false, false, false, false, false, false],
            },
          ],
        },
      }),
    );

    const cases = loadCasesOf(createStore().get(laminateConfigFamily(ID)));
    expect(cases.map((c) => c.name)).toEqual(["Zug", "Schub"]);
    expect(cases[1].dofValues[2]).toBe(250);
    expect(cases[1].deltaT).toBe(-20);
  });

  it("leaves an already-migrated laminate untouched", () => {
    const current = defaultLaminateConfig(ID, "Neu", "");
    localStorage.setItem(laminateStorageKey(ID), JSON.stringify(current));
    const config = createStore().get(laminateConfigFamily(ID));
    expect(config.loadCases).toHaveLength(1);
    expect(config.loadCases[0].id).toBe(current.loadCases[0].id);
  });
});

describe("editing load cases", () => {
  it("writes only into the active one", () => {
    const store = createStore();
    store.set(laminateConfigFamily(ID), defaultLaminateConfig(ID, "L", ""));

    const first = store.get(activeLoadCaseFamily(ID));
    store.set(addLoadCaseAtom, ID);
    const second = store.get(activeLoadCaseFamily(ID));
    expect(second.id).not.toBe(first.id);
    // A new case starts as a copy of the one on screen.
    expect(second.dofValues).toEqual(first.dofValues);

    store.set(updateActiveLoadCaseAtom, {
      laminateId: ID,
      update: (c) => ({ ...c, dofValues: [7, 0, 0, 0, 0, 0] }),
    });

    const cases = loadCasesOf(store.get(laminateConfigFamily(ID)));
    expect(cases.find((c) => c.id === second.id)?.dofValues[0]).toBe(7);
    expect(cases.find((c) => c.id === first.id)?.dofValues[0]).toBe(first.dofValues[0]);
  });

  it("keeps the last load case, since a laminate without one shows nothing", () => {
    const store = createStore();
    store.set(laminateConfigFamily(ID), defaultLaminateConfig(ID, "L", ""));
    const only = store.get(activeLoadCaseFamily(ID));

    store.set(removeLoadCaseAtom, { laminateId: ID, loadCaseId: only.id });
    expect(loadCasesOf(store.get(laminateConfigFamily(ID)))).toHaveLength(1);
  });

  it("moves the selection off a deleted case rather than pointing at nothing", () => {
    const store = createStore();
    store.set(laminateConfigFamily(ID), defaultLaminateConfig(ID, "L", ""));
    const first = store.get(activeLoadCaseFamily(ID));
    store.set(addLoadCaseAtom, ID);
    const second = store.get(activeLoadCaseFamily(ID));

    store.set(removeLoadCaseAtom, { laminateId: ID, loadCaseId: second.id });
    expect(store.get(activeLoadCaseFamily(ID)).id).toBe(first.id);
  });

  it("falls back to the first case when the selection names one that is gone", () => {
    const store = createStore();
    store.set(laminateConfigFamily(ID), defaultLaminateConfig(ID, "L", ""));
    store.set(selectedLoadCaseFamily(ID), "no-such-case");
    expect(store.get(activeLoadCaseFamily(ID)).id).toBe(
      loadCasesOf(store.get(laminateConfigFamily(ID)))[0].id,
    );
  });
});
