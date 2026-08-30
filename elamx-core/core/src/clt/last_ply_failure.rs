//! Last-ply failure: degrade the weakest ply, recompute, repeat.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/CLT_Calculator.java
//! (`determineValuesLastPlyFailure`) and .../lastplyfailure/LastPlyFailureInput.java.
//!
//! The applied load stays fixed. Each iteration solves the CLT problem, finds
//! the ply surface with the smallest reserve factor, and knocks that ply's
//! stiffness down by [`LastPlyFailureInput::degradation_factor`] - the matrix
//! moduli (E_nor, G) for an inter-fibre failure, E_par for a fibre failure.
//! A ply that fails a second time in the mode it was already degraded in ends
//! the analysis: nothing is left to take away from it.
//!
//! What comes out are load factors: at which multiple of the applied load the
//! first inter-fibre failure appears (`rf_first_iff`), the first fibre failure
//! (`rf_first_ff`), the critical strain is reached (`rf_first_epsilon`), and
//! the largest reserve factor seen along the whole degradation path
//! (`exceedance_factor`, `EF_LPF` in the original's output) - the last one
//! being the load factor the laminate ultimately survives.
//!
//! ## Three deliberate faithfulnesses
//!
//! The original does three surprising things here, and this port reproduces
//! all three. They are not oversights on this side: the golden-master suite
//! compares against numbers eLamX itself printed, so "fixing" any of them
//! here would turn a silent difference into a red test - which is the right
//! place for the decision to be made, but not one this port makes on its own.
//!
//! 1. **Criterion parameters fall back to their defaults.** Every ply is
//!    rebuilt on a fresh material, and the copy loop meant to carry the
//!    parameters over reads them from the copy instead of from the source
//!    (`mat.putAdditionalValue(key, mat.getAdditionalValue(key))` in
//!    `getAsDefaultMaterial`). A material's own Puck parameters therefore
//!    never reach the criterion - it sees
//!    [`crate::failure::DEFAULT_ADDITIONAL_VALUES`].
//! 2. **Hygrothermal loads have no effect.** The same fresh material leaves
//!    the thermal and moisture expansion coefficients at zero, so the
//!    hygrothermal force vector is identically zero however large dT is.
//!    Consistently, `LastPlyFailureInput` offers no dT/dc field at all, and
//!    neither does [`LastPlyFailureInput`] here.
//! 3. **The reference-plane offset is dropped.** The temporary laminate is
//!    constructed with a default offset of 0, so an offset laminate is
//!    analysed about its own mid-plane.

use super::calculator::{determine_values, get_layer_results, LayerResult, LayerResultError};
use super::laminate::CltLaminate;
use super::loads::Loads;
use super::strains::Strains;
use crate::failure::{default_additional_values, CriterionRegistry, FailureType};
use crate::model::{Laminate, Layer, Material};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Everything the analysis needs besides the laminate itself.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LastPlyFailureInput {
    /// The applied load, held constant over the whole analysis. Hygrothermal
    /// fields are not part of it - see the module documentation.
    pub loads: Loads,
    /// Factor a degraded ply's stiffness is multiplied by (`degFac`). Small
    /// but non-zero: a ply that carried nothing at all would make the ABD
    /// matrix singular.
    pub degradation_factor: f64,
    /// Fibre-direction strain treated as the allowable one (`epsAllow`), used
    /// for the strain-based reserve factor.
    pub epsilon_crit: f64,
    /// Knock-down applied to the reserve factor of an inter-fibre failure
    /// (`jA`), reflecting that a matrix crack is not yet a failed laminate.
    pub j_a: f64,
    /// Whether a fibre failure also degrades the ply's matrix moduli.
    pub degrade_all_on_fibre_failure: bool,
}

impl Default for LastPlyFailureInput {
    fn default() -> Self {
        // Mirrors the field initialisers of the Java LastPlyFailureInput.
        LastPlyFailureInput {
            loads: Loads::default(),
            degradation_factor: 0.000_001,
            epsilon_crit: 0.003,
            j_a: 1.0,
            degrade_all_on_fibre_failure: true,
        }
    }
}

/// A reserve factor together with the iteration it was reached in.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LastPlyFailureEvent {
    pub reserve_factor: f64,
    /// Zero-based iteration index, matching the original's output.
    pub iteration: usize,
}

/// One degradation step.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LastPlyFailureIteration {
    /// Every ply's stress/strain state and reserve factor, computed with the
    /// stiffnesses this iteration STARTED with (i.e. before its own
    /// degradation is applied).
    pub layer_results: Vec<LayerResult>,
    /// Which plies have been degraded for inter-fibre failure by the end of
    /// this iteration, in stacking order.
    pub matrix_failed: Vec<bool>,
    /// Which plies have been degraded for fibre failure by the end of this
    /// iteration, in stacking order.
    pub fibre_failed: Vec<bool>,
    /// Stacking-order number (1-based) of the ply degraded in this iteration.
    pub layer_number: usize,
    /// The governing reserve factor, already multiplied by `j_a` if this
    /// iteration's failure was an inter-fibre one.
    pub reserve_factor: f64,
    pub failure_name: String,
    pub failure_type: FailureType,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct LastPlyFailureResult {
    /// The degradation path, oldest first.
    pub iterations: Vec<LastPlyFailureIteration>,
    /// Load factor of the first fibre failure.
    pub first_fibre_failure: Option<LastPlyFailureEvent>,
    /// Load factor of the first inter-fibre failure.
    pub first_matrix_failure: Option<LastPlyFailureEvent>,
    /// `epsilon_crit` divided by the largest fibre-direction strain in the
    /// first iteration that carries the load without failing.
    pub first_epsilon: Option<LastPlyFailureEvent>,
    /// The largest reserve factor along the path: the load factor at which the
    /// laminate finally fails (`EF_LPF`).
    pub exceedance_factor: Option<LastPlyFailureEvent>,
    /// Whether a fibre failure occurred before any inter-fibre failure did.
    pub fibre_before_matrix_failure: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LastPlyFailureError {
    /// The laminate has no layers, so there is nothing to degrade.
    NoLayers,
    /// A layer references a material that is not in the catalog.
    MissingMaterial(String),
    /// A ply could not be evaluated - see [`LayerResultError`].
    Layer(LayerResultError),
}

impl std::fmt::Display for LastPlyFailureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LastPlyFailureError::NoLayers => write!(f, "the laminate has no layers"),
            LastPlyFailureError::MissingMaterial(id) => write!(f, "material '{id}' not found"),
            LastPlyFailureError::Layer(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LastPlyFailureError {}

impl From<LayerResultError> for LastPlyFailureError {
    fn from(e: LayerResultError) -> Self {
        LastPlyFailureError::Layer(e)
    }
}

/// Runs the degradation loop. `materials` must contain every material the
/// laminate's layers reference; `criteria` every criterion they name.
pub fn calculate(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    input: &LastPlyFailureInput,
) -> Result<LastPlyFailureResult, LastPlyFailureError> {
    let (working_laminate, mut working_materials) = expand(laminate, materials)?;
    let layer_count = working_laminate.layers.len();

    let mut matrix_failed = vec![false; layer_count];
    let mut fibre_failed = vec![false; layer_count];

    let mut iterations: Vec<LastPlyFailureIteration> = Vec::with_capacity(2 * layer_count);
    let mut first_fibre_failure = None;
    let mut first_matrix_failure = None;
    let mut first_epsilon = None;
    let mut exceedance_factor: Option<LastPlyFailureEvent> = None;
    let mut fibre_before_matrix_failure = false;

    let mut loads = input.loads;
    let mut strains = Strains::default();

    // Two per ply is the upper bound: each ply can fail once in each mode.
    for iteration in 0..2 * layer_count {
        let clt = CltLaminate::new(&working_laminate, &working_materials)
            .map_err(|e| LastPlyFailureError::MissingMaterial(e.0))?;

        // Load control throughout - the Java input never exposes the
        // prescribed-strain flags its Loads/Strains pair would allow.
        determine_values(&clt, &mut loads, &mut strains, &[false; 6]);
        let layer_results = get_layer_results(&clt, &loads, &strains, &working_materials, criteria)?;

        let (governing, index) = governing_reserve_factor(&layer_results);
        let failure_type = governing.failure_type;
        let failure_name = governing.failure_name.clone();
        let minimal = governing.minimal_reserve_factor;

        // The reserve factor of an inter-fibre failure is reported knocked
        // down by j_a; every other failure type is reported as computed.
        let mut j_a_applied = 1.0;
        let material = working_materials
            .get_mut(&material_id(index))
            .expect("every expanded ply has its own material");

        let exhausted = match failure_type {
            FailureType::MatrixFailure => {
                if matrix_failed[index] {
                    true
                } else {
                    material.e_nor *= input.degradation_factor;
                    material.g *= input.degradation_factor;
                    matrix_failed[index] = true;
                    j_a_applied = input.j_a;
                    false
                }
            }
            FailureType::FiberFailure => {
                if fibre_failed[index] {
                    true
                } else {
                    material.e_par *= input.degradation_factor;
                    fibre_failed[index] = true;
                    if input.degrade_all_on_fibre_failure {
                        material.e_nor *= input.degradation_factor;
                        material.g *= input.degradation_factor;
                        matrix_failed[index] = true;
                    }
                    false
                }
            }
            FailureType::GeneralMaterialFailure => {
                if fibre_failed[index] || matrix_failed[index] {
                    true
                } else {
                    material.e_par *= input.degradation_factor;
                    material.e_nor *= input.degradation_factor;
                    material.g *= input.degradation_factor;
                    matrix_failed[index] = true;
                    fibre_failed[index] = true;
                    false
                }
            }
            // No load in any evaluated direction: nothing fails, nothing is
            // degraded, and the loop simply runs out its iteration budget -
            // exactly as the original does.
            FailureType::Undamaged => false,
        };

        if exhausted {
            break;
        }

        // The strain-based reserve factor is taken once, in the first
        // iteration whose laminate actually carries the load.
        if first_epsilon.is_none() && minimal >= 1.0 {
            let max_abs_strain = layer_results
                .iter()
                .map(|r| r.sss_upper.strain[0].abs().max(r.sss_lower.strain[0].abs()))
                .fold(f64::MIN, f64::max);
            first_epsilon = Some(LastPlyFailureEvent {
                reserve_factor: input.epsilon_crit / max_abs_strain,
                iteration,
            });
        }

        if exceedance_factor.is_none_or(|e| minimal > e.reserve_factor) {
            exceedance_factor = Some(LastPlyFailureEvent {
                reserve_factor: minimal,
                iteration,
            });
        }

        let reported = minimal * j_a_applied;

        if first_matrix_failure.is_none() && failure_type == FailureType::MatrixFailure {
            first_matrix_failure = Some(LastPlyFailureEvent {
                reserve_factor: reported,
                iteration,
            });
        }
        if first_fibre_failure.is_none() && failure_type == FailureType::FiberFailure {
            first_fibre_failure = Some(LastPlyFailureEvent {
                reserve_factor: reported,
                iteration,
            });
            if first_matrix_failure.is_none() {
                fibre_before_matrix_failure = true;
            }
        }

        iterations.push(LastPlyFailureIteration {
            layer_number: layer_results[index].layer_number,
            layer_results,
            matrix_failed: matrix_failed.clone(),
            fibre_failed: fibre_failed.clone(),
            reserve_factor: reported,
            failure_name,
            failure_type,
        });
    }

    Ok(LastPlyFailureResult {
        iterations,
        first_fibre_failure,
        first_matrix_failure,
        first_epsilon,
        exceedance_factor,
        fibre_before_matrix_failure,
    })
}

/// Id of the private material belonging to expanded ply `index`.
fn material_id(index: usize) -> String {
    format!("lpf-{index}")
}

/// Builds the throwaway laminate the degradation runs on: the fully expanded
/// stacking sequence as plain (non-symmetric, non-inverted) layers, each with
/// a material of its own so that degrading one ply does not degrade the others
/// that happen to share its material.
///
/// The material copies carry only stiffnesses and strengths, and the criterion
/// parameters come out of [`default_additional_values`] - see the module
/// documentation for why that is faithful rather than lossy.
fn expand(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
) -> Result<(Laminate, HashMap<String, Material>), LastPlyFailureError> {
    let resolved = laminate.all_layers();
    if resolved.is_empty() {
        return Err(LastPlyFailureError::NoLayers);
    }

    let mut working = Laminate::new("lpf", "");
    let mut working_materials = HashMap::with_capacity(resolved.len());

    for (index, ply) in resolved.iter().enumerate() {
        let source = materials
            .get(ply.material_id)
            .ok_or_else(|| LastPlyFailureError::MissingMaterial(ply.material_id.to_string()))?;

        let id = material_id(index);
        let mut material = Material::new(
            id.clone(),
            "",
            source.e_par,
            source.e_nor,
            source.nue12,
            source.g,
            0.0,
        );
        material.r_par_ten = source.r_par_ten;
        material.set_r_par_com(source.r_par_com);
        material.r_nor_ten = source.r_nor_ten;
        material.set_r_nor_com(source.r_nor_com);
        material.set_r_shear(source.r_shear);
        material.additional_values = default_additional_values();
        working_materials.insert(id.clone(), material);

        let mut layer = Layer::new("", "", id, ply.angle, ply.thickness);
        layer.criterion_id = ply.criterion_id.map(str::to_string);
        working.layers.push(layer);
    }

    Ok((working, working_materials))
}

/// The smallest reserve factor over all plies and both ply surfaces, and the
/// index of the ply carrying it. Ties keep the ply found first, and the lower
/// surface wins over the upper one at equal value - both follow from the
/// original's strictly-greater comparisons, and both matter because the choice
/// decides which ply gets degraded next.
fn governing_reserve_factor(results: &[LayerResult]) -> (&crate::failure::ReserveFactor, usize) {
    let mut governing = &results[0].rr_lower;
    let mut index = 0;
    for (i, result) in results.iter().enumerate() {
        if governing.minimal_reserve_factor > result.rr_lower.minimal_reserve_factor {
            governing = &result.rr_lower;
            index = i;
        }
        if governing.minimal_reserve_factor > result.rr_upper.minimal_reserve_factor {
            governing = &result.rr_upper;
            index = i;
        }
    }
    (governing, index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{default_criterion_registry, MAX_STRESS_ID};

    fn material() -> Material {
        let mut m = Material::new("mat", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = default_additional_values();
        m
    }

    fn materials() -> HashMap<String, Material> {
        HashMap::from([("mat".to_string(), material())])
    }

    /// A cross-ply laminate, each ply 0.25 mm thick.
    fn cross_ply(angles: &[f64]) -> Laminate {
        let mut laminate = Laminate::new("lam", "cross ply");
        for (i, angle) in angles.iter().enumerate() {
            let mut layer = Layer::new(format!("l{i}"), "", "mat", *angle, 0.25);
            layer.criterion_id = Some(MAX_STRESS_ID.to_string());
            laminate.layers.push(layer);
        }
        laminate
    }

    fn run(laminate: &Laminate, input: &LastPlyFailureInput) -> LastPlyFailureResult {
        calculate(
            laminate,
            &materials(),
            &default_criterion_registry(),
            input,
        )
        .expect("the laminate is analysable")
    }

    fn tension(n_x: f64) -> LastPlyFailureInput {
        LastPlyFailureInput {
            loads: Loads {
                n_x,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn transverse_plies_crack_before_the_load_carrying_ones_fail() {
        let result = run(&cross_ply(&[0.0, 90.0, 90.0, 0.0]), &tension(200.0));

        let matrix = result
            .first_matrix_failure
            .expect("a cross-ply under tension cracks its 90 deg plies");
        let fibre = result
            .first_fibre_failure
            .expect("and eventually breaks the 0 deg fibres");

        assert!(
            matrix.reserve_factor < fibre.reserve_factor,
            "matrix failure at {} should precede fibre failure at {}",
            matrix.reserve_factor,
            fibre.reserve_factor
        );
        assert!(matrix.iteration < fibre.iteration);
        assert!(!result.fibre_before_matrix_failure);

        // The 90 deg plies are the ones that crack.
        let cracked = &result.iterations[matrix.iteration];
        assert!(cracked.layer_number == 2 || cracked.layer_number == 3);
    }

    /// The whole point of the analysis: the laminate carries more than the
    /// load at which its first ply fails.
    #[test]
    fn the_laminate_outlives_its_first_failed_ply() {
        let result = run(&cross_ply(&[0.0, 90.0, 90.0, 0.0]), &tension(200.0));

        let first = result.iterations[0].reserve_factor;
        let last = result
            .exceedance_factor
            .expect("at least one iteration ran")
            .reserve_factor;
        assert!(
            last > first,
            "EF_LPF {last} should exceed the first-ply reserve factor {first}"
        );
    }

    #[test]
    fn every_ply_can_fail_at_most_once_per_mode() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);
        let result = run(&laminate, &tension(200.0));

        assert!(result.iterations.len() <= 2 * laminate.layers.len());
        for iteration in &result.iterations {
            assert_eq!(iteration.matrix_failed.len(), laminate.layers.len());
            assert_eq!(iteration.fibre_failed.len(), laminate.layers.len());
        }

        // Degradation never un-fails a ply.
        for pair in result.iterations.windows(2) {
            for i in 0..laminate.layers.len() {
                assert!(!(pair[0].matrix_failed[i] && !pair[1].matrix_failed[i]));
                assert!(!(pair[0].fibre_failed[i] && !pair[1].fibre_failed[i]));
            }
        }
    }

    /// `degrade_all_on_fibre_failure` is what decides whether a broken ply
    /// keeps any transverse stiffness at all, so the two settings must not
    /// produce the same degradation path.
    #[test]
    fn degrading_everything_on_fibre_failure_changes_the_path() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);

        let mut input = tension(200.0);
        input.degrade_all_on_fibre_failure = true;
        let all = run(&laminate, &input);
        input.degrade_all_on_fibre_failure = false;
        let fibre_only = run(&laminate, &input);

        let first_fibre = all
            .first_fibre_failure
            .expect("fibre failure is reached")
            .iteration;
        assert_eq!(
            all.iterations[first_fibre].fibre_failed,
            fibre_only.iterations[first_fibre].fibre_failed,
            "the fibre failure itself is the same either way"
        );
        assert_ne!(
            all.iterations[first_fibre].matrix_failed,
            fibre_only.iterations[first_fibre].matrix_failed,
            "but only degrade_all_on_fibre_failure takes the matrix down with it"
        );
    }

    /// j_a is a knock-down on the reported inter-fibre reserve factor only -
    /// it must not change which ply fails when.
    #[test]
    fn j_a_scales_the_matrix_reserve_factor_without_moving_it() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);

        let plain = run(&laminate, &tension(200.0));
        let mut knocked = tension(200.0);
        knocked.j_a = 0.5;
        let knocked = run(&laminate, &knocked);

        let a = plain.first_matrix_failure.expect("cracks");
        let b = knocked.first_matrix_failure.expect("cracks");
        assert_eq!(a.iteration, b.iteration);
        assert!((b.reserve_factor - 0.5 * a.reserve_factor).abs() < 1e-12);
        assert_eq!(
            plain.exceedance_factor.map(|e| e.iteration),
            knocked.exceedance_factor.map(|e| e.iteration),
            "j_a does not move EF_LPF"
        );
    }

    /// Halving the load doubles every reserve factor: the analysis is linear
    /// in the applied load, one degradation step at a time.
    #[test]
    fn reserve_factors_scale_inversely_with_the_load() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);
        let full = run(&laminate, &tension(200.0));
        let half = run(&laminate, &tension(100.0));

        assert_eq!(full.iterations.len(), half.iterations.len());
        for (a, b) in full.iterations.iter().zip(&half.iterations) {
            assert_eq!(a.layer_number, b.layer_number);
            assert!((2.0 * a.reserve_factor - b.reserve_factor).abs() < 1e-9 * b.reserve_factor);
        }
    }

    #[test]
    fn the_strain_reserve_factor_follows_epsilon_crit() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);

        let mut input = tension(200.0);
        input.epsilon_crit = 0.003;
        let a = run(&laminate, &input).first_epsilon.expect("load is carried");
        input.epsilon_crit = 0.006;
        let b = run(&laminate, &input).first_epsilon.expect("load is carried");

        assert_eq!(a.iteration, b.iteration);
        assert!((2.0 * a.reserve_factor - b.reserve_factor).abs() < 1e-9 * b.reserve_factor);
    }

    /// A symmetric laminate is analysed as its expanded stack, so its ply
    /// numbering - and therefore the reported layer of failure - covers all
    /// mirrored plies, not just the stored half.
    #[test]
    fn a_symmetric_laminate_is_degraded_on_its_expanded_stack() {
        let mut laminate = cross_ply(&[0.0, 90.0]);
        laminate.symmetric = true;
        let result = run(&laminate, &tension(200.0));

        for iteration in &result.iterations {
            assert_eq!(iteration.matrix_failed.len(), 4);
            assert!(iteration.layer_number >= 1 && iteration.layer_number <= 4);
        }
    }

    #[test]
    fn an_empty_laminate_is_reported_rather_than_analysed() {
        let laminate = Laminate::new("lam", "empty");
        let error = calculate(
            &laminate,
            &materials(),
            &default_criterion_registry(),
            &tension(200.0),
        )
        .expect_err("there is nothing to degrade");
        assert_eq!(error, LastPlyFailureError::NoLayers);
    }

    #[test]
    fn a_missing_material_is_reported_rather_than_panicking() {
        let mut laminate = cross_ply(&[0.0]);
        laminate.layers[0].material_id = "nope".to_string();
        let error = calculate(
            &laminate,
            &materials(),
            &default_criterion_registry(),
            &tension(200.0),
        )
        .expect_err("the material is not in the catalog");
        assert_eq!(error, LastPlyFailureError::MissingMaterial("nope".into()));
    }

    /// Faithfulness check, not a preference: the analysis must ignore the
    /// material's own criterion parameters (see the module documentation).
    #[test]
    fn criterion_parameters_come_from_the_defaults_not_from_the_material() {
        let mut laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);
        for layer in &mut laminate.layers {
            layer.criterion_id = Some(crate::failure::PUCK_ID.to_string());
        }

        let mut exotic = material();
        exotic.additional_values.insert(crate::failure::PSPD.to_string(), 0.9);
        exotic.additional_values.insert(crate::failure::PSPZ.to_string(), 0.9);
        let exotic = HashMap::from([("mat".to_string(), exotic)]);

        let registry = default_criterion_registry();
        let input = tension(200.0);
        let with_defaults = calculate(&laminate, &materials(), &registry, &input).unwrap();
        let with_exotic = calculate(&laminate, &exotic, &registry, &input).unwrap();

        assert_eq!(
            with_defaults.first_matrix_failure, with_exotic.first_matrix_failure,
            "the material's own Puck parameters must not reach the criterion"
        );
    }

    /// Same kind of check for the dropped expansion coefficients: a
    /// temperature difference cannot change anything, because there is no
    /// input field carrying one into the analysis.
    #[test]
    fn a_temperature_load_does_not_reach_the_analysis() {
        let laminate = cross_ply(&[0.0, 90.0, 90.0, 0.0]);

        let mut hot = material();
        hot.alpha_t_par = 1.0e-6;
        hot.alpha_t_nor = 3.0e-5;
        let hot = HashMap::from([("mat".to_string(), hot)]);

        let registry = default_criterion_registry();
        let input = tension(200.0);
        let cold_run = calculate(&laminate, &materials(), &registry, &input).unwrap();
        let hot_run = calculate(&laminate, &hot, &registry, &input).unwrap();

        assert_eq!(
            cold_run.exceedance_factor, hot_run.exceedance_factor,
            "the ply copies carry no expansion coefficients"
        );
    }
}
