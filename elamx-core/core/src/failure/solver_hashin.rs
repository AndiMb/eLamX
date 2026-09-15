//! The Hashin that Autodesk Helius and ANSYS share.
//! Reference: eLamX2/AdditionalAutodeskFailureCriteria/.../AutodeskHashin.java and
//! eLamX2/AdditionalAnsysFailurecriteria/.../AnsysHashin.java
//!
//! Four modes - fibre tension, fibre compression, matrix tension, matrix
//! compression - and the two solvers differ in exactly two numbers: how much
//! of the shear stress reaches fibre tension, and which shear strength the
//! matrix-compression mode is built on. Helius lets the user set both; ANSYS
//! fixes the first at one and takes the second from the in-plane shear
//! strength, having no other. So this takes them as arguments rather than
//! having the same forty lines twice.

use super::{CriterionError, FailureType, ReserveFactor};
use crate::model::Material;

pub fn reserve_factor(
    material: &Material,
    s: [f64; 3],
    alpha: f64,
    r23: f64,
    context: &str,
) -> Result<ReserveFactor, CriterionError> {
    if s[0] == 0.0 && s[1] == 0.0 && s[2] == 0.0 {
        return Ok(ReserveFactor::undamaged());
    }

    // Fibre first, matrix after, and the matrix only takes over when it is
    // strictly the smaller of the two - which is the original's way of saying
    // "the governing mode", written as an if rather than a min so that the
    // name travels with the number. A tie goes to the fibre.
    let mut governing = if s[0] >= 0.0 {
        let f = s[0] * s[0] / (material.r_par_ten * material.r_par_ten)
            + alpha * (s[2] * s[2] / (material.r_shear * material.r_shear));
        ReserveFactor {
            failure_name: "FiberFailureTension".to_string(),
            minimal_reserve_factor: (1.0 / f).sqrt(),
            failure_type: FailureType::FiberFailure,
        }
    } else {
        ReserveFactor {
            failure_name: "FiberFailureCompression".to_string(),
            minimal_reserve_factor: material.r_par_com / s[0].abs(),
            failure_type: FailureType::FiberFailure,
        }
    };

    let matrix = if s[1] >= 0.0 {
        let m = s[1] * s[1] / (material.r_nor_ten * material.r_nor_ten)
            + s[2] * s[2] / (material.r_shear * material.r_shear);
        ReserveFactor {
            failure_name: "MatrixFailureTension".to_string(),
            minimal_reserve_factor: (1.0 / m).sqrt(),
            failure_type: FailureType::MatrixFailure,
        }
    } else {
        let q = 0.25 * s[1] * s[1] / (r23 * r23) + s[2] * s[2] / (material.r_shear * material.r_shear);
        let l = (0.25 * material.r_nor_com / (r23 * r23) - 1.0 / material.r_nor_com) * s[1];
        // The original raises here rather than returning a number; so does
        // this, for the same reason - a negative discriminant means the
        // strengths cannot describe a mode, not that the ply is fine.
        let under_the_root = l * l + 4.0 * q;
        super::non_negative(under_the_root, &format!("{context}, Matrixdruckversagen"))?;
        ReserveFactor {
            failure_name: "MatrixFailureCompression".to_string(),
            minimal_reserve_factor: (under_the_root.sqrt() - l) / (2.0 * q),
            failure_type: FailureType::MatrixFailure,
        }
    };

    if matrix.minimal_reserve_factor < governing.minimal_reserve_factor {
        governing = matrix;
    }
    Ok(governing)
}
