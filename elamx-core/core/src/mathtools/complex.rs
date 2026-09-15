//! Complex arithmetic.
//! Reference: eLamX2/MathTools/src/de/elamx/mathtools/Complex.java
//!
//! Hand-written rather than pulled from a crate, for one reason: the cutout
//! solution is a transcription of a paper's algebra through the original's own
//! arithmetic, and `powi` is where that shows. The Java raises a complex number
//! by repeated multiplication; `num-complex` uses the polar form. The two agree
//! to within a few ulp, which is nothing beside the 1e-6 the root finder works
//! to - but a transcription that differs in the LAST place it could is easier
//! to defend than one that differs in an arbitrary place.
//!
//! Only what the port uses is here. Notably absent is the Java's `divide`
//! returning `null` on a zero divisor: this returns an infinity or a NaN, the
//! same thing every other division in this crate does, and the callers that
//! could divide by zero say so themselves.

use std::ops::{Add, Div, Mul, Neg, Sub};

/// A complex number.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Complex {
    pub re: f64,
    pub im: f64,
}

impl Complex {
    pub const ZERO: Complex = Complex { re: 0.0, im: 0.0 };
    pub const ONE: Complex = Complex { re: 1.0, im: 0.0 };
    pub const I: Complex = Complex { re: 0.0, im: 1.0 };

    pub fn new(re: f64, im: f64) -> Self {
        Complex { re, im }
    }

    /// A real number as a complex one.
    pub fn real(re: f64) -> Self {
        Complex { re, im: 0.0 }
    }

    /// `re^2 + im^2` - the squared magnitude, which is what division needs and
    /// what the Java calls `getHilfsBetrag`.
    pub fn norm_sqr(self) -> f64 {
        self.re * self.re + self.im * self.im
    }

    pub fn abs(self) -> f64 {
        self.norm_sqr().sqrt()
    }

    pub fn conj(self) -> Self {
        Complex { re: self.re, im: -self.im }
    }

    /// An integer power, by repeated multiplication as the original does.
    ///
    /// A negative exponent inverts first and then multiplies, so `z.powi(-2)`
    /// is `(1/z)*(1/z)` rather than `1/(z*z)`. Same value, and the same
    /// rounding as the Java.
    pub fn powi(self, exponent: i32) -> Self {
        if exponent == 0 {
            return Complex::ONE;
        }
        let (base, times) = if exponent < 0 {
            let n = self.norm_sqr();
            (Complex::new(self.re / n, -self.im / n), -exponent)
        } else {
            (self, exponent)
        };

        let mut acc = base;
        for _ in 1..times {
            acc = acc * base;
        }
        acc
    }
}

impl Add for Complex {
    type Output = Complex;
    fn add(self, other: Complex) -> Complex {
        Complex::new(self.re + other.re, self.im + other.im)
    }
}

impl Add<f64> for Complex {
    type Output = Complex;
    fn add(self, other: f64) -> Complex {
        Complex::new(self.re + other, self.im)
    }
}

impl Sub for Complex {
    type Output = Complex;
    fn sub(self, other: Complex) -> Complex {
        Complex::new(self.re - other.re, self.im - other.im)
    }
}

impl Mul for Complex {
    type Output = Complex;
    fn mul(self, other: Complex) -> Complex {
        Complex::new(
            self.re * other.re - self.im * other.im,
            self.re * other.im + self.im * other.re,
        )
    }
}

impl Mul<f64> for Complex {
    type Output = Complex;
    fn mul(self, other: f64) -> Complex {
        Complex::new(self.re * other, self.im * other)
    }
}

impl Div for Complex {
    type Output = Complex;
    fn div(self, other: Complex) -> Complex {
        let n = other.norm_sqr();
        Complex::new(
            (self.re * other.re + self.im * other.im) / n,
            (self.im * other.re - self.re * other.im) / n,
        )
    }
}

impl Div<f64> for Complex {
    type Output = Complex;
    fn div(self, other: f64) -> Complex {
        Complex::new(self.re / other, self.im / other)
    }
}

impl Neg for Complex {
    type Output = Complex;
    fn neg(self) -> Complex {
        Complex::new(-self.re, -self.im)
    }
}

/// Solves a complex linear system by Gaussian elimination with partial
/// pivoting.
///
/// The cutout module's second-stage potential is a 4x4 complex system that has
/// to be solved once per sampled angle. The Java inverts the matrix and
/// multiplies; solving directly is the same answer with one less step to go
/// wrong, and pivoting matters because the rows are force and moment
/// coefficients side by side, orders of magnitude apart.
///
/// `None` if the matrix is singular to working precision.
pub fn solve(a_in: &[Vec<Complex>], b: &[Complex]) -> Option<Vec<Complex>> {
    let n = a_in.len();
    let mut a: Vec<Vec<Complex>> = a_in.to_vec();
    let mut x = b.to_vec();

    for k in 0..n {
        let pivot_row = (k..n).max_by(|i, j| {
            a[*i][k].abs().partial_cmp(&a[*j][k].abs()).unwrap_or(std::cmp::Ordering::Equal)
        })?;
        let pivot = a[pivot_row][k];
        if pivot.abs() == 0.0 || !pivot.abs().is_finite() {
            return None;
        }
        a.swap(k, pivot_row);
        x.swap(k, pivot_row);

        for i in (k + 1)..n {
            let factor = a[i][k] / a[k][k];
            if factor.abs() == 0.0 {
                continue;
            }
            for j in k..n {
                a[i][j] = a[i][j] - factor * a[k][j];
            }
            x[i] = x[i] - factor * x[k];
        }
    }

    for i in (0..n).rev() {
        let mut acc = x[i];
        for j in (i + 1)..n {
            acc = acc - a[i][j] * x[j];
        }
        x[i] = acc / a[i][i];
    }
    Some(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Complex, b: Complex) {
        assert!((a.re - b.re).abs() < 1e-12 && (a.im - b.im).abs() < 1e-12, "{a:?} vs {b:?}");
    }

    #[test]
    fn the_field_operations_are_the_ones_from_school() {
        let a = Complex::new(3.0, 4.0);
        let b = Complex::new(1.0, -2.0);
        close(a + b, Complex::new(4.0, 2.0));
        close(a - b, Complex::new(2.0, 6.0));
        close(a * b, Complex::new(11.0, -2.0));
        // (3+4i)/(1-2i) = (3+4i)(1+2i)/5 = (-5+10i)/5
        close(a / b, Complex::new(-1.0, 2.0));
        assert_eq!(a.abs(), 5.0);
        close(a * a.conj(), Complex::real(25.0));
    }

    #[test]
    fn i_squared_is_minus_one() {
        close(Complex::I * Complex::I, Complex::real(-1.0));
        close(Complex::I.powi(4), Complex::ONE);
    }

    /// Powers on the unit circle, where the answer is known exactly: a point at
    /// angle t raised to n sits at angle n*t. The cutout stress functions do
    /// nothing else with `powi` - their argument is always `zeta`, which is on
    /// the unit circle by construction.
    #[test]
    fn a_power_turns_a_point_on_the_unit_circle_by_its_own_angle() {
        let t: f64 = 0.37;
        let zeta = Complex::new(t.cos(), t.sin());
        for n in [-3, -2, -1, 1, 2, 3, 7] {
            let turned = Complex::new((n as f64 * t).cos(), (n as f64 * t).sin());
            assert!((zeta.powi(n) - turned).abs() < 1e-12, "n = {n}");
        }
        close(zeta.powi(0), Complex::ONE);
    }

    /// The complex solver, on a system whose answer is known by construction:
    /// pick an x, multiply, solve back.
    #[test]
    fn the_complex_solver_recovers_the_vector_it_was_built_from() {
        let a = vec![
            vec![Complex::new(2.0, 1.0), Complex::new(0.0, -1.0), Complex::new(1.0, 0.0)],
            vec![Complex::new(-1.0, 0.5), Complex::new(3.0, 0.0), Complex::new(0.0, 2.0)],
            vec![Complex::new(0.0, 0.0), Complex::new(1.0, 1.0), Complex::new(-2.0, 0.5)],
        ];
        let x = [Complex::new(1.5, -0.5), Complex::new(-2.0, 0.25), Complex::new(0.75, 3.0)];
        let b: Vec<Complex> = a
            .iter()
            .map(|row| {
                row.iter().zip(x).fold(Complex::ZERO, |acc, (c, xi)| acc + *c * xi)
            })
            .collect();

        let found = solve(&a, &b).expect("loesbar");
        for (got, want) in found.iter().zip(x) {
            assert!((*got - want).abs() < 1e-12, "{found:?}");
        }
    }

    /// A zero leading entry is a pivot problem, not a singular one - the
    /// cutout coefficient matrix has them whenever a stiffness component
    /// happens to vanish.
    #[test]
    fn the_complex_solver_pivots_rather_than_dividing_by_zero() {
        let a = vec![
            vec![Complex::ZERO, Complex::ONE],
            vec![Complex::ONE, Complex::ZERO],
        ];
        let found = solve(&a, &[Complex::new(3.0, 1.0), Complex::new(5.0, -2.0)]).unwrap();
        assert_eq!(found, vec![Complex::new(5.0, -2.0), Complex::new(3.0, 1.0)]);

        let singular = vec![
            vec![Complex::ONE, Complex::new(2.0, 0.0)],
            vec![Complex::new(2.0, 0.0), Complex::new(4.0, 0.0)],
        ];
        assert_eq!(solve(&singular, &[Complex::ONE, Complex::new(2.0, 0.0)]), None);
    }

    #[test]
    fn a_negative_power_is_the_reciprocal_of_the_positive_one() {
        let z = Complex::new(0.7, -1.3);
        for n in [1, 2, 5] {
            let product = z.powi(n) * z.powi(-n);
            assert!((product - Complex::ONE).abs() < 1e-12, "n = {n}");
        }
    }
}
