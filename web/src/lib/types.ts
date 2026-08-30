// Mirrors the JSON shapes of elamx-core's Rust structs (see
// elamx-core/core/src/model/ and elamx-core/wasm/src/lib.rs). Field names
// must match the Rust `serde` field names exactly (snake_case, no renames).
import type { MessageKey } from "../i18n";

export interface MaterialDto {
  id: string;
  name: string;
  e_par: number;
  e_nor: number;
  nue12: number;
  g: number;
  g13: number;
  g23: number;
  rho: number;
  alpha_t_par: number;
  alpha_t_nor: number;
  beta_par: number;
  beta_nor: number;
  r_par_ten: number;
  r_par_com: number;
  r_nor_ten: number;
  r_nor_com: number;
  r_shear: number;
  additional_values: Record<string, number>;
}

export interface LayerDto {
  id: string;
  name: string;
  angle: number;
  thickness: number;
  material_id: string;
  criterion_id: string | null;
}

export interface LaminateDto {
  id: string;
  name: string;
  layers: LayerDto[];
  symmetric: boolean;
  with_middle_layer: boolean;
  invert_z: boolean;
  offset: number;
}

export interface LoadsDto {
  n_x: number;
  n_y: number;
  n_xy: number;
  m_x: number;
  m_y: number;
  m_xy: number;
  delta_t: number;
  delta_h: number;
  nt_x: number;
  nt_y: number;
  nt_xy: number;
  mt_x: number;
  mt_y: number;
  mt_xy: number;
}

export interface StrainsDto {
  epsilon_x: number;
  epsilon_y: number;
  gamma_xy: number;
  kappa_x: number;
  kappa_y: number;
  kappa_xy: number;
}

export interface CltRequest {
  laminate: LaminateDto;
  materials: Record<string, MaterialDto>;
  loads: LoadsDto;
  strains: StrainsDto;
  use_strain: [boolean, boolean, boolean, boolean, boolean, boolean];
}

export interface StressStrainStateDto {
  stress: [number, number, number];
  strain: [number, number, number];
}

export type FailureType = "Undamaged" | "FiberFailure" | "MatrixFailure" | "GeneralMaterialFailure";

export interface ReserveFactorDto {
  failure_name: string;
  minimal_reserve_factor: number;
  failure_type: FailureType;
}

export interface LayerResultDto {
  layer_number: number;
  sss_lower: StressStrainStateDto;
  sss_upper: StressStrainStateDto;
  sss_lower_global: StressStrainStateDto;
  sss_upper_global: StressStrainStateDto;
  rr_lower: ReserveFactorDto;
  rr_upper: ReserveFactorDto;
  failed: boolean;
}

export interface EngineeringConstantsDto {
  ex_simple: number;
  ey_simple: number;
  g_simple: number;
  nuxy_simple: number;
  nuyx_simple: number;
  ex_fixed: number;
  ey_fixed: number;
  g_fixed: number;
  nuxy_fixed: number;
  nuyx_fixed: number;
  ex_bend_simple: number;
  ey_bend_simple: number;
  g_bend_simple: number;
  nuxy_bend_simple: number;
  nuyx_bend_simple: number;
  ex_bend_fixed: number;
  ey_bend_fixed: number;
  g_bend_fixed: number;
  nuxy_bend_fixed: number;
  nuyx_bend_fixed: number;
  beta_d: number;
  nu_d: number;
  gamma_d: number;
  delta_d: number;
}

export interface MassMomentsDto {
  i0: number;
  i1: number;
  i2: number;
}

export interface LayerContributionDto {
  layer_number: number;
  angle_deg: number;
  thickness: number;
  zm: number;
  /** Of the EXPANDED ply - the mirrored half of a symmetric laminate exists
   *  only in the core's expansion, so this is where its material comes from. */
  material_id: string;
  criterion_id: string | null;
  q_global: number[][];
  a_contribution: number[][];
  b_contribution: number[][];
  d_contribution: number[][];
}

export interface CltResponse {
  abd: number[][];
  /** Inverse of `abd` - lets the UI show the "simple" engineering constants' derivation with real numbers. */
  abd_inv: number[][];
  tges: number;
  is_symmetric: boolean;
  area_weight: number;
  mass_moments: MassMomentsDto | null;
  loads: LoadsDto;
  strains: StrainsDto;
  engineering_constants: EngineeringConstantsDto;
  layer_contributions: LayerContributionDto[];
  layer_results: LayerResultDto[];
}

export interface AngleSweepResponse {
  angle_deg: number[];
  a11: number[];
  a12: number[];
  a22: number[];
  a66: number[];
}

// Criterion ids and their additional-value keys, matching the `pub const`s in
// elamx-core/core/src/failure/{mod,max_strain,tsai_wu,puck,fmc,ztl}.rs.
// Most criterion names are proper nouns and read identically in every
// language ("Puck", "Tsai-Wu"), but a few are descriptive ("Max. Spannung" /
// "Max. stress"), so all of them go through the catalog uniformly rather than
// splitting the list into translated and untranslated halves.
export const CRITERIA = [
  { id: "max_stress", labelKey: "criterion.max_stress" },
  { id: "tsai_hill", labelKey: "criterion.tsai_hill" },
  { id: "hashin", labelKey: "criterion.hashin" },
  { id: "tsai_wu", labelKey: "criterion.tsai_wu" },
  { id: "max_strain", labelKey: "criterion.max_strain" },
  { id: "puck", labelKey: "criterion.puck" },
  { id: "christensen", labelKey: "criterion.christensen" },
  { id: "edge", labelKey: "criterion.edge" },
  { id: "fibre_failure", labelKey: "criterion.fibre_failure" },
  { id: "fmc", labelKey: "criterion.fmc" },
  { id: "hoffman", labelKey: "criterion.hoffman" },
  { id: "mayes", labelKey: "criterion.mayes" },
  { id: "rotem", labelKey: "criterion.rotem" },
  { id: "sun", labelKey: "criterion.sun" },
  { id: "ztl", labelKey: "criterion.ztl" },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

export type CriterionId = (typeof CRITERIA)[number]["id"];

export const MAX_STRAIN_KEYS = {
  epsX: "max_strain.eps_x",
  epsY: "max_strain.eps_y",
  gammaXy: "max_strain.gamma_xy",
  globalLocal: "max_strain.global_local",
} as const;

export const TSAI_WU_KEYS = {
  f12Star: "tsai_wu.f12_star",
} as const;

export const PUCK_KEYS = {
  pSpd: "puck.p_spd",
  pSpz: "puck.p_spz",
  a0: "puck.a0",
  lambdaMin: "puck.lambda_min",
} as const;

export const FMC_KEYS = {
  mueSp: "fmc.mue_sp",
  m: "fmc.m",
} as const;

export const ZTL_KEYS = {
  f12Star: "ztl.f12_star",
} as const;

// Sensible starting values for every criterion's additional parameters, so a
// newly created material works with any criterion the user picks without
// first hitting a "missing additional value" error - the Rust core requires
// each key to be explicitly present (it never assumes a default), and 0 would
// be a *wrong* default for some of these (e.g. Puck's p_spd is a divisor).
export const DEFAULT_ADDITIONAL_VALUES: Record<string, number> = {
  [MAX_STRAIN_KEYS.epsX]: 0.01,
  [MAX_STRAIN_KEYS.epsY]: 0.01,
  [MAX_STRAIN_KEYS.gammaXy]: 0.02,
  [MAX_STRAIN_KEYS.globalLocal]: 0,
  [TSAI_WU_KEYS.f12Star]: -0.5,
  [PUCK_KEYS.pSpd]: 0.3,
  [PUCK_KEYS.pSpz]: 0.35,
  [PUCK_KEYS.a0]: 0.5,
  [PUCK_KEYS.lambdaMin]: 0.5,
  [FMC_KEYS.mueSp]: 0.3,
  [FMC_KEYS.m]: 1.5,
  [ZTL_KEYS.f12Star]: -0.5,
};

export const emptyLoads = (): LoadsDto => ({
  n_x: 0,
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
});

export const emptyStrains = (): StrainsDto => ({
  epsilon_x: 0,
  epsilon_y: 0,
  gamma_xy: 0,
  kappa_x: 0,
  kappa_y: 0,
  kappa_xy: 0,
});

// --- Plate buckling (elamx-core::plate) -------------------------------------
// Mirrors BucklingRequest/BucklingResponse in elamx-core/wasm/src/lib.rs.

/** Edge condition of one pair of opposite edges: S(imply supported), C(lamped), F(ree). */
export type BoundaryConditionId = "SS" | "CC" | "CF" | "FF" | "SC" | "SF";

export const BOUNDARY_CONDITIONS = [
  "SS",
  "CC",
  "CF",
  "FF",
  "SC",
  "SF",
] as const satisfies readonly BoundaryConditionId[];

/** Which bending stiffness idealisation the plate is analysed with. */
export type DMatrixKindId = "standard" | "special_orthotropic" | "d_tilde";

export const D_MATRIX_KINDS = [
  { id: "standard", labelKey: "buckling.dMatrix.standard" },
  { id: "special_orthotropic", labelKey: "buckling.dMatrix.specialOrthotropic" },
  { id: "d_tilde", labelKey: "buckling.dMatrix.dTilde" },
] as const satisfies readonly { id: DMatrixKindId; labelKey: MessageKey }[];

/** eLamX2 caps the Ritz term counts here, and so do the ported integral tables. */
export const MAX_RITZ_TERMS = 20;

export interface BucklingInputDto {
  length: number;
  width: number;
  n_x: number;
  n_y: number;
  n_xy: number;
  bc_x: BoundaryConditionId;
  bc_y: BoundaryConditionId;
  m: number;
  n: number;
  d_matrix: DMatrixKindId;
}

export interface BucklingModeDto {
  /** Load factor: the applied load flows times this buckle the plate. */
  eigenvalue: number;
  /** Modal amplitudes a_ij, m rows of n. */
  shape: number[][];
  /** w(x,y) on a square grid, rows along y, peak normalised to 1. */
  surface: number[][] | null;
}

export interface BucklingResponse {
  critical_factor: number | null;
  n_crit: [number, number, number] | null;
  modes: BucklingModeDto[];
  symmetry_warning: boolean;
}

// --- Plate deformation (elamx-core::plate::deformation) ---------------------
// Mirrors DeformationRequest / DeformationResult in elamx-core/wasm/src/lib.rs.

/** A transverse load. Serde tags the variant with `kind` and flattens the
 *  name beside it, so the JSON is one flat object per load. */
export type NamedLoadDto =
  | { kind: "Surface"; name: string; force: number }
  | { kind: "Point"; name: string; x: number; y: number; force: number };

export interface DeformationInputDto {
  length: number;
  width: number;
  bc_x: BoundaryConditionId;
  bc_y: BoundaryConditionId;
  m: number;
  n: number;
  d_matrix: DMatrixKindId;
  loads: NamedLoadDto[];
}

export interface DeformationResponse {
  /** Ritz coefficients, m rows of n. */
  coefficients: number[][];
  /** Deflection on a regular grid, rows along y - in real length units. */
  surface: number[][];
  max_deflection: number;
  /** Where the maximum sits, as [x, y] on the plate. */
  max_at: [number, number];
  min_deflection: number;
  symmetry_warning: boolean;
}

// --- Pressure vessel (elamx-core::clt::pressure_vessel) ---------------------
// Mirrors PressureVesselRequest / PressureVesselResult in
// elamx-core/wasm/src/lib.rs.

/** Which radius the user measured; the analysis works on the mean one. */
export type RadiusTypeId = "Inner" | "Mean" | "Outer";

export const RADIUS_TYPES = [
  { id: "Inner", labelKey: "vessel.radius.inner" },
  { id: "Mean", labelKey: "vessel.radius.mean" },
  { id: "Outer", labelKey: "vessel.radius.outer" },
] as const satisfies readonly { id: RadiusTypeId; labelKey: MessageKey }[];

export interface PressureVesselInputDto {
  pressure: number;
  radius: number;
  radius_type: RadiusTypeId;
}

export interface PressureVesselResponse {
  /** Derived from the given radius and the wall thickness. */
  mean_radius: number;
  /** The boiler-formula load, plus the moments the straight wall requires. */
  loads: LoadsDto;
  /** Axial strain in epsilon_x, hoop strain in epsilon_y; curvatures are zero. */
  strains: StrainsDto;
  layer_results: LayerResultDto[];
}

// --- Failure body (elamx-core::failure::envelope) ---------------------------
// Mirrors FailureEnvelope in elamx-core/wasm/src/lib.rs.

export interface FailureEnvelopeResponse {
  /** Surface grid in the ply's local stress space, [sigma_par, sigma_nor, tau].
   *  `null` is a direction the criterion could not evaluate. */
  points: ([number, number, number] | null)[][];
  polar_samples: number;
  azimuth_samples: number;
}

// --- Last ply failure (elamx-core::clt::last_ply_failure) -------------------
// Mirrors LastPlyFailureRequest / LastPlyFailureResult in
// elamx-core/wasm/src/lib.rs.

export interface LastPlyFailureInputDto {
  loads: LoadsDto;
  /** Factor a degraded ply's stiffness is multiplied by. */
  degradation_factor: number;
  /** Fibre-direction strain treated as the allowable one. */
  epsilon_crit: number;
  /** Knock-down on the reserve factor of an inter-fibre failure. */
  j_a: number;
  degrade_all_on_fibre_failure: boolean;
}

/** A reserve factor together with the degradation step it belongs to. */
export interface LastPlyFailureEventDto {
  reserve_factor: number;
  iteration: number;
}

export interface LastPlyFailureIterationDto {
  layer_results: LayerResultDto[];
  /** Per ply, in stacking order, after this step. */
  matrix_failed: boolean[];
  fibre_failed: boolean[];
  /** 1-based stacking position of the ply degraded in this step. */
  layer_number: number;
  reserve_factor: number;
  failure_name: string;
  failure_type: FailureType;
}

export interface LastPlyFailureResponse {
  iterations: LastPlyFailureIterationDto[];
  first_fibre_failure: LastPlyFailureEventDto | null;
  first_matrix_failure: LastPlyFailureEventDto | null;
  first_epsilon: LastPlyFailureEventDto | null;
  exceedance_factor: LastPlyFailureEventDto | null;
  fibre_before_matrix_failure: boolean;
}
