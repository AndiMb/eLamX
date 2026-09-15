//! The four criteria LS-DYNA's composite material models use.
//! Reference: eLamX2/AdditionalLSDynaFailureCriteria/src/de/elamx/laminate/addFailureCriteriaLSDYNA/{LSDYNAChangChang,LSDYNATsaiWu,LSDYNADaimlerCamanho,LSDYNADaimlerPinho}.java
//!
//! MAT54's Chang-Chang and MAT55's Tsai-Wu share a fibre part and differ only
//! in how they treat the matrix; the two Daimler criteria are physically based
//! fracture-plane models, and the Pinho one searches that plane degree by
//! degree. All four are transcribed rather than improved: what these are for is
//! agreeing with a deck, and the places where they depart from the papers they
//! cite are marked where they occur.

use super::{additional_value, Criterion, CriterionError, FailureType, LayerContext, ReserveFactor};
use crate::model::{Material, StressStrainState};

/// MAT54/MAT55's shear weighting in fibre tension: 1 is the full Chang-Chang
/// interaction, 0 the pure maximum-stress check. The property sheet starts at
/// 0, which is LS-DYNA's own default.
pub const CHANG_CHANG_BETA: &str = "ls_dyna_chang_chang.beta";
pub const TSAI_WU_BETA: &str = "ls_dyna_tsai_wu.beta";
/// Camanho's two critical energy release rates. Only their RATIO enters, as
/// the weighting between the linear and the quadratic part of matrix tension.
pub const CAMANHO_G1C: &str = "ls_dyna_daimler_camanho.g1c";
pub const CAMANHO_G2C: &str = "ls_dyna_daimler_camanho.g2c";
/// The fracture-plane angle under pure transverse compression, in DEGREES. The
/// original rounds it UP to a whole degree before using it, so 52.1 is 53.
pub const PINHO_ALPHA_0: &str = "ls_dyna_daimler_pinho.alpha_0";

/// Everything blank: no stress at all, which both MAT54 and MAT55 report as no
/// failure rather than as a division.
fn unstressed(s: [f64; 3]) -> bool {
    s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0
}

/// The fibre part MAT54 and MAT55 have in common.
///
/// Returns the reserve factor to REPORT and the one to COMPARE the matrix
/// against - which are not the same number when the fibre part comes out
/// undefined: the original then reports infinity but keeps comparing against
/// 99999999, so a matrix mode below that still takes over.
fn fibre(material: &Material, s: [f64; 3], beta: f64) -> (ReserveFactor, f64) {
    let reported = if s[0] >= 0.0 {
        let q = s[0] * s[0] / (material.r_par_ten * material.r_par_ten);
        let l = beta * s[2] / material.r_shear;
        ReserveFactor {
            failure_name: "FiberFailureTension".to_string(),
            minimal_reserve_factor: ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q),
            failure_type: FailureType::FiberFailure,
        }
    } else {
        ReserveFactor {
            failure_name: "FiberFailureCompression".to_string(),
            minimal_reserve_factor: material.r_par_com / s[0].abs(),
            failure_type: FailureType::FiberFailure,
        }
    };

    if reported.minimal_reserve_factor.is_nan() {
        // 0/0: no fibre stress and no shear, so this mode says nothing.
        (ReserveFactor::undamaged(), 99999999.0)
    } else {
        let compare = reported.minimal_reserve_factor;
        (reported, compare)
    }
}

/// MAT54.
pub struct LsDynaChangChang;

impl Criterion for LsDynaChangChang {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let beta = additional_value(material, CHANG_CHANG_BETA)?;
        let s = state.stress;
        if unstressed(s) {
            return Ok(ReserveFactor::undamaged());
        }

        let (mut governing, fibre_compare) = fibre(material, s, beta);

        let matrix = if s[1] >= 0.0 {
            let m = s[1] * s[1] / (material.r_nor_ten * material.r_nor_ten)
                + s[2] * s[2] / (material.r_shear * material.r_shear);
            ReserveFactor {
                failure_name: "MatrixFailureTension".to_string(),
                minimal_reserve_factor: (1.0 / m).sqrt(),
                failure_type: FailureType::MatrixFailure,
            }
        } else {
            // Transverse compression on the IN-PLANE shear strength, where
            // Hashin's mode C uses a transverse-transverse one. MAT54 has only
            // the one strength, so that is what it uses.
            let q = 0.25 * s[1] * s[1] / (material.r_shear * material.r_shear)
                + s[2] * s[2] / (material.r_shear * material.r_shear);
            let l = (0.25 * material.r_nor_com / (material.r_shear * material.r_shear)
                - 1.0 / material.r_nor_com)
                * s[1];
            let under_the_root = l * l + 4.0 * q;
            super::non_negative(under_the_root, "LS-DYNA Chang-Chang, Matrixdruckversagen")?;
            ReserveFactor {
                failure_name: "MatrixFailureCompression".to_string(),
                minimal_reserve_factor: (under_the_root.sqrt() - l) / (2.0 * q),
                failure_type: FailureType::MatrixFailure,
            }
        };

        if matrix.minimal_reserve_factor < fibre_compare {
            governing = matrix;
        }
        Ok(governing)
    }
}

/// MAT55, which is MAT54's fibre part with one quadratic for the matrix
/// instead of two modes - it does not distinguish transverse tension from
/// transverse compression, only weights them differently.
pub struct LsDynaTsaiWu;

impl Criterion for LsDynaTsaiWu {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let beta = additional_value(material, TSAI_WU_BETA)?;
        let s = state.stress;
        if unstressed(s) {
            return Ok(ReserveFactor::undamaged());
        }

        let (mut governing, fibre_compare) = fibre(material, s, beta);

        let q = s[1] * s[1] / (material.r_nor_ten * material.r_nor_com)
            + s[2] * s[2] / (material.r_shear * material.r_shear);
        let l = (material.r_nor_com - material.r_nor_ten) * s[1]
            / (material.r_nor_com * material.r_nor_ten);
        let matrix = ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q);

        if matrix < fibre_compare {
            governing = ReserveFactor {
                failure_name: "MatrixFailure".to_string(),
                minimal_reserve_factor: matrix,
                failure_type: FailureType::MatrixFailure,
            };
        }
        Ok(governing)
    }
}

/// The fracture-plane strengths and friction parameters both Daimler criteria
/// build on, from the angle the plane takes under pure transverse compression.
struct FracturePlane {
    r_t: f64,
    r_l: f64,
    eta_t: f64,
    eta_l: f64,
}

/// Daimler's Camanho, with the plane angle fixed at 53 degrees.
pub struct LsDynaDaimlerCamanho;

impl Criterion for LsDynaDaimlerCamanho {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let g1c = additional_value(material, CAMANHO_G1C)?;
        let g2c = additional_value(material, CAMANHO_G2C)?;
        let s = state.stress;
        let strain = state.strain;
        if unstressed(s) {
            return Ok(ReserveFactor::undamaged());
        }

        let alpha0 = 53.0_f64.to_radians();
        let r_l = material.r_shear;
        let r_t = material.r_nor_com * alpha0.cos() * (alpha0.sin() + alpha0.cos() / (2.0 * alpha0).tan());
        let eta_t = -1.0 / (2.0 * alpha0).tan();
        let eta_l = -(r_l * (2.0 * alpha0).cos()) / (material.r_nor_com * alpha0.cos() * alpha0.cos());
        let plane = FracturePlane { r_t, r_l, eta_t, eta_l };

        // The kink band: the angle a fibre-compression failure rotates into,
        // and the stresses in it.
        let phi_c = {
            let numerator =
                1.0 - (1.0 - 4.0 * (r_l / material.r_par_com + eta_l) * (r_l / material.r_par_com)).sqrt();
            let denominator = 2.0 * (r_l / material.r_par_com + eta_l);
            (numerator / denominator).atan()
        };
        let sig_2m = phi_c.sin() * phi_c.sin() * s[0] + phi_c.cos() * phi_c.cos() * s[1]
            - 2.0 * phi_c.sin() * phi_c.cos() * s[2].abs();
        let tau_12m = (s[1] - s[0]) * phi_c.sin() * phi_c.cos()
            + s[2].abs() * (phi_c.cos() * phi_c.cos() - phi_c.sin() * phi_c.sin());

        let mut governing = if s[0] > 0.0 {
            // The one place in this crate where a criterion reads the STRAIN
            // rather than the stress: Camanho's fibre tension is a strain
            // criterion, written here as the strength over the strain the
            // material's own modulus would need.
            ReserveFactor {
                failure_name: "FiberFailureTension".to_string(),
                minimal_reserve_factor: material.r_par_ten / material.e_par.abs() / strain[0],
                failure_type: FailureType::FiberFailure,
            }
        } else {
            let denominator = tau_12m.abs() + plane.eta_l * sig_2m;
            ReserveFactor {
                failure_name: "FiberFailureCompression".to_string(),
                // 9999, not infinity: the original's own "no failure in this
                // mode", and it is a number the matrix part compares against.
                minimal_reserve_factor: if denominator > 0.0 { plane.r_l / denominator } else { 9999.0 },
                failure_type: FailureType::FiberFailure,
            }
        };

        let matrix = if s[1] >= 0.0 {
            // Only the ratio of the two energy release rates enters.
            let g = g1c / g2c;
            let q = g * (s[1] / material.r_nor_ten) * (s[1] / material.r_nor_ten)
                + (s[2] / plane.r_l) * (s[2] / plane.r_l);
            let l = (1.0 - g) * s[1] / material.r_nor_ten;
            ReserveFactor {
                failure_name: "MatrixFailureTension".to_string(),
                minimal_reserve_factor: ((l * l + 4.0 * q).sqrt() - l) / (2.0 * q),
                failure_type: FailureType::MatrixFailure,
            }
        } else {
            // Two planes are tried - the ply's own and the 53 degree one - and
            // the weaker wins.
            let denominator = s[2].abs() + plane.eta_l * s[1];
            let mut rf = if denominator > 0.0 { plane.r_l / denominator } else { 9999.0 };

            let theta = (-s[2].abs() / (s[1] * alpha0.sin())).atan();
            let mut tau_t_eff =
                -s[1] * alpha0.cos() * (alpha0.sin() - plane.eta_t * alpha0.cos() * theta.cos());
            if tau_t_eff <= 0.0 {
                tau_t_eff = 0.0;
            }
            // The absolute value wraps the whole sum here, not just the shear
            // stress as in Pinho's paper. Transcribed as it stands.
            let mut tau_l_eff =
                alpha0.cos() * (s[2] + plane.eta_l * s[1] * alpha0.cos() * theta.sin()).abs();
            if tau_l_eff <= 0.0 {
                tau_l_eff = 0.0;
            }
            let q = tau_t_eff / plane.r_t * tau_t_eff / plane.r_t
                + tau_l_eff / plane.r_l * tau_l_eff / plane.r_l;
            let on_the_plane = 1.0 / q.sqrt();
            if on_the_plane <= rf {
                rf = on_the_plane;
            }
            ReserveFactor {
                failure_name: "MatrixFailureCompression".to_string(),
                minimal_reserve_factor: rf,
                failure_type: FailureType::MatrixFailure,
            }
        };

        if matrix.minimal_reserve_factor < governing.minimal_reserve_factor {
            governing = matrix;
        }
        Ok(governing)
    }
}

/// Daimler's Pinho, which searches the fracture plane one whole degree at a
/// time over a half turn - the original's own resolution, and the reason this
/// criterion costs about a hundred times what the others do.
pub struct LsDynaDaimlerPinho;

impl Criterion for LsDynaDaimlerPinho {
    fn reserve_factor(
        &self,
        material: &Material,
        _context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError> {
        let alpha_0 = additional_value(material, PINHO_ALPHA_0)?;
        let s = state.stress;
        if unstressed(s) {
            return Ok(ReserveFactor::undamaged());
        }

        // Rounded UP to a whole degree before anything is computed with it.
        let alpha0 = alpha_0.ceil().to_radians();
        let r_l = material.r_shear;
        let r_t = material.r_nor_com * alpha0.cos() * (alpha0.sin() + alpha0.cos() / (2.0 * alpha0).tan());
        let eta_t = -1.0 / (2.0 * alpha0).tan();
        // Pinho ties the two friction parameters together, where Camanho reads
        // the longitudinal one off the compressive strength directly.
        let eta_l = r_l * eta_t / r_t;

        // The misalignment angle, and the rotation the load adds to it.
        let theta_c = {
            let numerator =
                1.0 - (1.0 - 4.0 * (r_l / material.r_par_com + eta_l) * (r_l / material.r_par_com)).sqrt();
            let denominator = 2.0 * (r_l / material.r_par_com + eta_l);
            (numerator / denominator).atan()
        };
        let theta_i = theta_c - theta_c * material.r_par_com / material.g;
        let gamma_i = (theta_i * material.g + s[2].abs()) / (material.g + s[0] - s[1]) - theta_i;
        // The sign comes from the shear stress, and at exactly zero shear the
        // original takes the unsigned angle rather than letting signum's +-0
        // decide - its own comment says the signed version disagrees with LaRC
        // there.
        let theta = if s[2] != 0.0 {
            s[2].signum() * (theta_i + gamma_i)
        } else {
            theta_i + gamma_i
        };

        let sig_1m = (s[0] + s[1]) / 2.0
            + (s[0] + s[1]) / 2.0 * (2.0 * theta).cos()
            + s[2] * (2.0 * theta).sin();
        let sig_2m = s[0] + s[1] - sig_1m;
        let tau_12m = -(s[0] - s[1]) / 2.0 * (2.0 * theta).sin() + s[2] * (2.0 * theta).cos();

        let mut rf_f = 9999.0;
        let mut governing = if s[0] >= 0.0 {
            rf_f = material.r_par_ten / s[0];
            ReserveFactor {
                failure_name: "FiberFailureTension".to_string(),
                minimal_reserve_factor: rf_f,
                failure_type: FailureType::FiberFailure,
            }
        } else {
            for alpha in 0..180 {
                let a = (alpha as f64).to_radians();
                let sig_n = sig_2m / 2.0 + sig_2m / 2.0 * (2.0 * a).cos();
                // A plus and a sine where the transverse shear on a plane is
                // -sig/2 * sin(2a). Transcribed; it is what the kink-band
                // branch of the original computes.
                let tau_t = sig_2m / 2.0 + sig_2m / 2.0 * (2.0 * a).sin();
                let tau_l = tau_12m * a.cos();
                let candidate = if sig_n > 0.0 {
                    let f = (sig_n / material.r_nor_ten) * (sig_n / material.r_nor_ten)
                        + (tau_t / r_t) * (tau_t / r_t)
                        + (tau_l / r_l) * (tau_l / r_l);
                    (1.0 / f).sqrt()
                } else {
                    let f = (tau_t / (r_t - eta_t * sig_n)) * (tau_t / (r_t - eta_t * sig_n))
                        + (tau_l / (r_l - eta_l * sig_n)) * (tau_l / (r_l - eta_l * sig_n));
                    (1.0 / f).sqrt()
                };
                if candidate < rf_f {
                    rf_f = candidate;
                }
            }
            ReserveFactor {
                failure_name: "FiberFailureCompression".to_string(),
                minimal_reserve_factor: rf_f,
                failure_type: FailureType::FiberFailure,
            }
        };

        // The matrix plane, searched the same way. Note that `tension` and
        // `compression` keep their value from a PREVIOUS angle when the
        // current one does not enter their branch - that is the original's
        // loop, and it is what decides which mode is reported.
        let mut rf_m = 9999.0;
        let mut tension = 9999.0;
        let mut compression = 9999.0;
        for alpha in 0..180 {
            let a = (alpha as f64).to_radians();
            let sig_n = s[1] / 2.0 + s[1] / 2.0 * (2.0 * a).cos();
            let tau_t = -s[1] / 2.0 * (2.0 * a).sin();
            let tau_l = s[2] * a.cos();
            if sig_n >= 0.0 {
                let f = (sig_n / material.r_nor_ten) * (sig_n / material.r_nor_ten)
                    + (tau_t / r_t) * (tau_t / r_t)
                    + (tau_l / r_l) * (tau_l / r_l);
                tension = 1.0 / f.sqrt();
            } else {
                let f = (tau_t / (r_t - eta_t * sig_n)) * (tau_t / (r_t - eta_t * sig_n))
                    + (tau_l / (r_l - eta_l * sig_n)) * (tau_l / (r_l - eta_l * sig_n));
                compression = 1.0 / f.sqrt();
            }
            if tension < rf_m && tension < rf_f {
                rf_m = tension;
                governing = ReserveFactor {
                    failure_name: "MatrixFailureTension".to_string(),
                    minimal_reserve_factor: rf_m,
                    failure_type: FailureType::MatrixFailure,
                };
            }
            if compression < rf_m && compression < rf_f {
                rf_m = compression;
                governing = ReserveFactor {
                    failure_name: "MatrixFailureCompression".to_string(),
                    minimal_reserve_factor: rf_m,
                    failure_type: FailureType::MatrixFailure,
                };
            }
        }
        Ok(governing)
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
        m.additional_values = HashMap::from([
            (CHANG_CHANG_BETA.to_string(), 0.0),
            (TSAI_WU_BETA.to_string(), 0.0),
            (CAMANHO_G1C.to_string(), 0.28),
            (CAMANHO_G2C.to_string(), 0.79),
            (PINHO_ALPHA_0.to_string(), 53.0),
        ]);
        m
    }

    fn at(stress: [f64; 3]) -> StressStrainState {
        StressStrainState {
            stress,
            strain: [0.0, 0.0, 0.0],
        }
    }

    /// With beta at zero, MAT54 and MAT55 agree with the plain stress ratios on
    /// the fibre allowables - which is the whole content of their fibre part
    /// there, and holds for both because they share it.
    #[test]
    fn the_fibre_allowables_come_out_at_one() {
        for criterion in [
            &LsDynaChangChang as &dyn Criterion,
            &LsDynaTsaiWu as &dyn Criterion,
        ] {
            for stress in [[2000.0, 0.0, 0.0], [-1200.0, 0.0, 0.0]] {
                let rf = criterion.reserve_factor(&material(), None, &at(stress)).unwrap();
                assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
                assert_eq!(rf.failure_type, FailureType::FiberFailure, "bei {stress:?}");
            }
        }
    }

    /// MAT54's two matrix modes at their own allowables. Transverse tension is
    /// the ordinary quadratic; transverse compression is built so that
    /// -R_nor_com comes out at one whatever the shear strength is.
    #[test]
    fn chang_changs_matrix_allowables_come_out_at_one() {
        for stress in [[0.0, 50.0, 0.0], [0.0, -150.0, 0.0], [0.0, 0.0, 70.0]] {
            let rf = LsDynaChangChang
                .reserve_factor(&material(), None, &at(stress))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
        }
    }

    /// MAT55's single matrix quadratic, which has to pass through BOTH
    /// transverse allowables - that is what the linear term is for.
    #[test]
    fn the_matrix_quadratic_passes_through_both_transverse_allowables() {
        for stress in [[0.0, 50.0, 0.0], [0.0, -150.0, 0.0], [0.0, 0.0, 70.0]] {
            let rf = LsDynaTsaiWu
                .reserve_factor(&material(), None, &at(stress))
                .unwrap();
            assert_relative_eq!(rf.minimal_reserve_factor, 1.0, epsilon = 1e-12);
            assert_eq!(rf.failure_name, "MatrixFailure", "bei {stress:?}");
        }
    }

    /// Beta is the one parameter MAT54 and MAT55 take, and it only ever makes
    /// fibre tension worse: it adds the shear stress to that mode.
    #[test]
    fn beta_only_costs_reserve_in_fibre_tension() {
        let mut with_beta = material();
        with_beta.additional_values.insert(CHANG_CHANG_BETA.to_string(), 1.0);
        let state = at([1900.0, 0.0, 20.0]);
        let without = LsDynaChangChang
            .reserve_factor(&material(), None, &state)
            .unwrap();
        let with = LsDynaChangChang.reserve_factor(&with_beta, None, &state).unwrap();
        assert_relative_eq!(without.minimal_reserve_factor, 2000.0 / 1900.0, epsilon = 1e-12);
        assert!(with.minimal_reserve_factor < without.minimal_reserve_factor);
    }

    /// Pure transverse tension, where every fracture-plane model has to agree
    /// with the plain ratio: the governing plane is the ply's own, the shear on
    /// it is zero, and only the transverse strength is left.
    #[test]
    fn pinho_finds_the_obvious_plane_under_transverse_tension() {
        let rf = LsDynaDaimlerPinho
            .reserve_factor(&material(), None, &at([0.0, 25.0, 0.0]))
            .unwrap();
        assert_relative_eq!(rf.minimal_reserve_factor, 2.0, epsilon = 1e-9);
        assert_eq!(rf.failure_name, "MatrixFailureTension");
    }

    /// Camanho's fibre tension is a STRAIN check, so it has to scale with the
    /// strain and ignore the stress that comes with it.
    #[test]
    fn camanhos_fibre_tension_reads_the_strain() {
        let m = material();
        let state = StressStrainState {
            stress: [1000.0, 0.0, 0.0],
            strain: [0.005, 0.0, 0.0],
        };
        let rf = LsDynaDaimlerCamanho.reserve_factor(&m, None, &state).unwrap();
        assert_relative_eq!(
            rf.minimal_reserve_factor,
            2000.0 / 140000.0 / 0.005,
            epsilon = 1e-12
        );
        assert_eq!(rf.failure_name, "FiberFailureTension");
    }

    /// Only the RATIO of Camanho's two energy release rates enters, so scaling
    /// both by the same factor may not move the answer.
    #[test]
    fn only_the_ratio_of_the_release_rates_matters() {
        let mut scaled = material();
        scaled.additional_values.insert(CAMANHO_G1C.to_string(), 2.8);
        scaled.additional_values.insert(CAMANHO_G2C.to_string(), 7.9);
        let state = StressStrainState {
            stress: [0.0, 30.0, 15.0],
            strain: [0.0, 0.0, 0.0],
        };
        // Not bit for bit: 0.28/0.79 and 2.8/7.9 differ in the last place, and
        // the ratio is the only thing that reaches the answer.
        assert_relative_eq!(
            LsDynaDaimlerCamanho
                .reserve_factor(&material(), None, &state)
                .unwrap()
                .minimal_reserve_factor,
            LsDynaDaimlerCamanho
                .reserve_factor(&scaled, None, &state)
                .unwrap()
                .minimal_reserve_factor,
            epsilon = 1e-12
        );
    }

    /// The rounding of the plane angle, which is easy to miss and changes every
    /// number the criterion produces: 52.1 degrees is used as 53.
    #[test]
    fn pinho_rounds_the_plane_angle_up_to_a_whole_degree() {
        let state = at([0.0, -40.0, 20.0]);
        let mut rounded_up = material();
        rounded_up.additional_values.insert(PINHO_ALPHA_0.to_string(), 52.1);
        assert_eq!(
            LsDynaDaimlerPinho
                .reserve_factor(&rounded_up, None, &state)
                .unwrap()
                .minimal_reserve_factor,
            LsDynaDaimlerPinho
                .reserve_factor(&material(), None, &state)
                .unwrap()
                .minimal_reserve_factor
        );
    }

    #[test]
    fn undamaged_at_zero_stress() {
        for criterion in [
            &LsDynaChangChang as &dyn Criterion,
            &LsDynaTsaiWu as &dyn Criterion,
            &LsDynaDaimlerCamanho as &dyn Criterion,
            &LsDynaDaimlerPinho as &dyn Criterion,
        ] {
            let rf = criterion.reserve_factor(&material(), None, &at([0.0; 3])).unwrap();
            assert_eq!(rf.failure_type, FailureType::Undamaged);
        }
    }
}
