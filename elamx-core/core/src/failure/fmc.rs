//! FMC (Cuntze) failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/FMC.java

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

/// Shear-friction parameter (Cuntze's "mue_sp").
pub const MUE_SP: &str = "fmc.mue_sp";
/// Curve-rounding exponent.
pub const M: &str = "fmc.m";

pub struct Fmc;

impl Criterion for Fmc {
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

        let mue_sp = additional_value(material, MUE_SP)?;
        let m = additional_value(material, M)?;

        let (ff, text_f_f) = if s[0] >= 0.0 {
            ((s[0] / material.r_par_ten).powf(m), "FiberFailureTension")
        } else {
            ((-s[0] / material.r_par_com).powf(m), "FiberFailureCompression")
        };

        let (iff13, text_f_m) = if s[1] >= 0.0 {
            ((s[1] / material.r_nor_ten).powf(m), "MatrixFailureTension")
        } else {
            ((-s[1] / material.r_nor_com).powf(m), "MatrixFailureCompression")
        };

        // Guarded so the base of the power stays non-negative (a negative
        // base with a non-integer exponent `m` would be mathematically undefined).
        let abs_shear = s[2].abs();
        let iff2 = if abs_shear != 0.0 && abs_shear + mue_sp * s[1] > 0.0 {
            ((abs_shear + mue_sp * s[1]) / material.r_shear).powf(m)
        } else {
            0.0
        };
        let text_f_sp = "MatrixFailureShear";

        let (name, ftype) = if ff > iff13 {
            if ff > iff2 {
                (text_f_f, FailureType::FiberFailure)
            } else {
                (text_f_sp, FailureType::MatrixFailure)
            }
        } else if iff13 > iff2 {
            (text_f_m, FailureType::MatrixFailure)
        } else {
            (text_f_sp, FailureType::MatrixFailure)
        };

        let minimal_reserve_factor = (ff + iff13 + iff2).powf(-1.0 / m);

        Ok(ReserveFactor {
            failure_name: name.to_string(),
            minimal_reserve_factor,
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
        m.additional_values = HashMap::from([(MUE_SP.to_string(), 0.3), (M.to_string(), 1.5)]);
        m
    }

    #[test]
    fn undamaged_at_zero_stress() {
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Fmc.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        // At s0 = R_par_ten (s1=s2=0): ff = 1^m = 1, iff13 = iff2 = 0, so the
        // total is 1^(-1/m) = 1.0 regardless of m or mue_sp.
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Fmc.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn missing_additional_value_is_an_error() {
        let material = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let state = StressStrainState {
            stress: [100.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        assert!(Fmc.reserve_factor(&material, None, &state).is_err());
    }
}
