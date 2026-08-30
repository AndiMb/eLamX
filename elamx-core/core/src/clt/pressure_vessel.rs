//! Thin-walled pressure vessel: a cylinder made of this laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_PressureVessel/src/de/elamx/clt/pressurevessel/PressureVesselInput.java
//! and .../pressurevesselui/CLT_PressureVesselTopComponent.recalc().
//!
//! The whole analysis is the CLT solver under a particular load and a
//! particular boundary condition, so there is very little arithmetic of its
//! own:
//!
//! - The membrane load comes from the boiler formula on the MEAN radius:
//!   axial `N_x = p*r/2`, hoop `N_y = p*r`, no shear.
//! - The curvatures are prescribed to zero rather than the moments: a
//!   cylinder's wall does not bend, and what the analysis wants to know is
//!   which moments that constraint produces (`use_strain` is false for the
//!   three forces and true for the three curvatures).
//! - The plies are evaluated with [`crate::clt::get_layer_results_radial`],
//!   where the hoop strain follows 1/r through the wall instead of being
//!   constant - the one place a vessel differs from a flat laminate.

use super::calculator::{determine_values, get_layer_results_radial, LayerResult, LayerResultError};
use super::laminate::CltLaminate;
use super::loads::Loads;
use super::strains::Strains;
use crate::failure::CriterionRegistry;
use crate::model::Material;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Which radius the user measured. The analysis works on the mean radius, so
/// an inner or outer one is moved half a wall thickness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub enum RadiusType {
    Inner,
    Mean,
    Outer,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct PressureVesselInput {
    /// Internal pressure.
    pub pressure: f64,
    pub radius: f64,
    pub radius_type: RadiusType,
}

impl Default for PressureVesselInput {
    fn default() -> Self {
        // Mirrors the field initialisers of the Java PressureVesselInput.
        PressureVesselInput {
            pressure: 0.0,
            radius: 1.0,
            radius_type: RadiusType::Mean,
        }
    }
}

impl PressureVesselInput {
    /// The mean radius for a wall of `thickness`, which is what every formula
    /// below is written in.
    pub fn mean_radius(&self, thickness: f64) -> f64 {
        match self.radius_type {
            RadiusType::Inner => self.radius + thickness / 2.0,
            RadiusType::Mean => self.radius,
            RadiusType::Outer => self.radius - thickness / 2.0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct PressureVesselResult {
    /// The mean radius the analysis ran on - derived from the input radius and
    /// the wall thickness, so worth reporting rather than leaving implicit.
    pub mean_radius: f64,
    /// The load the boiler formula produced, plus the moments the
    /// zero-curvature constraint required.
    pub loads: Loads,
    /// Axial strain in `epsilon_x`, hoop strain in `epsilon_y`; the curvatures
    /// are the prescribed zeros.
    pub strains: Strains,
    pub layer_results: Vec<LayerResult>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PressureVesselError {
    /// A mean radius of zero or less is not a vessel; the hoop strain divides
    /// by it.
    NonPositiveRadius(f64),
    Layer(LayerResultError),
}

impl std::fmt::Display for PressureVesselError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PressureVesselError::NonPositiveRadius(r) => {
                write!(f, "mean radius must be positive, got {r}")
            }
            PressureVesselError::Layer(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PressureVesselError {}

impl From<LayerResultError> for PressureVesselError {
    fn from(e: LayerResultError) -> Self {
        PressureVesselError::Layer(e)
    }
}

/// Solves the vessel: the boiler-formula load, the moments the wall's
/// zero curvature requires, and every ply's state through the wall.
pub fn calculate(
    lam: &CltLaminate,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    input: &PressureVesselInput,
) -> Result<PressureVesselResult, PressureVesselError> {
    let mean_radius = input.mean_radius(lam.tges());
    if !(mean_radius > 0.0) {
        return Err(PressureVesselError::NonPositiveRadius(mean_radius));
    }

    let mut loads = Loads {
        n_x: input.pressure * mean_radius / 2.0,
        n_y: input.pressure * mean_radius,
        n_xy: 0.0,
        ..Default::default()
    };
    let mut strains = Strains::default();

    // Forces prescribed, curvatures prescribed to zero: the wall stays
    // straight, and the moments that takes are part of the answer.
    determine_values(lam, &mut loads, &mut strains, &[false, false, false, true, true, true]);

    let layer_results =
        get_layer_results_radial(lam, &loads, &strains, mean_radius, materials, criteria)?;

    Ok(PressureVesselResult {
        mean_radius,
        loads,
        strains,
        layer_results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::{default_additional_values, default_criterion_registry, MAX_STRESS_ID};
    use crate::model::{Laminate, Layer};

    fn materials() -> HashMap<String, Material> {
        let mut m = Material::new("mat", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = default_additional_values();
        HashMap::from([("mat".to_string(), m)])
    }

    fn vessel(angles: &[f64]) -> CltLaminate {
        let mut laminate = Laminate::new("lam", "vessel");
        for (i, angle) in angles.iter().enumerate() {
            let mut layer = Layer::new(format!("l{i}"), "", "mat", *angle, 0.25);
            layer.criterion_id = Some(MAX_STRESS_ID.to_string());
            laminate.layers.push(layer);
        }
        laminate.symmetric = true;
        CltLaminate::new(&laminate, &materials()).unwrap()
    }

    fn run(lam: &CltLaminate, input: &PressureVesselInput) -> PressureVesselResult {
        calculate(lam, &materials(), &default_criterion_registry(), input).expect("solvable")
    }

    #[test]
    fn the_hoop_load_is_twice_the_axial_one() {
        // The boiler formula, which is the one thing about a thin-walled
        // vessel every engineer checks by eye.
        let lam = vessel(&[0.0, 90.0]);
        let result = run(
            &lam,
            &PressureVesselInput { pressure: 0.5, radius: 200.0, radius_type: RadiusType::Mean },
        );
        assert!((result.loads.n_y - 2.0 * result.loads.n_x).abs() < 1e-9);
        assert!((result.loads.n_x - 0.5 * 200.0 / 2.0).abs() < 1e-9);
        assert_eq!(result.loads.n_xy, 0.0);
    }

    #[test]
    fn an_inner_or_outer_radius_is_moved_half_a_wall() {
        let lam = vessel(&[0.0, 90.0]);
        let thickness = lam.tges();
        let inner = PressureVesselInput { pressure: 0.5, radius: 200.0, radius_type: RadiusType::Inner };
        let outer = PressureVesselInput { radius_type: RadiusType::Outer, ..inner };

        assert!((inner.mean_radius(thickness) - (200.0 + thickness / 2.0)).abs() < 1e-12);
        assert!((outer.mean_radius(thickness) - (200.0 - thickness / 2.0)).abs() < 1e-12);
        assert!(run(&lam, &inner).mean_radius > run(&lam, &outer).mean_radius);
    }

    #[test]
    fn the_wall_is_held_straight_and_the_moments_that_takes_are_reported() {
        let lam = vessel(&[0.0, 90.0, 45.0]);
        let result = run(
            &lam,
            &PressureVesselInput { pressure: 0.4, radius: 150.0, radius_type: RadiusType::Mean },
        );
        for curvature in [result.strains.kappa_x, result.strains.kappa_y, result.strains.kappa_xy] {
            assert!(curvature.abs() < 1e-12, "curvature {curvature} should be prescribed to zero");
        }
        // A symmetric laminate under membrane load needs no moment to stay
        // straight; the point is that the solver reports whatever it takes.
        assert!(result.loads.m_x.abs() < 1e-6);
    }

    #[test]
    fn the_hoop_strain_falls_off_through_the_wall() {
        // The one place a vessel differs from a flat laminate: the hoop strain
        // follows 1/r, so the inner surface is strained more than the outer.
        let lam = vessel(&[0.0, 90.0]);
        let result = run(
            &lam,
            &PressureVesselInput { pressure: 2.0, radius: 20.0, radius_type: RadiusType::Mean },
        );
        let first = &result.layer_results[0];
        // Layer 0 sits at the largest z, i.e. the outer surface: its upper
        // (outer) hoop strain must be the smaller one.
        let upper = first.sss_upper_global.strain[1];
        let lower = first.sss_lower_global.strain[1];
        assert!(upper < lower, "outer {upper} should be strained less than inner {lower}");
    }

    #[test]
    fn a_thicker_vessel_is_less_strained_by_the_same_pressure() {
        let thin = vessel(&[0.0, 90.0]);
        let thick = vessel(&[0.0, 90.0, 0.0, 90.0, 0.0, 90.0]);
        let input = PressureVesselInput { pressure: 1.0, radius: 300.0, radius_type: RadiusType::Mean };
        assert!(run(&thick, &input).strains.epsilon_y < run(&thin, &input).strains.epsilon_y);
    }

    #[test]
    fn a_degenerate_radius_is_reported_rather_than_dividing_by_zero() {
        let lam = vessel(&[0.0, 90.0]);
        let error = calculate(
            &lam,
            &materials(),
            &default_criterion_registry(),
            &PressureVesselInput { pressure: 1.0, radius: 0.0, radius_type: RadiusType::Mean },
        )
        .expect_err("a vessel of no radius is not a vessel");
        assert!(matches!(error, PressureVesselError::NonPositiveRadius(_)));
    }
}
