//! Christensen failure criterion (separate fiber and matrix quadratics).
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Christensen.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Christensen;

impl Criterion for Christensen {
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

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        // Fiber failure. `f64::MAX` (not infinity) mirrors the Java original's
        // sentinel exactly: it's only ever used in the comparison below, and
        // any finite matrix reserve factor is guaranteed to beat it.
        let (mut rf_value, mut name, mut ftype) = if s[0] == 0.0 {
            (f64::MAX, String::new(), FailureType::Undamaged)
        } else {
            let q_f = f11 * s[0] * s[0];
            let l_f = f1 * s[0];
            let resfac_f = ((l_f * l_f + 4.0 * q_f).sqrt() - l_f) / (2.0 * q_f);
            (resfac_f, "FiberFailure".to_string(), FailureType::FiberFailure)
        };

        // Matrix failure (inter-fiber fracture).
        let q_m = f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l_m = f2 * s[1];
        let resfac_m = ((l_m * l_m + 4.0 * q_m).sqrt() - l_m) / (2.0 * q_m);

        if resfac_m < rf_value {
            rf_value = resfac_m;
            name = "MatrixFailure".to_string();
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
        let rf = Christensen.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Christensen.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn matrix_governs_when_fiber_stress_is_zero() {
        let state = StressStrainState {
            stress: [0.0, 50.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Christensen.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }
}
