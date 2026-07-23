//! Edge failure criterion (seven independent half-plane/quadric checks; the
//! smallest applicable reserve factor governs).
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Edge.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Edge;

impl Criterion for Edge {
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

        let r_pz = material.r_par_ten;
        let r_pd = material.r_par_com;
        let r_sz = material.r_nor_ten;
        let r_sd = material.r_nor_com;
        let r_sp = material.r_shear;

        // 0.0 doubles as "nothing set yet" (matching the Java original's use
        // of the default `ReserveFactor()` state for that purpose) - safe
        // since none of these formulas legitimately produce exactly 0.0.
        let mut rf_value = 0.0_f64;
        let mut name = String::new();
        let mut ftype = FailureType::Undamaged;

        // 1. RF1 * sigma2 = R_sz
        if s[1] > 0.0 {
            rf_value = r_sz / s[1];
            name = "MatrixFailureTension".to_string();
            ftype = FailureType::MatrixFailure;
        }

        // 2. RF2^2*(sigma2/R_sz)^2 + RF2^2*(tau12/R_sp)^2 = 1
        if s[1] > 0.0 {
            let rf2 = (1.0 / ((s[1] / r_sz).powi(2) + (s[2] / r_sp).powi(2))).sqrt();
            if rf2 < rf_value || rf_value == 0.0 {
                rf_value = rf2;
                name = "MatrixShearFailure".to_string();
                ftype = FailureType::MatrixFailure;
            }
        }

        // 3. RF3 * sigma2 = -R_sd
        if s[1] < 0.0 {
            let rf3 = -r_sd / s[1];
            if rf3 < rf_value || rf_value == 0.0 {
                rf_value = rf3;
                name = "MatrixFailureCompression".to_string();
                ftype = FailureType::MatrixFailure;
            }
        }

        // 4. RF4 * sigma1 = R_pz
        if s[0] > 0.0 {
            let rf4 = r_pz / s[0];
            if rf4 < rf_value || rf_value == 0.0 {
                rf_value = rf4;
                name = "FibreFailureTension".to_string();
                ftype = FailureType::FiberFailure;
            }
        }

        // 5. RF5 * sigma1 = -R_pd
        if s[0] < 0.0 {
            let rf5 = -r_pd / s[0];
            if rf5 < rf_value || rf_value == 0.0 {
                rf_value = rf5;
                name = "FibreFailureCompression".to_string();
                ftype = FailureType::FiberFailure;
            }
        }

        // 6. RF6 * |tau12| = R_sp (always evaluated, unconditionally).
        let rf6 = r_sp / s[2].abs();
        if rf6 < rf_value || rf_value == 0.0 {
            rf_value = rf6;
            name = "ShearFailure".to_string();
            ftype = FailureType::MatrixFailure;
        }

        // 7. Combined fibre-compression/shear interaction.
        if s[0] < 0.0 && s[2] != 0.0 {
            let rf7 = 1.0 / ((-s[0] / r_pd) + (s[2].abs() / r_sp));
            if rf7 < rf_value || rf_value == 0.0 {
                rf_value = rf7;
                name = "FibreShearFailure".to_string();
                ftype = FailureType::FiberFailure;
            }
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
        let rf = Edge.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Edge.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FibreFailureTension");
    }

    #[test]
    fn combined_fibre_shear_interaction_can_govern() {
        // s0 = -R_pd (RF5 alone would be 1.0), plus a modest shear stress.
        // RF7 = 1/(1 + |s2|/R_sp) < 1.0 and beats both RF5 and RF6 here.
        let state = StressStrainState {
            stress: [-1200.0, 0.0, 7.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Edge.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0 / 1.1, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FibreShearFailure");
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }
}
