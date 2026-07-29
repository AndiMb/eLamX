//! Generalised symmetric eigenvalue solver for the plate Ritz problems.
//!
//! Reference: eLamX2/MathTools/src/de/elamx/mathtools/MatrixTools.java, getEigenValues
//!
//! Solves `Kg v = mu K v` for a symmetric positive-definite K by reducing it
//! to a standard problem: Cholesky K = L Lt, then A = L^-1 Kg L^-t, whose
//! eigenvalues are found with a cyclic-by-largest-element Jacobi rotation
//! sweep. The buckling eigenvalue reported per mode is `-1/mu`.
//!
//! Why a hand-rolled solver rather than a linear-algebra crate: this mirrors
//! the Java implementation term for term, so results stay comparable to
//! eLamX2's down to the last digit, and it keeps the wasm bundle free of a
//! LAPACK-shaped dependency for a single 100x100 dense problem.

/// A generalised eigenvalue problem that turned out not to be solvable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EigenError {
    /// The Cholesky factorisation hit a non-positive pivot, i.e. the stiffness
    /// matrix is not positive definite. In the plate modules this is the
    /// symptom of a degenerate configuration (zero-thickness laminate, a plate
    /// edge of length zero, an all-free edge pair leaving rigid-body motion).
    NotPositiveDefinite { index: usize },
}

impl std::fmt::Display for EigenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EigenError::NotPositiveDefinite { index } => write!(
                f,
                "stiffness matrix is not positive definite (leading minor {index} is non-positive)"
            ),
        }
    }
}

impl std::error::Error for EigenError {}

#[derive(Debug, Clone, PartialEq)]
pub struct EigenSolution {
    /// Eigenvalues, ordered by ascending magnitude (the Java code picks the
    /// largest |mu| first, and mu = -1/lambda inverts that ordering).
    pub eigenvalues: Vec<f64>,
    /// One eigenvector per eigenvalue, each of length n, unit-normalised.
    pub eigenvectors: Vec<Vec<f64>>,
}

const JACOBI_EPS: f64 = 1.0e-10;
const JACOBI_MAX_SWEEPS: usize = 100_000;

/// Solves `kg v = mu k v` and returns `-1/mu` per mode with its eigenvector.
///
/// `k` and `kg` are consumed: the reduction overwrites both, exactly as the
/// Java version does in place.
pub fn generalized_symmetric_eigen(
    kg: &[Vec<f64>],
    k: &[Vec<f64>],
    count: usize,
) -> Result<EigenSolution, EigenError> {
    let nm = k.len();
    let mut a = vec![vec![0.0f64; nm]; nm]; // working copy of K, later L^-1 Kg L^-t
    let mut v = vec![vec![0.0f64; nm]; nm]; // working copy of Kg, later eigenvectors
    for i in 0..nm {
        a[i][..nm].copy_from_slice(&k[i][..nm]);
        v[i][..nm].copy_from_slice(&kg[i][..nm]);
    }

    // --- Cholesky factorisation of K, lower triangle into `l` ---------------
    let mut l = vec![vec![0.0f64; nm]; nm];
    for i in 0..nm {
        let mut h = 0.0;
        for j in 0..i {
            h += l[i][j] * l[i][j];
        }
        let pivot = a[i][i] - h;
        if !(pivot > 0.0) || !pivot.is_finite() {
            return Err(EigenError::NotPositiveDefinite { index: i });
        }
        l[i][i] = pivot.sqrt();
        for ii in (i + 1)..nm {
            let mut h = 0.0;
            for j in 0..i {
                h += l[ii][j] * l[i][j];
            }
            l[ii][i] = (a[ii][i] - h) / l[i][i];
        }
    }

    // --- Invert L, storing the result in l's UPPER triangle -----------------
    // (the Java code reuses the same array this way, and the back-substitution
    // at the end reads it as L^-t, so the layout is kept.)
    let mut x = vec![0.0f64; nm];
    for i in 0..nm {
        x[i] = 1.0 / l[i][i];
        for j in (i + 1)..nm {
            let mut h = 0.0;
            for ii in i..j {
                h += l[j][ii] * x[ii];
            }
            x[j] = -h / l[j][j];
        }
        for j in i..nm {
            l[i][j] = x[j];
        }
    }

    // --- A = L^-1 Kg L^-t, exploiting symmetry ------------------------------
    for i in 0..nm {
        for j in 0..=i {
            let mut h = 0.0;
            for ii in 0..=i {
                h += l[ii][i] * v[ii][j];
            }
            a[i][j] = h;
            a[j][i] = h;
        }
    }
    for i in 0..nm {
        for j in 0..=i {
            let mut h = 0.0;
            for ii in 0..=j {
                h += a[ii][i] * l[ii][j];
            }
            a[i][j] = h;
        }
    }
    // Only the lower triangle of `a` is meaningful from here on.

    // --- Jacobi rotations; `v` accumulates the eigenvectors -----------------
    for row in v.iter_mut() {
        row.fill(0.0);
    }
    let mut off_diagonal_sq = 0.0;
    for i in 0..nm {
        v[i][i] = 1.0;
    }
    for i in 1..nm {
        for j in 0..i {
            off_diagonal_sq += a[i][j] * a[i][j];
        }
    }

    let mut diag_prev = vec![0.0f64; nm];
    let mut z = vec![0.0f64; nm];
    let mut converged = false;
    let mut sweeps = 0;
    while off_diagonal_sq > JACOBI_EPS && !converged && sweeps < JACOBI_MAX_SWEEPS {
        sweeps += 1;
        for i in 0..nm {
            diag_prev[i] = a[i][i];
        }

        // Annihilate the currently largest off-diagonal entry.
        let (mut p, mut q, mut h) = (0usize, 0usize, 0.0f64);
        for i in 1..nm {
            for j in 0..i {
                if h < a[i][j].abs() {
                    h = a[i][j].abs();
                    p = i;
                    q = j;
                }
            }
        }
        if a[p][q] == 0.0 {
            break;
        }

        let delta = (a[q][q] - a[p][p]) / 2.0 / a[p][q];
        let rho = delta.abs() + (1.0 + delta * delta).sqrt();
        let t = if delta >= 0.0 { 1.0 / rho } else { -1.0 / rho };
        let c = 1.0 / (1.0 + t * t).sqrt();
        let s = c * t;
        let tau = s / (1.0 + c);
        off_diagonal_sq -= a[p][q] * a[p][q];

        let apq = a[p][q];
        a[p][p] -= t * apq;
        a[q][q] += t * apq;
        a[p][q] = 0.0;

        for i in 0..q {
            z[i] = a[p][i];
            a[p][i] -= s * (a[q][i] + tau * a[p][i]);
        }
        for i in (q + 1)..p {
            z[i] = a[p][i];
            a[p][i] -= s * (a[i][q] + tau * a[p][i]);
        }
        for i in (p + 1)..nm {
            z[i] = a[i][p];
            a[i][p] -= s * (a[i][q] + tau * a[i][p]);
        }
        for i in 0..q {
            a[q][i] += tau * (z[i] + a[p][i]);
        }
        for i in (q + 1)..p {
            a[i][q] += tau * (z[i] + a[p][i]);
        }
        for i in (p + 1)..nm {
            a[i][q] += tau * (z[i] + a[i][p]);
        }

        for i in 0..nm {
            z[i] = v[i][p];
            v[i][p] -= s * (v[i][q] + tau * v[i][p]);
        }
        for i in 0..nm {
            v[i][q] += tau * (z[i] + v[i][p]);
        }

        converged = (0..nm).all(|i| (diag_prev[i] - a[i][i]).abs() <= JACOBI_EPS);
    }

    // --- Extract the `count` largest |mu| and back-transform ----------------
    let count = count.min(nm);
    let mut eigenvalues = Vec::with_capacity(count);
    let mut eigenvectors = Vec::with_capacity(count);
    for _ in 0..count {
        let mut h = 0.0f64;
        let mut p = 0;
        for j in 0..nm {
            if a[j][j].abs() > h.abs() {
                h = a[j][j];
                p = j;
            }
        }
        eigenvalues.push(-1.0 / h);
        a[p][p] = 0.0; // consumed, so the next round picks the next largest

        // y = column p of the accumulated rotations, then vec = L^-t y.
        let mut vec: Vec<f64> = (0..nm).map(|j| v[j][p]).collect();
        for ii in 0..nm {
            let mut h = 0.0;
            for j in ii..nm {
                h += l[ii][j] * vec[j];
            }
            vec[ii] = h;
        }
        let norm = vec.iter().map(|x| x * x).sum::<f64>().sqrt();
        if norm > 0.0 {
            for value in vec.iter_mut() {
                *value /= norm;
            }
        }
        eigenvectors.push(vec);
    }

    Ok(EigenSolution {
        eigenvalues,
        eigenvectors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(n: usize) -> Vec<Vec<f64>> {
        let mut m = vec![vec![0.0; n]; n];
        for i in 0..n {
            m[i][i] = 1.0;
        }
        m
    }

    #[test]
    fn diagonal_problem_has_known_eigenvalues() {
        // Kg = diag(-1, -2, -4), K = I  =>  mu = -1,-2,-4  =>  lambda = 1, 0.5, 0.25.
        // Ordered by descending |mu|, so ascending lambda.
        let mut kg = identity(3);
        kg[0][0] = -1.0;
        kg[1][1] = -2.0;
        kg[2][2] = -4.0;
        let sol = generalized_symmetric_eigen(&kg, &identity(3), 3).unwrap();
        let expected = [0.25, 0.5, 1.0];
        for (got, want) in sol.eigenvalues.iter().zip(expected) {
            assert!((got - want).abs() < 1e-9, "{got} vs {want}");
        }
    }

    #[test]
    fn scaling_the_stiffness_scales_the_eigenvalues() {
        let mut kg = identity(4);
        for i in 0..4 {
            kg[i][i] = -((i + 1) as f64);
        }
        let k1 = identity(4);
        let mut k2 = identity(4);
        for i in 0..4 {
            k2[i][i] = 3.0;
        }
        let a = generalized_symmetric_eigen(&kg, &k1, 4).unwrap();
        let b = generalized_symmetric_eigen(&kg, &k2, 4).unwrap();
        for (x, y) in a.eigenvalues.iter().zip(b.eigenvalues.iter()) {
            assert!((y / x - 3.0).abs() < 1e-9, "{y} / {x}");
        }
    }

    #[test]
    fn eigenvectors_satisfy_the_generalized_problem() {
        // Non-diagonal, symmetric, positive definite K.
        let k = vec![
            vec![4.0, 1.0, 0.0],
            vec![1.0, 3.0, 1.0],
            vec![0.0, 1.0, 2.0],
        ];
        let kg = vec![
            vec![-2.0, 0.5, 0.0],
            vec![0.5, -1.0, 0.25],
            vec![0.0, 0.25, -1.5],
        ];
        let sol = generalized_symmetric_eigen(&kg, &k, 3).unwrap();
        for (idx, lambda) in sol.eigenvalues.iter().enumerate() {
            let v = &sol.eigenvectors[idx];
            // Kg v = mu K v with mu = -1/lambda.
            let mu = -1.0 / lambda;
            for i in 0..3 {
                let lhs: f64 = (0..3).map(|j| kg[i][j] * v[j]).sum();
                let rhs: f64 = mu * (0..3).map(|j| k[i][j] * v[j]).sum::<f64>();
                // The Jacobi loop stops once the summed squared off-diagonal
                // drops below JACOBI_EPS, which leaves a residual of about its
                // square root - so ~1e-5 relative, not machine precision.
                let scale = lhs.abs().max(rhs.abs()).max(1e-12);
                assert!((lhs - rhs).abs() / scale < 1e-5, "row {i}: {lhs} vs {rhs}");
            }
        }
    }

    #[test]
    fn non_positive_definite_stiffness_is_reported_not_panicked() {
        let k = vec![vec![0.0, 0.0], vec![0.0, 1.0]];
        let kg = identity(2);
        assert_eq!(
            generalized_symmetric_eigen(&kg, &k, 2),
            Err(EigenError::NotPositiveDefinite { index: 0 })
        );
    }
}
