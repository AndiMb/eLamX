//! Mayes failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Mayes.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Mayes;

impl Criterion for Mayes {
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

        let (rf_f, name_f) = if s[0] > 0.0 {
            (
                (1.0 / ((s[0] / material.r_par_ten).powi(2) + (s[2] / material.r_shear).powi(2))).sqrt(),
                "FibreFailureTension",
            )
        } else {
            (
                (1.0 / ((s[0] / material.r_par_com).powi(2) + (s[2] / material.r_shear).powi(2))).sqrt(),
                "FibreFailureCompression",
            )
        };
        let mut rf_value = rf_f;
        let mut name = name_f.to_string();
        let mut ftype = FailureType::FiberFailure;

        let (rf_m, name_m) = if s[1] >= 0.0 {
            (
                (1.0 / ((s[1] / material.r_nor_ten).powi(2) + (s[2] / material.r_shear).powi(2))).sqrt(),
                "MatrixFailureTension",
            )
        } else {
            (
                (1.0 / ((s[1] / material.r_nor_com).powi(2) + (s[2] / material.r_shear).powi(2))).sqrt(),
                "MatrixFailureCompression",
            )
        };

        if rf_m < rf_value {
            rf_value = rf_m;
            name = name_m.to_string();
            ftype = FailureType::MatrixFailure;
        }

        Ok(ReserveFactor {
            failure_name: name,
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
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Mayes.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Mayes.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FibreFailureTension");
    }

    #[test]
    fn matrix_tension_governs_when_smaller_than_fiber_reserve() {
        let state = StressStrainState {
            stress: [10.0, 50.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Mayes.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
    }
}
