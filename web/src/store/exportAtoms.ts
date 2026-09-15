// Writing a laminate out for a finite-element solver.
//
// The options are stored ONCE, not per laminate: eLamX keeps them in its own
// preferences, and someone exporting a second stack for the same solver wants
// the same settings without retyping them. The deck itself is derived, like
// every other result here - there is no "generate" button, the preview is just
// what would be downloaded.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage, selectAtom } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { ExportOptionsDto, ExportTargetDto, SolverId } from "../lib/types";
import { elamx } from "../lib/wasm";
import { laminateRequestFamily } from "./derivedAtoms";

/** eLamX's own starting point: the middle plane, no expansion, no strengths. */
export function defaultExportOptions(): ExportOptionsDto {
  return { hygrothermal: false, strength: false, offset: "mid" };
}

/**
 * The per-solver settings, all of them at once.
 *
 * Kept as one object rather than one atom per solver so that switching solvers
 * keeps what was set for the others - the LS-DYNA unit multipliers in
 * particular are worth typing once.
 */
export interface SolverSettings {
  solver: SolverId;
  nastranFormat: "small" | "large" | "free";
  ansysLayout: "section" | "real";
  lsDynaCard: "mat22" | "mat54" | "mat55" | "mat58";
  /** The multipliers that take eLamX's N/mm/t into the deck's own units. */
  mass: number;
  length: number;
  time: number;
}

export function defaultSolverSettings(): SolverSettings {
  return {
    solver: "nastran",
    nastranFormat: "small",
    // eLamX's own defaults, both of them the older of the two choices.
    ansysLayout: "real",
    lsDynaCard: "mat58",
    mass: 1,
    length: 1,
    time: 1,
  };
}

export const EXPORT_OPTIONS_KEY = "elamx.export.options";
export const EXPORT_SOLVER_KEY = "elamx.export.solver";

export const exportOptionsAtom = atomWithStorage<ExportOptionsDto>(
  EXPORT_OPTIONS_KEY,
  defaultExportOptions(),
  createJSONStorage<ExportOptionsDto>(() => localStorage),
  { getOnInit: true },
);

export const solverSettingsAtom = atomWithStorage<SolverSettings>(
  EXPORT_SOLVER_KEY,
  defaultSolverSettings(),
  createJSONStorage<SolverSettings>(() => localStorage),
  { getOnInit: true },
);

/** The settings as the core's tagged union. */
export const exportTargetAtom = atom<ExportTargetDto>((get) => {
  const settings = { ...defaultSolverSettings(), ...get(solverSettingsAtom) };
  switch (settings.solver) {
    case "nastran":
      return { solver: "nastran", format: settings.nastranFormat };
    case "abaqus":
      return { solver: "abaqus" };
    case "ansys":
      return { solver: "ansys", layout: settings.ansysLayout };
    case "ls_dyna":
      return {
        solver: "ls_dyna",
        card: settings.lsDynaCard,
        mass: settings.mass,
        length: settings.length,
        time: settings.time,
      };
  }
});

/** The file name a deck is offered under, by solver. */
export const EXPORT_EXTENSION: Record<SolverId, string> = {
  nastran: "bdf",
  abaqus: "inp",
  ansys: "mac",
  ls_dyna: "k",
};

export const deckFamily = atomFamily((laminateId: string) =>
  atom<Promise<string>>(async (get) => {
    const { laminate, materials } = get(laminateRequestFamily(laminateId));
    const target = get(exportTargetAtom);
    const options = get(exportOptionsAtom);
    return await elamx.export_solver_deck(
      JSON.stringify({ laminate, materials, target, options }),
    );
  }),
);

export const loadableDeckFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(deckFamily(laminateId)),
);

export const deckErrorFamily = atomFamily((laminateId: string) =>
  selectAtom(loadableDeckFamily(laminateId), (state) =>
    state.state === "hasError" ? String(state.error) : null,
  ),
);
