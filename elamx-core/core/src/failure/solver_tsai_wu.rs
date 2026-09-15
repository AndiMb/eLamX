//! The Tsai-Wu that Abaqus and Autodesk Helius share, down to the last sign.
//! Reference: eLamX2/AdditionalAbaqusFailureCriteria/.../AbaqusTsaiWu.java and
//! eLamX2/AdditionalAutodeskFailureCriteria/.../AutodeskTsaiWu.java
//!
//! The two Java classes are the same forty lines twice, differing only in which
//! material parameters they read - each solver's criterion carries its own
//! `f12star` and `sigbiax`, because a user calibrating for one solver has no
//! reason to have calibrated for the other. That difference is real and is kept
//! (the parameters travel separately through the file); the arithmetic is not
//! duplicated.

use super::{Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

/// A solver's Tsai-Wu, told where to find its two parameters.
pub struct SolverTsaiWu {
    pub f12_star_key: &'static str,
    pub sig_biax_key: &'static str,
}

impl Criterion for SolverTsaiWu {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let f12_star = super::additional_value(material, self.f12_star_key)?;
        let sig_biax = super::additional_value(material, self.sig_biax_key)?;
        let s = state.stress;

        let f1 = 1.0 / material.r_par_ten - 1.0 / material.r_par_com;
        let f2 = 1.0 / material.r_nor_ten - 1.0 / material.r_nor_com;
        let f11 = 1.0 / (material.r_par_ten * material.r_par_com);
        let f22 = 1.0 / (material.r_nor_ten * material.r_nor_com);
        let f66 = 1.0 / (material.r_shear * material.r_shear);

        // With an equibiaxial strength measured, the interaction term comes
        // from it rather than being a free parameter.
        //
        // Transcribed from the original, including the two signs that keep it
        // from doing what it is for: a term calibrated at sigma_1 = sigma_2 =
        // sig_biax has to make the criterion come out at exactly 1 there, and
        // the only term that does is
        //
        //     [1 - (f1 + f2) * s - (f11 + f22) * s^2] / (2 * s^2)
        //
        // whereas this adds the two compressive reciprocals instead of
        // subtracting them, and adds the quadratic part instead. So the reserve
        // factor at the calibration point is not 1. Changing it here would put
        // this crate's answer at odds with eLamX's and with the solver deck
        // written from the same numbers, which is the one thing these criteria
        // exist not to do. See the note in the roadmap.
        let f12 = if sig_biax > 0.0 {
            let reciprocals = 1.0 / material.r_par_ten
                + 1.0 / material.r_par_com
                + 1.0 / material.r_nor_ten
                + 1.0 / material.r_nor_com;
            (1.0 - reciprocals * sig_biax + (f11 + f22) * sig_biax * sig_biax)
                / (2.0 * sig_biax * sig_biax)
        } else {
            f12_star * (f11 * f22).sqrt()
        };

        let q = f11 * s[0] * s[0] + 2.0 * f12 * s[0] * s[1] + f22 * s[1] * s[1] + f66 * s[2] * s[2];
        let l = f1 * s[0] + f2 * s[1];

        if q == 0.0 && l == 0.0 {
            return Ok(ReserveFactor::undamaged());
        }

        // Same quadratic as `tsai_wu`, and the same unconditional fibre-failure
        // label on a criterion that cannot tell the two modes apart.
        Ok(ReserveFactor {
            failure_name: "Failure".to_string(),
            minimal_reserve_factor: ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q),
            failure_type: FailureType::FiberFailure,
        })
    }
}
