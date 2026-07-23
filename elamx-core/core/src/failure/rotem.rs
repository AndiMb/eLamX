//! Rotem failure criterion.
//! Reference: eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/Rotem.java

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

pub struct Rotem;

impl Criterion for Rotem {
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

        // Matches the Java original exactly, including its reuse of
        // r_par_ten (not r_par_com) for the fiber-compression branch.
        let (rf_f, name_f) = if s[0] > 0.0 {
            (material.r_par_ten / s[0], "FibreFailureTension")
        } else {
            (-material.r_par_ten / s[0], "FibreFailureCompression")
        };
        let mut rf_value = rf_f;
        let mut name = name_f.to_string();
        let mut ftype = FailureType::FiberFailure;

        let (rf_m, name_m) = if s[1] >= 0.0 {
            let term = rotem_reduction_term(material.e_nor, material.e_par, s[0], material.r_nor_ten);
            let rf_m = (1.0 - term)
                / (s[1] * s[1] / (material.r_nor_ten * material.r_nor_ten)
                    + s[2] * s[2] / (material.r_shear * material.r_shear));
            (rf_m.sqrt(), "MatrixFailureTension")
        } else {
            let term = rotem_reduction_term(material.e_nor, material.e_par, s[0], material.r_nor_com);
            let rf_m = (1.0 - term)
                / (s[1] * s[1] / (material.r_nor_com * material.r_nor_com)
                    + s[2] * s[2] / (material.r_shear * material.r_shear));
            (rf_m.sqrt(), "MatrixFailureCompression")
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

/// The Java original's chained `Enor^2 * s0^4 / (Epar^4 * r_nor^2)` term,
/// computed via the exact same left-to-right multiply/divide sequence rather
/// than an algebraically-simplified form, to stay bit-identical.
fn rotem_reduction_term(e_nor: f64, e_par: f64, s0: f64, r_nor: f64) -> f64 {
    let mut term = e_nor * e_nor;
    term *= s0;
    term /= e_par;
    term *= s0;
    term /= e_par;
    term *= s0;
    term /= e_par;
    term *= s0;
    term /= e_par;
    term /= r_nor;
    term /= r_nor;
    term
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
        let rf = Rotem.reserve_factor(&material(), None, &state).unwrap();
        assert_eq!(rf.failure_type, FailureType::Undamaged);
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_tension_allowable() {
        // With s1 = s2 = 0 the matrix term's denominator is 0, so RF_M is
        // either +infinity or NaN (both fail to beat a finite RF_F), leaving
        // the fiber result as the answer.
        let state = StressStrainState {
            stress: [2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Rotem.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FibreFailureTension");
    }

    #[test]
    fn reserve_factor_is_one_at_pure_fiber_compression_allowable() {
        // Reuses r_par_ten (2000), not r_par_com, matching the original.
        let state = StressStrainState {
            stress: [-2000.0, 0.0, 0.0],
            strain: [0.0, 0.0, 0.0],
        };
        let rf = Rotem.reserve_factor(&material(), None, &state).unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "FibreFailureCompression");
    }
}
