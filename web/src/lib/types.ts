// The app's names for the types that cross the wasm boundary.
//
// The shapes themselves are GENERATED from the Rust structs by ts-rs (see
// elamx-core/core/tests, `cargo test --features ts`) and live in
// ./generated/. They used to be written out by hand here, mirroring the Rust
// with nothing but a comment saying so - and a renamed serde field would then
// compile on both sides and fail at runtime as an `undefined`.
//
// Aliased rather than used under their Rust names, because the app has its own
// vocabulary: a `Dto` suffix for a payload, an `Id` suffix for a string union.
// Renaming or removing a Rust type now breaks this file, which is the point.

import type { MessageKey } from "../i18n";
import type { AngleSweepResponse as GenAngleSweepResponse } from "./generated/AngleSweepResponse";
import type { BoundaryCondition as GenBoundaryCondition } from "./generated/BoundaryCondition";
import type { BucklingInput as GenBucklingInput } from "./generated/BucklingInput";
import type { BucklingModeDto as GenBucklingModeDto } from "./generated/BucklingModeDto";
import type { BucklingResponse as GenBucklingResponse } from "./generated/BucklingResponse";
import type { CltRequest as GenCltRequest } from "./generated/CltRequest";
import type { CltResponse as GenCltResponse } from "./generated/CltResponse";
import type { DMatrixKind as GenDMatrixKind } from "./generated/DMatrixKind";
import type { DeformationInput as GenDeformationInput } from "./generated/DeformationInput";
import type { DeformationResult as GenDeformationResult } from "./generated/DeformationResult";
import type { EngineeringConstantsDto as GenEngineeringConstantsDto } from "./generated/EngineeringConstantsDto";
import type { FailureEnvelope as GenFailureEnvelope } from "./generated/FailureEnvelope";
import type { FailureType as GenFailureType } from "./generated/FailureType";
import type { Laminate as GenLaminate } from "./generated/Laminate";
import type { LastPlyFailureEvent as GenLastPlyFailureEvent } from "./generated/LastPlyFailureEvent";
import type { LastPlyFailureInput as GenLastPlyFailureInput } from "./generated/LastPlyFailureInput";
import type { LastPlyFailureIteration as GenLastPlyFailureIteration } from "./generated/LastPlyFailureIteration";
import type { LastPlyFailureResult as GenLastPlyFailureResult } from "./generated/LastPlyFailureResult";
import type { Layer as GenLayer } from "./generated/Layer";
import type { LayerContributionDto as GenLayerContributionDto } from "./generated/LayerContributionDto";
import type { LayerPosition as GenLayerPosition } from "./generated/LayerPosition";
import type { LayerResult as GenLayerResult } from "./generated/LayerResult";
import type { Loads as GenLoads } from "./generated/Loads";
import type { MassMomentsDto as GenMassMomentsDto } from "./generated/MassMomentsDto";
import type { Material as GenMaterial } from "./generated/Material";
import type { NamedLoad as GenNamedLoad } from "./generated/NamedLoad";
import type { PlateField as GenPlateField } from "./generated/PlateField";
import type { PlateFieldResult as GenPlateFieldResult } from "./generated/PlateFieldResult";
import type { PressureVesselInput as GenPressureVesselInput } from "./generated/PressureVesselInput";
import type { PressureVesselResult as GenPressureVesselResult } from "./generated/PressureVesselResult";
import type { RadiusType as GenRadiusType } from "./generated/RadiusType";
import type { ReserveFactor as GenReserveFactor } from "./generated/ReserveFactor";
import type { Strains as GenStrains } from "./generated/Strains";
import type { StressStrainState as GenStressStrainState } from "./generated/StressStrainState";

export type AngleSweepResponse = GenAngleSweepResponse;
export type BoundaryConditionId = GenBoundaryCondition;
export type BucklingInputDto = GenBucklingInput;
export type BucklingModeDto = GenBucklingModeDto;
export type BucklingResponse = GenBucklingResponse;
export type CltRequest = GenCltRequest;
export type CltResponse = GenCltResponse;
export type DMatrixKindId = GenDMatrixKind;
export type DeformationInputDto = GenDeformationInput;
export type DeformationResponse = GenDeformationResult;
export type EngineeringConstantsDto = GenEngineeringConstantsDto;
export type FailureEnvelopeResponse = GenFailureEnvelope;
export type FailureType = GenFailureType;
export type LaminateDto = GenLaminate;
export type LastPlyFailureEventDto = GenLastPlyFailureEvent;
export type LastPlyFailureInputDto = GenLastPlyFailureInput;
export type LastPlyFailureIterationDto = GenLastPlyFailureIteration;
export type LastPlyFailureResponse = GenLastPlyFailureResult;
export type LayerContributionDto = GenLayerContributionDto;
export type LayerPositionId = GenLayerPosition;
export type LayerDto = GenLayer;
export type LayerResultDto = GenLayerResult;
export type LoadsDto = GenLoads;
export type MassMomentsDto = GenMassMomentsDto;
export type MaterialDto = GenMaterial;
export type NamedLoadDto = GenNamedLoad;
export type PlateFieldId = GenPlateField;
export type PlateFieldResponse = GenPlateFieldResult;
export type PressureVesselInputDto = GenPressureVesselInput;
export type PressureVesselResponse = GenPressureVesselResult;
export type RadiusTypeId = GenRadiusType;
export type ReserveFactorDto = GenReserveFactor;
export type StrainsDto = GenStrains;
export type StressStrainStateDto = GenStressStrainState;

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

export const BOUNDARY_CONDITIONS = [
  "SS",
  "CC",
  "CF",
  "FF",
  "SC",
  "SF",
] as const satisfies readonly BoundaryConditionId[];

export const D_MATRIX_KINDS = [
  { id: "standard", labelKey: "buckling.dMatrix.standard" },
  { id: "special_orthotropic", labelKey: "buckling.dMatrix.specialOrthotropic" },
  { id: "d_tilde", labelKey: "buckling.dMatrix.dTilde" },
] as const satisfies readonly { id: DMatrixKindId; labelKey: MessageKey }[];

/** eLamX2 caps the Ritz term counts here, and so do the ported integral tables. */
export const MAX_RITZ_TERMS = 20;

export const RADIUS_TYPES = [
  { id: "Inner", labelKey: "vessel.radius.inner" },
  { id: "Mean", labelKey: "vessel.radius.mean" },
  { id: "Outer", labelKey: "vessel.radius.outer" },
] as const satisfies readonly { id: RadiusTypeId; labelKey: MessageKey }[];

