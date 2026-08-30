//! Static CLT solver operations.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/{CLT_Calculator,CLT_LayerResult}.java
//!
//! `determineValuesLastPlyFailure` from the Java original lives in its own
//! module, `clt::last_ply_failure`, since it is a loop around the two
//! functions here rather than another operation beside them.

use super::laminate::CltLaminate;
use super::loads::Loads;
use super::strains::Strains;
use crate::failure::{CriterionError, CriterionRegistry, LayerContext, ReserveFactor};
use crate::mathtools;
use crate::model::{Material, StressStrainState};
use std::collections::HashMap;

/// Hygrothermal (temperature- and moisture-induced) forces and moments acting
/// on the laminate, in the order N_x, N_y, N_xy, M_x, M_y, M_xy.
pub fn hygro_thermal_forces(lam: &CltLaminate, loads: &Loads) -> [f64; 6] {
    if loads.delta_h == 0.0 && loads.delta_t == 0.0 {
        return [0.0; 6];
    }

    let mut nt = vec![0.0, 0.0, 0.0];
    let mut mt = vec![0.0, 0.0, 0.0];
    for layer in lam.layers() {
        let angle_rad = layer.angle_deg.to_radians();
        let q_matrix = layer.q_matrix_global();

        let alpha_i = calc_angle_i(layer.alpha_t_par(), layer.alpha_t_nor(), angle_rad);
        let beta_i = calc_angle_i(layer.beta_par(), layer.beta_nor(), angle_rad);
        let hygro_coeff = calc_hygro_coeff(&alpha_i, &beta_i, loads.delta_t, loads.delta_h);

        let qalpha = mathtools::mat_vec_mult(&q_matrix, &hygro_coeff);
        let qalpha_t = mathtools::multiply(&qalpha, layer.thickness);
        nt = mathtools::add(&nt, &qalpha_t);

        let qalpha_tz = mathtools::multiply(&qalpha_t, layer.zm);
        mt = mathtools::add(&mt, &qalpha_tz);
    }

    [nt[0], nt[1], nt[2], mt[0], mt[1], mt[2]]
}

fn calc_angle_i(par: f64, nor: f64, angle_rad: f64) -> Vec<f64> {
    let c = angle_rad.cos();
    let c2 = c * c;
    let s = angle_rad.sin();
    let s2 = s * s;
    vec![
        par * c2 + nor * s2,
        par * s2 + nor * c2,
        2.0 * (par - nor) * s * c,
    ]
}

fn calc_hygro_coeff(alpha_i: &[f64], beta_i: &[f64], delta_t: f64, delta_h: f64) -> Vec<f64> {
    alpha_i
        .iter()
        .zip(beta_i)
        .map(|(a, b)| a * delta_t + b * delta_h)
        .collect()
}

/// Solves for the not-yet-known loads or strains via the ABD system, given a
/// per-degree-of-freedom flag for whether the strain (`true`) or the load
/// (`false`) is prescribed. Mutates `loads` and `strains` with the results,
/// mirroring `CLT_Calculator.determineValues`.
pub fn determine_values(
    lam: &CltLaminate,
    loads: &mut Loads,
    strains: &mut Strains,
    use_strain: &[bool; 6],
) {
    let formom = loads.force_moment_vector();
    let epskappa = strains.epsilon_kappa_vector();
    let t_force = hygro_thermal_forces(lam, loads);

    let mut rhs = [0.0; 6];
    for i in 0..6 {
        rhs[i] = if use_strain[i] {
            epskappa[i]
        } else {
            formom[i] + t_force[i]
        };
    }

    let mut results = mathtools::solve_ab_with_exchange(lam.abd_matrix(), &rhs, use_strain);

    for i in 0..6 {
        if use_strain[i] {
            results[i] -= t_force[i];
        }
    }

    if use_strain[0] {
        loads.n_x = results[0];
    } else {
        strains.epsilon_x = results[0];
    }
    if use_strain[1] {
        loads.n_y = results[1];
    } else {
        strains.epsilon_y = results[1];
    }
    if use_strain[2] {
        loads.n_xy = results[2];
    } else {
        strains.gamma_xy = results[2];
    }
    if use_strain[3] {
        loads.m_x = results[3];
    } else {
        strains.kappa_x = results[3];
    }
    if use_strain[4] {
        loads.m_y = results[4];
    } else {
        strains.kappa_y = results[4];
    }
    if use_strain[5] {
        loads.m_xy = results[5];
    } else {
        strains.kappa_xy = results[5];
    }

    loads.set_hygrothermal_forces_vector(t_force);
}

/// Laminate thermal expansion coefficients (alpha_x, alpha_y, alpha_xy),
/// derived from a unit temperature change.
pub fn alpha_global(lam: &CltLaminate) -> [f64; 3] {
    let loads = Loads {
        delta_t: 1.0,
        ..Default::default()
    };
    let therm_force = hygro_thermal_forces(lam, &loads);
    let mut alpha_t = [0.0; 3];
    for (ii, slot) in alpha_t.iter_mut().enumerate() {
        let mut acc = 0.0;
        for jj in 0..6 {
            acc += lam.abd_inv_matrix()[ii][jj] * therm_force[jj];
        }
        *slot = acc;
    }
    alpha_t
}

/// Laminate moisture expansion coefficients (beta_x, beta_y, beta_xy), derived
/// from a unit relative-humidity change.
pub fn beta_global(lam: &CltLaminate) -> [f64; 3] {
    let loads = Loads {
        delta_h: 1.0,
        ..Default::default()
    };
    let hygral_force = hygro_thermal_forces(lam, &loads);
    let mut beta = [0.0; 3];
    for (ii, slot) in beta.iter_mut().enumerate() {
        let mut acc = 0.0;
        for jj in 0..6 {
            acc += lam.abd_inv_matrix()[ii][jj] * hygral_force[jj];
        }
        *slot = acc;
    }
    beta
}

/// Per-layer stress/strain state and reserve factor at both the upper and
/// lower surface of a ply. Reference: CLT_LayerResult.java.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LayerResult {
    /// Stacking-order position (1-based), matching `CltLayer::number`.
    pub layer_number: usize,
    pub sss_lower: StressStrainState,
    pub sss_upper: StressStrainState,
    pub sss_lower_global: StressStrainState,
    pub sss_upper_global: StressStrainState,
    pub rr_lower: ReserveFactor,
    pub rr_upper: ReserveFactor,
    /// `true` if either surface's reserve factor is below 1.0.
    pub failed: bool,
}

/// A layer could not be evaluated: its material or failure criterion isn't in
/// the catalog/registry passed in, or the criterion itself reported an error
/// (see [`CriterionError`]).
#[derive(Debug, Clone, PartialEq)]
pub enum LayerResultError {
    MissingMaterial(String),
    MissingCriterion(String),
    Criterion(CriterionError),
}

impl std::fmt::Display for LayerResultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LayerResultError::MissingMaterial(id) => write!(f, "material '{id}' not found"),
            LayerResultError::MissingCriterion(id) => {
                write!(f, "failure criterion '{id}' not found in the registry")
            }
            LayerResultError::Criterion(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LayerResultError {}

impl From<CriterionError> for LayerResultError {
    fn from(e: CriterionError) -> Self {
        LayerResultError::Criterion(e)
    }
}

/// Evaluates every layer's stress/strain state and reserve factor for the
/// given loads/strains. `materials` and `criteria` must contain every
/// material/criterion referenced by the laminate's layers.
pub fn get_layer_results(
    lam: &CltLaminate,
    load: &Loads,
    strain: &Strains,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
) -> Result<Vec<LayerResult>, LayerResultError> {
    layer_results_with(lam, load, strain, materials, criteria, |cl, epskappa, dt, dh| {
        cl.stress_state(epskappa, dt, dh, super::LayerPosition::Lower, true)
    }, |cl, epskappa, dt, dh| {
        cl.stress_state(epskappa, dt, dh, super::LayerPosition::Upper, true)
    })
}

/// Axisymmetric (pressure vessel) variant of [`get_layer_results`], where the
/// hoop strain is derived from the mean radius rather than a linear
/// through-thickness strain. Reference: `CLT_Calculator.getLayerResults_radial`.
pub fn get_layer_results_radial(
    lam: &CltLaminate,
    load: &Loads,
    strain: &Strains,
    mean_radius: f64,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
) -> Result<Vec<LayerResult>, LayerResultError> {
    layer_results_with(
        lam,
        load,
        strain,
        materials,
        criteria,
        move |cl, epskappa, dt, dh| {
            cl.stress_state_radial(epskappa, dt, dh, super::LayerPosition::Lower, mean_radius, true)
        },
        move |cl, epskappa, dt, dh| {
            cl.stress_state_radial(epskappa, dt, dh, super::LayerPosition::Upper, mean_radius, true)
        },
    )
}

fn layer_results_with(
    lam: &CltLaminate,
    load: &Loads,
    strain: &Strains,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    lower: impl Fn(
        &super::CltLayer,
        &[f64; 6],
        f64,
        f64,
    ) -> (StressStrainState, Option<StressStrainState>),
    upper: impl Fn(
        &super::CltLayer,
        &[f64; 6],
        f64,
        f64,
    ) -> (StressStrainState, Option<StressStrainState>),
) -> Result<Vec<LayerResult>, LayerResultError> {
    let epskappa = strain.epsilon_kappa_vector();
    let delta_temp = load.delta_t;
    let delta_hygro = load.delta_h;

    lam.layers()
        .iter()
        .map(|cl| {
            let material = materials
                .get(cl.material_id())
                .ok_or_else(|| LayerResultError::MissingMaterial(cl.material_id().to_string()))?;
            let criterion_id = cl.criterion_id().unwrap_or(crate::failure::PUCK_ID);
            let criterion = criteria
                .get(criterion_id)
                .ok_or_else(|| LayerResultError::MissingCriterion(criterion_id.to_string()))?;

            let layer_context = LayerContext {
                angle_deg: cl.angle_deg,
                embedded: cl.embedded,
            };

            let (sss_lower, sss_lower_global) = lower(cl, &epskappa, delta_temp, delta_hygro);
            let (sss_upper, sss_upper_global) = upper(cl, &epskappa, delta_temp, delta_hygro);

            let rr_lower = criterion.reserve_factor(material, Some(&layer_context), &sss_lower)?;
            let rr_upper = criterion.reserve_factor(material, Some(&layer_context), &sss_upper)?;

            let failed = rr_lower.minimal_reserve_factor < 1.0 || rr_upper.minimal_reserve_factor < 1.0;

            Ok(LayerResult {
                layer_number: cl.number,
                sss_lower,
                sss_upper,
                sss_lower_global: sss_lower_global.expect("calc_global was requested"),
                sss_upper_global: sss_upper_global.expect("calc_global was requested"),
                rr_lower,
                rr_upper,
                failed,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mathtools::mat_vec_mult;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    fn materials_map() -> HashMap<String, Material> {
        let mut m = HashMap::new();
        m.insert(
            "mat".to_string(),
            Material::new("mat", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9),
        );
        m
    }

    fn sample_laminate() -> CltLaminate {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "45", "mat", 45.0, 0.15));
        lam.layers.push(Layer::new("l2", "-45", "mat", -45.0, 0.15));
        lam.layers.push(Layer::new("l3", "90", "mat", 90.0, 0.2));
        CltLaminate::new(&lam, &materials_map()).unwrap()
    }

    fn material_with_strengths() -> Material {
        let mut m = Material::new("mat", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m
    }

    fn single_layer_laminate(
        criterion_id: Option<&str>,
    ) -> (CltLaminate, HashMap<String, Material>) {
        let mut lam = Laminate::new("id", "lam");
        let mut layer = Layer::new("l0", "0", "mat", 0.0, 0.2);
        layer.criterion_id = criterion_id.map(str::to_string);
        lam.layers.push(layer);

        let mut materials = HashMap::new();
        materials.insert("mat".to_string(), material_with_strengths());

        let clt = CltLaminate::new(&lam, &materials).unwrap();
        (clt, materials)
    }

    #[test]
    fn hygro_thermal_forces_are_zero_without_temperature_or_moisture_change() {
        let clt = sample_laminate();
        let loads = Loads::default();
        assert_eq!(hygro_thermal_forces(&clt, &loads), [0.0; 6]);
    }

    #[test]
    fn determine_values_with_all_strains_prescribed_matches_abd_times_strain() {
        let clt = sample_laminate();
        let mut loads = Loads::default();
        let mut strains = Strains {
            epsilon_x: 0.001,
            epsilon_y: -0.0004,
            gamma_xy: 0.0002,
            kappa_x: 0.01,
            kappa_y: -0.005,
            kappa_xy: 0.002,
        };
        let use_strain = [true; 6];

        determine_values(&clt, &mut loads, &mut strains, &use_strain);

        let expected = mat_vec_mult(clt.abd_matrix(), strains.epsilon_kappa_vector().as_ref());
        let actual = loads.force_moment_vector();
        for i in 0..6 {
            assert!(
                (actual[i] - expected[i]).abs() < 1e-6,
                "index {i}: {} vs {}",
                actual[i],
                expected[i]
            );
        }
    }

    #[test]
    fn determine_values_recovers_prescribed_strain_via_mixed_boundary_conditions() {
        let clt = sample_laminate();

        // Ground truth: prescribe all strains, read off the resulting loads.
        let mut loads_all_strain = Loads::default();
        let mut strains_all_strain = Strains {
            epsilon_x: 0.001,
            epsilon_y: -0.0004,
            gamma_xy: 0.0002,
            kappa_x: 0.01,
            kappa_y: -0.005,
            kappa_xy: 0.002,
        };
        determine_values(
            &clt,
            &mut loads_all_strain,
            &mut strains_all_strain,
            &[true; 6],
        );

        // Now prescribe N_x (from the ground truth) instead of epsilon_x, and
        // check that epsilon_x is recovered as the corresponding unknown.
        let mut use_strain = [true; 6];
        use_strain[0] = false;
        let mut loads = Loads {
            n_x: loads_all_strain.n_x,
            ..Default::default()
        };
        let mut strains = strains_all_strain;
        strains.epsilon_x = 0.0; // now unknown

        determine_values(&clt, &mut loads, &mut strains, &use_strain);

        assert!((strains.epsilon_x - strains_all_strain.epsilon_x).abs() < 1e-9);
        assert!((loads.n_y - loads_all_strain.n_y).abs() < 1e-6);
    }

    #[test]
    fn alpha_and_beta_global_are_zero_for_a_quasi_isotropic_balanced_layup() {
        let clt = sample_laminate();
        let alpha = alpha_global(&clt);
        let beta = beta_global(&clt);
        // [0/45/-45/90] is balanced: no shear-extension coupling for thermal/moisture loads.
        assert!(alpha[2].abs() < 1e-12);
        assert!(beta[2].abs() < 1e-12);
    }

    #[test]
    fn get_layer_results_reports_not_failed_under_a_small_load() {
        let (clt, materials) = single_layer_laminate(Some(crate::failure::MAX_STRESS_ID));
        let registry = crate::failure::default_criterion_registry();
        let mut loads = Loads {
            n_x: 10.0,
            ..Default::default()
        };
        let mut strains = Strains::default();
        determine_values(&clt, &mut loads, &mut strains, &[false; 6]);

        let results = get_layer_results(&clt, &loads, &strains, &materials, &registry).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].layer_number, 1);
        assert!(!results[0].failed);
        assert!(results[0].rr_lower.minimal_reserve_factor > 1.0);
    }

    #[test]
    fn get_layer_results_reports_failed_when_reserve_factor_drops_below_one() {
        let (clt, materials) = single_layer_laminate(Some(crate::failure::MAX_STRESS_ID));
        let registry = crate::failure::default_criterion_registry();
        // Large enough N_x to push the fiber-direction stress past R_par_ten = 2000.
        let mut loads = Loads {
            n_x: 1000.0,
            ..Default::default()
        };
        let mut strains = Strains::default();
        determine_values(&clt, &mut loads, &mut strains, &[false; 6]);

        let results = get_layer_results(&clt, &loads, &strains, &materials, &registry).unwrap();
        assert!(results[0].failed);
    }

    #[test]
    fn get_layer_results_defaults_to_puck_when_layer_has_no_criterion_assigned() {
        let (clt, mut materials) = single_layer_laminate(None);
        materials.get_mut("mat").unwrap().additional_values = HashMap::from([
            (crate::failure::PSPD.to_string(), 0.3),
            (crate::failure::PSPZ.to_string(), 0.35),
            (crate::failure::A0.to_string(), 0.5),
            (crate::failure::LAMBDA_MIN.to_string(), 0.5),
        ]);
        let registry = crate::failure::default_criterion_registry();
        let mut loads = Loads {
            n_x: 10.0,
            ..Default::default()
        };
        let mut strains = Strains::default();
        determine_values(&clt, &mut loads, &mut strains, &[false; 6]);

        let results = get_layer_results(&clt, &loads, &strains, &materials, &registry).unwrap();
        assert!(!results[0].failed);
    }

    #[test]
    fn get_layer_results_reports_missing_criterion_as_an_error() {
        let (clt, materials) = single_layer_laminate(Some("not-a-real-criterion"));
        let registry = crate::failure::default_criterion_registry();
        let loads = Loads::default();
        let strains = Strains::default();

        let result = get_layer_results(&clt, &loads, &strains, &materials, &registry);
        assert_eq!(
            result.unwrap_err(),
            LayerResultError::MissingCriterion("not-a-real-criterion".to_string())
        );
    }
}
