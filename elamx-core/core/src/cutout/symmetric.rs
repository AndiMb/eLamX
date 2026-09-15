//! The complex potentials for a hole in a SYMMETRIC laminate.
//! Reference: eLamX2/.../cutout/SymHoleQuantitiesForce.java,
//! SymHoleQuantitiesMoment.java and SymStressFunction.java
//!
//! A symmetric stack has no B matrix, so stretching and bending do not talk to
//! each other and the hole can be solved twice over: once for the force
//! resultants and once for the moments, from two papers by Ukadgaonker and Rao
//! that share a structure and almost nothing else.
//!
//! Both end at the same place - four complex constants `a[2..4]`, `b[2..4]`
//! that feed [`StressFunction`] - so they share a type here, as they share a
//! base class there.

// The papers index their matrices by component and this file follows them, so
// `d_norm[0][i]` and `d_norm[i][0]` appear side by side in the same loop. An
// iterator over rows would hide which of the two an expression means.
#![allow(clippy::needless_range_loop)]

use crate::mathtools::{roots, Complex, RootError};

use super::geometry::CutoutGeometry;

/// The constants of one potential: the two characteristic roots, the four
/// mapping constants, and for the moment problem the two auxiliary vectors
/// `p` and `q`.
#[derive(Debug, Clone)]
pub struct HoleQuantities {
    /// The two characteristic roots with positive imaginary part.
    pub s: [Complex; 2],
    /// `a[0..2]` from the roots, `a[2..4]` from the load. Same for `b`.
    pub a: [Complex; 4],
    pub b: [Complex; 4],
    /// Only the moment problem has these; the force problem leaves them zero.
    pub p: [Complex; 3],
    pub q: [Complex; 3],
}

impl HoleQuantities {
    /// `a_i` and `b_i` for the two roots - the same two lines in both papers,
    /// [1](7) and [2](26).
    fn from_roots(s: [Complex; 2]) -> Self {
        let mut a = [Complex::ZERO; 4];
        let mut b = [Complex::ZERO; 4];
        for i in 0..2 {
            a[i] = Complex::new(1.0 - s[i].im, s[i].re);
            b[i] = Complex::new(1.0 + s[i].im, -s[i].re);
        }
        HoleQuantities { s, a, b, p: [Complex::ZERO; 3], q: [Complex::ZERO; 3] }
    }
}

/// The two roots the theory wants, out of the four the quartic has.
///
/// The quartic of a real anisotropic plate has no real roots: they come as two
/// conjugate pairs, and the potentials are built on the two from the upper half
/// plane. `roots` returns each pair together with that one first, so taking
/// every second root is exactly the selection - and the same one the Java
/// makes with `roots[i*2]`.
fn upper_half_pair(coefficients: [f64; 5]) -> Result<[Complex; 2], CutoutError> {
    let all = roots(&coefficients).map_err(CutoutError::Roots)?;
    let s = [all[0], all[2]];
    if s[0].im <= 0.0 || s[1].im <= 0.0 {
        return Err(CutoutError::RealCharacteristicRoot);
    }
    Ok(s)
}

#[derive(Debug, Clone, PartialEq)]
pub enum CutoutError {
    Roots(RootError),
    /// The characteristic quartic produced a real root.
    ///
    /// Lekhnitskii's solution needs two conjugate pairs; a real root means the
    /// stiffness matrix is not one a plate could have. eLamX does not check and
    /// would carry on into complex arithmetic that no longer means anything.
    RealCharacteristicRoot,
    /// Fewer than one ply, or a stack with no thickness.
    EmptyLaminate,
    /// Not enough sample points to describe a closed contour.
    TooFewValues { values: usize },
    /// The hole is longer than the mapping was fitted for.
    AspectRatioTooLarge { ratio: f64, maximum: f64 },
    /// A side, radius or semi-axis that is zero or negative.
    NonPositiveGeometry,
    /// One of the linear systems the unsymmetric solution solves came out
    /// singular. eLamX inverts the matrix unconditionally and would carry the
    /// infinities forward.
    SingularSystem,
    /// Two of the characteristic roots coincide.
    ///
    /// Lekhnitskii calls such a material degenerate, and the potentials stop
    /// being independent there: four of them describe fewer than four
    /// directions, the linear systems built on them go singular, and the
    /// answer runs away. It is not an exotic case - a quasi-isotropic stack is
    /// exactly it, because an isotropic plate has the double root `i`.
    ///
    /// eLamX has no guard. On `[0/45/-45/90]` it returns a stress resultant of
    /// 4e12 without comment.
    DegenerateRoots { separation: f64 },
}

impl std::fmt::Display for CutoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CutoutError::Roots(e) => write!(f, "{e}"),
            CutoutError::RealCharacteristicRoot => write!(
                f,
                "the characteristic equation has a real root, so this stiffness is not one a plate can have and the hole solution does not apply"
            ),
            CutoutError::EmptyLaminate => write!(f, "the laminate has no layers"),
            CutoutError::TooFewValues { values } => {
                write!(f, "a contour needs at least 5 points, got {values}")
            }
            CutoutError::AspectRatioTooLarge { ratio, maximum } => write!(
                f,
                "the aspect ratio {ratio} is beyond the {maximum} this hole shape is mapped for"
            ),
            CutoutError::NonPositiveGeometry => {
                write!(f, "the hole needs positive dimensions")
            }
            CutoutError::DegenerateRoots { separation } => write!(
                f,
                "two characteristic roots coincide (they differ by {separation:.3e}), so the four complex potentials are not independent and this solution does not apply to this stack - a quasi-isotropic unsymmetric layup is the usual way to land here"
            ),
            CutoutError::SingularSystem => write!(
                f,
                "the potentials could not be solved for: the system is singular, which means this stiffness does not determine them"
            ),
        }
    }
}

impl std::error::Error for CutoutError {}

/// The force problem: Ukadgaonker & Rao, *A general solution for stresses
/// around holes in symmetric laminates under inplane loading*.
///
/// `loads` is the full six-component vector; only the first three are read.
pub fn force_quantities(
    a_matrix: &[Vec<f64>],
    thickness: f64,
    loads: &[f64; 6],
) -> Result<HoleQuantities, CutoutError> {
    // (A.1) the membrane stiffness per unit thickness, and (A.2) its inverse.
    // Written out rather than run through the general 3x3 inverse because that
    // is how the paper writes it and how the Java transcribes it.
    let bd: Vec<Vec<f64>> = (0..3)
        .map(|i| (0..3).map(|j| a_matrix[i][j] / thickness).collect())
        .collect();

    let det = bd[0][0] * bd[1][1] * bd[2][2] - bd[0][0] * bd[1][2] * bd[1][2]
        + 2.0 * bd[0][1] * bd[1][2] * bd[0][2]
        - bd[2][2] * bd[0][1] * bd[0][1]
        - bd[1][1] * bd[0][2] * bd[0][2];

    let ad00 = (bd[1][1] * bd[2][2] - bd[1][2] * bd[1][2]) / det;
    let ad01 = (bd[0][2] * bd[1][2] - bd[0][1] * bd[2][2]) / det;
    let ad02 = (bd[0][1] * bd[1][2] - bd[0][2] * bd[1][1]) / det;
    let ad11 = (bd[0][0] * bd[2][2] - bd[0][2] * bd[0][2]) / det;
    let ad12 = (bd[0][1] * bd[0][2] - bd[0][0] * bd[1][2]) / det;
    let ad22 = (bd[0][0] * bd[1][1] - bd[0][1] * bd[0][1]) / det;

    // (12), in ascending powers.
    let s = upper_half_pair([ad11, -2.0 * ad12, 2.0 * ad01 + ad22, -2.0 * ad02, ad00])?;
    let mut hq = HoleQuantities::from_roots(s);

    let g = [loads[0] / thickness, loads[1] / thickness, loads[2] / thickness];

    // [1](25)
    let (r1, i1) = (s[0].re, s[0].im);
    let (r2, i2) = (s[1].re, s[1].im);
    let d1 = 2.0 * ((r2 - r1) * (r2 - r1) + i2 * i2 - i1 * i1);
    let d2 = r1 * r1 - i1 * i1;
    let d3 = r2 * r2 - i2 * i2;

    let big_b = (g[0] + (r2 * r2 + i2 * i2) * g[1] + 2.0 * r2 * g[2]) / d1;
    let big_b_prime = (-g[0] + (d2 - 2.0 * r1 * r2) * g[1] - 2.0 * r2 * g[2]) / d1;
    let big_c_prime = ((r1 - r2) * g[0] + (r2 * d2 - r1 * d3) * g[1] + (d2 - d3) * g[2]) / (i2 * d1);

    // [1](27)
    let combined = Complex::I * big_c_prime + big_b_prime;
    let k = [
        (hq.a[0] * big_b + hq.a[1] * combined) * 0.5,
        (hq.b[0] * big_b + hq.b[1] * combined) * 0.5,
        (hq.a[0] * s[0] * big_b + hq.a[1] * s[1] * combined) * 0.5,
        (hq.b[0] * s[0] * big_b + hq.b[1] * s[1] * combined) * 0.5,
    ];
    solve_mapping_constants(&mut hq, &k);
    Ok(hq)
}

/// The last step of the force problem, [1](31).
fn solve_mapping_constants(hq: &mut HoleQuantities, k: &[Complex; 4]) {
    let difference = hq.s[0] - hq.s[1];
    let first = k[0] + k[1].conj();
    let second = k[1] + k[0].conj();
    let third = k[2] + k[3].conj();
    let fourth = k[3] + k[2].conj();

    hq.a[2] = (hq.s[1] * first - third) / difference;
    hq.b[2] = (hq.s[1] * second - fourth) / difference;
    hq.a[3] = -((hq.s[0] * first - third) / difference);
    hq.b[3] = -((hq.s[0] * second - fourth) / difference);
}

/// The moment problem: Ukadgaonker & Rao, *A general solution for moments
/// around holes in symmetric laminates*.
///
/// `d_norm` is Tsai & Hahn's normalised off-axis flexural moduli, which is what
/// the paper is written in; only the last three components of `loads` are read.
pub fn moment_quantities(
    d_norm: &[Vec<f64>],
    thickness: f64,
    loads: &[f64; 6],
) -> Result<HoleQuantities, CutoutError> {
    // (14), in ascending powers - and the ONE place this file knowingly
    // departs from the original.
    //
    // eLamX writes `arr5[3] = 4 * Dnorm[0][2]` and `arr5[1] = 4 * Dnorm[0][2]`:
    // the same coefficient, 4*D16, at both the cubic and the linear term. The
    // characteristic equation of a plate in bending has 4*D26 at the cubic one.
    // Three things say it is a slip rather than a convention:
    //
    //   - the force problem next door gets the analogous term right, using
    //     `ad[1][2]` where this uses `Dnorm[0][2]`;
    //   - the quartic is otherwise exactly the textbook one, written with D22
    //     leading;
    //   - and on a laminate where D16 is large the original's version has REAL
    //     roots, which no elastic plate can have - the solution is then not
    //     merely inaccurate but undefined. `a_twisted_stack_needs_d26` is that
    //     laminate.
    //
    // On any stack with D16 = D26 = 0 - symmetric and balanced, or specially
    // orthotropic, which is nearly everything this module is used on - the two
    // agree to the last bit, so the correction changes no answer anyone has
    // already had.
    let s = upper_half_pair([
        d_norm[0][0],
        4.0 * d_norm[0][2],
        2.0 * (d_norm[0][1] + 2.0 * d_norm[2][2]),
        4.0 * d_norm[1][2],
        d_norm[1][1],
    ])?;
    let mut hq = HoleQuantities::from_roots(s);

    // (19)
    for i in 0..3 {
        hq.p[i] = Complex::real(d_norm[i][0])
            + s[0].powi(2) * d_norm[i][1]
            + s[0] * (2.0 * d_norm[i][2]);
        hq.q[i] = Complex::real(d_norm[i][0])
            + s[1].powi(2) * d_norm[i][1]
            + s[1] * (2.0 * d_norm[i][2]);
    }

    // [2](A.2)
    let t1 = s[0].re * s[0].re - s[0].im * s[0].im;
    let t2 = s[1].re * s[1].re - s[1].im * s[1].im;
    let mut ad = [0.0; 3];
    let mut bd = [0.0; 3];
    let mut cd = [0.0; 3];
    for i in 0..3 {
        ad[i] = d_norm[0][i] + d_norm[1][i] * t1 + 2.0 * d_norm[2][i] * s[0].re;
        bd[i] = d_norm[0][i] + d_norm[1][i] * t2 + 2.0 * d_norm[2][i] * s[1].re;
        cd[i] = 2.0 * d_norm[1][i] * s[1].re * s[1].im + 2.0 * d_norm[2][i] * s[1].im;
    }

    let scale = -6.0 / thickness.powi(3);
    let x = scale * loads[3];
    let y = scale * loads[4];
    let z = scale * loads[5];

    let t = {
        let t0 = x * cd[1] - y * cd[0];
        let t1 = bd[0] * cd[2] - cd[0] * bd[2];
        let t2 = x * cd[2] - z * cd[0];
        let t3 = bd[0] * cd[1] - cd[0] * bd[1];
        let t4 = ad[0] * cd[1] - cd[0] * ad[1];
        let t5 = ad[0] * cd[2] - cd[0] * ad[2];
        let t6 = x / cd[0];
        [t0, t1, t2, t3, t4, t5, t6, t0 * t1 - t2 * t3, t2 * t4 - t0 * t5, t1 * t4 - t3 * t5]
    };

    // [2](A.1)
    let big_b = t[7] / t[9];
    let big_b_prime = t[8] / t[9];
    let big_c_prime = (ad[0] * t[7] + bd[0] * t[8]) / (cd[0] * t[9]) - t[6];

    // [2](57)
    let combined = Complex::I * big_c_prime + big_b_prime;
    let k = [
        (hq.a[0] * big_b * hq.p[0] / s[0] + hq.a[1] * combined * hq.q[0] / s[1]) * 0.5,
        (hq.b[0] * big_b * hq.p[0] / s[0] + hq.b[1] * combined * hq.q[0] / s[1]) * 0.5,
        (hq.a[0] * hq.p[1] * big_b + hq.a[1] * hq.q[1] * combined) * 0.5,
        (hq.b[0] * hq.p[1] * big_b + hq.b[1] * hq.q[1] * combined) * 0.5,
    ];

    // [2](61) - the same shape as [1](31), but weighted by p and q.
    let denominator = hq.p[0] * hq.q[1] * s[1] - hq.p[1] * hq.q[0] * s[0];
    let left = s[0] / denominator;
    let right = -(s[1] / denominator);
    let first = k[0] + k[1].conj();
    let second = k[1] + k[0].conj();
    let third = k[2] + k[3].conj();
    let fourth = k[3] + k[2].conj();

    hq.a[2] = (hq.q[0] * third - hq.q[1] * s[1] * first) * left;
    hq.b[2] = (hq.q[0] * fourth - hq.q[1] * s[1] * second) * left;
    hq.a[3] = (hq.p[0] * third - hq.p[1] * s[0] * first) * right;
    hq.b[3] = (hq.p[0] * fourth - hq.p[1] * s[0] * second) * right;

    Ok(hq)
}

/// The derivatives of the two stress functions at one point on the hole edge.
///
/// `theta` is the angle on the unit circle, not the angle in the plate - the
/// mapping takes care of the difference, and [`CutoutGeometry::alpha`] reports
/// where the point actually is.
pub struct StressFunction<'a> {
    quantities: &'a HoleQuantities,
    constants: Vec<f64>,
}

impl<'a> StressFunction<'a> {
    pub fn new(quantities: &'a HoleQuantities, geometry: &CutoutGeometry) -> Self {
        StressFunction { quantities, constants: geometry.constants() }
    }

    /// `[phi', psi']` at the parameter angle `theta`, in degrees.
    pub fn at(&self, theta_deg: f64) -> [Complex; 2] {
        let zeta = {
            let rad = theta_deg * std::f64::consts::PI / 180.0;
            Complex::new(rad.cos(), rad.sin())
        };
        let m = &self.constants;
        let a = &self.quantities.a;
        let b = &self.quantities.b;

        // [1](6) / [2](25), differentiated with respect to zeta.
        let mut sum_positive = Complex::ZERO;
        let mut sum_negative = Complex::ZERO;
        for (i, mi) in m.iter().enumerate().skip(1) {
            if *mi != 0.0 {
                let i_f = i as f64;
                sum_positive = sum_positive + zeta.powi(i as i32 - 1) * (i_f * mi);
                sum_negative = sum_negative + Complex::real(-i_f * mi) / zeta.powi(i as i32 + 1);
            }
        }
        let w: [Complex; 2] = std::array::from_fn(|k| {
            (a[k] * (-zeta.powi(-2) + sum_positive) + b[k] * (sum_negative + 1.0)) * 0.5
        });

        // [1](30) / [2](60), likewise. `psi` comes out positive because a[3]
        // and b[3] were already negated when they were solved for.
        let mut sum = Complex::ZERO;
        for (i, mi) in m.iter().enumerate().skip(1) {
            if *mi != 0.0 {
                sum = sum + Complex::real(i as f64 * mi) / zeta.powi(i as i32 + 1);
            }
        }

        // [1](33) / [2](63)
        std::array::from_fn(|k| {
            (-a[k + 2] / zeta.powi(2) - b[k + 2] * sum) / w[k]
        })
    }
}
