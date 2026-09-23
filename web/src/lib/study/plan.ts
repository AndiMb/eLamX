// From a study's definition and the project to the points the core is asked:
// the one place where a study meets the project.
//
// Pure: it takes the project as data and returns the requests as JSON, so the
// same plan is built for the study page, for the report and in a test. Every
// request is a request a module page would send - the CLT page's for a
// matrix cell, the buckling page's for a sweep point - which is what makes a
// cell checkable against the module (N4).

import type {
  BucklingInputDto,
  CriterionId,
  DeformationInputDto,
  LastPlyFailureInputDto,
  MaterialDto,
  VibrationInputDto,
} from "../types";
import { emptyLoads } from "../types";
import { LOAD_FIELDS } from "../constants";
import { expandedStack } from "../angleStack";
import { buildCltRequest, laminateDtoOf } from "../../store/derivedAtoms";
import { loadCasesOf, type LaminateConfig, type LoadCase } from "../../store/laminateAtoms";
import { defaultLastPlyFailureInput } from "../../store/lastPlyFailureAtoms";
import { callCostMs, estimate, fingerprint, type CostEstimate } from "./cost";
import type { PointTask } from "./evaluate";
import type { MatrixDef, StudyDef } from "./model";
import { planSweep, type SweepLayout } from "./sweep";

/** What a study needs of the project. */
export interface StudyProject {
  laminates: LaminateConfig[];
  materials: MaterialDto[];
  /** Module inputs by laminate id, where the laminate has them. */
  bucklings: Record<string, BucklingInputDto>;
  vibrations: Record<string, VibrationInputDto>;
  deformations: Record<string, DeformationInputDto>;
  lastPlyFailures: Record<string, LastPlyFailureInputDto>;
}

/** Something that keeps a study from being what its definition says. */
export type PlanProblem =
  | { kind: "laminateMissing"; id: string }
  | { kind: "empty" }
  | { kind: "unknownKind" }
  | { kind: "termsCapped"; max: number }
  | { kind: "noLayers" };

export interface MatrixAxis {
  id: string;
  label: string;
  /** The laminate of a row, or of a column's load case. */
  laminateId?: string;
  loadCaseId?: string;
  criterion?: CriterionId;
}

export interface MatrixLayout {
  kind: "matrix";
  /** Laminates, in definition order - before any transposing. */
  rows: MatrixAxis[];
  /** Load cases or criteria. */
  cols: MatrixAxis[];
  output: MatrixDef["output"];
  /** For `criterion` columns: the load case each row is judged under. */
  rowLoadCase: (string | null)[];
}

export type StudyLayout = MatrixLayout | SweepLayout;

export interface StudyPlan {
  /** Fingerprint of every request of every point: equal hashes, equal
   *  results. The study is outdated exactly when this changes. */
  hash: string;
  points: PointTask[];
  layout: StudyLayout | null;
  cost: CostEstimate;
  problems: PlanProblem[];
}

export function materialMap(materials: MaterialDto[]) {
  return Object.fromEntries(materials.map((m) => [m.id, m]));
}

/** A laminate as a study sends it: without its own and its plies' names,
 *  which the core does not read. So renaming a laminate or a ply does not
 *  change a request - and does not mark a study outdated. */
export function studyLaminate(config: LaminateConfig) {
  const dto = laminateDtoOf(config);
  return { ...dto, name: "", layers: dto.layers.map((l) => ({ ...l, name: "" })) };
}

/** The materials a laminate uses, without their names - for the same reason:
 *  a change to a material no ply of the laminate is made of is no change to
 *  what the study computes. */
export function studyMaterials(config: LaminateConfig, materials: MaterialDto[]) {
  const used = new Set(config.layers.map((l) => l.materialId));
  return Object.fromEntries(materials.filter((m) => used.has(m.id)).map((m) => [m.id, { ...m, name: "" }]));
}

/** Plies of the whole stack, mirroring included. */
export function pliesOf(config: LaminateConfig): number {
  return expandedStack(
    config.layers.map((l) => l.thickness),
    config.symmetric,
    config.withMiddleLayer,
  ).plies;
}

/** The load case's mechanical loads, as the last-ply-failure input takes
 *  them - or null when it prescribes a strain, which that analysis cannot
 *  follow (it scales a load). */
export function lpfLoadsOf(loadCase: LoadCase): LastPlyFailureInputDto["loads"] | null {
  if (loadCase.useStrain.some(Boolean)) return null;
  const loads = emptyLoads();
  loadCase.dofValues.forEach((value, i) => {
    loads[LOAD_FIELDS[i]] = value;
  });
  return loads;
}

/** Content of a load case, without its id and name - two cases with equal
 *  content are one column. */
function loadKey(c: LoadCase): string {
  return JSON.stringify([c.dofValues, c.useStrain, c.deltaT, c.deltaH]);
}

const DEFAULT_MATRIX_CRITERIA: CriterionId[] = ["puck", "tsai_wu", "max_stress", "max_strain", "hashin"];

function finish(points: PointTask[], layout: StudyLayout | null, costMs: number, problems: PlanProblem[]): StudyPlan {
  return {
    hash: fingerprint(JSON.stringify(points)),
    points,
    layout,
    cost: estimate(points.length, costMs),
    problems,
  };
}

export function planMatrix(def: MatrixDef, project: StudyProject, messages: PlanMessages): StudyPlan {
  const problems: PlanProblem[] = [];
  const rowsCfg =
    def.laminates.length === 0
      ? project.laminates
      : def.laminates
          .map((id) => {
            const found = project.laminates.find((l) => l.id === id);
            if (!found) problems.push({ kind: "laminateMissing", id });
            return found;
          })
          .filter((l): l is LaminateConfig => !!l);

  const rows: MatrixAxis[] = rowsCfg.map((l) => ({ id: l.id, label: l.name, laminateId: l.id }));
  const cols: MatrixAxis[] = [];
  const colCases: LoadCase[] = [];
  const rowLoadCase: (string | null)[] = rowsCfg.map(() => null);
  let rowCases: LoadCase[] = [];

  const findCase = (laminateId: string, loadCaseId: string) =>
    project.laminates.find((l) => l.id === laminateId)?.loadCases.find((c) => c.id === loadCaseId);

  if (def.columns === "load_case") {
    const chosen: { laminate: LaminateConfig; loadCase: LoadCase }[] = [];
    if (def.loadCases.length > 0) {
      for (const sel of def.loadCases) {
        const laminate = project.laminates.find((l) => l.id === sel.laminateId);
        const loadCase = findCase(sel.laminateId, sel.loadCaseId);
        if (laminate && loadCase) chosen.push({ laminate, loadCase });
      }
    } else {
      // Every load case of the laminates in the matrix, each content once.
      const seen = new Set<string>();
      for (const laminate of rowsCfg) {
        for (const loadCase of loadCasesOf(laminate)) {
          const key = loadKey(loadCase);
          if (seen.has(key)) continue;
          seen.add(key);
          chosen.push({ laminate, loadCase });
        }
      }
    }
    const names = chosen.map((c) => c.loadCase.name);
    for (const { laminate, loadCase } of chosen) {
      const ambiguous = names.filter((n) => n === loadCase.name).length > 1;
      cols.push({
        id: `${laminate.id}|${loadCase.id}`,
        label: ambiguous ? `${loadCase.name} (${laminate.name})` : loadCase.name,
        laminateId: laminate.id,
        loadCaseId: loadCase.id,
      });
      colCases.push(loadCase);
    }
  } else {
    const criteria = def.criteria.length > 0 ? def.criteria : DEFAULT_MATRIX_CRITERIA;
    for (const criterion of criteria) cols.push({ id: criterion, label: criterion, criterion });
    const shared = def.loadCases[0] ? findCase(def.loadCases[0].laminateId, def.loadCases[0].loadCaseId) : undefined;
    rowCases = rowsCfg.map((l, i) => {
      const loadCase = shared ?? loadCasesOf(l)[0];
      rowLoadCase[i] = loadCase.id;
      return loadCase;
    });
  }

  const points: PointTask[] = [];
  let costMs = 0;
  rowsCfg.forEach((config, r) => {
    const plies = pliesOf(config);
    cols.forEach((col, c) => {
      const loadCase = def.columns === "load_case" ? colCases[c] : rowCases[r];
      const laminateConfig =
        col.criterion !== undefined
          ? {
              ...config,
              layers: config.layers.map((l) => ({ ...l, criterionId: col.criterion!, extraCriteria: undefined })),
            }
          : config;
      const laminate = studyLaminate(laminateConfig);
      const materials = studyMaterials(config, project.materials);
      if (config.layers.length === 0) {
        points.push({ outputs: [], invalid: messages.noLayers, requests: {} });
        return;
      }
      if (def.output === "lpf") {
        const loads = lpfLoadsOf(loadCase);
        const input = { ...(project.lastPlyFailures[config.id] ?? defaultLastPlyFailureInput()) };
        points.push(
          loads
            ? { outputs: ["lpf"], requests: { lpf: JSON.stringify({ laminate, materials, input: { ...input, loads } }) } }
            : { outputs: ["lpf"], invalid: messages.lpfNeedsLoads, requests: {} },
        );
        costMs += callCostMs("lpf", { plies });
      } else {
        points.push({
          outputs: ["min_rf"],
          requests: { clt: JSON.stringify(buildCltRequest(laminate, materials, loadCase)) },
        });
        costMs += callCostMs("clt", { plies });
      }
    });
  });

  if (points.length === 0) problems.push({ kind: "empty" });
  return finish(points, { kind: "matrix", rows, cols, output: def.output, rowLoadCase }, costMs, problems);
}

/** Messages the plan writes into invalid points - in the user's language,
 *  since a gap's tooltip shows them as they are. */
export interface PlanMessages {
  lpfNeedsLoads: string;
  fractionsExceedOne: string;
  fractionsUndetermined: string;
  noLayers: string;
}

export function planStudy(study: StudyDef, project: StudyProject, messages: PlanMessages): StudyPlan {
  switch (study.kind) {
    case "matrix":
      return planMatrix(study.matrix, project, messages);
    case "sweep":
      return planSweep(study.sweep, project, messages);
    case "unknown":
      return finish([], null, 0, [{ kind: "unknownKind" }]);
  }
}

export { finish as finishPlan };
