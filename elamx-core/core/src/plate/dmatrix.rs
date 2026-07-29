//! Which bending stiffness matrix a plate analysis runs on.
//!
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/dmatrix/
//!
//! In the Java original these are three NetBeans services discovered through
//! Lookup, because they were meant to be extensible by separately deployed
//! modules. This app bundles a fixed set, so an enum is the honest shape - and
//! it lets the choice ride along in the request JSON as a stable string.

use serde::{Deserialize, Serialize};

use crate::clt::CltLaminate;
use crate::mathtools::{self, Matrix};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DMatrixKind {
    /// The laminate's D matrix as-is. Assumes a symmetric laminate, since it
    /// ignores the membrane-bending coupling that B introduces.
    Standard,
    /// D with D16 and D26 zeroed - the "special orthotropic" idealisation,
    /// which removes bend-twist coupling.
    SpecialOrthotropic,
    /// D-tilde = D - B A^-1 B. Condenses the membrane-bending coupling into an
    /// effective bending stiffness, so it does NOT need a symmetric laminate.
    DTilde,
}

impl DMatrixKind {
    pub const ALL: [DMatrixKind; 3] = [
        DMatrixKind::Standard,
        DMatrixKind::SpecialOrthotropic,
        DMatrixKind::DTilde,
    ];

    /// Whether the idealisation is only valid for a symmetric laminate.
    pub fn needs_symmetric_laminate(&self) -> bool {
        match self {
            DMatrixKind::Standard | DMatrixKind::SpecialOrthotropic => true,
            DMatrixKind::DTilde => false,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            DMatrixKind::Standard => "standard",
            DMatrixKind::SpecialOrthotropic => "special_orthotropic",
            DMatrixKind::DTilde => "d_tilde",
        }
    }

    /// The 3x3 bending stiffness this idealisation presents to the plate.
    pub fn matrix(&self, laminate: &CltLaminate) -> [[f64; 3]; 3] {
        let d = laminate.d_matrix();
        let mut out = [[0.0f64; 3]; 3];
        match self {
            DMatrixKind::Standard => {
                for i in 0..3 {
                    for j in 0..3 {
                        out[i][j] = d[i][j];
                    }
                }
            }
            DMatrixKind::SpecialOrthotropic => {
                for i in 0..3 {
                    for j in 0..3 {
                        out[i][j] = d[i][j];
                    }
                }
                out[0][2] = 0.0;
                out[1][2] = 0.0;
                out[2][0] = 0.0;
                out[2][1] = 0.0;
            }
            DMatrixKind::DTilde => {
                let a_inv: Matrix = mathtools::get_inverse(laminate.a_matrix());
                let b = laminate.b_matrix();
                let help = mathtools::mat_mult(&mathtools::mat_mult(b, &a_inv), b);
                for i in 0..3 {
                    for j in 0..3 {
                        out[i][j] = d[i][j] - help[i][j];
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    fn laminate(angles: &[f64], symmetric: bool) -> CltLaminate {
        let material = Material::new("m", "m", 140_000.0, 10_000.0, 0.3, 5_000.0, 1.6e-9);
        let mut materials = HashMap::new();
        materials.insert("m".to_string(), material);

        let lam = Laminate {
            id: "l".into(),
            name: "l".into(),
            layers: angles
                .iter()
                .enumerate()
                .map(|(i, &angle)| Layer::new(format!("y{i}"), format!("y{i}"), "m", angle, 0.25))
                .collect(),
            symmetric,
            with_middle_layer: false,
            invert_z: false,
            offset: 0.0,
        };
        CltLaminate::new(&lam, &materials).unwrap()
    }

    #[test]
    fn standard_returns_the_d_matrix_unchanged() {
        let l = laminate(&[0.0, 45.0, 90.0], false);
        let got = DMatrixKind::Standard.matrix(&l);
        let d = l.d_matrix();
        for i in 0..3 {
            for j in 0..3 {
                assert_eq!(got[i][j], d[i][j]);
            }
        }
    }

    #[test]
    fn special_orthotropic_zeroes_only_the_coupling_terms() {
        let l = laminate(&[0.0, 45.0, 90.0], false);
        let got = DMatrixKind::SpecialOrthotropic.matrix(&l);
        let d = l.d_matrix();
        assert_eq!(got[0][2], 0.0);
        assert_eq!(got[1][2], 0.0);
        assert_eq!(got[2][0], 0.0);
        assert_eq!(got[2][1], 0.0);
        for (i, j) in [(0, 0), (0, 1), (1, 0), (1, 1), (2, 2)] {
            assert_eq!(got[i][j], d[i][j]);
        }
    }

    #[test]
    fn d_tilde_equals_d_for_a_symmetric_laminate() {
        // B is zero for a symmetric layup, so D - B A^-1 B collapses to D.
        let l = laminate(&[0.0, 90.0], true);
        let tilde = DMatrixKind::DTilde.matrix(&l);
        let d = l.d_matrix();
        for i in 0..3 {
            for j in 0..3 {
                assert!(
                    (tilde[i][j] - d[i][j]).abs() < 1e-6 * d[i][j].abs().max(1.0),
                    "[{i}][{j}]: {} vs {}",
                    tilde[i][j],
                    d[i][j]
                );
            }
        }
    }

    #[test]
    fn d_tilde_is_softer_than_d_for_an_unsymmetric_laminate() {
        // B A^-1 B is positive semi-definite, so condensing it out can only
        // reduce the effective bending stiffness.
        let l = laminate(&[0.0, 90.0], false);
        let tilde = DMatrixKind::DTilde.matrix(&l);
        let d = l.d_matrix();
        assert!(tilde[0][0] < d[0][0], "{} vs {}", tilde[0][0], d[0][0]);
        assert!(tilde[1][1] < d[1][1]);
    }

    #[test]
    fn only_d_tilde_tolerates_an_unsymmetric_laminate() {
        assert!(DMatrixKind::Standard.needs_symmetric_laminate());
        assert!(DMatrixKind::SpecialOrthotropic.needs_symmetric_laminate());
        assert!(!DMatrixKind::DTilde.needs_symmetric_laminate());
    }
}
