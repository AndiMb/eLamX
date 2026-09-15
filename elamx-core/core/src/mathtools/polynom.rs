//! Roots of a real polynomial, by Bairstow's method.
//! Reference: eLamX2/MathTools/src/de/elamx/mathtools/Polynom.java
//!
//! One caller: the cutout analysis, which needs the four roots of the
//! characteristic quartic of an anisotropic plate. Those roots are what the
//! whole complex-potential solution is built on, so this is ported rather than
//! replaced by a closed-form quartic - the ORDER the roots come out in decides
//! which one is called `s1` and which `s2`, and a different solver would be
//! free to disagree.
//!
//! One thing is not ported: the original's iteration runs `while |b1| > EPS ||
//! |b2| > EPS` with no upper bound at all (its `maxIterations` constant is
//! commented out). On a polynomial Bairstow does not converge for, eLamX hangs.
//! Here the loop is capped and says so.

use super::complex::Complex;

/// Convergence threshold on the deflation remainder, as in the original.
const EPS: f64 = 1.0e-6;

/// How many Bairstow steps one quadratic factor may take.
///
/// Generous: the quartics this is used on settle in well under twenty. The cap
/// exists to turn a non-converging input into an error rather than a hang.
const MAX_ITERATIONS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootError {
    /// Fewer than two coefficients, or a leading coefficient of zero.
    NotAPolynomial,
    /// Bairstow's iteration did not settle within [`MAX_ITERATIONS`].
    DidNotConverge,
}

impl std::fmt::Display for RootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RootError::NotAPolynomial => {
                write!(f, "not a polynomial: needs at least a linear term with a non-zero leading coefficient")
            }
            RootError::DidNotConverge => write!(
                f,
                "the root finder did not converge within {MAX_ITERATIONS} steps"
            ),
        }
    }
}

impl std::error::Error for RootError {}

/// The roots of `a[0] + a[1] x + a[2] x^2 + ...`, coefficients in ascending
/// order - the order the Java constructor takes them in.
///
/// Complex roots come out in conjugate PAIRS, the one with the positive
/// imaginary part first. The cutout analysis relies on that: it takes every
/// second root to get one representative per pair, and the theory wants the
/// upper-half-plane one.
pub fn roots(coefficients: &[f64]) -> Result<Vec<Complex>, RootError> {
    let degree = coefficients.len().checked_sub(1).ok_or(RootError::NotAPolynomial)?;
    if degree < 1 || coefficients[degree] == 0.0 {
        return Err(RootError::NotAPolynomial);
    }

    let mut out = Vec::with_capacity(degree);
    match degree {
        1 => {
            out.push(Complex::real(-coefficients[0] / coefficients[1]));
        }
        2 => quadratic(coefficients[1] / coefficients[2], coefficients[0] / coefficients[2], &mut out),
        _ => bairstow(coefficients, &mut out)?,
    }
    Ok(out)
}

/// Peels quadratic factors off the polynomial two at a time.
///
/// Transcribed from the Java, including the `+= EPS` nudge that keeps a zero
/// starting guess from stalling the iteration on its first step.
fn bairstow(coefficients: &[f64], out: &mut Vec<Complex>) -> Result<(), RootError> {
    let mut a = coefficients.to_vec();
    let mut dim = a.len() - 1;

    while dim > 2 {
        let mut a1 = a[dim - 1] / a[dim];
        let mut a0 = a[dim - 2] / a[dim];
        if a1 == 0.0 {
            a1 += EPS;
        }
        if a0 == 0.0 {
            a0 += EPS;
        }

        let mut da1 = 0.0;
        let mut da0 = 0.0;
        let mut b = vec![0.0; dim + 1];
        let mut q = vec![0.0; dim - 1];
        let mut b1;
        let mut b2;
        let mut steps = 0;

        loop {
            a1 -= da1;
            a0 -= da0;

            for j in (0..=dim - 2).rev() {
                b[j] = a[j + 2] - a1 * b[j + 1] - a0 * b[j + 2];
                // `j < dim - 3` in the Java, on ints. `dim >= 3` here, and the
                // subtraction is done in isize so that dim = 3 gives -1 and the
                // branch is simply never taken, as it is there.
                if (j as isize) < dim as isize - 3 {
                    q[j] = b[j + 2] - a1 * q[j + 1] - a0 * q[j + 2];
                }
            }

            b1 = a[1] - a1 * b[0] - a0 * b[1];
            b2 = a[0] - a1 * b1 - a0 * b[0];

            let q1 = b[1] - a1 * q[0] - a0 * q[1];
            let q2 = b[0] - a1 * q1 - a0 * q[0];

            let denominator = q2 * q2 - (-a0 * q1 - a1 * q2) * q1;
            da1 = (q1 * b2 - q2 * b1) / denominator;
            da0 = ((-a0 * q1 - a1 * q2) * b1 - q2 * b2) / denominator;

            if b1.abs() <= EPS && b2.abs() <= EPS {
                break;
            }
            steps += 1;
            if steps > MAX_ITERATIONS || !da1.is_finite() || !da0.is_finite() {
                return Err(RootError::DidNotConverge);
            }
        }

        quadratic(a1, a0, out);
        dim -= 2;

        if dim == 2 {
            quadratic(b[1] / b[2], b[0] / b[2], out);
            return Ok(());
        }
        if dim == 1 {
            out.push(Complex::real(-b[0] / b[1]));
            return Ok(());
        }
        a = b[..=dim].to_vec();
    }

    Ok(())
}

/// The two roots of `x^2 + p x + q`, appended in order.
///
/// A real pair comes out larger first, a complex pair with the positive
/// imaginary part first - which is the half the cutout theory needs.
fn quadratic(p: f64, q: f64, out: &mut Vec<Complex>) {
    let half = -p / 2.0;
    let discriminant = (p / 2.0) * (p / 2.0) - q;
    if discriminant >= 0.0 {
        let root = discriminant.sqrt();
        out.push(Complex::real(half + root));
        out.push(Complex::real(half - root));
    } else {
        let root = (-discriminant).sqrt();
        out.push(Complex::new(half, root));
        out.push(Complex::new(half, -root));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Evaluates the polynomial at a complex point - the only honest way to
    /// check a root finder, since "the roots" of a quartic have no canonical
    /// order to compare against.
    fn evaluate(coefficients: &[f64], z: Complex) -> Complex {
        let mut acc = Complex::ZERO;
        for (i, c) in coefficients.iter().enumerate() {
            acc = acc + z.powi(i as i32) * *c;
        }
        acc
    }

    fn assert_all_are_roots(coefficients: &[f64], tolerance: f64) -> Vec<Complex> {
        let found = roots(coefficients).expect("Nullstellen");
        assert_eq!(found.len(), coefficients.len() - 1, "Anzahl der Nullstellen");
        for r in &found {
            let value = evaluate(coefficients, *r);
            assert!(value.abs() < tolerance, "p({r:?}) = {value:?}");
        }
        found
    }

    #[test]
    fn solves_a_linear_and_a_quadratic_directly() {
        // 2x + 6 = 0
        assert_eq!(roots(&[6.0, 2.0]).unwrap(), vec![Complex::real(-3.0)]);
        // x^2 - 3x + 2 = 0, roots 2 and 1, larger first.
        assert_eq!(roots(&[2.0, -3.0, 1.0]).unwrap(), vec![Complex::real(2.0), Complex::real(1.0)]);
        // x^2 + 1 = 0, the conjugate pair with +i first.
        assert_eq!(roots(&[1.0, 0.0, 1.0]).unwrap(), vec![Complex::I, -Complex::I]);
    }

    /// The shape the cutout analysis actually asks for: a quartic with two
    /// conjugate pairs and no real root, which is what an anisotropic plate's
    /// characteristic equation always has.
    #[test]
    fn splits_a_quartic_into_two_conjugate_pairs() {
        // (x^2 + 1)(x^2 + 4) = x^4 + 5x^2 + 4, roots +-i and +-2i.
        let found = assert_all_are_roots(&[4.0, 0.0, 5.0, 0.0, 1.0], 1e-6);
        for pair in found.chunks(2) {
            assert!(pair[0].im > 0.0, "erste Wurzel des Paares muss oben liegen");
            assert!((pair[0] - pair[1].conj()).abs() < 1e-9, "Paar nicht konjugiert");
        }
        let mut magnitudes: Vec<f64> = found.iter().step_by(2).map(|z| z.im).collect();
        magnitudes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((magnitudes[0] - 1.0).abs() < 1e-6, "{magnitudes:?}");
        assert!((magnitudes[1] - 2.0).abs() < 1e-6, "{magnitudes:?}");
    }

    /// A real quartic from a real laminate: the characteristic polynomial of
    /// the carbon/epoxy ply this crate uses everywhere, in the form
    /// `a11 s^4 - 2 a16 s^3 + (2 a12 + a66) s^2 - 2 a26 s + a22`.
    #[test]
    fn solves_the_characteristic_quartic_of_an_orthotropic_plate() {
        // An orthotropic laminate has a16 = a26 = 0, so the quartic is
        // biquadratic and its roots are purely imaginary - the classic case.
        let a11 = 1.0 / 141_000.0;
        let a22 = 1.0 / 9_340.0;
        let a12 = -0.35 / 141_000.0;
        let a66 = 1.0 / 4_500.0;
        let coefficients = [a22, 0.0, 2.0 * a12 + a66, 0.0, a11];

        let found = assert_all_are_roots(&coefficients, 1e-9);
        for r in &found {
            assert!(r.re.abs() < 1e-9, "orthotrop: Wurzeln rein imaginaer, {r:?}");
        }
    }

    #[test]
    fn says_so_instead_of_hanging_or_guessing() {
        assert_eq!(roots(&[]), Err(RootError::NotAPolynomial));
        assert_eq!(roots(&[1.0]), Err(RootError::NotAPolynomial));
        assert_eq!(roots(&[1.0, 0.0]), Err(RootError::NotAPolynomial));
    }
}
