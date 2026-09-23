// A sweep's points: the base laminate and load case, varied over one range
// or two, each point asked of the core for the outputs chosen.

import type { BucklingInputDto, DeformationInputDto, VibrationInputDto } from "../types";
import { buildCltRequest } from "../../store/derivedAtoms";
import { loadCasesOf, type LaminateConfig } from "../../store/laminateAtoms";
import { defaultBucklingInput } from "../../store/bucklingAtoms";
import { defaultVibrationInput } from "../../store/vibrationAtoms";
import { defaultLastPlyFailureInput } from "../../store/lastPlyFailureAtoms";
import { defaultDeformationInput } from "../../store/deformationAtoms";
import { callCostMs, capTerms, isCrossPly, MAX_STUDY_TERMS } from "./cost";
import { OUTPUT_CALL, type PointCall, type PointTask, type StudyOutput } from "./evaluate";
import type { SweepDef, VariationDef } from "./model";
import {
  finishPlan,
  lpfLoadsOf,
  pliesOf,
  studyLaminate,
  studyMaterials,
  type PlanMessages,
  type PlanProblem,
  type StudyPlan,
  type StudyProject,
} from "./plan";
import { applyVariation, pLaminate, rangeValues, resolveFractions, type SweepInput } from "./variation";

export interface SweepAxis {
  variation: VariationDef;
  values: number[];
}

export interface SweepLayout {
  kind: "sweep";
  x: SweepAxis;
  /** The second input, whose values make the family of curves. */
  y: SweepAxis | null;
  outputs: StudyOutput[];
}

/** The inputs of one point, or why there are none. Shared by the plan and
 *  by "adopt as a laminate", so that what is adopted is what was computed. */
export function sweepInputAt(
  def: SweepDef,
  project: StudyProject,
  xValue: number,
  yValue: number | null,
  messages: PlanMessages,
): { input: SweepInput; capped: boolean } | { invalid: string } | null {
  const base = project.laminates.find((l) => l.id === def.laminateId);
  if (!base) return null;
  const cases = loadCasesOf(base);
  const loadCase = cases.find((c) => c.id === def.loadCaseId) ?? cases[0];
  const buckling = capTerms<BucklingInputDto>(project.bucklings[base.id] ?? defaultBucklingInput());
  const vibration = capTerms<VibrationInputDto>(project.vibrations[base.id] ?? defaultVibrationInput());
  const deformation = capTerms<DeformationInputDto>(project.deformations[base.id] ?? defaultDeformationInput());
  let input: SweepInput = {
    laminate: base,
    loadCase,
    buckling: buckling.input,
    vibration: vibration.input,
    deformation: deformation.input,
    fractions: null,
  };
  input = applyVariation(input, def.x, xValue);
  if (def.y && yValue !== null) input = applyVariation(input, def.y, yValue);
  if (input.fractions) {
    if (base.layers.length === 0) return { invalid: messages.noLayers };
    const fractions = resolveFractions(input.fractions, def.fractions);
    if (fractions === "exceedsOne") return { invalid: messages.fractionsExceedOne };
    if (fractions === "undetermined") return { invalid: messages.fractionsUndetermined };
    input = { ...input, laminate: pLaminate(input.laminate, def.plies, fractions) };
  }
  if (input.laminate.layers.length === 0) return { invalid: messages.noLayers };
  const needs = new Set(def.outputs.map((o) => OUTPUT_CALL[o]));
  const capped =
    (needs.has("buckling") && buckling.capped) ||
    (needs.has("vibration") && vibration.capped) ||
    (needs.has("deformation") && deformation.capped);
  return { input, capped };
}

function requestsOf(input: SweepInput, calls: Set<PointCall>, project: StudyProject, messages: PlanMessages) {
  const laminate = studyLaminate(input.laminate);
  const materials = studyMaterials(input.laminate, project.materials);
  const requests: PointTask["requests"] = {};
  if (calls.has("clt")) requests.clt = JSON.stringify(buildCltRequest(laminate, materials, input.loadCase));
  if (calls.has("lpf")) {
    const loads = lpfLoadsOf(input.loadCase);
    if (!loads) return { invalid: messages.lpfNeedsLoads };
    const params = project.lastPlyFailures[input.laminate.id] ?? defaultLastPlyFailureInput();
    requests.lpf = JSON.stringify({ laminate, materials, input: { ...params, loads } });
  }
  if (calls.has("buckling")) requests.buckling = JSON.stringify({ laminate, materials, input: input.buckling });
  if (calls.has("vibration")) requests.vibration = JSON.stringify({ laminate, materials, input: input.vibration });
  if (calls.has("deformation")) requests.deformation = JSON.stringify({ laminate, materials, input: input.deformation });
  return { requests };
}

export function planSweep(def: SweepDef, project: StudyProject, messages: PlanMessages): StudyPlan {
  const problems: PlanProblem[] = [];
  const base = project.laminates.find((l) => l.id === def.laminateId);
  if (!base) return finishPlan([], null, 0, [{ kind: "laminateMissing", id: def.laminateId }]);
  const outputs = def.outputs;
  if (outputs.length === 0) return finishPlan([], null, 0, [{ kind: "empty" }]);
  const calls = new Set(outputs.map((o) => OUTPUT_CALL[o]));

  const xs = rangeValues(def.x);
  const ys = def.y ? rangeValues(def.y) : [null];
  const points: PointTask[] = [];
  let costMs = 0;
  let capped = false;
  for (const y of ys) {
    for (const x of xs) {
      const at = sweepInputAt(def, project, x, y, messages);
      if (!at) continue;
      if ("invalid" in at) {
        points.push({ outputs, invalid: at.invalid, requests: {} });
        continue;
      }
      capped ||= at.capped;
      const built = requestsOf(at.input, calls, project, messages);
      if ("invalid" in built) {
        points.push({ outputs, invalid: built.invalid, requests: {} });
        continue;
      }
      points.push({ outputs, requests: built.requests });
      const plies = pliesOf(at.input.laminate);
      const orthotropic = isCrossPly(at.input.laminate.layers.map((l) => l.angle));
      for (const call of calls) {
        const plate =
          call === "buckling" ? at.input.buckling : call === "vibration" ? at.input.vibration : call === "deformation" ? at.input.deformation : null;
        costMs += callCostMs(call, { plies, orthotropic, terms: plate ? [plate.m, plate.n] : undefined });
      }
    }
  }
  if (capped) problems.push({ kind: "termsCapped", max: MAX_STUDY_TERMS });
  if (points.length === 0) problems.push({ kind: "empty" });
  const layout: SweepLayout = {
    kind: "sweep",
    x: { variation: def.x, values: xs },
    y: def.y ? { variation: def.y, values: ys as number[] } : null,
    outputs,
  };
  return finishPlan(points, layout, costMs, problems);
}

/** The laminate a sweep point stands for, as a new laminate of the project
 *  would be made from it - or null where the point has none. */
export function sweepVariant(
  def: SweepDef,
  project: StudyProject,
  xValue: number,
  yValue: number | null,
  messages: PlanMessages,
): SweepInput | null {
  const at = sweepInputAt(def, project, xValue, yValue, messages);
  return at && "input" in at ? at.input : null;
}

export type { LaminateConfig };
