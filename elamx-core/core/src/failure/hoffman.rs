//! Hoffman failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Hoffman.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Hoffman;

impl Criterion for Hoffman {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        // Unlike Tsai-Wu/ZTL, Hoffman fixes F12 from the strengths directly
        // rather than taking an interaction-strength additional value.
        let f12 = -1.0 / (2.0 * material.r_par_ten * material.r_par_com);
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        let q = f11 * s[0] * s[0] + 2.0 * f12 * s[0] * s[1] + f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l = f1 * s[0] + f2 * s[1];

        if q == 0.0 && l == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        let minimal_reserve_factor = ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q);

        Ok(ReserveFactor {
            failure_name: "Failure".to_string(),
            minimal_reserve_factor,
            failure_type: FailureType::FiberFailure,
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
        let rf = Hoffman.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        // At s = [R_par_ten, 0, 0] the F12 cross-term vanishes (s1=0), so this
        // reduces to the same Q=x, L=1-x identity as Tsai-Wu: RF = 1.0.
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Hoffman.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }
}
