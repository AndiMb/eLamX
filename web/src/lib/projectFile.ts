// Translation between the app's state and an `.elamx` project file.
//
// `.elamx` is the original desktop program's format and stays this app's
// format too, so a project moves between the two in either direction. The XML
// itself is parsed and written by the Rust core (see elamx-core's `project`
// module), which is where the Java class names, element order and number
// formatting live - this file only maps the resulting Project structure onto
// the atoms the UI edits.
//
// What this app does not model yet is carried through untouched rather than
// dropped: analyses beyond the first of each kind, and sections no module here
// answers to. Load cases are not among them - every <calculation> in the file
// becomes a real load case. See `CarryOver` in store/laminateAtoms.ts.

import { elamx } from "./wasm";
import { DEFAULT_CRITERION_ID, LOAD_FIELDS, STRAIN_FIELDS, type LayerRow } from "./constants";
import {
  CRITERIA,
  type BucklingInputDto,
  type CriterionId,
  type LastPlyFailureInputDto,
  type FibreDto,
  type MaterialDto,
  type MatrixMaterialDto,
  type VibrationInputDto,
  type DeformationInputDto,
  type PressureVesselInputDto,
  type SpringInInputDto,
  type CutoutInputDto,
  type OptimizationInputDto,
  type OptimizerKindId,
} from "./types";
import type { ComparisonVariant } from "./generated/ComparisonVariant";
import type { ImportNotice as CoreImportNotice } from "./generated/ImportNotice";
import type { WebExtension } from "./generated/WebExtension";
import type { RuleSettings } from "./generated/RuleSettings";
import type { Variant } from "../store/comparisonAtoms";
import {
  EMPTY_WEB_EXTENSION_CARRY,
  type ImportNotice,
  type WebExtensionCarry,
} from "./webExtension";
import {
  defaultLaminateConfig,
  defaultLoadCase,
  type LaminateConfig,
  type LoadCase,
} from "../store/laminateAtoms";

/** The shape elamx-core's `project::Project` serialises to. Only the parts
 *  this app reads are typed; the rest travels as `unknown` and is written
 *  back unchanged. */
interface ProjectDto {
  version: string;
  materials: MaterialDto[];
  fibres: FibreDto[];
  matrices: MatrixMaterialDto[];
  laminates: ProjectLaminateDto[];
  optimizations?: OptimizationEntryDto[];
  /** Project-level sections as raw XML - the ones the core does not model and
   *  this app does not touch, carried so that saving a desktop project does
   *  not delete work the desktop put there. */
  unsupported_sections?: unknown[];
  /** `<webExtension>`: what only this app uses, read by the core. */
  web_extension?: WebExtension | null;
  /** What the core could not use - filled on read, ignored on write. */
  import_notices?: CoreImportNotice[];
}

interface ProjectLaminateDto {
  laminate: LaminateDto;
  calculations: CalculationDto[];
  bucklings: BucklingEntryDto[];
  last_ply_failures: LastPlyFailureEntryDto[];
  pressure_vessels: PressureVesselEntryDto[];
  deformations: DeformationEntryDto[];
  vibrations?: VibrationEntryDto[];
  spring_ins?: SpringInEntryDto[];
  cutouts?: CutoutEntryDto[];
  unsupported_modules?: unknown[];
}

interface LaminateDto {
  id: string;
  name: string;
  layers: LayerDto[];
  symmetric: boolean;
  with_middle_layer: boolean;
  invert_z: boolean;
  offset: number;
}

interface LayerDto {
  id: string;
  name: string;
  angle: number;
  thickness: number;
  material_id: string;
  criterion_id: string | null;
  /** Absent in a JSON written before extra criteria existed. */
  extra_criteria?: string[];
}

interface CalculationDto {
  name: string;
  loads: Record<string, number>;
  strains: Record<string, number>;
  use_strain: boolean[];
}

interface BucklingEntryDto {
  name: string;
  input: BucklingInputDto;
}

interface LastPlyFailureEntryDto {
  name: string;
  input: LastPlyFailureInputDto;
}

interface PressureVesselEntryDto {
  name: string;
  input: PressureVesselInputDto;
}

interface DeformationEntryDto {
  name: string;
  input: DeformationInputDto;
}

interface VibrationEntryDto {
  name: string;
  input: VibrationInputDto;
}

interface SpringInEntryDto {
  name: string;
  input: SpringInInputDto;
}

interface CutoutEntryDto {
  name: string;
  input: CutoutInputDto;
}

/** The optimisation is the one module that hangs off the project rather than
 *  off a laminate - it searches for a stacking sequence, so it has none yet.
 *  `angle_type` is the file's memory of which angle preset was picked; this
 *  app has no preset list, and carries the number so the desktop still opens
 *  on the preset the user chose. */
interface OptimizationEntryDto {
  name: string;
  optimizer: OptimizerKindId;
  angle_type: number;
  input: OptimizationInputDto;
}

/** A whole session: what a file turns into on open, and what a save turns
 *  back into a file. The same shape in both directions on purpose - anything
 *  that survives one has to survive the other. */
export interface ProjectSnapshot {
  materials: MaterialDto[];
  /** The constituents a micromechanic material is built from. Their own
   *  catalogs, as in the file: they are not ply materials. */
  fibres: FibreDto[];
  matrices: MatrixMaterialDto[];
  laminates: LaminateConfig[];
  bucklings: Record<string, BucklingInputDto>;
  lastPlyFailures: Record<string, LastPlyFailureInputDto>;
  pressureVessels: Record<string, PressureVesselInputDto>;
  deformations: Record<string, DeformationInputDto>;
  vibrations: Record<string, VibrationInputDto>;
  springIns: Record<string, SpringInInputDto>;
  cutouts: Record<string, CutoutInputDto>;
  /** The first optimisation in the file, which is the one the module shows.
   *  Absent when the file had none and nothing has been searched for. */
  optimization?: OptimizationEntryDto;
  /** Further optimisations from the file. The module shows one at a time, so
   *  the rest are carried rather than shown. */
  extraOptimizations: unknown[];
  version: string;
  /** Project-level sections carried through untouched - see ProjectDto. */
  unsupportedSections: unknown[];
  /** The comparison page's columns. In the file since `<webExtension>`
   *  gave them a place; before that they lived in browser storage only. */
  comparison: Variant[];
  /** The rest of `<webExtension>`, carried until the features that fill it
   *  exist, so that a round trip through this build does not lose what a
   *  newer one wrote. */
  webExtensionCarry: WebExtensionCarry;
  /** The thresholds of the stacking-rule check, or null for the defaults.
   *  Optional so that a snapshot written before the check existed still
   *  reads. */
  stackingRuleSettings?: RuleSettings | null;
  /** What could not be used when the file was read. Empty on the way out. */
  importNotices?: ImportNotice[];
}

/** A comparison column from the file, as a laminate id and load-case id of
 *  this session - or null when the file no longer has it.
 *
 *  Load cases get fresh ids on every open, so the file names one by position
 *  and name. The position is tried first; if the name there differs, the
 *  file was edited in eLamX 3.x and the name is searched instead, as long as
 *  it is unambiguous. */
function resolveVariant(variant: ComparisonVariant, laminates: LaminateConfig[]): Variant | null {
  const laminate = laminates.find((l) => l.id === variant.laminate_uuid);
  if (!laminate) return null;
  const atIndex = laminate.loadCases[variant.load_case_index];
  if (atIndex && atIndex.name === variant.load_case_name) {
    return { laminateId: laminate.id, loadCaseId: atIndex.id };
  }
  const byName = laminate.loadCases.filter((c) => c.name === variant.load_case_name);
  return byName.length === 1 ? { laminateId: laminate.id, loadCaseId: byName[0].id } : null;
}

/** The reverse: a column of this session as the file names it, or null when
 *  it points at something that no longer exists. */
function toFileVariant(variant: Variant, laminates: LaminateConfig[]): ComparisonVariant | null {
  const laminate = laminates.find((l) => l.id === variant.laminateId);
  const index = laminate?.loadCases.findIndex((c) => c.id === variant.loadCaseId) ?? -1;
  if (!laminate || index < 0) return null;
  return {
    laminate_uuid: laminate.id,
    load_case_index: index,
    load_case_name: laminate.loadCases[index].name,
  };
}

/** The extension to write, or null when there is nothing in it - the core
 *  writes no element then, so a project using no web-only feature stays
 *  exactly what the desktop would write. */
function toWebExtension(snapshot: ProjectSnapshot): WebExtension | null {
  const carry = snapshot.webExtensionCarry ?? EMPTY_WEB_EXTENSION_CARRY;
  const variants = (snapshot.comparison ?? [])
    .map((v) => toFileVariant(v, snapshot.laminates))
    .filter((v): v is ComparisonVariant => v !== null);
  const extension: WebExtension = {
    schema: 1,
    // Written by the core from the layers themselves.
    layer_criteria: [],
    studies: carry.studies,
    snapshots: carry.snapshots,
    report_templates: carry.reportTemplates,
    comparison: variants.length > 0 ? { variants } : null,
    stacking_rule_settings: snapshot.stackingRuleSettings ?? null,
  };
  const empty =
    extension.layer_criteria.length === 0 &&
    extension.studies.length === 0 &&
    extension.snapshots.length === 0 &&
    extension.report_templates.length === 0 &&
    extension.comparison === null &&
    extension.stacking_rule_settings === null;
  return empty ? null : extension;
}

const KNOWN_CRITERIA = new Set<string>(CRITERIA.map((c) => c.id));

function asCriterionId(value: string | null): CriterionId {
  // The core rejects criteria it cannot resolve, so anything arriving here is
  // one it knows. It may still be one this build's UI has no entry for, in
  // which case falling back keeps the file open instead of failing on a
  // dropdown value.
  return value && KNOWN_CRITERIA.has(value) ? (value as CriterionId) : DEFAULT_CRITERION_ID;
}

/** A layer's extra criteria as the row keeps them: absent when there are
 *  none, so a layer from eLamX 3.x looks exactly as it did before extra
 *  criteria existed. The core has already dropped ids it does not know. */
function extraCriteriaOf(ids: string[] | undefined): { extraCriteria?: CriterionId[] } {
  const known = (ids ?? []).filter((id): id is CriterionId => KNOWN_CRITERIA.has(id));
  return known.length > 0 ? { extraCriteria: known } : {};
}

/** Which of the two input formats a file is.
 *
 *  `reduced` is `.elamxb`, the shorthand the batch mode takes: the same root
 *  element, a different document. Chosen by the caller from the file name
 *  rather than sniffed, which is how the original decides too - its batch mode
 *  has a `--reducedinput` switch. */
export type ProjectFormat = "project" | "reduced";

/** Parses `.elamx` (or `.elamxb`) XML into the app's state. Throws with the
 *  core's own message (which names the offending element) if the file cannot be
 *  read. */
export async function importProject(
  xml: string,
  format: ProjectFormat = "project",
): Promise<ProjectSnapshot> {
  const project: ProjectDto = JSON.parse(
    format === "reduced" ? await elamx.import_elamxb(xml) : await elamx.import_elamx(xml),
  );

  const bucklings: Record<string, BucklingInputDto> = {};
  const lastPlyFailures: Record<string, LastPlyFailureInputDto> = {};
  const pressureVessels: Record<string, PressureVesselInputDto> = {};
  const deformations: Record<string, DeformationInputDto> = {};
  const vibrations: Record<string, VibrationInputDto> = {};
  const springIns: Record<string, SpringInInputDto> = {};
  const cutouts: Record<string, CutoutInputDto> = {};
  const [optimization, ...extraOptimizations] = project.optimizations ?? [];
  const laminates = project.laminates.map((entry) => {
    const dto = entry.laminate;
    const [buckling, ...extraBucklings] = entry.bucklings;
    const [lastPlyFailure, ...extraLastPlyFailures] = entry.last_ply_failures ?? [];
    const [pressureVessel, ...extraPressureVessels] = entry.pressure_vessels ?? [];
    const [deformation, ...extraDeformations] = entry.deformations ?? [];
    const [vibration, ...extraVibrations] = entry.vibrations ?? [];
    const [springIn, ...extraSpringIns] = entry.spring_ins ?? [];
    const [cutout, ...extraCutouts] = entry.cutouts ?? [];

    // Every <calculation> becomes a load case, in file order. A file with none
    // still opens - it gets the default case, the same one a new laminate has.
    const loadCases: LoadCase[] = entry.calculations.map((calculation, i) => ({
      id: crypto.randomUUID(),
      name: calculation.name || `${i + 1}`,
      dofValues: calculation.use_strain.map((useStrain, k) =>
        useStrain ? calculation.strains[STRAIN_FIELDS[k]] : calculation.loads[LOAD_FIELDS[k]],
      ),
      useStrain: [...calculation.use_strain],
      deltaT: calculation.loads.delta_t ?? 0,
      deltaH: calculation.loads.delta_h ?? 0,
    }));

    const config: LaminateConfig = {
      ...defaultLaminateConfig(dto.id, dto.name, ""),
      layers: dto.layers.map(
        (l): LayerRow => ({
          id: l.id,
          name: l.name,
          angle: l.angle,
          thickness: l.thickness,
          materialId: l.material_id,
          criterionId: asCriterionId(l.criterion_id),
          ...extraCriteriaOf(l.extra_criteria),
        }),
      ),
      symmetric: dto.symmetric,
      withMiddleLayer: dto.with_middle_layer,
      invertZ: dto.invert_z,
      offset: dto.offset,
      // A file's load case may prescribe strains for some degrees of freedom
      // and loads for the others, so the stored value per DOF comes from
      // whichever of the two that flag selects (see loadCases above).
      loadCases: loadCases.length > 0 ? loadCases : [defaultLoadCase("1")],
      carryOver: {
        bucklingName: buckling?.name,
        lastPlyFailureName: lastPlyFailure?.name,
        pressureVesselName: pressureVessel?.name,
        deformationName: deformation?.name,
        vibrationName: vibration?.name,
        springInName: springIn?.name,
        cutoutName: cutout?.name,
        extraVibrations,
        extraSpringIns,
        extraCutouts,
        extraBucklings,
        extraLastPlyFailures,
        extraPressureVessels,
        extraDeformations,
        unsupportedModules: entry.unsupported_modules ?? [],
      },
    };

    if (buckling) bucklings[dto.id] = buckling.input;
    if (lastPlyFailure) lastPlyFailures[dto.id] = lastPlyFailure.input;
    if (pressureVessel) pressureVessels[dto.id] = pressureVessel.input;
    if (deformation) deformations[dto.id] = deformation.input;
    if (vibration) vibrations[dto.id] = vibration.input;
    if (springIn) springIns[dto.id] = springIn.input;
    if (cutout) cutouts[dto.id] = cutout.input;
    return config;
  });

  const extension = project.web_extension ?? null;
  const importNotices: ImportNotice[] = [...(project.import_notices ?? [])];
  const comparison: Variant[] = [];
  for (const variant of extension?.comparison?.variants ?? []) {
    const resolved = resolveVariant(variant, laminates);
    if (resolved) {
      comparison.push(resolved);
    } else {
      importNotices.push({
        kind: "comparison_variant_dropped",
        laminate:
          laminates.find((l) => l.id === variant.laminate_uuid)?.name ?? variant.laminate_uuid,
        loadCase: variant.load_case_name,
      });
    }
  }

  return {
    materials: project.materials,
    fibres: project.fibres ?? [],
    matrices: project.matrices ?? [],
    laminates,
    bucklings,
    lastPlyFailures,
    pressureVessels,
    deformations,
    vibrations,
    springIns,
    cutouts,
    optimization,
    extraOptimizations,
    version: project.version,
    unsupportedSections: project.unsupported_sections ?? [],
    comparison,
    webExtensionCarry: extension
      ? {
          studies: extension.studies,
          snapshots: extension.snapshots,
          reportTemplates: extension.report_templates,
        }
      : EMPTY_WEB_EXTENSION_CARRY,
    stackingRuleSettings: extension?.stacking_rule_settings ?? null,
    importNotices,
  };
}

/** Serialises the app's state to `.elamx` XML. */
export async function exportProject(snapshot: ProjectSnapshot): Promise<string> {

  const project: ProjectDto = {
    version: snapshot.version || "1",
    unsupported_sections: snapshot.unsupportedSections,
    web_extension: toWebExtension(snapshot),
    materials: snapshot.materials,
    fibres: snapshot.fibres,
    matrices: snapshot.matrices,
    optimizations: [
      ...(snapshot.optimization ? [snapshot.optimization] : []),
      ...((snapshot.extraOptimizations ?? []) as OptimizationEntryDto[]),
    ],
    laminates: snapshot.laminates.map((config) => {
      const carry = config.carryOver ?? {};

      const calculations: CalculationDto[] = config.loadCases.map((loadCase) => {
        const loads: Record<string, number> = {
          n_x: 0, n_y: 0, n_xy: 0, m_x: 0, m_y: 0, m_xy: 0,
          delta_t: loadCase.deltaT, delta_h: loadCase.deltaH,
          nt_x: 0, nt_y: 0, nt_xy: 0, mt_x: 0, mt_y: 0, mt_xy: 0,
        };
        const strains: Record<string, number> = {
          epsilon_x: 0, epsilon_y: 0, gamma_xy: 0, kappa_x: 0, kappa_y: 0, kappa_xy: 0,
        };
        loadCase.dofValues.forEach((value, i) => {
          if (loadCase.useStrain[i]) strains[STRAIN_FIELDS[i]] = value;
          else loads[LOAD_FIELDS[i]] = value;
        });
        return { name: loadCase.name, loads, strains, use_strain: [...loadCase.useStrain] };
      });

      const buckling = snapshot.bucklings[config.id];
      const lastPlyFailure = snapshot.lastPlyFailures[config.id];
      const pressureVessel = snapshot.pressureVessels[config.id];
      const deformation = snapshot.deformations[config.id];
      const vibration = snapshot.vibrations[config.id];
      const springIn = snapshot.springIns[config.id];
      const cutout = snapshot.cutouts[config.id];

      return {
        laminate: {
          id: config.id,
          name: config.name,
          layers: config.layers.map((l) => ({
            id: l.id,
            name: l.name,
            angle: l.angle,
            thickness: l.thickness,
            material_id: l.materialId,
            criterion_id: l.criterionId,
            extra_criteria: l.extraCriteria ?? [],
          })),
          symmetric: config.symmetric,
          with_middle_layer: config.withMiddleLayer,
          invert_z: config.invertZ,
          offset: config.offset,
        },
        calculations,
        bucklings: [
          ...(buckling
            ? [{ name: carry.bucklingName ?? "Plattenbeulen", input: buckling }]
            : []),
          ...((carry.extraBucklings ?? []) as BucklingEntryDto[]),
        ],
        last_ply_failures: [
          ...(lastPlyFailure
            ? [{ name: carry.lastPlyFailureName ?? "Last Ply Failure", input: lastPlyFailure }]
            : []),
          ...((carry.extraLastPlyFailures ?? []) as LastPlyFailureEntryDto[]),
        ],
        pressure_vessels: [
          ...(pressureVessel
            ? [{ name: carry.pressureVesselName ?? "Drucktank", input: pressureVessel }]
            : []),
          ...((carry.extraPressureVessels ?? []) as PressureVesselEntryDto[]),
        ],
        deformations: [
          ...(deformation
            ? [{ name: carry.deformationName ?? "Plattenverformung", input: deformation }]
            : []),
          ...((carry.extraDeformations ?? []) as DeformationEntryDto[]),
        ],
        vibrations: [
          ...(vibration
            ? [{ name: carry.vibrationName ?? "Plattenschwingung", input: vibration }]
            : []),
          ...((carry.extraVibrations ?? []) as VibrationEntryDto[]),
        ],
        spring_ins: [
          ...(springIn ? [{ name: carry.springInName ?? "Spring-In", input: springIn }] : []),
          ...((carry.extraSpringIns ?? []) as SpringInEntryDto[]),
        ],
        cutouts: [
          ...(cutout ? [{ name: carry.cutoutName ?? "Ausschnitt", input: cutout }] : []),
          ...((carry.extraCutouts ?? []) as CutoutEntryDto[]),
        ],
        unsupported_modules: carry.unsupportedModules ?? [],
      };
    }),
  };

  return await elamx.export_elamx(JSON.stringify(project));
}

/** Hands the XML to the browser as a download. */
export function downloadProject(xml: string, filename: string) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".elamx") ? filename : `${filename}.elamx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
