//! What ANSYS offers for a composite ply, which is one criterion and three
//! material parameters.
//! Reference: eLamX2/AdditionalAnsysFailurecriteria/src/de/elamx/laminate/addFailureCriteriaAnsys/
//!
//! The module in the Java holds three criteria and REGISTERS ONE. Its
//! `layer.xml` has `AnsysHoffman` commented out as "ANSYS Vorzeichendefinition:
//! wahrscheinlich ueberfluessig" and `AnsysLaRC03` as "funktioniert noch nicht".
//! The latter still prints its own reserve factor to stdout, which is what
//! unfinished code looks like. So eLamX offers neither, and porting them would
//! not be porting: it would be adding a criterion the original's author decided
//! against, and in the LaRC03 case one they marked as not working. They stay
//! out until that is somebody's decision rather than an accident of
//! transcription.
//!
//! The LaRC03's three material parameters are a different matter: those ARE
//! registered, so every eLamX material carries them and the file stores them.
//! They are named here and travel through the round trip untouched.

use super::{Criterion, CriterionError, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

/// The LaRC03's two critical energy release rates and its fracture-plane angle
/// in degrees. Registered in eLamX as material parameters even though the
/// criterion that reads them is not - see the module note.
pub const LARC03_G1C: &str = "ansys_larc03.g1c";
pub const LARC03_G2C: &str = "ansys_larc03.g2c";
pub const LARC03_ALPHA_0: &str = "ansys_larc03.alpha_0";

pub struct AnsysHashin;

impl Criterion for AnsysHashin {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        // Helius's Hashin with alpha = 1 (the classical weighting) and the
        // in-plane shear strength standing in for R23, which is the only shear
        // strength an ANSYS ply carries.
        super::solver_hashin::reserve_factor(
            material,
            state.stress,
            1.0,
            material.r_shear,
            "Ansys-Hashin",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::FailureType;
    use super::*;
    use approx::assert_relative_eq;

    fn material() -> Material {
        let mut m = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m
    }

    fn at(stress: [f64; 3]) -> StressStrainState {
        StressStrainState {
            stress,
            strain: [0.0, 0.0, 0.0],
        }
    }

    /// ANSYS's Hashin is the classical one, so every uniaxial allowable is 1.
    #[test]
    fn the_allowables_come_out_at_one() {
        for stress in [
            [2000.0, 0.0, 0.0],
            [-1200.0, 0.0, 0.0],
            [0.0, 50.0, 0.0],
            [0.0, -150.0, 0.0],
            [0.0, 0.0, 70.0],
        ] {
            let rf = AnsysHashin.reserve_factor(&material(), None, &at(stress)).unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
        }
    }

    /// It differs from Helius's by the two numbers Helius lets the user set:
    /// with alpha at one and R23 at the in-plane shear strength, they agree.
    #[test]
    fn it_is_helius_hashin_with_the_two_free_numbers_fixed() {
        use std::collections::HashMap;
        let mut m = material();
        m.additional_values = HashMap::from([
            (super::super::AUTODESK_ALPHA.to_string(), 1.0),
            (super::super::AUTODESK_R23.to_string(), m.r_shear),
        ]);
        let state = at([-800.0, -30.0, 25.0]);
        assert_eq!(
            AnsysHashin.reserve_factor(&m, None, &state).unwrap().minimal_reserve_factor,
            super::super::AutodeskHashin
                .reserve_factor(&m, None, &state)
                .unwrap()
                .minimal_reserve_factor
        );
    }

    #[test]
    fn undamaged_at_zero_stress() {
        let rf = AnsysHashin.reserve_factor(&material(), None, &at([0.0; 3])).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }
}
