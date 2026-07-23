//! Sun failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Sun.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Sun;

impl Criterion for Sun {
    fn reserve_factor(
        &self,
        material: &Material,
        context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let s = state.stress;

        if s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        // A ply sandwiched between others has a higher in-situ transverse
        // tensile and shear strength than an edge/outer ply.
        let mut r_sp = material.r_shear;
        let mut r_sz = material.r_nor_ten;
        if context.is_some_and(|c| c.embedded) {
            r_sp *= 1.5;
            r_sz *= 1.5;
        }

        let (rf_f, name_f) = if s[0] > 0.0 {
            (material.r_par_ten / s[0], "FibreFailureTension")
        } else {
            // Java computes sqrt((R_par_com/s0)^2). `.abs()` on the same,
            // un-negated ratio is equivalent without the pointless
            // square-then-root - and, unlike negating first, it also matches
            // Java at the s0 == 0.0 boundary (both give +infinity there).
            ((material.r_par_com / s[0]).abs(), "FibreFailureCompression")
        };
        let mut rf_value = rf_f;
        let mut name = name_f.to_string();
        let mut ftype = FailureType::FiberFailure;

        let (rf_m, name_m) = if s[1] > 0.0 {
            (
                (1.0 / ((s[1] / r_sz).powi(2) + (s[2] / r_sp).powi(2))).sqrt(),
                "MatrixFailureTension",
            )
        } else {
            (
                (1.0 / ((s[1] / material.r_nor_com).powi(2) + (s[2] / r_sp).powi(2))).sqrt(),
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
        let rf = Sun.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Sun.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn embedded_layer_gets_a_higher_effective_transverse_strength() {
        // Non-embedded: RF = 1.0 exactly at the nominal R_nor_ten.
        let state_edge = StressStrainState {
            stress: [0.0, 50.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf_edge = Sun.reserve_factor(&material(), None, &state_edge).unwrap();
        assert_relative_eq!(rf_edge.minimal_reserve_factor, 1.0, epsilon = 1e-9);

        // Embedded: same nominal stress now only reaches 1/1.5 of the raised
        // effective strength, so the reserve factor should be 1.5.
        let embedded = LayerContext { angle_deg: 0.0, embedded: true };
        let rf_embedded = Sun
            .reserve_factor(&material(), Some(&embedded), &state_edge)
            .unwrap();
        assert_relative_eq!(rf_embedded.minimal_reserve_factor, 1.5, epsilon = 1e-9);
    }
}
