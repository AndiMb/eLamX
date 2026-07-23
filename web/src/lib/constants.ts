import { DEFAULT_ADDITIONAL_VALUES, type CriterionId, type MaterialDto } from "./types";

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
}

export const DOF_NAMES = [
  { load: "N_x", strain: "ε_x" },
  { load: "N_y", strain: "ε_y" },
  { load: "N_xy", strain: "γ_xy" },
  { load: "M_x", strain: "κ_x" },
  { load: "M_y", strain: "κ_y" },
  { load: "M_xy", strain: "κ_xy" },
] as const;

export const LOAD_FIELDS = ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy"] as const;
export const STRAIN_FIELDS = [
  "epsilon_x",
  "epsilon_y",
  "gamma_xy",
  "kappa_x",
  "kappa_y",
  "kappa_xy",
] as const;

export function defaultMaterial(): MaterialDto {
  return {
    id: crypto.randomUUID(),
    name: "UD-CFK",
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
  };
}

export function defaultLayers(materialId: string): LayerRow[] {
  return [
    { id: crypto.randomUUID(), name: "Lage 1", angle: 0, thickness: 0.2, materialId, criterionId: DEFAULT_CRITERION_ID },
    { id: crypto.randomUUID(), name: "Lage 2", angle: 90, thickness: 0.2, materialId, criterionId: DEFAULT_CRITERION_ID },
  ];
}
