//! The two isotropic yield criteria.
//! Reference: eLamX2/AdditionalFailureCriteriaMetal/src/de/elamx/laminate/addFailureCriteriaMetal/
//!
//! Tresca and von Mises are not composite criteria at all - they are what a
//! metal ply is judged by, and eLamX offers them because a real laminate often
//! has one: a metal foil in a fibre-metal laminate, a titanium doubler, an
//! aluminium honeycomb face sheet.
//!
//! Both take the yield strength from `r_par_ten`, both report
//! `GeneralMaterialFailure` - there is no fibre and no matrix to tell apart -
//! and both assume the material is isotropic without requiring it. The
//! original checks and shows a dialog, then computes anyway; this crate
//! exposes the same check as [`is_isotropic`] for a caller that wants to warn,
//! and the criteria themselves compute regardless. See that function on why the
//! check is the original's and not a tidier one.

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

/// Whether a material is isotropic enough for these criteria to mean anything.
///
/// Port of `IsotropCriterion.checkMaterial`, tolerances and all: the strengths
/// and the two moduli must match EXACTLY, and only the shear modulus is
/// allowed a one percent band around `E / (2 (1 + nu))`. Exact equality on
/// floating point is a strange rule, but it is the original's, and a material
/// typed in as isotropic will satisfy it - the numbers come from the same
/// fields the user filled in, not from a computation.
///
/// Returning a bool rather than refusing: eLamX warns and then computes, so a
/// port that refused would answer a question the original answers.
pub fn is_isotropic(material: &Material) -> bool {
    const SHEAR_TOLERANCE: f64 = 0.01;

    if material.r_par_ten != material.r_par_com
        || material.r_nor_ten != material.r_nor_com
        || material.r_par_ten != material.r_nor_ten
        || material.e_par != material.e_nor
        || material.nue12 != material.nue21()
    {
        return false;
    }

    let shear = material.e_par / (2.0 * (1.0 + material.nue12));
    material.g <= (1.0 + SHEAR_TOLERANCE) * shear && material.g >= (1.0 - SHEAR_TOLERANCE) * shear
}

/// The name both criteria give their one failure mode. The original resolves
/// `vonMises.Failure` and `Tresca.Failure` from its bundles, and both say
/// "Failure": with no mechanisms to distinguish there is nothing else to say.
const FAILURE: &str = "Failure";

/// von Mises: the distortion-energy criterion, in plane stress.
pub struct VonMises;

impl Criterion for VonMises {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;
        let equivalent = s[0] * s[0] + s[1] * s[1] - s[0] * s[1] + 3.0 * s[2] * s[2];

        // An unstressed ply cannot yield. The original divides and gets an
        // infinity, which is the same answer told less clearly.
        if equivalent == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        let strength = material.r_par_ten;
        Ok(ReserveFactor {
            failure_name: FAILURE.to_string(),
            minimal_reserve_factor: (strength * strength / equivalent).sqrt(),
            failure_type: FailureType::GeneralMaterialFailure,
        })
    }
}

/// Tresca: the maximum-shear-stress criterion, in plane stress.
pub struct Tresca;

impl Criterion for Tresca {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;

        // The two in-plane principal stresses. The third is zero - this is
        // plane stress - and it matters: `|s1 - s2|` is the shear between the
        // two in-plane principals, while `|s1|` and `|s2|` are each the shear
        // against that zero third one. The original takes the largest of the
        // three, which is what makes Tresca differ from von Mises at all.
        let mean = (s[0] + s[1]) / 2.0;
        let radius = (((s[0] - s[1]) / 2.0).powi(2) + s[2] * s[2]).sqrt();
        let s1 = mean + radius;
        let s2 = mean - radius;

        let governing = s1.abs().max(s2.abs()).max((s1 - s2).abs());
        if governing == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        Ok(ReserveFactor {
            failure_name: FAILURE.to_string(),
            minimal_reserve_factor: material.r_par_ten / governing,
            failure_type: FailureType::GeneralMaterialFailure,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Aluminium, typed in as a laminate ply: isotropic, one strength.
    fn aluminium() -> Material {
        let e = 70000.0;
        let nu = 0.33;
        let mut m = Material::new("al", "Al", e, e, nu, e / (2.0 * (1.0 + nu)), 2.7e-9);
        m.r_par_ten = 300.0;
        m.set_r_par_com(300.0);
        m.r_nor_ten = 300.0;
        m.set_r_nor_com(300.0);
        m.set_r_shear(300.0 / 3.0f64.sqrt());
        m
    }

    fn at(stress: [f64; 3]) -> StressStrainState {
        StressStrainState { stress, strain: [0.0; 3] }
    }

    fn rf(criterion: &dyn Criterion, material: &Material, stress: [f64; 3]) -> f64 {
        criterion
            .reserve_factor(material, None, &at(stress))
            .unwrap()
            .minimal_reserve_factor
    }

    /// Uniaxial tension is where the two criteria agree with each other and
    /// with the definition of the yield strength: the reserve factor is simply
    /// the strength over the stress.
    #[test]
    fn both_criteria_reduce_to_the_yield_strength_in_uniaxial_tension() {
        let m = aluminium();
        assert!((rf(&VonMises, &m, [150.0, 0.0, 0.0]) - 2.0).abs() < 1e-12);
        assert!((rf(&Tresca, &m, [150.0, 0.0, 0.0]) - 2.0).abs() < 1e-12);
        // And in compression, since neither criterion knows a sign.
        assert!((rf(&VonMises, &m, [-150.0, 0.0, 0.0]) - 2.0).abs() < 1e-12);
        assert!((rf(&Tresca, &m, [-150.0, 0.0, 0.0]) - 2.0).abs() < 1e-12);
    }

    /// Pure shear is where they famously differ, and by a known amount: von
    /// Mises yields at R/sqrt(3) and Tresca at R/2, so Tresca is the more
    /// conservative by a factor of 2/sqrt(3).
    #[test]
    fn pure_shear_separates_the_two_by_the_textbook_factor() {
        let m = aluminium();
        let tau = 100.0;
        let mises = rf(&VonMises, &m, [0.0, 0.0, tau]);
        let tresca = rf(&Tresca, &m, [0.0, 0.0, tau]);
        assert!((mises - 300.0 / (3.0f64.sqrt() * tau)).abs() < 1e-9, "{mises}");
        assert!((tresca - 300.0 / (2.0 * tau)).abs() < 1e-9, "{tresca}");
        assert!((mises / tresca - 2.0 / 3.0f64.sqrt()).abs() < 1e-12);
    }

    /// Equal biaxial tension is the other end: Tresca sees no shear between
    /// the two in-plane principals, so only the out-of-plane pair governs, and
    /// the two criteria agree again.
    #[test]
    fn equal_biaxial_tension_brings_them_back_together() {
        let m = aluminium();
        let mises = rf(&VonMises, &m, [150.0, 150.0, 0.0]);
        let tresca = rf(&Tresca, &m, [150.0, 150.0, 0.0]);
        assert!((mises - 2.0).abs() < 1e-12, "{mises}");
        assert!((tresca - 2.0).abs() < 1e-12, "{tresca}");
    }

    /// The principal stresses have to come out of a rotated state too - a
    /// criterion that read the components directly would pass every test
    /// above and fail here.
    #[test]
    fn tresca_finds_the_principal_stresses_of_a_rotated_state() {
        let m = aluminium();
        // Pure shear at 45 degrees is tension and compression of equal size.
        let plain = rf(&Tresca, &m, [100.0, -100.0, 0.0]);
        let rotated = rf(&Tresca, &m, [0.0, 0.0, 100.0]);
        assert!((plain - rotated).abs() < 1e-12, "{plain} vs {rotated}");
        assert!((rf(&VonMises, &m, [100.0, -100.0, 0.0]) - rf(&VonMises, &m, [0.0, 0.0, 100.0])).abs() < 1e-12);
    }

    #[test]
    fn an_unstressed_ply_cannot_yield() {
        let m = aluminium();
        assert!(rf(&VonMises, &m, [0.0; 3]).is_infinite());
        assert!(rf(&Tresca, &m, [0.0; 3]).is_infinite());
    }

    /// The isotropy test, on the material it was written for and on one that
    /// should not be judged by these criteria at all.
    #[test]
    fn the_isotropy_check_tells_a_metal_from_a_composite() {
        assert!(is_isotropic(&aluminium()));

        let mut composite = Material::new("cfk", "CFK", 141000.0, 9340.0, 0.35, 4500.0, 1.7e-9);
        composite.r_par_ten = 2000.0;
        composite.set_r_par_com(2000.0);
        composite.r_nor_ten = 2000.0;
        composite.set_r_nor_com(2000.0);
        assert!(!is_isotropic(&composite));

        // Only the shear modulus gets a tolerance, and it is one percent.
        let mut nearly = aluminium();
        nearly.g *= 1.005;
        assert!(is_isotropic(&nearly));
        nearly.g = aluminium().g * 1.02;
        assert!(!is_isotropic(&nearly));

        // Everything else is exact, which is the original's own rule.
        let mut uneven = aluminium();
        uneven.r_nor_ten = 300.0001;
        uneven.set_r_nor_com(300.0001);
        assert!(!is_isotropic(&uneven));
    }
}
