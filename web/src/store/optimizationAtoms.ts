// The optimisation: state for the search, and the search itself.
//
// Unlike every other module here, this one does NOT run on every keystroke.
// A search is hundreds to thousands of full analyses - the exhaustive one can
// be a million - so it runs when asked and not before. That is the one real
// difference between this module's plumbing and the rest of the app's, and it
// is why the result lives in its own atom rather than being derived from the
// input.
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type {
  ConstraintDto,
  GeneticParametersDto,
  MaterialDto,
  OptimizationInputDto,
  OptimizationResponse,
  OptimizerKindId,
} from "../lib/types";
import { BatchCancelled, batchClient, type BatchHandle } from "../lib/batchClient";
import { materialsAtom } from "./materialsAtoms";

/**
 * How many candidates a search may evaluate before giving up.
 *
 * Sized for a browser tab: at roughly a millisecond per candidate this is a
 * few seconds of work. The exhaustive search will hit it on anything but a
 * small problem, which is the honest outcome - it enumerates every order.
 */
export const DEFAULT_BUDGET = 20000;

/** eLamX's own starting point: the four standard angles at 0.125 mm. */
export function defaultOptimizationInput(materialId: string): OptimizationInputDto {
  return {
    angles: [0, 45, -45, 90],
    thickness: 0.125,
    material_id: materialId,
    criterion_id: "puck",
    extra_criteria: [],
    constraints: [{ kind: "clt", loads: emptyLoads(1000) }],
    symmetric: false,
    max_layers: 200,
  };
}

function emptyLoads(n_x: number) {
  return {
    n_x,
    n_y: 0,
    n_xy: 0,
    m_x: 0,
    m_y: 0,
    m_xy: 0,
    delta_t: 0,
    delta_h: 0,
    nt_x: 0,
    nt_y: 0,
    nt_xy: 0,
    mt_x: 0,
    mt_y: 0,
    mt_xy: 0,
  };
}

/** The core's `GeneticParameters::default`, which is eLamX's own. */
export function defaultGeneticParameters(): GeneticParametersDto {
  return {
    parents: 60,
    children: 60,
    mutation_probability: 0.3,
    shift_probability: 0.2,
    // Far below the original's 6000: that many generations is minutes of work
    // in a tab, and the search has usually settled long before. The result
    // reports the generation it last improved in, so a run that was cut short
    // says so.
    max_generations: 60,
    restart_after_unchanged: 400,
    delta_max_layers: 0,
    seed: 1,
  };
}

const json = createJSONStorage<OptimizationInputDto>(() => localStorage);

/** Where the search's input is stored, and with it the answer to whether a
 *  search was ever set up at all.
 *
 *  The atom answers with its default either way, so asking it would write an
 *  optimisation into every saved project. The key exists once the module was
 *  edited or a file filled it - which is the real question a save asks. */
export const OPTIMIZATION_STORAGE_KEY = "elamx.optimization";

export const optimizationInputAtom = atomWithStorage<OptimizationInputDto>(
  OPTIMIZATION_STORAGE_KEY,
  defaultOptimizationInput(""),
  json,
  { getOnInit: true },
);

export const optimizerAtom = atomWithStorage<OptimizerKindId>(
  "elamx.optimization.optimizer",
  "sequential",
  createJSONStorage<OptimizerKindId>(() => localStorage),
  { getOnInit: true },
);

export const geneticParametersAtom = atomWithStorage<GeneticParametersDto>(
  "elamx.optimization.genetic",
  defaultGeneticParameters(),
  createJSONStorage<GeneticParametersDto>(() => localStorage),
  { getOnInit: true },
);

/**
 * The two fields of the file's `<optimization>` element the UI never edits.
 *
 * `angleType` is eLamX's memory of which angle preset the wizard offered; this
 * app lets the angles be typed directly and has no preset list, so the number
 * is only kept so that a project saved here still opens on the preset the
 * desktop user picked. `name` is what the desktop shows the module as.
 */
export const optimizationMetaAtom = atomWithStorage<{ name: string; angleType: number }>(
  "elamx.optimization.meta",
  // OptimizationModuleData: angleType 0, name from the German bundle.
  { name: "Optimierung", angleType: 0 },
  createJSONStorage<{ name: string; angleType: number }>(() => localStorage),
  { getOnInit: true },
);

/** What the last run produced, or the reason it did not. */
export interface OptimizationState {
  /** `cancelled`: stopped by the user; the previous result, if any, stays. */
  status: "idle" | "running" | "done" | "failed" | "cancelled";
  result?: OptimizationResponse;
  error?: string;
  /** Wall-clock milliseconds of the last run - the honest cost. */
  took?: number;
}

export const optimizationStateAtom = atom<OptimizationState>({ status: "idle" });

/**
 * The input with its material resolved.
 *
 * The stored default cannot name one - it is written before any project
 * exists - and a project can lose the material a saved search referred to. In
 * both cases the search would go out with an id nothing answers to, so it is
 * resolved here rather than in the form: the form shows what will be searched
 * with, and this is what decides it.
 */
export const resolvedOptimizationInputAtom = atom((get) => {
  const input = get(optimizationInputAtom);
  const materials: MaterialDto[] = get(materialsAtom);
  if (materials.some((m) => m.id === input.material_id)) return input;
  return { ...input, material_id: materials[0]?.id ?? "" };
});

/** The search in flight, for the cancel button. Module state rather than an
 *  atom: a handle is not something to render or to undo. */
let runningSearch: BatchHandle | null = null;

/** Runs the search - on the batch worker, so that a search of minutes blocks
 *  no live recomputation and can be stopped. Nothing else in the app
 *  triggers it. */
export const runOptimizationAtom = atom(null, async (get, set) => {
  const input = get(resolvedOptimizationInputAtom);
  const materials: MaterialDto[] = get(materialsAtom);
  const optimizer = get(optimizerAtom);
  const previous = get(optimizationStateAtom).result;

  runningSearch?.cancel();
  set(optimizationStateAtom, { status: "running", result: previous });
  const started = performance.now();
  const handle = batchClient.run({
    kind: "call",
    fn: "optimize",
    args: [
      JSON.stringify({
        materials: Object.fromEntries(materials.map((m) => [m.id, m])),
        input,
        optimizer,
        genetic: get(geneticParametersAtom),
        budget: DEFAULT_BUDGET,
      }),
    ],
  });
  runningSearch = handle;
  try {
    const json = await handle.promise;
    set(optimizationStateAtom, {
      status: "done",
      result: JSON.parse(json ?? "null") as OptimizationResponse,
      took: performance.now() - started,
    });
  } catch (error) {
    if (error instanceof BatchCancelled) {
      // A newer run cancelled this one and has set its own state already.
      if (runningSearch === handle) set(optimizationStateAtom, { status: "cancelled", result: previous });
      return;
    }
    set(optimizationStateAtom, {
      status: "failed",
      error: String(error),
      took: performance.now() - started,
    });
  } finally {
    if (runningSearch === handle) runningSearch = null;
  }
});

/** Stops the running search, if there is one. */
export const cancelOptimizationAtom = atom(null, () => {
  runningSearch?.cancel();
});

/** A constraint of the given kind, at its own defaults. */
export function defaultConstraint(kind: ConstraintDto["kind"]): ConstraintDto {
  switch (kind) {
    case "clt":
      return { kind, loads: emptyLoads(1000) };
    case "buckling":
      return {
        kind,
        input: {
          length: 500,
          width: 500,
          n_x: -1,
          n_y: 0,
          n_xy: 0,
          bc_x: "SS",
          bc_y: "SS",
          m: 10,
          n: 10,
          d_matrix: "standard",
          stiffeners: [],
        },
      };
    case "deformation":
      return {
        kind,
        input: {
          length: 500,
          width: 500,
          bc_x: "SS",
          bc_y: "SS",
          m: 10,
          n: 10,
          d_matrix: "standard",
          loads: [{ kind: "Surface", name: "q", force: 0.01 }],
          stiffeners: [],
          max_displacement_z: 5,
        },
      };
    case "pressure_vessel":
      return {
        kind,
        input: { pressure: 0.5, radius: 250, radius_type: "Inner" },
      };
  }
}
