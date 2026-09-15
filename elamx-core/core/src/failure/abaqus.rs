//! The two criteria Abaqus implements, as Abaqus implements them.
//! Reference: eLamX2/AdditionalAbaqusFailureCriteria/src/de/elamx/laminate/addFailureCriteriaAbaqus/{AbaqusTsaiWu,AbaqusAzziTsaiHill}.java
//!
//! Both have a namesake among the ordinary criteria, and neither agrees with
//! it. That is the point of having them: a laminate checked in eLamX and the
//! same laminate checked in a finite-element run should fail at the same load,
//! and it does not unless the check is the one the solver actually performs.
//! So these are not refinements of `tsai_wu` and `tsai_hill` - they are what
//! Abaqus does, differences included.

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub const F12_STAR: &str = "abaqus_tsai_wu.f12_star";
/// The equibiaxial strength. Zero means "not measured", and then `F12_STAR` is
/// used instead - which is what the property sheet's default of 0 says.
pub const SIG_BIAX: &str = "abaqus_tsai_wu.sig_biax";

pub struct AbaqusTsaiWu;

impl Criterion for AbaqusTsaiWu {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let f12_star = additional_value(material, F12_STAR)?;
        let sig_biax = additional_value(material, SIG_BIAX)?;
        let s = state.stress;

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        // With an equibiaxial strength measured, Abaqus computes the
        // interaction term from it rather than taking it as a free parameter.
        //
        // Transcribed from the original, including the two signs that keep it
        // from doing what it is for: a term calibrated at sigma_1 = sigma_2 =
        // sig_biax has to make the criterion come out at exactly 1 there, and
        // the only term that does is
        //
        //     [1 - (f1 + f2) * s - (f11 + f22) * s^2] / (2 * s^2)
        //
        // whereas this adds the two compressive reciprocals instead of
        // subtracting them, and adds the quadratic part instead. So the
        // reserve factor at the calibration point is not 1. Changing it here
        // would put this crate's answer at odds with eLamX's and with whatever
        // Abaqus deck was written from the same numbers, which is the one thing
        // this criterion exists not to do. See the note in the roadmap.
        let f12 = if sig_biax > 0.0 {
            let reciprocals = 1.0 / material.r_par_ten
                + 1.0 / material.r_par_com
                + 1.0 / material.r_nor_ten
                + 1.0 / material.r_nor_com;
            (1.0 - reciprocals * sig_biax + (f11 + f22) * sig_biax * sig_biax)
                / (2.0 * sig_biax * sig_biax)
        } else {
            f12_star * (f11 * f22).sqrt()
        };

        let q = f11 * s[0] * s[0] + 2.0 * f12 * s[0] * s[1] + f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l = f1 * s[0] + f2 * s[1];

        if q == 0.0 && l == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        // Same quadratic as `tsai_wu`, and the same unconditional fibre-failure
        // label on a criterion that cannot tell the two modes apart.
        Ok(ReserveFactor {
            failure_name: "Failure".to_string(),
            minimal_reserve_factor: ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q),
            failure_type: FailureType::FiberFailure,
        })
    }
}

pub struct AbaqusAzziTsaiHill;

impl Criterion for AbaqusAzziTsaiHill {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;

        // Which strength enters depends on the sign of the stress it belongs
        // to, so the envelope is assembled from four quadrants of quadric
        // rather than being one.
        let (f11, f12) = if s[0] > 0.0 {
            let r = material.r_par_ten;
            (1.0 / (r * r), -1.0 / (2.0 * r * r))
        } else {
            let r = material.r_par_com;
            (1.0 / (r * r), -1.0 / (2.0 * r * r))
        };
        let f22 = if s[1] > 0.0 {
            1.0 / (material.r_nor_ten * material.r_nor_ten)
        } else {
            1.0 / (material.r_nor_com * material.r_nor_com)
        };
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        // `abs` on the cross term, which is Abaqus's own: the interaction
        // weakens the ply whichever way the product of the two stresses points.
        let q = f11 * s[0] * s[0]
            + 2.0 * f12 * (s[0] * s[1]).abs()
            + f22 * s[1] * s[1]
            + f66 * s[2] * s[2];

        if q == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        Ok(ReserveFactor {
            failure_name: "Failure".to_string(),
            minimal_reserve_factor: 1.0 / q.sqrt(),
            failure_type: FailureType::FiberFailure,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::collections::HashMap;

    fn material(sig_biax: f64) -> Material {
        let mut m = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = HashMap::from([
            (F12_STAR.to_string(), -0.5),
            (SIG_BIAX.to_string(), sig_biax),
        ]);
        m
    }

    fn at(stress: [f64; 3]) -> StressStrainState {
        StressStrainState {
            stress,
            strain: [0.0, 0.0, 0.0],
        }
    }

    /// Every one of the three uniaxial allowables, each of which has to come
    /// out at exactly 1 - that is what an allowable is, and it holds whatever
    /// the interaction term does, because the interaction term drops out.
    #[test]
    fn azzi_tsai_hill_is_one_at_each_allowable() {
        for stress in [
            [2000.0, 0.0, 0.0],
            [-1200.0, 0.0, 0.0],
            [0.0, 50.0, 0.0],
            [0.0, -150.0, 0.0],
            [0.0, 0.0, 70.0],
            [0.0, 0.0, -70.0],
        ] {
            let rf = AbaqusAzziTsaiHill
                .reserve_factor(&material(0.0), None, &at(stress))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
        }
    }

    /// The `abs` on the cross term, stated as what it does: swapping the sign
    /// of the transverse stress leaves the reserve factor alone, which an
    /// ordinary Azzi-Tsai-Hill would not.
    #[test]
    fn azzi_tsai_hill_ignores_the_sign_of_the_interaction() {
        let m = material(0.0);
        let with_tension = AbaqusAzziTsaiHill
            .reserve_factor(&m, None, &at([1000.0, 20.0, 0.0]))
            .unwrap();
        let mirrored = AbaqusAzziTsaiHill
            .reserve_factor(&m, None, &at([1000.0, -20.0, 0.0]))
            .unwrap();
        // Not equal outright: the transverse strength differs by sign too. What
        // is equal is the interaction's contribution, so the two agree once the
        // same transverse strength is used on both sides.
        let mut symmetric = material(0.0);
        symmetric.set_r_nor_com(50.0);
        let a = AbaqusAzziTsaiHill
            .reserve_factor(&symmetric, None, &at([1000.0, 20.0, 0.0]))
            .unwrap();
        let b = AbaqusAzziTsaiHill
            .reserve_factor(&symmetric, None, &at([1000.0, -20.0, 0.0]))
            .unwrap();
        assert_relative_eq!(a.minimal_reserve_factor, b.minimal_reserve_factor, epsilon = 1e-12);
        assert!(with_tension.minimal_reserve_factor != mirrored.minimal_reserve_factor);
    }

    #[test]
    fn undamaged_at_zero_stress() {
        for rf in [
            AbaqusAzziTsaiHill
                .reserve_factor(&material(0.0), None, &at([0.0; 3]))
                .unwrap(),
            AbaqusTsaiWu
                .reserve_factor(&material(0.0), None, &at([0.0; 3]))
                .unwrap(),
        ] {
            assert_eq!(rf.failure_type, FailureType::Undamaged);
        }
    }

    /// Fibre tension, where the interaction term drops out of the Tsai-Wu
    /// quadratic and the answer is 1 for any `f12`.
    #[test]
    fn tsai_wu_is_one_at_the_fibre_tension_allowable() {
        for sig_biax in [0.0, 40.0] {
            let rf = AbaqusTsaiWu
                .reserve_factor(&material(sig_biax), None, &at([2000.0, 0.0, 0.0]))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
        }
    }

    /// Without an equibiaxial strength the criterion is the ordinary Tsai-Wu
    /// with the same `F12*`, so the two have to agree exactly.
    #[test]
    fn tsai_wu_without_a_biaxial_strength_is_the_ordinary_tsai_wu() {
        let mut m = material(0.0);
        m.additional_values
            .insert(super::super::F12_STAR.to_string(), -0.5);
        let state = at([800.0, -30.0, 25.0]);
        let abaqus = AbaqusTsaiWu.reserve_factor(&m, None, &state).unwrap();
        let ordinary = super::super::TsaiWu.reserve_factor(&m, None, &state).unwrap();
        assert_eq!(abaqus.minimal_reserve_factor, ordinary.minimal_reserve_factor);
    }

    /// The transcribed bug, written down so that it is a decision and not an
    /// accident: at the stress state the interaction term was calibrated on,
    /// the reserve factor should be 1 and is not.
    #[test]
    fn the_biaxial_branch_misses_its_own_calibration_point() {
        let sig_biax = 40.0;
        let rf = AbaqusTsaiWu
            .reserve_factor(&material(sig_biax), None, &at([sig_biax, sig_biax, 0.0]))
            .unwrap();
        assert!(
            (rf.minimal_reserve_factor - 1.0).abs() > 0.1,
            "RF am Kalibrierpunkt: {}",
            rf.minimal_reserve_factor
        );

        // What the term would have to be for it to hold, as a check that the
        // reasoning above is right and not just an assertion about a number.
        let m = material(0.0);
        let f1 = 1.0 / m.r_par_ten - 1.0 / m.r_par_com;
        let f2 = 1.0 / m.r_nor_ten - 1.0 / m.r_nor_com;
        let f11 = 1.0 / (m.r_par_ten * m.r_par_com);
        let f22 = 1.0 / (m.r_nor_ten * m.r_nor_com);
        let correct = (1.0 - (f1 + f2) * sig_biax - (f11 + f22) * sig_biax * sig_biax)
            / (2.0 * sig_biax * sig_biax);
        let q = (f11 + 2.0 * correct + f22) * sig_biax * sig_biax;
        let l = (f1 + f2) * sig_biax;
        assert_relative_eq!(((l * l + 4.0 * q).sqrt() - l) / (2.0 * q), 1.0, epsilon = 1e-12);
    }
}
