//! The two criteria Autodesk Helius implements.
//! Reference: eLamX2/AdditionalAutodeskFailureCriteria/src/de/elamx/laminate/addFailureCriteriaAutodesk/{AutodeskTsaiWu,AutodeskHashin}.java
//!
//! The Tsai-Wu is Abaqus's line for line, so it is the shared
//! [`SolverTsaiWu`] with Helius's own two parameters. The Hashin is not the
//! `hashin` in this crate: it weights the shear term of fibre tension with an
//! alpha the user sets, and its matrix-compression mode is built on a separate
//! transverse shear strength R23 rather than on the transverse one.

use super::solver_tsai_wu::SolverTsaiWu;
use super::{additional_value, Criterion, CriterionError, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub const F12_STAR: &str = "autodesk_tsai_wu.f12_star";
pub const SIG_BIAX: &str = "autodesk_tsai_wu.sig_biax";

/// Helius's Tsai-Wu: the shared implementation, Helius's parameters.
pub const AUTODESK_TSAI_WU: SolverTsaiWu = SolverTsaiWu {
    f12_star_key: F12_STAR,
    sig_biax_key: SIG_BIAX,
};

/// How much of the shear stress counts towards fibre tensile failure. One in
/// the property sheet, which is the classical Hashin; zero leaves fibre tension
/// a pure stress ratio.
pub const ALPHA: &str = "autodesk_hashin.alpha";
/// The transverse-transverse shear strength, which the matrix-compression mode
/// is built on. Not derived from anything else the material carries.
pub const R23: &str = "autodesk_hashin.r23";

pub struct AutodeskHashin;

impl Criterion for AutodeskHashin {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        super::solver_hashin::reserve_factor(
            material,
            state.stress,
            additional_value(material, ALPHA)?,
            additional_value(material, R23)?,
            "Autodesk-Hashin",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::FailureType;
    use super::*;
    use approx::assert_relative_eq;
    use std::collections::HashMap;

    fn material() -> Material {
        let mut m = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = HashMap::from([
            (F12_STAR.to_string(), -0.5),
            (SIG_BIAX.to_string(), 0.0),
            (ALPHA.to_string(), 1.0),
            (R23.to_string(), 60.0),
        ]);
        m
    }

    fn at(stress: [f64; 3]) -> StressStrainState {
        StressStrainState {
            stress,
            strain: [0.0, 0.0, 0.0],
        }
    }

    /// Each uniaxial allowable, and the mode that has to be named there.
    #[test]
    fn the_allowables_come_out_at_one_under_their_own_mode() {
        for (stress, name) in [
            ([2000.0, 0.0, 0.0], "FiberFailureTension"),
            ([-1200.0, 0.0, 0.0], "FiberFailureCompression"),
            ([0.0, 50.0, 0.0], "MatrixFailureTension"),
            // Pure shear reaches 1 in BOTH modes at once here (alpha = 1), and
            // the original only lets the matrix take over when it is strictly
            // smaller - so a tie is reported as fibre failure.
            ([0.0, 0.0, 70.0], "FiberFailureTension"),
        ] {
            let rf = AutodeskHashin
                .reserve_factor(&material(), None, &at(stress))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
            assert_eq!(rf.failure_name, name, "bei {stress:?}");
        }
    }

    /// Transverse compression, where the closed form is worth writing out: with
    /// no shear, Q and L are both proportional to sigma_2, and the reserve
    /// factor solves the same quadratic Hashin's mode C does. At
    /// sigma_2 = -R_nor_com it has to be 1 whatever R23 is, because the linear
    /// term is built to make it so.
    #[test]
    fn transverse_compression_is_one_at_the_allowable_for_any_r23() {
        for r23 in [30.0, 60.0, 150.0] {
            let mut m = material();
            m.additional_values.insert(R23.to_string(), r23);
            let rf = AutodeskHashin
                .reserve_factor(&m, None, &at([0.0, -150.0, 0.0]))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
            assert_eq!(rf.failure_name, "MatrixFailureCompression");
        }
    }

    /// Alpha is what separates this from the crate's own Hashin in fibre
    /// tension: at zero the shear stress stops counting there entirely.
    #[test]
    fn alpha_decides_whether_shear_reaches_fibre_tension() {
        let mut without = material();
        without.additional_values.insert(ALPHA.to_string(), 0.0);
        // Shear well below its own allowable, so the matrix mode does not take
        // over and the fibre number is the one reported.
        let state = at([1900.0, 0.0, 20.0]);
        let with_alpha = AutodeskHashin
            .reserve_factor(&material(), None, &state)
            .unwrap();
        let none = AutodeskHashin.reserve_factor(&without, None, &state).unwrap();
        assert_eq!(none.failure_name, "FiberFailureTension");
        assert_relative_eq!(none.minimal_reserve_factor, 2000.0 / 1900.0, epsilon = 1e-12);
        assert!(with_alpha.minimal_reserve_factor < none.minimal_reserve_factor);
    }

    #[test]
    fn undamaged_at_zero_stress() {
        let rf = AutodeskHashin
            .reserve_factor(&material(), None, &at([0.0; 3]))
            .unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    /// Helius's Tsai-Wu and Abaqus's are the same arithmetic on separately
    /// stored parameters: same numbers in, same number out.
    #[test]
    fn the_tsai_wu_agrees_with_abaqus_on_the_same_parameters() {
        let mut m = material();
        m.additional_values
            .insert(super::super::ABAQUS_F12_STAR.to_string(), -0.5);
        m.additional_values
            .insert(super::super::ABAQUS_SIG_BIAX.to_string(), 0.0);
        let state = at([800.0, -30.0, 25.0]);
        assert_eq!(
            AUTODESK_TSAI_WU
                .reserve_factor(&m, None, &state)
                .unwrap()
                .minimal_reserve_factor,
            super::super::ABAQUS_TSAI_WU
                .reserve_factor(&m, None, &state)
                .unwrap()
                .minimal_reserve_factor
        );
    }
}
