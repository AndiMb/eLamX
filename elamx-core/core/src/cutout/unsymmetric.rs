//! The complex potentials for a hole in an UNSYMMETRIC laminate.
//! Reference: eLamX2/.../cutout/UnsymHoleQuantities.java and UnsymPotentials.java
//!
//! Ukadgaonker & Rao again, *A general solution for stress resultants and
//! moments around holes in unsymmetric laminates*. Where the symmetric problem
//! splits cleanly into a force half and a moment half, here the B matrix ties
//! them together and there is one problem with twice the unknowns: an
//! eighth-degree characteristic equation instead of two quartics, four
//! potentials instead of two, and six coupled resultants at every point.
//!
//! The shape of the solution is the same all the same. A first-stage potential
//! carries the far-field load, a second-stage one cancels the traction the
//! first leaves on the hole edge, and the answer is their difference.

// The papers index their matrices by component; an iterator over rows would
// hide which index an expression means.
#![allow(clippy::needless_range_loop)]

use crate::mathtools::{complex, roots, Complex, Matrix};

use super::geometry::CutoutGeometry;
use super::symmetric::CutoutError;

/// Everything the unsymmetric solution needs from the laminate.
///
/// `c`..`h` are the six rows that turn a potential into the six resultants -
/// `c`, `d`, `e` for `n_x`, `n_y`, `n_xy` and `f`, `g`, `h` for the moments.
#[derive(Debug, Clone)]
pub struct UnsymQuantities {
    pub s: [Complex; 4],
    pub a: [Complex; 4],
    pub b: [Complex; 4],
    pub p: [Complex; 4],
    pub q: [Complex; 4],
    pub c: [Complex; 4],
    pub d: [Complex; 4],
    pub e: [Complex; 4],
    pub f: [Complex; 4],
    pub g: [Complex; 4],
    pub h: [Complex; 4],
}

/// The ordering eLamX sorts its four characteristic roots into.
///
/// `Complex.compareTo` orders by DESCENDING magnitude of the real part, then of
/// the imaginary part - so the root closest to the imaginary axis ends up last,
/// which is what the Java comment asks for ("damit letztes s moeglichst keinen
/// Realteil besitzt"). It is not a mathematical requirement; it is a
/// conditioning choice, and the linear systems below are assembled in that
/// order, so it has to be reproduced exactly.
fn java_order(a: &Complex, b: &Complex) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let by_re = b.re.abs().partial_cmp(&a.re.abs()).unwrap_or(Ordering::Equal);
    if by_re != Ordering::Equal {
        return by_re;
    }
    b.im.abs().partial_cmp(&a.im.abs()).unwrap_or(Ordering::Equal)
}

/// The characteristic roots and the coefficient vectors built on them.
pub fn quantities(
    a_matrix: &Matrix,
    b_matrix: &Matrix,
    d_matrix: &Matrix,
    abd: &Matrix,
) -> Result<UnsymQuantities, CutoutError> {
    let (a, b, d) = (a_matrix, b_matrix, d_matrix);

    // (A.3)
    let r = [
        a[2][2] * b[0][0] - a[0][2] * b[0][2],
        2.0 * a[2][2] * b[0][2] + 2.0 * a[1][2] * b[0][0]
            - a[0][2] * b[0][1]
            - 2.0 * a[0][2] * b[2][2]
            - a[0][1] * b[0][2],
        a[1][1] * b[0][0] + 5.0 * a[1][2] * b[0][2]
            - 3.0 * a[0][2] * b[1][2]
            - a[0][1] * b[0][1]
            - 2.0 * a[0][1] * b[2][2],
        -2.0 * a[2][2] * b[1][2] + a[1][2] * b[0][1] + 2.0 * a[1][2] * b[2][2]
            + 3.0 * a[1][1] * b[0][2]
            - a[0][2] * b[1][1]
            - 3.0 * a[0][1] * b[1][2],
        -a[1][2] * b[1][2] + a[1][1] * b[0][1] + 2.0 * a[1][1] * b[2][2]
            - a[0][1] * b[1][1]
            - a[2][2] * b[1][1],
        a[1][1] * b[1][2] - a[1][2] * b[1][1],
    ];

    let s_coef = [
        a[0][0] * b[0][2] - a[0][2] * b[0][0],
        a[0][0] * b[0][1] + 2.0 * a[0][0] * b[2][2]
            - a[0][2] * b[0][2]
            - a[0][1] * b[0][0]
            - a[2][2] * b[0][0],
        3.0 * a[0][0] * b[1][2] + a[0][2] * b[0][1] + 2.0 * a[0][2] * b[2][2]
            - 2.0 * a[2][2] * b[0][2]
            - 3.0 * a[0][1] * b[0][2]
            - a[1][2] * b[0][0],
        a[0][0] * b[1][1] + 5.0 * a[0][2] * b[1][2]
            - a[0][1] * b[0][1]
            - 2.0 * a[0][1] * b[2][2]
            - 3.0 * a[1][2] * b[0][2],
        2.0 * a[0][2] * b[1][1] + 2.0 * a[2][2] * b[1][2]
            - a[0][1] * b[1][2]
            - a[1][2] * b[0][1]
            - 2.0 * a[1][2] * b[2][2],
        a[2][2] * b[1][1] - a[1][2] * b[1][2],
    ];

    let t = [
        a[0][0] * a[2][2] - a[0][2] * a[0][2],
        2.0 * a[0][0] * a[1][2] - 2.0 * a[0][1] * a[0][2],
        2.0 * a[0][2] * a[1][2] + a[0][0] * a[1][1]
            - a[0][1] * a[0][1]
            - 2.0 * a[0][1] * a[2][2],
        2.0 * a[0][2] * a[1][1] - 2.0 * a[0][1] * a[1][2],
        a[1][1] * a[2][2] - a[1][2] * a[1][2],
    ];

    // (A.2) - the eighth-degree characteristic polynomial, ascending.
    let bb = |i: usize, j: usize| b[i][j];
    let q_poly = [
        bb(0, 0) * r[0] + bb(0, 2) * s_coef[0] - d[0][0] * t[0],
        bb(0, 0) * r[1] + 3.0 * bb(0, 2) * r[0] + bb(0, 2) * s_coef[1]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[0]
            - d[0][0] * t[1]
            - 4.0 * d[0][2] * t[0],
        bb(0, 0) * r[2]
            + 3.0 * bb(0, 2) * r[1]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * r[0]
            + bb(0, 2) * s_coef[2]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[1]
            + 3.0 * bb(1, 2) * s_coef[0]
            - d[0][0] * t[2]
            - 4.0 * d[0][2] * t[1]
            - (2.0 * d[0][1] + 4.0 * d[2][2]) * t[0],
        bb(0, 0) * r[3]
            + 3.0 * bb(0, 2) * r[2]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * r[1]
            + bb(1, 2) * r[0]
            + bb(0, 2) * s_coef[3]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[2]
            + 3.0 * bb(1, 2) * s_coef[1]
            + bb(1, 1) * s_coef[0]
            - d[0][0] * t[3]
            - 4.0 * d[0][2] * t[2]
            - (2.0 * d[0][1] + 4.0 * d[2][2]) * t[1]
            - 4.0 * d[1][2] * t[0],
        bb(0, 0) * r[4]
            + 3.0 * bb(0, 2) * r[3]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * r[2]
            + bb(1, 2) * r[1]
            + bb(0, 2) * s_coef[4]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[3]
            + 3.0 * bb(1, 2) * s_coef[2]
            + bb(1, 1) * s_coef[1]
            - d[0][0] * t[4]
            - 4.0 * d[0][2] * t[3]
            - (2.0 * d[0][1] + 4.0 * d[2][2]) * t[2]
            - 4.0 * d[1][2] * t[1]
            - d[1][1] * t[0],
        bb(0, 0) * r[5]
            + 3.0 * bb(0, 2) * r[4]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * r[3]
            + bb(1, 2) * r[2]
            + bb(0, 2) * s_coef[5]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[4]
            + 3.0 * bb(1, 2) * s_coef[3]
            + bb(1, 1) * s_coef[2]
            - 4.0 * d[0][2] * t[4]
            - (2.0 * d[0][1] + 4.0 * d[2][2]) * t[3]
            - 4.0 * d[1][2] * t[2]
            - d[1][1] * t[1],
        3.0 * bb(0, 2) * r[5]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * r[4]
            + bb(1, 2) * r[3]
            + (bb(0, 1) + 2.0 * bb(2, 2)) * s_coef[5]
            + 3.0 * bb(1, 2) * s_coef[4]
            + bb(1, 1) * s_coef[3]
            - (2.0 * d[0][1] + 4.0 * d[2][2]) * t[4]
            - 4.0 * d[1][2] * t[3]
            - d[1][1] * t[2],
        (bb(0, 1) + 2.0 * bb(2, 2)) * r[5] + bb(1, 2) * r[4] + 3.0 * bb(1, 2) * s_coef[5]
            + bb(1, 1) * s_coef[4]
            - 4.0 * d[1][2] * t[4]
            - d[1][1] * t[3],
        bb(1, 2) * r[5] + bb(1, 1) * s_coef[5] - d[1][1] * t[4],
    ];

    // (A.1). `roots` scales the polynomial itself - the original does the same
    // here by hand, dividing by its smallest coefficient, which is where the
    // trick came from.
    let all = roots(&q_poly).map_err(CutoutError::Roots)?;
    if all.len() != 8 {
        return Err(CutoutError::RealCharacteristicRoot);
    }
    let mut s: [Complex; 4] = [all[0], all[2], all[4], all[6]];
    if s.iter().any(|z| z.im <= 0.0) {
        return Err(CutoutError::RealCharacteristicRoot);
    }
    s.sort_by(java_order);

    // Lekhnitskii's formulation needs four DISTINCT roots. Two that coincide
    // make the potentials linearly dependent, and the 4x4 and 7x7 systems below
    // inherit that: the answer does not degrade, it runs away. A quasi-isotropic
    // stack is the everyday way to get there, since an isotropic plate has the
    // double root `i` - so this is a case to name, not an edge.
    for i in 0..4 {
        for j in (i + 1)..4 {
            let separation = (s[i] - s[j]).abs();
            if separation < 1.0e-3 * (1.0 + s[i].abs()) {
                return Err(CutoutError::DegenerateRoots { separation });
            }
        }
    }

    // (7)
    let mut qa = [Complex::ZERO; 4];
    let mut qb = [Complex::ZERO; 4];
    for i in 0..4 {
        qa[i] = Complex::new(1.0 - s[i].im, s[i].re);
        qb[i] = Complex::new(1.0 + s[i].im, -s[i].re);
    }

    // (A.4)
    let mut p = [Complex::ZERO; 4];
    let mut q = [Complex::ZERO; 4];
    for i in 0..4 {
        let mut top_r = Complex::ZERO;
        let mut top_s = Complex::ZERO;
        let mut bottom = Complex::ZERO;
        for j in 0..6 {
            let power = s[i].powi(j as i32);
            top_r = top_r + power * r[j];
            top_s = top_s + power * s_coef[j];
            if j < 5 {
                bottom = bottom + power * t[j];
            }
        }
        p[i] = top_r / bottom;
        q[i] = top_s / bottom;
    }

    // (17) - the ABD matrix turns each potential into its six resultants.
    let mut c = [Complex::ZERO; 4];
    let mut d_row = [Complex::ZERO; 4];
    let mut e = [Complex::ZERO; 4];
    let mut f = [Complex::ZERO; 4];
    let mut g = [Complex::ZERO; 4];
    let mut h = [Complex::ZERO; 4];
    for i in 0..4 {
        let v = [
            p[i],
            q[i] * s[i],
            p[i] * s[i] + q[i],
            Complex::real(-1.0),
            -s[i].powi(2),
            s[i] * -2.0,
        ];
        let mut out = [Complex::ZERO; 6];
        for row in 0..6 {
            let mut acc = Complex::ZERO;
            for col in 0..6 {
                acc = acc + v[col] * abd[row][col];
            }
            out[row] = acc;
        }
        c[i] = out[0];
        d_row[i] = out[1];
        e[i] = out[2];
        f[i] = out[3];
        g[i] = out[4];
        h[i] = out[5];
    }

    Ok(UnsymQuantities { s, a: qa, b: qb, p, q, c, d: d_row, e, f, g, h })
}

/// The four potentials, sampled at the parameter angles the caller will report.
pub struct Potentials {
    /// `[potential index][sample]`.
    values: Vec<Vec<Complex>>,
}

impl Potentials {
    /// Solves the first stage from the far-field load and the second stage at
    /// each sampled angle.
    ///
    /// `angles_deg` are the parameter angles - **the same ones the caller
    /// evaluates `alpha` at**. The Java samples the potential at
    /// `j * 360 / N` while its consumer walks `i * 360 / (N - 1)`, so the
    /// potential it reads at index `i` belongs to a slightly different point
    /// than the angle it reports; at the default 721 samples the two drift
    /// apart by a full step over the sweep. Passing the angles in makes the
    /// mismatch impossible rather than merely unlikely.
    pub fn new(
        q: &UnsymQuantities,
        geometry: &CutoutGeometry,
        loads: &[f64; 6],
        angles_deg: &[f64],
    ) -> Result<Self, CutoutError> {
        // (20, 21, 22) - seven real unknowns: Re and Im of the four
        // first-stage coefficients, with Im(A4) fixed at zero by (22).
        let mut k = vec![vec![0.0; 7]; 7];
        for col in 0..7 {
            let j = col / 2;
            let real_part = col % 2 == 0;
            let sign = if real_part { 1.0 } else { -1.0 };
            let pick = |z: Complex| sign * if real_part { z.re } else { z.im };

            k[0][col] = pick(q.c[j]);
            k[1][col] = pick(q.d[j]);
            k[2][col] = pick(q.e[j]);
            k[3][col] = pick(q.f[j]);
            k[4][col] = pick(q.g[j]);
            k[5][col] = pick(q.h[j]);
            k[6][col] = pick(q.p[j] * q.s[j] - q.q[j]);
        }

        let mut v = [0.0; 7];
        for i in 0..6 {
            v[i] = loads[i] / 2.0;
        }

        let solution =
            crate::mathtools::solve_general(&k, &v).ok_or(CutoutError::SingularSystem)?;
        let mut first = [Complex::ZERO; 4];
        for i in 0..7 {
            if i % 2 == 0 {
                first[i / 2].re = solution[i];
            } else {
                first[(i - 1) / 2].im = solution[i];
            }
        }
        // (22)
        first[3].im = 0.0;

        // (58)
        let mut big_k = [Complex::ZERO; 8];
        for i in 0..4 {
            let twisted = q.h[i] * 2.0 + q.s[i] * q.g[i];
            big_k[0] = big_k[0] + q.e[i] * first[i] * q.a[i];
            big_k[1] = big_k[1] + q.e[i] * first[i] * q.b[i];
            big_k[2] = big_k[2] + q.d[i] * first[i] * q.a[i];
            big_k[3] = big_k[3] + q.d[i] * first[i] * q.b[i];
            big_k[4] = big_k[4] + q.g[i] * first[i] * q.a[i];
            big_k[5] = big_k[5] + q.g[i] * first[i] * q.b[i];
            big_k[6] = big_k[6] + twisted * first[i] * q.a[i];
            big_k[7] = big_k[7] + twisted * first[i] * q.b[i];
        }

        // (57), without the radius, which cancels again in (59).
        let mut a_un = [Complex::ZERO; 4];
        let mut b_un = [Complex::ZERO; 4];
        for i in 0..4 {
            a_un[i] = (big_k[i * 2] + big_k[i * 2 + 1].conj()) * 0.5;
            b_un[i] = (big_k[i * 2 + 1] + big_k[i * 2].conj()) * 0.5;
        }

        // (56) - the same 4x4 matrix at every angle, so it is built once.
        let coefficients: Vec<Vec<Complex>> = (0..4)
            .map(|row| {
                (0..4)
                    .map(|i| match row {
                        0 => q.e[i],
                        1 => q.d[i],
                        2 => q.g[i],
                        _ => q.h[i] * 2.0 + q.s[i] * q.g[i],
                    })
                    .collect()
            })
            .collect();

        let m = geometry.constants();
        let mut values = vec![vec![Complex::ZERO; angles_deg.len()]; 4];
        for (sample, deg) in angles_deg.iter().enumerate() {
            let rad = deg.to_radians();
            let zeta = Complex::new(rad.cos(), rad.sin());

            let mut sum = Complex::ZERO;
            let mut sum_positive = Complex::ZERO;
            let mut sum_negative = Complex::ZERO;
            for (i, mi) in m.iter().enumerate().skip(1) {
                if *mi != 0.0 {
                    let i_f = i as f64;
                    sum = sum + Complex::real(i_f * mi) / zeta.powi(i as i32 + 1);
                    sum_positive = sum_positive + zeta.powi(i as i32 - 1) * (i_f * mi);
                    sum_negative =
                        sum_negative + Complex::real(-i_f * mi) / zeta.powi(i as i32 + 1);
                }
            }

            let rhs: Vec<Complex> = (0..4)
                .map(|i| -(a_un[i] / zeta.powi(2) + b_un[i] * sum))
                .collect();
            let phi2 = complex::solve(&coefficients, &rhs).ok_or(CutoutError::SingularSystem)?;

            for i in 0..4 {
                // (6), differentiated with respect to zeta.
                let w = (q.a[i] * (-zeta.powi(-2) + sum_positive)
                    + q.b[i] * (sum_negative + 1.0))
                    * 0.5;
                // (59), (60)
                values[i][sample] = first[i] - phi2[i] / w;
            }
        }

        Ok(Potentials { values })
    }

    pub fn at(&self, sample: usize) -> [Complex; 4] {
        std::array::from_fn(|i| self.values[i][sample])
    }
}
