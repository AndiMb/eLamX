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
// dropped: analyses beyond the first of each kind, and modules with no web
// counterpart (cutouts, spring-in, optimisation). Load cases are not among
// them - every <calculation> in the file becomes a real load case. See
// `CarryOver` in store/laminateAtoms.ts.

import { loadElamxWasm } from "./wasm";
import { DEFAULT_CRITERION_ID, LOAD_FIELDS, STRAIN_FIELDS, type LayerRow } from "./constants";
import {
  CRITERIA,
  type BucklingInputDto,
  type CriterionId,
  type LastPlyFailureInputDto,
  type MaterialDto,
  type DeformationInputDto,
  type PressureVesselInputDto,
} from "./types";
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
  laminates: ProjectLaminateDto[];
  /** `<fibres>`, `<matrices>`, `<optimizations>` as raw XML - sections the
   *  core does not model and this app does not touch, carried so that saving
   *  a desktop project does not delete its fibre materials. */
  unsupported_sections?: unknown[];
}

interface ProjectLaminateDto {
  laminate: LaminateDto;
  calculations: CalculationDto[];
  bucklings: BucklingEntryDto[];
  last_ply_failures: LastPlyFailureEntryDto[];
  pressure_vessels: PressureVesselEntryDto[];
  deformations: DeformationEntryDto[];
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

/** A whole session: what a file turns into on open, and what a save turns
 *  back into a file. The same shape in both directions on purpose - anything
 *  that survives one has to survive the other. */
export interface ProjectSnapshot {
  materials: MaterialDto[];
  laminates: LaminateConfig[];
  bucklings: Record<string, BucklingInputDto>;
  lastPlyFailures: Record<string, LastPlyFailureInputDto>;
  pressureVessels: Record<string, PressureVesselInputDto>;
  deformations: Record<string, DeformationInputDto>;
  version: string;
  /** Project-level sections carried through untouched - see ProjectDto. */
  unsupportedSections: unknown[];
}

const KNOWN_CRITERIA = new Set<string>(CRITERIA.map((c) => c.id));

function asCriterionId(value: string | null): CriterionId {
  // The core rejects criteria it cannot resolve, so anything arriving here is
  // one it knows. It may still be one this build's UI has no entry for, in
  // which case falling back keeps the file open instead of failing on a
  // dropdown value.
  return value && KNOWN_CRITERIA.has(value) ? (value as CriterionId) : DEFAULT_CRITERION_ID;
}

/** Parses `.elamx` XML into the app's state. Throws with the core's own
 *  message (which names the offending element) if the file cannot be read. */
export async function importProject(xml: string): Promise<ProjectSnapshot> {
  const wasm = await loadElamxWasm();
  const project: ProjectDto = JSON.parse(wasm.import_elamx(xml));

  const bucklings: Record<string, BucklingInputDto> = {};
  const lastPlyFailures: Record<string, LastPlyFailureInputDto> = {};
  const pressureVessels: Record<string, PressureVesselInputDto> = {};
  const deformations: Record<string, DeformationInputDto> = {};
  const laminates = project.laminates.map((entry) => {
    const dto = entry.laminate;
    const [buckling, ...extraBucklings] = entry.bucklings;
    const [lastPlyFailure, ...extraLastPlyFailures] = entry.last_ply_failures ?? [];
    const [pressureVessel, ...extraPressureVessels] = entry.pressure_vessels ?? [];
    const [deformation, ...extraDeformations] = entry.deformations ?? [];

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
    return config;
  });

  return {
    materials: project.materials,
    laminates,
    bucklings,
    lastPlyFailures,
    pressureVessels,
    deformations,
    version: project.version,
    unsupportedSections: project.unsupported_sections ?? [],
  };
}

/** Serialises the app's state to `.elamx` XML. */
export async function exportProject(snapshot: ProjectSnapshot): Promise<string> {
  const wasm = await loadElamxWasm();

  const project: ProjectDto = {
    version: snapshot.version || "1",
    unsupported_sections: snapshot.unsupportedSections,
    materials: snapshot.materials,
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
        unsupported_modules: carry.unsupportedModules ?? [],
      };
    }),
  };

  return wasm.export_elamx(JSON.stringify(project));
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
