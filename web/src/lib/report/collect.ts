// The results a report shows, computed for the report.
//
// Not read from the atoms the pages use: those hold what is open, for the
// active load case, and a module nobody opened has computed nothing. The
// report asks the core directly (`elamx`, the same worker the pages use) for
// every laminate and load case it covers and for every module the laminate is
// configured for, so it is complete whatever the screen shows.

import type {
  AngleSweepResponse,
  BucklingInputDto,
  BucklingResponse,
  CltResponse,
  DeformationInputDto,
  DeformationResponse,
  FailureEnvelopeResponse,
  LastPlyFailureInputDto,
  LastPlyFailureResponse,
  MaterialDto,
  PlateFieldResponse,
  VibrationInputDto,
  VibrationResponse,
} from "../types";
import type { ProjectSnapshot } from "../projectFile";
import { loadCasesOf, type LaminateConfig, type LoadCase } from "../../store/laminateAtoms";
import { buildCltRequest, laminateDtoOf } from "../../store/derivedAtoms";
import type { ReportTemplate } from "./model";
import { snapshotCltRequest } from "../compare/snapshot";
import type { StudyDef } from "../study/model";
import type { StudyPlan } from "../study/plan";
import type { PointResult } from "../study/evaluate";
import type { CollectedStudy } from "./sections/studies";
import { criticalLayerIndex, governingSurface } from "../failureMetric";
import { SURFACE_SAMPLES } from "../../store/bucklingAtoms";
import { PLATE_SAMPLES } from "../../store/plateViewAtoms";
import { ENVELOPE_QUALITY } from "../../store/failureBodyAtoms";

/** The part of the core the report calls - `elamx` in the app, the same in
 *  a test. */
export interface ReportCompute {
  compute_clt(request: string): Promise<string>;
  compute_angle_sweep(request: string, deltaAngleDeg: number): Promise<string>;
  compute_buckling(request: string): Promise<string>;
  compute_vibration(request: string): Promise<string>;
  compute_deformation(request: string): Promise<string>;
  compute_last_ply_failure(request: string): Promise<string>;
  compute_buckling_surface(request: string): Promise<string>;
  compute_vibration_surface(request: string): Promise<string>;
  compute_deformation_field(request: string): Promise<string>;
  compute_failure_envelope(request: string): Promise<string>;
}

/** A module's input and its result - or why there is none. */
export type ModuleOutcome<I, R> = { input: I; result: R } | { input: I; error: string };

export interface LoadCaseResults {
  loadCase: LoadCase;
  /** Whether it is the one the laminate shows. */
  active: boolean;
  clt: CltResponse | null;
  error?: string;
  /** The failure body of the governing ply under this load case, for its
   *  figure; null when there is none or it could not be computed. */
  failureBody?: CriticalFailureBody | null;
}

export interface CriticalFailureBody {
  /** Index of the governing ply in the expanded stack. */
  index: number;
  criterion: string;
  materialName: string;
  envelope: FailureEnvelopeResponse;
}

/** What the plate figures draw, sampled on the grids the modules sample on:
 *  the first buckling mode, the first natural mode and the deflection. */
export interface PlateShapes {
  buckling: number[][] | null;
  vibration: number[][] | null;
  deflection: PlateFieldResponse | null;
}

export interface LaminateResults {
  config: LaminateConfig;
  /** The first load case's response - the stack's own properties, which do
   *  not depend on the load. */
  base: CltResponse | null;
  cases: LoadCaseResults[];
  sweep: AngleSweepResponse | null;
  lastPlyFailure?: ModuleOutcome<LastPlyFailureInputDto, LastPlyFailureResponse>;
  buckling?: ModuleOutcome<BucklingInputDto, BucklingResponse>;
  vibration?: ModuleOutcome<VibrationInputDto, VibrationResponse>;
  deformation?: ModuleOutcome<DeformationInputDto, DeformationResponse>;
  shapes?: PlateShapes;
}

export interface ComparisonColumn {
  laminateName: string;
  loadCaseName: string;
  clt: CltResponse | null;
}

export interface CollectedResults {
  materials: MaterialDto[];
  laminates: LaminateResults[];
  comparison: ComparisonColumn[];
  /** The project's studies, with their results. Empty unless the template
   *  asks for them. */
  studies: CollectedStudy[];
}

/** How the report gets a study's results: its plan against the project, and
 *  the points computed - on the batch worker in the app, or taken from the
 *  study page when that holds a finished run of these very inputs. */
export interface StudyRunner {
  plan(study: StudyDef): StudyPlan;
  run(study: StudyDef, plan: StudyPlan): Promise<(PointResult | undefined)[]>;
}

/** What a report needs of the project: the file's view of it. */
export type ReportProject = Pick<
  ProjectSnapshot,
  "materials" | "laminates" | "bucklings" | "vibrations" | "deformations" | "lastPlyFailures" | "comparison" | "studies" | "snapshots"
>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run<I, R>(
  input: I | undefined,
  call: (request: string) => Promise<string>,
  request: object,
): Promise<ModuleOutcome<I, R> | undefined> {
  if (!input) return undefined;
  try {
    return { input, result: JSON.parse(await call(JSON.stringify({ ...request, input }))) as R };
  } catch (error) {
    return { input, error: message(error) };
  }
}

/** A second call for a picture's data. A picture that cannot be had is left
 *  out; it does not take the numbers it would illustrate with it. */
async function optional<T>(call: () => Promise<string>): Promise<T | null> {
  try {
    return JSON.parse(await call()) as T;
  } catch {
    return null;
  }
}

/** The first mode of each plate analysis - the lowest positive load factor,
 *  as the buckling module lists its modes - and the deflection, for the
 *  figures. */
async function plateShapes(
  plate: { laminate: unknown; materials: unknown },
  buckling: ModuleOutcome<BucklingInputDto, BucklingResponse> | undefined,
  vibration: ModuleOutcome<VibrationInputDto, VibrationResponse> | undefined,
  deformation: ModuleOutcome<DeformationInputDto, DeformationResponse> | undefined,
  compute: ReportCompute,
): Promise<PlateShapes> {
  const shapes: PlateShapes = { buckling: null, vibration: null, deflection: null };
  if (buckling && "result" in buckling) {
    const mode = buckling.result.modes.find((m) => m.eigenvalue >= 0 && Number.isFinite(m.eigenvalue));
    if (mode) {
      const request = { input: buckling.input, shape: mode.shape, samples: SURFACE_SAMPLES };
      shapes.buckling = await optional(() => compute.compute_buckling_surface(JSON.stringify(request)));
    }
  }
  if (vibration && "result" in vibration) {
    const mode = vibration.result.modes[0];
    if (mode) {
      const request = { input: vibration.input, shape: mode.shape, samples: SURFACE_SAMPLES };
      shapes.vibration = await optional(() => compute.compute_vibration_surface(JSON.stringify(request)));
    }
  }
  if (deformation && "result" in deformation) {
    const request = {
      ...plate,
      input: deformation.input,
      coefficients: deformation.result.coefficients,
      field: "Deflection",
      layer: 0,
      position: "Upper",
      samples: PLATE_SAMPLES,
    };
    shapes.deflection = await optional(() => compute.compute_deformation_field(JSON.stringify(request)));
  }
  return shapes;
}

/** The governing ply's failure body under one load case, for the criterion
 *  that governs it - which need not be the ply's first. Bodies depend only on
 *  material and criterion, so load cases share them through `envelopes`. */
async function criticalBody(
  clt: CltResponse,
  materials: Record<string, MaterialDto>,
  compute: ReportCompute,
  envelopes: Map<string, Promise<FailureEnvelopeResponse | null>>,
): Promise<CriticalFailureBody | null> {
  const index = criticalLayerIndex(clt.layer_results);
  const ply = clt.layer_contributions[index];
  const material = ply ? materials[ply.material_id] : undefined;
  if (!material) return null;
  const criterion = governingSurface(clt.layer_results[index]).criterion;
  const key = `${material.id}|${criterion}`;
  let envelope = envelopes.get(key);
  if (!envelope) {
    const request = { material, criterion_id: criterion, quality: ENVELOPE_QUALITY };
    envelope = optional<FailureEnvelopeResponse>(() => compute.compute_failure_envelope(JSON.stringify(request)));
    envelopes.set(key, envelope);
  }
  const body = await envelope;
  return body ? { index, criterion, materialName: material.name, envelope: body } : null;
}

/** The laminates a template covers, in the project's order. */
export function laminatesOf(template: ReportTemplate, project: ReportProject): LaminateConfig[] {
  return template.laminates.length === 0
    ? project.laminates
    : project.laminates.filter((l) => template.laminates.includes(l.id));
}

/**
 * Computes everything the template asks for. `activeLoadCase` names each
 * laminate's active case, for a template that covers only those.
 * `onProgress` is called after each laminate.
 */
export async function collectResults(
  template: ReportTemplate,
  project: ReportProject,
  compute: ReportCompute,
  activeLoadCase: (laminateId: string) => string | undefined,
  onProgress?: (done: number, total: number) => void,
  studyRunner?: StudyRunner,
): Promise<CollectedResults> {
  const materials = Object.fromEntries(project.materials.map((m) => [m.id, m]));
  const wants = (kind: ReportTemplate["sections"][number]) => template.sections.includes(kind);
  const configs = laminatesOf(template, project);
  const laminates: LaminateResults[] = [];

  for (const [index, config] of configs.entries()) {
    const laminate = laminateDtoOf(config);
    const all = loadCasesOf(config);
    const activeId = activeLoadCase(config.id) ?? all[0].id;
    const chosen = template.loadCases === "all" ? all : all.filter((c) => c.id === activeId).slice(0, 1);
    const cases: LoadCaseResults[] = [];
    const envelopes = new Map<string, Promise<FailureEnvelopeResponse | null>>();
    for (const loadCase of chosen.length > 0 ? chosen : all.slice(0, 1)) {
      try {
        const json = await compute.compute_clt(JSON.stringify(buildCltRequest(laminate, materials, loadCase)));
        const clt = JSON.parse(json) as CltResponse;
        const failureBody = wants("layerResults") ? await criticalBody(clt, materials, compute, envelopes) : undefined;
        cases.push({ loadCase, active: loadCase.id === activeId, clt, failureBody });
      } catch (error) {
        cases.push({ loadCase, active: loadCase.id === activeId, clt: null, error: message(error) });
      }
    }
    let sweep: AngleSweepResponse | null = null;
    if (wants("abd")) {
      try {
        sweep = JSON.parse(
          await compute.compute_angle_sweep(JSON.stringify({ laminate, materials }), 5),
        ) as AngleSweepResponse;
      } catch {
        sweep = null;
      }
    }
    const plate = { laminate, materials };
    const buckling = wants("buckling")
      ? await run<BucklingInputDto, BucklingResponse>(project.bucklings[config.id], compute.compute_buckling, plate)
      : undefined;
    const vibration = wants("vibration")
      ? await run<VibrationInputDto, VibrationResponse>(project.vibrations[config.id], compute.compute_vibration, plate)
      : undefined;
    const deformation = wants("deformation")
      ? await run<DeformationInputDto, DeformationResponse>(
          project.deformations[config.id],
          compute.compute_deformation,
          plate,
        )
      : undefined;
    laminates.push({
      config,
      base: cases.find((c) => c.clt)?.clt ?? null,
      cases,
      sweep,
      lastPlyFailure: wants("failureSequence")
        ? await run(project.lastPlyFailures[config.id], compute.compute_last_ply_failure, plate)
        : undefined,
      buckling,
      vibration,
      deformation,
      shapes: await plateShapes(plate, buckling, vibration, deformation, compute),
    });
    onProgress?.(index + 1, configs.length);
  }

  const comparison: ComparisonColumn[] = [];
  if (wants("comparison")) {
    for (const variant of project.comparison ?? []) {
      if (variant.snapshotId) {
        const snapshot = (project.snapshots ?? []).find((s) => s.id === variant.snapshotId);
        if (!snapshot) continue;
        let clt: CltResponse | null = null;
        try {
          clt = JSON.parse(await compute.compute_clt(JSON.stringify(snapshotCltRequest(snapshot)))) as CltResponse;
        } catch {
          clt = null;
        }
        comparison.push({ laminateName: snapshot.name, loadCaseName: snapshot.load_case.name, clt });
        continue;
      }
      const config = project.laminates.find((l) => l.id === variant.laminateId);
      const loadCase = config && loadCasesOf(config).find((c) => c.id === variant.loadCaseId);
      if (!config || !loadCase) continue;
      let clt: CltResponse | null = null;
      try {
        clt = JSON.parse(
          await compute.compute_clt(JSON.stringify(buildCltRequest(laminateDtoOf(config), materials, loadCase))),
        ) as CltResponse;
      } catch {
        clt = null;
      }
      comparison.push({ laminateName: config.name, loadCaseName: loadCase.name, clt });
    }
  }

  const studies: CollectedStudy[] = [];
  if (wants("studies") && studyRunner) {
    for (const study of project.studies ?? []) {
      const plan = studyRunner.plan(study);
      try {
        studies.push({ study, plan, points: plan.layout ? await studyRunner.run(study, plan) : [] });
      } catch (error) {
        studies.push({ study, plan, points: [], error: message(error) });
      }
    }
  }

  // Only the materials the covered laminates use.
  const used = new Set(configs.flatMap((c) => c.layers.map((l) => l.materialId)));
  return { materials: project.materials.filter((m) => used.has(m.id)), laminates, comparison, studies };
}
