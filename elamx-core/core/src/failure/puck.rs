//! Puck failure criterion - the application's default criterion for new plies.
//! Reference: eLamX2/Laminate/src/de/elamx/laminate/failure/Puck.java

use super::{
    additional_value, non_negative, Criterion, CriterionError, FailureType, LayerContext,
    ReserveFactor,
};
use crate::model::{Material, StressStrainState};

pub const PSPD: &str = "puck.p_spd";
pub const PSPZ: &str = "puck.p_spz";
pub const A0: &str = "puck.a0";
pub const LAMBDA_MIN: &str = "puck.lambda_min";

pub struct Puck;

impl Criterion for Puck {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let p_spd = additional_value(material, PSPD)?;
        let p_spz = additional_value(material, PSPZ)?;
        let a0 = additional_value(material, A0)?;
        let lambda_min = additional_value(material, LAMBDA_MIN)?;

        let s = state.stress;
        if s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        let afb = if s[0] >= 0.0 {
            s[0] / material.r_par_ten
        } else {
            -s[0] / material.r_par_com
        };

        let mut r_ass = 0.5 * material.r_shear / p_spd;
        let d_temp = 1.0 + 2.0 * p_spd * material.r_nor_com / material.r_shear;
        non_negative(d_temp, "Puck: fracture resistance R_ASS")?;
        r_ass *= d_temp.sqrt() - 1.0;

        let p_ssd = p_spd * r_ass / material.r_shear;

        let d_temp = 1.0 + 2.0 * p_ssd;
        non_negative(d_temp, "Puck: shear strength tau_xyc")?;
        let tauxyc = material.r_shear * d_temp.sqrt();

        // Matches the Java original: if there's no transverse/shear stress at
        // all, `azfb`/`name` stay at these defaults. That's fine because the
        // final `if afb > azfb` block below always fires in that case
        // (afb > 0 == azfb) and overwrites both.
        let mut azfb = 0.0_f64;
        let mut name = String::new();

        if !(s[1] == 0.0 && s[2] == 0.0) {
            if s[1] > 0.0 {
                // Mode A
                let a = ((1.0 - p_spz * material.r_nor_ten / material.r_shear) / material.r_nor_ten)
                    .powi(2);
                let b = 1.0 / (material.r_shear * material.r_shear);
                let c = p_spz / material.r_shear;
                let d_temp = a * s[1] * s[1] + b * s[2] * s[2];
                non_negative(d_temp, "Puck: mode A")?;
                azfb = d_temp.sqrt() + c * s[1];
                name = "MatrixFailureModusA".to_string();
            } else if (s[1] / s[2]).abs() <= r_ass / tauxyc.abs() {
                // Mode B
                let a = (p_spd / material.r_shear).powi(2);
                let b = 1.0 / (material.r_shear * material.r_shear);
                let c = p_spd / material.r_shear;
                let d_temp = a * s[1] * s[1] + b * s[2] * s[2];
                non_negative(d_temp, "Puck: mode B")?;
                azfb = d_temp.sqrt() + c * s[1];
                name = "MatrixFailureModusB".to_string();
            } else {
                // Mode C
                let a = 1.0 / (material.r_nor_com * material.r_nor_com);
                let b = (0.5 / ((1.0 + p_ssd) * material.r_shear)).powi(2);
                let c = -material.r_nor_com;
                azfb = (a * s[1] * s[1] + b * s[2] * s[2]) * c / s[1];
                name = "MatrixFailureModusC".to_string();
            }
        }

        let rf_temp_min = if afb > azfb { 1.0 / afb } else { 1.0 / azfb };

        if azfb != 0.0
            && (rf_temp_min * s[0] > a0 * material.r_par_ten
                || rf_temp_min * s[0] < -a0 * material.r_par_com)
        {
            // Weakening of the fracture body near the fiber-failure envelope.
            let d_temp = 1.0 - lambda_min * lambda_min;
            non_negative(d_temp, "Puck: weakening term (lambda_min)")?;
            let a = (1.0 - a0) / d_temp.sqrt();

            let delta = azfb / afb;

            let d_temp = 1.0 + delta * delta * (a * a - a0 * a0);
            non_negative(d_temp, "Puck: weakening term (lambda)")?;
            let lambda = (a0 + a * d_temp.sqrt()) / (1.0 + a * a * delta * delta) * delta;

            azfb /= lambda;
        }

        let mut minimal_reserve_factor = 1.0 / azfb;
        let mut failure_type = FailureType::MatrixFailure;

        if afb > azfb {
            minimal_reserve_factor = 1.0 / afb;
            name = if s[0] >= 0.0 {
                "FiberFailureTension".to_string()
            } else {
                "FiberFailureCompression".to_string()
            };
            failure_type = FailureType::FiberFailure;
        }

        Ok(ReserveFactor {
            failure_name: name,
            minimal_reserve_factor,
            failure_type,
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
        // Typical literature values for CFRP (Puck & Schürmann).
        m.additional_values = HashMap::from([
            (PSPD.to_string(), 0.3),
            (PSPZ.to_string(), 0.35),
            (A0.to_string(), 0.5),
            (LAMBDA_MIN.to_string(), 0.5),
        ]);
        m
    }

    #[test]
    fn undamaged_at_zero_stress() {
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Puck.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Puck.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
        assert_eq!(rf.failure_name, "FiberFailureTension");
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_compression_allowable() {
        let state = StressStrainState {
            stress: [-1200.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Puck.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FiberFailureCompression");
    }

    #[test]
    fn transverse_tension_triggers_mode_a_matrix_failure() {
        let state = StressStrainState {
            stress: [0.0, 20.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Puck.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
        assert_eq!(rf.failure_name, "MatrixFailureModusA");
        assert!(rf.minimal_reserve_factor > 0.0 && rf.minimal_reserve_factor.is_finite());
    }

    #[test]
    fn missing_additional_value_is_an_error() {
        let material = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let state = StressStrainState {
            stress: [100.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        assert!(Puck.reserve_factor(&material, None, &state).is_err());
    }
}
