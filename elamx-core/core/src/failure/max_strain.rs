//! Maximum strain criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/MaxStrain.java

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::mathtools::{self, Matrix};
use crate::model::{Material, StressStrainState};

pub const EPS_X: &str = "max_strain.eps_x";
pub const EPS_Y: &str = "max_strain.eps_y";
pub const GAMMA_XY: &str = "max_strain.gamma_xy";
/// Threshold-encoded boolean (`> 0.5` means the strain limits above are
/// defined in the global rather than the local/fibre-aligned system),
/// matching the Java original's use of a `Double` additional value for this flag.
pub const GLOBAL_LOCAL: &str = "max_strain.global_local";

pub struct MaxStrain;

impl Criterion for MaxStrain {
    fn reserve_factor(
        &self,
        material: &Material,
        context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let eps_x = additional_value(material, EPS_X)?;
        let eps_y = additional_value(material, EPS_Y)?;
        let gamma_xy = additional_value(material, GAMMA_XY)?;
        let global = additional_value(material, GLOBAL_LOCAL)? > 0.5;

        let mut strains = state.strain;

        if strains[0] == 0.0 && strains[1] == 0.0 && strains[2] == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        if global {
            let trans_glo_to_loc = trans_mat_eps_glo_to_loc(context);
            let inv = mathtools::get_inverse(&trans_glo_to_loc);
            strains = mathtools::mat_vec_mult(&inv, &strains)
                .try_into()
                .expect("3x3 matrix times 3-vector yields a 3-vector");
        }

        let mut rf_value = eps_x / strains[0].abs();
        let mut name = "FiberFailure";
        let mut ftype = FailureType::FiberFailure;

        let matrix_value = eps_y / strains[1].abs();
        if matrix_value < rf_value {
            rf_value = matrix_value;
            name = "MatrixFailure";
            ftype = FailureType::MatrixFailure;
        }

        let shear_value = gamma_xy / strains[2].abs();
        if shear_value < rf_value {
            rf_value = shear_value;
            name = "MatrixFailureShear";
            ftype = FailureType::MatrixFailure;
        }

        let failure_name = if rf_value.is_infinite() {
            String::new()
        } else {
            name.to_string()
        };

        Ok(ReserveFactor {
            failure_name,
            minimal_reserve_factor: rf_value,
            failure_type: ftype,
        })
    }
}

fn trans_mat_eps_glo_to_loc(context: Option<&LayerContext>) -> Matrix {
    match context {
        Some(c) => mathtools::strain_transform_glo_to_loc(c.angle_deg.to_radians()),
        None => vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![0.0, 0.0, 1.0],
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::collections::HashMap;

    fn material() -> Material {
        let mut m = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.additional_values = HashMap::from([
            (EPS_X.to_string(), 0.015),
            (EPS_Y.to_string(), 0.005),
            (GAMMA_XY.to_string(), 0.02),
            (GLOBAL_LOCAL.to_string(), 0.0),
        ]);
        m
    }

    #[test]
    fn missing_additional_value_is_an_error() {
        let material = Material::new("m", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.001, 0.0, 0.0],
        };
        assert!(MaxStrain.reserve_factor(&material, None, &state).is_err());
    }

    #[test]
    fn undamaged_at_zero_strain() {
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = MaxStrain.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_the_allowable_strain_local() {
        let state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.015, 0.0, 0.0],
        };
        let rf = MaxStrain.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn global_flag_rotates_strain_through_layer_angle() {
        let mut mat = material();
        mat.additional_values
            .insert(GLOBAL_LOCAL.to_string(), 1.0);
        let context = LayerContext { angle_deg: 0.0, embedded: false };

        // At 0 degrees, global == local, so the result should match the local case.
        let local_state = StressStrainState {
            stress: [0.0, 0.0, 0.0],
            strain: [0.015, 0.0, 0.0],
        };
        let rf = MaxStrain
            .reserve_factor(&mat, Some(&context), &local_state)
            .unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }
}
