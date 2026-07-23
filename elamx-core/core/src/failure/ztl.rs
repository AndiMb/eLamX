//! ZTL failure criterion (Tsai-Wu-style matrix quadratic plus a separate,
//! possibly-governing fiber check).
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/ZTL.java

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub const F12_STAR: &str = "ztl.f12_star";

pub struct Ztl;

impl Criterion for Ztl {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let f12_star = additional_value(material, F12_STAR)?;
        let s = state.stress;

        if s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        let f12 = f12_star * (f11 * f22).sqrt();
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        let q = f11 * s[0] * s[0] + 2.0 * f12 * s[0] * s[1] + f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l = f1 * s[0] + f2 * s[1];

        let mut rf_value = ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q);
        let mut name = "MatrixFailure".to_string();
        let mut ftype = FailureType::MatrixFailure;

        let (value, cand_name) = if s[0] >= 0.0 {
            (material.r_par_ten / s[0], "FiberFailureTension")
        } else {
            (-material.r_par_com / s[0], "FiberFailureCompression")
        };
        // Strictly less-than, matching the Java original: a tie is reported as
        // matrix failure, not fiber failure.
        if value < rf_value {
            rf_value = value;
            name = cand_name.to_string();
            ftype = FailureType::FiberFailure;
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
        let rf = Ztl.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn matrix_wins_the_tie_at_pure_fiber_tension_allowable() {
        // At s0 = R_par_ten (s1=s2=0) both the matrix quadratic and the direct
        // fiber check evaluate to exactly 1.0; ZTL's strict `<` means the
        // matrix branch (computed first) keeps the result on a tie.
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Ztl.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
    }

    #[test]
    fn missing_additional_value_is_an_error() {
        let material = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let state = StressStrainState {
            stress: [100.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        assert!(Ztl.reserve_factor(&material, None, &state).is_err());
    }
}
