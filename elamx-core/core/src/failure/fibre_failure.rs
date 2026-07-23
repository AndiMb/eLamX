//! Fibre-failure-only criterion (ignores transverse/shear stress entirely).
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/FibreFailure.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct FibreFailure;

impl Criterion for FibreFailure {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s0 = state.stress[0];

        if s0 > 0.0 {
            Ok(ReserveFactor {
                failure_name: "FiberFailureTension".to_string(),
                minimal_reserve_factor: material.r_par_ten / s0,
                failure_type: FailureType::FiberFailure,
            })
        } else if s0 < 0.0 {
            Ok(ReserveFactor {
                failure_name: "FiberFailureCompression".to_string(),
                minimal_reserve_factor: -material.r_par_com / s0,
                failure_type: FailureType::FiberFailure,
            })
        } else {
            Ok(ReserveFactor::undamaged())
        }
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
        m
    }

    #[test]
    fn undamaged_when_fiber_stress_is_zero() {
        let state = StressStrainState {
            stress: [0.0, 500.0, 30.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = FibreFailure.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_the_allowable_stress() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = FibreFailure.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }

    #[test]
    fn ignores_transverse_and_shear_stress() {
        let state = StressStrainState {
            stress: [1000.0, 1.0e9, 1.0e9],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = FibreFailure.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 2.0, epsilon = 1e-9);
    }
}
