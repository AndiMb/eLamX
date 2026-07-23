//! Matrix solvers (Cholesky, LU, Gauss-elimination-based pivot exchange).
//! Reference: eLamX2/MathTools/src/de/elamx/mathtools/MatrixTools.java
//!
//! The Jacobi eigenvalue solver (`getEigenValues` in the Java original) is ported
//! alongside the Plate/Buckling module instead of here, since that is its only caller.

// These solvers read and write several matrix indices per loop body (e.g. `l[i][j]`
// alongside `l[j][...]`), so index-based loops stay closer to the underlying linear
// algebra than the iterator-chain rewrites clippy suggests.
#![allow(clippy::needless_range_loop)]

/// A dense row-major matrix, mirroring the Java `double[][]` used throughout the original code.
pub type Matrix = Vec<Vec<f64>>;

/// Strain transformation matrix from the global (laminate) to the local
/// (fibre-aligned) coordinate system, for a ply rotated `angle_rad` from the
/// global x-axis. Used both by the CLT layer stress calculation and by
/// strain-based failure criteria - in the Java original this 8-line formula
/// was duplicated in both `CLT_Layer` and `MaxStrain` rather than shared.
pub fn strain_transform_glo_to_loc(angle_rad: f64) -> Matrix {
    let c = angle_rad.cos();
    let c2 = c * c;
    let s = angle_rad.sin();
    let s2 = s * s;

    vec![
        vec![c2, s2, s * c],
        vec![s2, c2, -s * c],
        vec![-2.0 * c * s, 2.0 * c * s, c2 - s2],
    ]
}

/// Maximum-norm of a 3x3 matrix. Hardcoded to 3x3, matching the original.
pub fn get_maximum_norm(mat: &Matrix) -> f64 {
    let mut max = 0.0_f64;
    for row in mat.iter().take(3) {
        for &v in row.iter().take(3) {
            max = max.max(v.abs());
        }
    }
    max
}

/// Determinant. Only 3x3 matrices are supported, matching the original.
pub fn get_det(mat: &Matrix) -> f64 {
    match mat.len() {
        3 => get_det_3x3(mat),
        _ => panic!("get_det: only 3x3 matrices are supported"),
    }
}

fn get_det_3x3(mat: &Matrix) -> f64 {
    mat[0][0] * mat[1][1] * mat[2][2]
        + mat[0][1] * mat[1][2] * mat[2][0]
        + mat[0][2] * mat[1][0] * mat[2][1]
        - mat[0][0] * mat[1][2] * mat[2][1]
        - mat[0][1] * mat[1][0] * mat[2][2]
        - mat[0][2] * mat[1][1] * mat[2][0]
}

/// Inverse of a square positive-definite matrix. 3x3 uses Cramer's rule directly,
/// larger matrices use a Cholesky-based inversion.
pub fn get_inverse(mat: &Matrix) -> Matrix {
    match mat.len() {
        3 => get_inverse_3x3(mat),
        _ => get_inverse_cholesky(mat),
    }
}

fn get_inverse_3x3(mat: &Matrix) -> Matrix {
    let mut inv = vec![vec![0.0; 3]; 3];
    inv[0][0] = mat[1][1] * mat[2][2] - mat[1][2] * mat[2][1];
    inv[0][1] = mat[0][2] * mat[2][1] - mat[0][1] * mat[2][2];
    inv[0][2] = mat[0][1] * mat[1][2] - mat[0][2] * mat[1][1];
    inv[1][0] = mat[1][2] * mat[2][0] - mat[1][0] * mat[2][2];
    inv[1][1] = mat[0][0] * mat[2][2] - mat[0][2] * mat[2][0];
    inv[1][2] = mat[0][2] * mat[1][0] - mat[0][0] * mat[1][2];
    inv[2][0] = mat[1][0] * mat[2][1] - mat[1][1] * mat[2][0];
    inv[2][1] = mat[0][1] * mat[2][0] - mat[0][0] * mat[2][1];
    inv[2][2] = mat[0][0] * mat[1][1] - mat[0][1] * mat[1][0];

    let det_inv = 1.0 / get_det(mat);
    for row in inv.iter_mut() {
        for v in row.iter_mut() {
            *v *= det_inv;
        }
    }
    inv
}

fn get_inverse_cholesky(mat: &Matrix) -> Matrix {
    let m = mat.len();
    let mut l = vec![vec![0.0; m]; m];
    let mut x = vec![0.0; m];

    // Cholesky factorization mat = L * L^T, L stored below the main diagonal.
    for i in 0..m {
        let mut h = 0.0;
        for j in 0..i {
            h += l[i][j] * l[i][j];
        }
        l[i][i] = (mat[i][i] - h).sqrt(); // fails if mat is not positive definite
        for ii in (i + 1)..m {
            let mut h = 0.0;
            for j in 0..i {
                h += l[ii][j] * l[i][j];
            }
            l[ii][i] = (mat[ii][i] - h) / l[i][i];
        }
    }

    // Inverse of L, stored above (and on) the main diagonal, reusing L's storage.
    // Reads L's still-untouched lower/diagonal entries of not-yet-processed rows.
    for i in 0..m {
        x[i] = 1.0 / l[i][i];
        for j in (i + 1)..m {
            let mut h = 0.0;
            for ii in i..j {
                h += l[j][ii] * x[ii];
            }
            x[j] = -h / l[j][j];
        }
        l[i][i..m].copy_from_slice(&x[i..m]);
    }

    // Product inv(L) * inv(L)^T, exploiting symmetry.
    let mut k_inverse = vec![vec![0.0; m]; m];
    for i in 0..m {
        for j in 0..=i {
            k_inverse[i][j] = l[j][i];
        }
    }
    for i in 0..m {
        for j in i..m {
            let mut h = 0.0;
            // For j > i the ii == i term intentionally reads k_inverse[i][j] before it
            // is written (still 0.0 from initialization) - this mirrors the Java
            // original, which relies on the same fresh-array zero default.
            for ii in i..m {
                h += l[i][ii] * k_inverse[ii][j];
            }
            k_inverse[i][j] = h;
        }
    }
    for i in 0..m {
        for j in i..m {
            k_inverse[j][i] = k_inverse[i][j];
        }
    }

    k_inverse
}

/// Solves `A x = b` via Cholesky factorization. `A` must be symmetric positive definite.
pub fn solve_ab_cholesky(a: &Matrix, b: &[f64]) -> Vec<f64> {
    let nm = a.len();
    let mut l = vec![vec![0.0; nm]; nm];

    for i in 0..nm {
        let mut h = 0.0;
        for j in 0..i {
            h += l[i][j] * l[i][j];
        }
        l[i][i] = (a[i][i] - h).sqrt();
        for ii in (i + 1)..nm {
            let mut h = 0.0;
            for j in 0..i {
                h += l[ii][j] * l[i][j];
            }
            l[ii][i] = (a[ii][i] - h) / l[i][i];
        }
    }

    let mut x = b.to_vec();

    // Forward substitution: L y = b (stored in x).
    for k in 0..nm {
        for i in 0..k {
            x[k] -= x[i] * l[k][i];
        }
        x[k] /= l[k][k];
    }

    // Back substitution: L^T x = y.
    for k in (0..nm).rev() {
        for i in (k + 1)..nm {
            x[k] -= x[i] * l[i][k];
        }
        x[k] /= l[k][k];
    }

    x
}

/// Solves `A x = b` via LU factorization without pivoting.
pub fn solve_ab_lu(a_in: &Matrix, b: &[f64]) -> Vec<f64> {
    let n = a_in.len();
    let mut a = a_in.clone();
    let mut l = vec![vec![0.0; n]; n];
    let mut u = vec![vec![0.0; n]; n];

    for k in 0..n {
        let pivot = a[k][k];
        u[k][k] = pivot;
        l[k][k] = 1.0;
        for j in (k + 1)..n {
            u[k][j] = a[k][j];
        }
        for i in (k + 1)..n {
            l[i][k] = a[i][k] / pivot;
        }
        for i in (k + 1)..n {
            for j in (k + 1)..n {
                a[i][j] -= l[i][k] * u[k][j];
            }
        }
    }

    let mut y = vec![0.0; n];
    for i in 0..n {
        y[i] = b[i];
        for j in 0..i {
            y[i] -= l[i][j] * y[j];
        }
    }

    let mut x = vec![0.0; n];
    for i in (0..n).rev() {
        x[i] = y[i];
        for j in (i + 1)..n {
            x[i] -= u[i][j] * x[j];
        }
        x[i] /= u[i][i];
    }

    x
}

/// Solves `A x = b` via LU factorization, after swapping selected dependent/independent
/// variable pairs (Bronstein pivot exchange). Used by the CLT solver for mixed
/// load/strain boundary conditions. `exchange_flags[i]` swaps row/column `i`.
pub fn solve_ab_with_exchange(a: &Matrix, b: &[f64], exchange_flags: &[bool]) -> Vec<f64> {
    let mut t_a = a.clone();
    for (i, &flagged) in exchange_flags.iter().enumerate() {
        if flagged {
            t_a = exchange(&t_a, i, i);
        }
    }
    solve_ab_lu(&t_a, b)
}

/// Pivot exchange of dependent/independent variables (Bronstein, "Taschenbuch der
/// Mathematik"). Produces a generally non-symmetric matrix, hence `solve_ab_lu`
/// rather than Cholesky is used afterwards.
fn exchange(mat: &Matrix, i: usize, k: usize) -> Matrix {
    let m = mat.len();
    let n = mat[0].len();
    let mut new_mat = vec![vec![0.0; n]; m];

    new_mat[i][k] = 1.0 / mat[i][k];

    for mu in 0..m {
        if mu == i {
            continue;
        }
        new_mat[mu][k] = mat[mu][k] / mat[i][k];
    }
    for nu in 0..n {
        if nu == k {
            continue;
        }
        new_mat[i][nu] = -mat[i][nu] / mat[i][k];
    }
    for mu in 0..m {
        if mu == i {
            continue;
        }
        for nu in 0..n {
            if nu == k {
                continue;
            }
            new_mat[mu][nu] = mat[mu][nu] - mat[mu][k] * mat[i][nu] / mat[i][k];
        }
    }

    new_mat
}

/// Matrix-vector product `A b`.
pub fn mat_vec_mult(a: &Matrix, b: &[f64]) -> Vec<f64> {
    a.iter()
        .map(|row| row.iter().zip(b).map(|(v, bv)| v * bv).sum())
        .collect()
}

/// Matrix-matrix product `A B`.
pub fn mat_mult(a: &Matrix, b: &Matrix) -> Matrix {
    let rows = a.len();
    let cols = b[0].len();
    let inner = a[0].len();
    let mut rs = vec![vec![0.0; cols]; rows];
    for ii in 0..rows {
        for jj in 0..cols {
            for kk in 0..inner {
                rs[ii][jj] += a[ii][kk] * b[kk][jj];
            }
        }
    }
    rs
}

/// Transpose of a matrix.
pub fn mat_transp(a: &Matrix) -> Matrix {
    let rows = a[0].len();
    let cols = a.len();
    let mut rs = vec![vec![0.0; cols]; rows];
    for ii in 0..rows {
        for jj in 0..cols {
            rs[ii][jj] = a[jj][ii];
        }
    }
    rs
}

/// Multiplies every element of a vector by a scalar.
pub fn multiply(vector: &[f64], scalar: f64) -> Vec<f64> {
    vector.iter().map(|v| v * scalar).collect()
}

/// Elementwise addition of two vectors.
pub fn add(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b).map(|(x, y)| x + y).collect()
}

/// Row index of the rotation angle in the result of [`get_matrix_components_over_angle`].
pub const ANGLE_ROW: usize = 0;
/// Row index of the A11 component.
pub const A11_ROW: usize = 1;
/// Row index of the A12 component.
pub const A12_ROW: usize = 2;
/// Row index of the A22 component.
pub const A22_ROW: usize = 3;
/// Row index of the A66 component.
pub const A66_ROW: usize = 4;

/// Sweep of the in-plane A-matrix components (A11, A12, A22, A66) as the coordinate
/// system is rotated from 0 to 360 degrees in steps of `delta_angle`. `mat` must be
/// the 3x3 A-matrix. Row layout matches the `*_ROW` constants above.
pub fn get_matrix_components_over_angle(mat: &Matrix, delta_angle: f64) -> Matrix {
    let number = (360.0 / delta_angle) as usize;
    let mut distribution = vec![vec![0.0; number]; 5];
    let deg_to_rad = std::f64::consts::PI / 180.0;

    let a11 = mat[0][0];
    let a12 = mat[0][1];
    let a16 = mat[0][2];
    let a22 = mat[1][1];
    let a26 = mat[1][2];
    let a66 = mat[2][2];

    for i in 0..number {
        let angle = delta_angle * i as f64;
        let c = (angle * deg_to_rad).cos();
        let (c2, c3, c4) = (c * c, c * c * c, c * c * c * c);
        let s = (angle * deg_to_rad).sin();
        let (s2, s3, s4) = (s * s, s * s * s, s * s * s * s);

        distribution[ANGLE_ROW][i] = angle;
        distribution[A11_ROW][i] = c4 * a11 + 2.0 * c2 * s2 * a12 - 4.0 * c3 * s * a16 + s4 * a22
            - 4.0 * s3 * c * a26
            + 4.0 * c2 * s2 * a66;
        distribution[A12_ROW][i] = c2 * s2 * a11
            + (c4 + s4) * a12
            + 2.0 * (s * c3 - c * s3) * a16
            + c2 * s2 * a22
            + 2.0 * (c * s3 - s * c3) * a26
            - 4.0 * c2 * s2 * a66;
        distribution[A22_ROW][i] = s4 * a11 + 2.0 * c2 * s2 * a12 + 4.0 * s3 * c * a16 + c4 * a22
            + 4.0 * c3 * s * a26
            + 4.0 * c2 * s2 * a66;
        distribution[A66_ROW][i] = c2 * s2 * a11 - 2.0 * c2 * s2 * a12
            + 2.0 * (s * c3 - c * s3) * a16
            + c2 * s2 * a22
            - 2.0 * (c3 * s - s3 * c) * a26
            + (c2 - s2) * (c2 - s2) * a66;
    }

    distribution
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn assert_matrix_eq(a: &Matrix, b: &Matrix, tol: f64) {
        assert_eq!(a.len(), b.len());
        for (row_a, row_b) in a.iter().zip(b) {
            assert_eq!(row_a.len(), row_b.len());
            for (&va, &vb) in row_a.iter().zip(row_b) {
                assert_relative_eq!(va, vb, epsilon = tol);
            }
        }
    }

    fn identity(n: usize) -> Matrix {
        let mut m = vec![vec![0.0; n]; n];
        for (i, row) in m.iter_mut().enumerate() {
            row[i] = 1.0;
        }
        m
    }

    #[test]
    fn det_3x3_known_matrix() {
        let mat = vec![
            vec![2.0, 0.0, 0.0],
            vec![0.0, 3.0, 0.0],
            vec![0.0, 0.0, 4.0],
        ];
        assert_relative_eq!(get_det(&mat), 24.0, epsilon = 1e-12);
    }

    #[test]
    fn inverse_3x3_round_trip() {
        let mat = vec![
            vec![4.0, 1.0, 0.5],
            vec![1.0, 3.0, 0.2],
            vec![0.5, 0.2, 2.0],
        ];
        let inv = get_inverse(&mat);
        assert_matrix_eq(&mat_mult(&mat, &inv), &identity(3), 1e-9);
    }

    #[test]
    fn inverse_cholesky_round_trip() {
        // Symmetric positive definite by construction (diagonally dominant).
        let mat = vec![
            vec![10.0, 1.0, 2.0, 0.0],
            vec![1.0, 8.0, 0.5, 1.0],
            vec![2.0, 0.5, 12.0, 3.0],
            vec![0.0, 1.0, 3.0, 9.0],
        ];
        let inv = get_inverse(&mat);
        assert_matrix_eq(&mat_mult(&mat, &inv), &identity(4), 1e-8);
    }

    #[test]
    fn solve_ab_cholesky_solves_known_system() {
        let a = vec![
            vec![10.0, 1.0, 2.0],
            vec![1.0, 8.0, 0.5],
            vec![2.0, 0.5, 12.0],
        ];
        let b = vec![13.0, 9.5, 14.5];
        let x = solve_ab_cholesky(&a, &b);
        let reconstructed = mat_vec_mult(&a, &x);
        for (r, bv) in reconstructed.iter().zip(&b) {
            assert_relative_eq!(r, bv, epsilon = 1e-9);
        }
    }

    #[test]
    fn solve_ab_lu_solves_known_system() {
        let a = vec![
            vec![4.0, 3.0, 0.0],
            vec![3.0, 4.0, -1.0],
            vec![0.0, -1.0, 4.0],
        ];
        let b = vec![7.0, 6.0, 3.0];
        let x = solve_ab_lu(&a, &b);
        let reconstructed = mat_vec_mult(&a, &x);
        for (r, bv) in reconstructed.iter().zip(&b) {
            assert_relative_eq!(r, bv, epsilon = 1e-9);
        }
    }

    #[test]
    fn solve_ab_with_exchange_swaps_variable_and_load() {
        // A must be invertible; SPD keeps the example easy to reason about.
        let a = vec![
            vec![10.0, 1.0, 2.0],
            vec![1.0, 8.0, 0.5],
            vec![2.0, 0.5, 12.0],
        ];
        let x0 = vec![1.0, 2.0, 3.0];
        let b0 = mat_vec_mult(&a, &x0);

        // Prescribe x0[1] instead of b0[1]: swap position 1 between the "load" and
        // "known displacement" roles, matching how CLT mixes force/strain boundary
        // conditions per degree of freedom.
        let mut c = b0.clone();
        c[1] = x0[1];
        let exchange_flags = vec![false, true, false];

        let y = solve_ab_with_exchange(&a, &c, &exchange_flags);

        assert_relative_eq!(y[0], x0[0], epsilon = 1e-9);
        assert_relative_eq!(y[1], b0[1], epsilon = 1e-9);
        assert_relative_eq!(y[2], x0[2], epsilon = 1e-9);
    }

    #[test]
    fn matrix_components_over_angle_zero_degrees_matches_input() {
        let mat = vec![
            vec![100.0, 20.0, 5.0],
            vec![20.0, 80.0, 3.0],
            vec![5.0, 3.0, 30.0],
        ];
        let sweep = get_matrix_components_over_angle(&mat, 90.0);
        assert_relative_eq!(sweep[ANGLE_ROW][0], 0.0, epsilon = 1e-12);
        assert_relative_eq!(sweep[A11_ROW][0], mat[0][0], epsilon = 1e-9);
        assert_relative_eq!(sweep[A12_ROW][0], mat[0][1], epsilon = 1e-9);
        assert_relative_eq!(sweep[A22_ROW][0], mat[1][1], epsilon = 1e-9);
        assert_relative_eq!(sweep[A66_ROW][0], mat[2][2], epsilon = 1e-9);
    }

    #[test]
    fn strain_transform_glo_to_loc_is_identity_at_zero_angle() {
        assert_matrix_eq(&strain_transform_glo_to_loc(0.0), &identity(3), 1e-12);
    }

    #[test]
    fn mat_vec_and_mat_mult_are_consistent() {
        let a = vec![vec![1.0, 2.0], vec![3.0, 4.0]];
        let b = vec![5.0, 6.0];
        assert_eq!(mat_vec_mult(&a, &b), vec![17.0, 39.0]);

        let identity_2 = identity(2);
        assert_matrix_eq(&mat_mult(&a, &identity_2), &a, 1e-12);
        assert_matrix_eq(&mat_transp(&mat_transp(&a)), &a, 1e-12);
    }

    #[test]
    fn vector_helpers() {
        assert_eq!(multiply(&[1.0, 2.0, 3.0], 2.0), vec![2.0, 4.0, 6.0]);
        assert_eq!(add(&[1.0, 2.0], &[3.0, 4.0]), vec![4.0, 6.0]);
    }
}
