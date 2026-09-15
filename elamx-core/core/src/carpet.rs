//! Carpet plots: what a material's stiffness becomes at every mix of 0, +-45
//! and 90 degree plies.
//! Reference: eLamX2/CarpetPlots/src/de/elamx/carpetplots/{CarpetPlotCalculator,MaterialCarpetPlotTopComponent}.java
//!
//! A carpet plot answers the question a stacking table cannot: not "what does
//! THIS laminate do" but "what can this material be made to do". The three
//! fractions sum to one, so two of them span the whole space - the family of
//! curves is one per 0 degree fraction, read over the +-45 fraction, with the
//! 90 degree plies making up the rest.
//!
//! It is deliberately NOT a laminate calculation: no thicknesses, no stacking
//! order, no bending. Every ply of a given angle is treated as a share of one
//! smeared in-plane stiffness, which is what makes the picture readable at the
//! stage it is used - before there is a stack at all.

use crate::clt::CltLayer;
use crate::mathtools::{self, Matrix};
use crate::model::Material;
use serde::{Deserialize, Serialize};

/// Which engineering constant the plot is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum CarpetValue {
    /// Membrane modulus along the 0 degree direction.
    #[default]
    Ex,
    /// Membrane Poisson's ratio.
    NuXy,
    /// Membrane shear modulus.
    GXy,
}

/// One curve: a fixed 0 degree fraction, read over the +-45 fraction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct CarpetCurve {
    /// The 0 degree fraction this curve holds fixed, as a fraction of one.
    pub fraction_0: f64,
    /// True for the one curve that carries NO 90 degree plies at all: there the
    /// 0 degree fraction is not fixed but is whatever the +-45 plies leave.
    pub without_90: bool,
    /// The +-45 fraction at each point, as a fraction of one.
    pub fraction_45: Vec<f64>,
    /// The value at each point.
    pub values: Vec<f64>,
}

/// The plot: ten curves at 0, 10, ... 90 percent zero-degree plies, plus the
/// bound without any 90 degree plies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct CarpetPlot {
    pub value: CarpetValue,
    pub curves: Vec<CarpetCurve>,
}

/// How many points each curve is sampled at, and how many curves there are.
/// Both are the original's, which draws them without offering a setting.
pub const POINTS_PER_CURVE: usize = 100;
pub const CURVES: usize = 10;

/// The smeared in-plane stiffness of a mix, and the value read off it.
fn value_of(q_0: &Matrix, q_45: &Matrix, q_m45: &Matrix, q_90: &Matrix, fractions: [f64; 3], value: CarpetValue) -> f64 {
    let [fraction_0, fraction_45, fraction_90] = fractions;
    let mut q_total = vec![vec![0.0; 3]; 3];
    for m in 0..3 {
        for n in 0..3 {
            // The +-45 plies enter as half each, which is what removes the
            // shear-extension coupling: a carpet plot is of balanced laminates.
            q_total[m][n] = fraction_0 * q_0[m][n]
                + fraction_45 * q_45[m][n] / 2.0
                + fraction_45 * q_m45[m][n] / 2.0
                + fraction_90 * q_90[m][n];
        }
    }
    let compliance = mathtools::get_inverse(&q_total);
    match value {
        CarpetValue::Ex => 1.0 / compliance[0][0],
        CarpetValue::NuXy => -compliance[0][1] / compliance[0][0],
        CarpetValue::GXy => 1.0 / compliance[2][2],
    }
}

/// One curve at a fixed 0 degree fraction.
///
/// With `with_90`, the 90 degree plies take up whatever the other two leave and
/// the +-45 fraction stops at `1 - fraction_0`. Without them, there are only
/// two angles left and the 0 degree plies take up the rest, so the +-45
/// fraction runs all the way to one - which is the curve bounding the family
/// from below.
pub fn curve(
    material: &Material,
    fraction_0: f64,
    points: usize,
    value: CarpetValue,
    with_90: bool,
) -> CarpetCurve {
    let ply = |angle: f64| CltLayer::new(angle, 1.0, material, None).q_matrix_global();
    let q_0 = ply(0.0);
    let q_45 = ply(45.0);
    let q_m45 = ply(-45.0);
    let q_90 = ply(90.0);

    let delta = (1.0 - fraction_0) / (points as f64 - 1.0);
    let mut fraction_45 = Vec::with_capacity(points);
    let mut values = Vec::with_capacity(points);
    for i in 0..points {
        let f45 = i as f64 * delta;
        let (f0, f90) = if with_90 {
            (fraction_0, 1.0 - f45 - fraction_0)
        } else {
            (1.0 - f45, 0.0)
        };
        fraction_45.push(f45);
        values.push(value_of(&q_0, &q_45, &q_m45, &q_90, [f0, f45, f90], value));
    }

    CarpetCurve {
        fraction_0,
        without_90: !with_90,
        fraction_45,
        values,
    }
}

/// The whole plot, as the original draws it.
pub fn carpet_plot(material: &Material, value: CarpetValue) -> CarpetPlot {
    let mut curves: Vec<CarpetCurve> = (0..CURVES)
        .map(|i| curve(material, 0.1 * i as f64, POINTS_PER_CURVE, value, true))
        .collect();
    // The bound: no 90 degree plies anywhere, so the curve runs from all-0 to
    // all-+-45 and every other curve lies above it.
    curves.push(curve(material, 0.0, POINTS_PER_CURVE, value, false));
    CarpetPlot { value, curves }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn material() -> Material {
        Material::new("m", "UD", 141000.0, 9340.0, 0.35, 4500.0, 1.7e-9)
    }

    /// The three corners of the space, where the answer is the material's own
    /// constant and nothing has to be believed about the averaging.
    #[test]
    fn an_all_zero_stack_is_the_material_itself() {
        let m = material();
        let ex = curve(&m, 1.0, 2, CarpetValue::Ex, true);
        assert_relative_eq!(ex.values[0], m.e_par, epsilon = 1e-9);

        let nu = curve(&m, 1.0, 2, CarpetValue::NuXy, true);
        assert_relative_eq!(nu.values[0], m.nue12, epsilon = 1e-12);

        let g = curve(&m, 1.0, 2, CarpetValue::GXy, true);
        assert_relative_eq!(g.values[0], m.g, epsilon = 1e-9);
    }

    /// All 90 degree plies: the same material read across the fibres.
    #[test]
    fn an_all_ninety_stack_is_the_transverse_modulus() {
        let m = material();
        let ex = curve(&m, 0.0, 2, CarpetValue::Ex, true);
        assert_relative_eq!(ex.values[0], m.e_nor, epsilon = 1e-9);
    }

    /// All +-45: the shear modulus has a closed form in the plies' own Q, and
    /// it is the one point where the carpet plot beats the material it is made
    /// of - a +-45 laminate shears far less than a single ply does.
    #[test]
    fn an_all_plus_minus_forty_five_stack_matches_the_closed_form() {
        let m = material();
        let q = CltLayer::new(0.0, 1.0, &m, None).q_matrix_local().clone();
        let expected = (q[0][0] + q[1][1] - 2.0 * q[0][1]) / 4.0;

        let g = curve(&m, 0.0, 2, CarpetValue::GXy, true);
        assert_relative_eq!(g.values[1], expected, epsilon = 1e-9);
        assert!(g.values[1] > 5.0 * m.g, "{} vs {}", g.values[1], m.g);
    }

    /// The quasi-isotropic mix, which has to come out isotropic: 25/50/25 gives
    /// a shear modulus that agrees with E/(2(1+nu)) built from the plot's own
    /// two other values. Nothing in the code enforces that - it is a property
    /// of the averaging, and it is the strongest check available without a
    /// second implementation.
    #[test]
    fn the_quasi_isotropic_mix_comes_out_isotropic() {
        let m = material();
        // Four points from a 0 degree fraction of 0.25 land on +-45 fractions
        // of 0, 0.25, 0.5 and 0.75, so the third is the 25/50/25 mix.
        let at = |value: CarpetValue| {
            let c = curve(&m, 0.25, 4, value, true);
            assert_relative_eq!(c.fraction_45[2], 0.5, epsilon = 1e-12);
            c.values[2]
        };

        let ex = at(CarpetValue::Ex);
        let nu = at(CarpetValue::NuXy);
        let g = at(CarpetValue::GXy);
        assert_relative_eq!(g, ex / (2.0 * (1.0 + nu)), max_relative = 1e-9);
    }

    /// The family, as the plot draws it: ten curves plus the bound, each
    /// stopping where its own 0 degree fraction leaves off.
    #[test]
    fn the_plot_is_ten_curves_and_a_bound() {
        let plot = carpet_plot(&material(), CarpetValue::Ex);
        assert_eq!(plot.curves.len(), CURVES + 1);

        for (i, c) in plot.curves.iter().take(CURVES).enumerate() {
            assert_relative_eq!(c.fraction_0, 0.1 * i as f64, epsilon = 1e-12);
            assert!(!c.without_90);
            assert_eq!(c.values.len(), POINTS_PER_CURVE);
            assert_relative_eq!(c.fraction_45[0], 0.0, epsilon = 1e-12);
            // The +-45 plies can only take what the 0 degree ones leave.
            assert_relative_eq!(
                *c.fraction_45.last().unwrap(),
                1.0 - 0.1 * i as f64,
                epsilon = 1e-12
            );
        }

        let bound = plot.curves.last().unwrap();
        assert!(bound.without_90);
        assert_relative_eq!(*bound.fraction_45.last().unwrap(), 1.0, epsilon = 1e-12);
    }

    /// What the picture is for: more 0 degree plies, more stiffness along them,
    /// whatever the rest of the stack does.
    #[test]
    fn more_zero_degree_plies_always_means_more_stiffness_along_them() {
        let plot = carpet_plot(&material(), CarpetValue::Ex);
        for i in 1..CURVES {
            let lower = &plot.curves[i - 1];
            let upper = &plot.curves[i];
            // Compare at the same +-45 fraction, which both curves reach.
            assert!(
                upper.values[0] > lower.values[0],
                "{} !> {}",
                upper.values[0],
                lower.values[0]
            );
        }
    }

    /// The bound lies under the family: with the 90 degree plies replaced by
    /// 0 degree ones, every mix is at least as stiff along x.
    #[test]
    fn the_bound_without_ninety_degree_plies_lies_above_the_family() {
        let plot = carpet_plot(&material(), CarpetValue::Ex);
        let bound = plot.curves.last().unwrap();
        // At 50 percent +-45 the bound has 50 percent at 0 degrees, so it must
        // beat the curve that has 40 percent there and 10 percent at 90.
        let index = bound
            .fraction_45
            .iter()
            .position(|f| (*f - 0.5).abs() < 0.01)
            .expect("ein Punkt nahe 50 Prozent");
        let family = &plot.curves[4];
        let family_index = family
            .fraction_45
            .iter()
            .position(|f| (*f - 0.5).abs() < 0.01)
            .expect("ein Punkt nahe 50 Prozent");
        assert!(bound.values[index] > family.values[family_index]);
    }
}
