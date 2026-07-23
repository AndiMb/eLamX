//! Hashin failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Hashin.java

use super::{non_negative, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Hashin;

impl Criterion for Hashin {
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

        // Exactly one of the two fiber branches below always fires (s[0] is
        // either >= 0 or < 0), so these are always assigned before use -
        // matching the Java original's reliance on that same invariant.
        let mut rf_value = 0.0;
        let mut name = "";
        let mut ftype = FailureType::Undamaged;
        let mut resfac_fiber = 0.0;

        if s[0] >= 0.0 {
            let f_s = s[0] * s[0] / (material.r_par_ten * material.r_par_ten)
                + s[2] * s[2] / (material.r_shear * material.r_shear);
            resfac_fiber = (1.0 / f_s).sqrt();
            rf_value = resfac_fiber;
            name = "FiberFailureTension";
            ftype = FailureType::FiberFailure;
        }
        if s[0] < 0.0 {
            let f_s = s[0].abs() / material.r_par_com;
            resfac_fiber = 1.0 / f_s;
            rf_value = resfac_fiber;
            name = "FiberFailureCompression";
            ftype = FailureType::FiberFailure;
        }

        if s[1] >= 0.0 {
            let m_s = s[1] * s[1] / (material.r_nor_ten * material.r_nor_ten)
                + s[2] * s[2] / (material.r_shear * material.r_shear);
            let resfac_matrix = (1.0 / m_s).sqrt();
            if resfac_matrix < resfac_fiber {
                rf_value = resfac_matrix;
                name = "MatrixFailureTension";
                ftype = FailureType::MatrixFailure;
            }
        }
        if s[1] < 0.0 {
            let q = 0.25 * s[1] * s[1] / (material.r_shear * material.r_shear)
                + s[2] * s[2] / (material.r_shear * material.r_shear);
            let l = (0.25 * material.r_nor_com / (material.r_shear * material.r_shear)
                - 1.0 / material.r_nor_com)
                * s[1];

            let d_temp = l * l + 4.0 * q;
            non_negative(d_temp, "Hashin: matrix compression term")?;
            let resfac_matrix = (d_temp.sqrt() - l) / (2.0 * q);

            if resfac_matrix < resfac_fiber {
                rf_value = resfac_matrix;
                name = "MatrixFailureCompression";
                ftype = FailureType::MatrixFailure;
            }
        }

        Ok(ReserveFactor {
            failure_name: name.to_string(),
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
        let rf = Hashin.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Hashin.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::FiberFailure);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_compression_allowable() {
        let state = StressStrainState {
            stress: [-1200.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Hashin.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
    }

    #[test]
    fn matrix_tension_governs_when_smaller_than_fiber_reserve() {
        let state = StressStrainState {
            stress: [10.0, 50.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Hashin.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_type, FailureType::MatrixFailure);
    }
}
