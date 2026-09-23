import {
  DEFAULT_ADDITIONAL_VALUES,
  type CriterionId,
  type FibreDto,
  type MaterialDto,
  type MatrixMaterialDto,
  type MicroMechanicsDto,
} from "./types";
import type { SymbolSpec } from "./symbols";
import { t } from "../i18n";

// Failure criterion is per-LAYER (matches the Java original's layup editor,
// and elamx-core's own LayerDto/CltLayer, which already carry their own
// criterion_id - see calculator.rs's get_layer_results) rather than one
// laminate-wide setting.
export const DEFAULT_CRITERION_ID: CriterionId = "max_stress";

export interface LayerRow {
  id: string;
  name: string;
  angle: number;
  thickness: number;
  materialId: string;
  criterionId: CriterionId;
  /** Criteria checked besides `criterionId`, in order; the ply's reserve
   *  factor is the minimum over all of them. Absent means none - eLamX 3.x
   *  knows only the one, so every layer that came from it has no extras and
   *  nothing needs migrating. Travels in the file's `<webExtension>`. */
  extraCriteria?: CriterionId[];
}

// Base/index pairs rather than pre-rendered strings so each call site can pick
// the right form for its slot - see lib/symbols.ts for the notation rule.
export const DOF_NAMES = [
  { load: { base: "N", sub: "x" }, strain: { base: "ε", sub: "x" } },
  { load: { base: "N", sub: "y" }, strain: { base: "ε", sub: "y" } },
  { load: { base: "N", sub: "xy" }, strain: { base: "γ", sub: "xy" } },
  { load: { base: "M", sub: "x" }, strain: { base: "κ", sub: "x" } },
  { load: { base: "M", sub: "y" }, strain: { base: "κ", sub: "y" } },
  { load: { base: "M", sub: "xy" }, strain: { base: "κ", sub: "xy" } },
] as const satisfies readonly { load: SymbolSpec; strain: SymbolSpec }[];

export const LOAD_FIELDS = ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy"] as const;

// The hygrothermal force/moment vector the core computes from dT/dH and each
// layer's alpha/beta (Loads::set_hygrothermal_forces_vector). Same DOF order as
// LOAD_FIELDS - it is the second summand of the CLT equation, never an input.
export const HYGROTHERMAL_FIELDS = ["nt_x", "nt_y", "nt_xy", "mt_x", "mt_y", "mt_xy"] as const;

export const STRAIN_FIELDS = [
  "epsilon_x",
  "epsilon_y",
  "gamma_xy",
  "kappa_x",
  "kappa_y",
  "kappa_xy",
] as const;

// Names produced here (and by defaultLayers below) are user DATA, not UI
// labels: they are written once, in whatever language is active at creation
// time, and the user can rename them freely afterwards. Hence the plain t()
// rather than the reactive useT() - re-translating a name on every language
// switch would overwrite whatever the user had renamed it to.
// Fixed rather than random: the default material and laminate are restored
// from browser storage on every reload, and a fresh id each time would orphan
// every layer that references them - and break the URL of the laminate the
// user had open. See store/laminateAtoms.ts.
export const DEFAULT_MATERIAL_ID = "material-1";
export const DEFAULT_LAMINATE_ID = "laminat-1";

export function defaultMaterial(): MaterialDto {
  return {
    id: DEFAULT_MATERIAL_ID,
    name: t("default.material.udCfrp"),
    e_par: 140000,
    e_nor: 10000,
    nue12: 0.3,
    g: 5000,
    g13: 5000,
    g23: 3500,
    rho: 1.6e-9,
    alpha_t_par: 0,
    alpha_t_nor: 0,
    beta_par: 0,
    beta_nor: 0,
    r_par_ten: 2000,
    r_par_com: 1200,
    r_nor_ten: 50,
    r_nor_com: 150,
    r_shear: 70,
    additional_values: { ...DEFAULT_ADDITIONAL_VALUES },
    // Typed in, not predicted - see store/micromechanicsAtoms.
    micro: null,
  };
}

export function defaultLayers(materialId: string): LayerRow[] {
  return [0, 90].map((angle, i) => ({
    id: crypto.randomUUID(),
    name: t("default.layerName", { nr: i + 1 }),
    angle,
    thickness: 0.2,
    materialId,
    criterionId: DEFAULT_CRITERION_ID,
  }));
}

// A carbon fibre and an epoxy, so a newly added constituent is a plausible one
// rather than a column of zeros. Same call as the default material above: the
// numbers are a starting point, not a claim about a product.
export function defaultFibre(id: string, name: string): FibreDto {
  return {
    id,
    name,
    e_par: 230000,
    e_nor: 15000,
    nue12: 0.28,
    g: 15000,
    g13: 0,
    g23: 0,
    rho: 1.78e-9,
    alpha_t_par: -5e-7,
    alpha_t_nor: 1e-5,
    beta_par: 0,
    beta_nor: 0,
  };
}

export function defaultMatrix(id: string, name: string): MatrixMaterialDto {
  // No shear modulus: it follows from E and nue, in the core and in eLamX.
  return { id, name, e: 3400, nue: 0.35, rho: 1.2e-9, alpha: 6.5e-5, beta: 0.3 };
}

/** What switching a material to "derive from fibre and matrix" starts from:
 *  the rule of mixtures everywhere, which is the Java constructor's choice. */
export function defaultMicroMechanics(fibreId: string, matrixId: string): MicroMechanicsDto {
  return {
    fibre_id: fibreId,
    matrix_id: matrixId,
    phi: 0.6,
    rho_model: "rule_of_mixture",
    e_par_model: "rule_of_mixture",
    e_nor_model: "rule_of_mixture",
    nue12_model: "rule_of_mixture",
    g_model: "rule_of_mixture",
  };
}
