//! Tsai-Wu failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/TsaiWu.java

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub const F12_STAR: &str = "tsai_wu.f12_star";

pub struct TsaiWu;

impl Criterion for TsaiWu {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let f12_star = additional_value(material, F12_STAR)?;
        let s = state.stress;

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        let f12 = f12_star * (f11 * f22).sqrt();
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        let q = f11 * s[0] * s[0] + 2.0 * f12 * s[0] * s[1] + f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l = f1 * s[0] + f2 * s[1];

        // Matches the Java original: failure_type is unconditionally FiberFailure
        // even though this is a general quadratic (not fibre-specific) criterion.
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
    use std::collections::HashMap;

    fn material() -> Material {
        let mut m = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.r_par_ten = 2000.0;
        m.set_r_par_com(1200.0);
        m.r_nor_ten = 50.0;
        m.set_r_nor_com(150.0);
        m.set_r_shear(70.0);
        m.additional_values = HashMap::from([(F12_STAR.to_string(), -0.5)]);
        m
    }

    #[test]
    fn undamaged_at_zero_stress() {
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = TsaiWu.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        // At s = [R_par_ten, 0, 0] the F12 cross-term vanishes, so the result
        // is independent of f12_star: RF = 1.0 algebraically for any strength
        // pair (verified analytically: Q = x, L = 1-x with x = Rt/Rc, giving
        // sqrt(L^2+4Q) = 1+x and RF = ((1+x)-(1-x))/(2x) = 1).
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = TsaiWu.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }

    #[test]
    fn missing_additional_value_is_an_error() {
        let material = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let state = StressStrainState {
            stress: [100.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        assert!(TsaiWu.reserve_factor(&material, None, &state).is_err());
    }
}
