//! Maximum stress criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/MaxStress.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct MaxStress;

impl Criterion for MaxStress {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;

        if s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        let (mut rf_value, mut name, mut ftype) = if s[0] >= 0.0 {
            (
                material.r_par_ten / s[0],
                "FiberFailureTension",
                FailureType::FiberFailure,
            )
        } else {
            (
                -material.r_par_com / s[0],
                "FiberFailureCompression",
                FailureType::FiberFailure,
            )
        };

        let (matrix_value, matrix_name) = if s[1] >= 0.0 {
            (material.r_nor_ten / s[1], "MatrixFailureTension")
        } else {
            (-material.r_nor_com / s[1], "MatrixFailureCompression")
        };
        if matrix_value < rf_value {
            rf_value = matrix_value;
            name = matrix_name;
            ftype = FailureType::MatrixFailure;
        }

        let shear_value = material.r_shear / s[2].abs();
        if shear_value < rf_value {
            rf_value = shear_value;
            name = "MatrixFailureShear";
            ftype = FailureType::MatrixFailure;
        }

        let failure_name = if rf_value.is_infinite() {
            String::new()
        } else {
            name.to_string()
        };

        Ok(ReserveFactor {
            failure_name,
            minimal_reserve_factor: rf_value,
            failure_type: ftype,
        })
    }
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn undamaged_at_zero_stress() {
        let rf = MaxStress
            .reserve_factor(
                &material(),
                None,
                &StressStrainState {
                    stress: [0.0, 0.0, 0.0],
                    strain: [0.0, 0.0, 0.0],
                },
            )
            .unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
        assert!(rf.minimal_reserve_factor.is_infinite());
    }

    #[test]
    fn reserve_factor_is_one_at_the_allowable_stress() {
        let rf = MaxStress
            .reserve_factor(
                &material(),
                None,
                &StressStrainState {
                    stress: [2000.0, 0.0, 0.0],
                    strain: [0.0, 0.0, 0.0],
                },
            )
            .unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn matrix_shear_governs_when_it_is_the_smallest_reserve() {
        // Fiber stress far below allowable, shear stress at its allowable.
        let rf = MaxStress
            .reserve_factor(
                &material(),
                None,
                &StressStrainState {
                    stress: [10.0, 0.0, 70.0],
                    strain: [0.0, 0.0, 0.0],
                },
            )
            .unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
        assert_eq!(rf.failure_name, "MatrixFailureShear");
    }
}
