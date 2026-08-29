//! Ritz shape functions for one plate edge pair.
//!
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/Boundary/Boundary.java
//!
//! Every shape function is a Bernoulli beam vibration mode plus a constant c5
//! that lets it also describe rigid-body displacement:
//!
//!   X_i(x) = c1 sin(cv x/a) + c2 cos(cv x/a) + c3 sinh(cv x/a) + c4 cosh(cv x/a) + c5
//!
//! The constants and the integrals of products of these functions come from
//! boundary_tables.rs (see that file for why they are literals). Everything
//! here is just the length scaling that turns a table entry, computed for the
//! unit interval, into the value for an edge of length `a`.

use super::boundary_tables as tbl;
use serde::{Deserialize, Serialize};

/// Edge condition of ONE pair of opposite plate edges. The two letters are the
/// two edges: S = simply supported, C = clamped, F = free.
///
/// The discriminants are eLamX2's combo-box indices (InputPanel.java's
/// `boundary_cond` array) so saved files and this enum agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BoundaryCondition {
    #[serde(rename = "SS")]
    SimplySimply,
    #[serde(rename = "CC")]
    ClampedClamped,
    #[serde(rename = "CF")]
    ClampedFree,
    #[serde(rename = "FF")]
    FreeFree,
    #[serde(rename = "SC")]
    SimplyClamped,
    #[serde(rename = "SF")]
    SimplyFree,
}

impl BoundaryCondition {
    pub const ALL: [BoundaryCondition; 6] = [
        BoundaryCondition::SimplySimply,
        BoundaryCondition::ClampedClamped,
        BoundaryCondition::ClampedFree,
        BoundaryCondition::FreeFree,
        BoundaryCondition::SimplyClamped,
        BoundaryCondition::SimplyFree,
    ];

    pub fn code(&self) -> &'static str {
        match self {
            BoundaryCondition::SimplySimply => "SS",
            BoundaryCondition::ClampedClamped => "CC",
            BoundaryCondition::ClampedFree => "CF",
            BoundaryCondition::FreeFree => "FF",
            BoundaryCondition::SimplyClamped => "SC",
            BoundaryCondition::SimplyFree => "SF",
        }
    }
}

/// Table set for one edge condition. Borrowed from the generated statics -
/// none of this is copied per calculation.
struct Tables {
    c1: &'static [f64; tbl::MAX_TERMS],
    c2: &'static [f64; tbl::MAX_TERMS],
    c3: &'static [f64; tbl::MAX_TERMS],
    c4: &'static [f64; tbl::MAX_TERMS],
    c5: &'static [f64; tbl::MAX_TERMS],
    cv: &'static [f64; tbl::MAX_TERMS],
    ix: &'static [f64; tbl::MAX_TERMS],
    ixx: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
    ixdx: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
    ixdx2: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
    idxdx: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
    idxdx2: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
    idx2dx2: &'static [[f64; tbl::MAX_TERMS]; tbl::MAX_TERMS],
}

/// Shape functions and integrals for one edge pair of length `a`.
pub struct Boundary {
    a: f64,
    t: Tables,
}

impl Boundary {
    pub fn new(condition: BoundaryCondition, length: f64) -> Self {
        let t = match condition {
            BoundaryCondition::SimplySimply => Tables {
                c1: &tbl::SS_C1,
                c2: &tbl::SS_C2,
                c3: &tbl::SS_C3,
                c4: &tbl::SS_C4,
                c5: &tbl::SS_C5,
                cv: &tbl::SS_CV,
                ix: &tbl::SS_IX,
                ixx: &tbl::SS_IXX,
                ixdx: &tbl::SS_IXDX,
                ixdx2: &tbl::SS_IXDX2,
                idxdx: &tbl::SS_IDXDX,
                idxdx2: &tbl::SS_IDXDX2,
                idx2dx2: &tbl::SS_IDX2DX2,
            },
            BoundaryCondition::ClampedClamped => Tables {
                c1: &tbl::CC_C1,
                c2: &tbl::CC_C2,
                c3: &tbl::CC_C3,
                c4: &tbl::CC_C4,
                c5: &tbl::CC_C5,
                cv: &tbl::CC_CV,
                ix: &tbl::CC_IX,
                ixx: &tbl::CC_IXX,
                ixdx: &tbl::CC_IXDX,
                ixdx2: &tbl::CC_IXDX2,
                idxdx: &tbl::CC_IDXDX,
                idxdx2: &tbl::CC_IDXDX2,
                idx2dx2: &tbl::CC_IDX2DX2,
            },
            BoundaryCondition::ClampedFree => Tables {
                c1: &tbl::CF_C1,
                c2: &tbl::CF_C2,
                c3: &tbl::CF_C3,
                c4: &tbl::CF_C4,
                c5: &tbl::CF_C5,
                cv: &tbl::CF_CV,
                ix: &tbl::CF_IX,
                ixx: &tbl::CF_IXX,
                ixdx: &tbl::CF_IXDX,
                ixdx2: &tbl::CF_IXDX2,
                idxdx: &tbl::CF_IDXDX,
                idxdx2: &tbl::CF_IDXDX2,
                idx2dx2: &tbl::CF_IDX2DX2,
            },
            BoundaryCondition::FreeFree => Tables {
                c1: &tbl::FF_C1,
                c2: &tbl::FF_C2,
                c3: &tbl::FF_C3,
                c4: &tbl::FF_C4,
                c5: &tbl::FF_C5,
                cv: &tbl::FF_CV,
                ix: &tbl::FF_IX,
                ixx: &tbl::FF_IXX,
                ixdx: &tbl::FF_IXDX,
                ixdx2: &tbl::FF_IXDX2,
                idxdx: &tbl::FF_IDXDX,
                idxdx2: &tbl::FF_IDXDX2,
                idx2dx2: &tbl::FF_IDX2DX2,
            },
            BoundaryCondition::SimplyClamped => Tables {
                c1: &tbl::SC_C1,
                c2: &tbl::SC_C2,
                c3: &tbl::SC_C3,
                c4: &tbl::SC_C4,
                c5: &tbl::SC_C5,
                cv: &tbl::SC_CV,
                ix: &tbl::SC_IX,
                ixx: &tbl::SC_IXX,
                ixdx: &tbl::SC_IXDX,
                ixdx2: &tbl::SC_IXDX2,
                idxdx: &tbl::SC_IDXDX,
                idxdx2: &tbl::SC_IDXDX2,
                idx2dx2: &tbl::SC_IDX2DX2,
            },
            BoundaryCondition::SimplyFree => Tables {
                c1: &tbl::SF_C1,
                c2: &tbl::SF_C2,
                c3: &tbl::SF_C3,
                c4: &tbl::SF_C4,
                c5: &tbl::SF_C5,
                cv: &tbl::SF_CV,
                ix: &tbl::SF_IX,
                ixx: &tbl::SF_IXX,
                ixdx: &tbl::SF_IXDX,
                ixdx2: &tbl::SF_IXDX2,
                idxdx: &tbl::SF_IDXDX,
                idxdx2: &tbl::SF_IDXDX2,
                idx2dx2: &tbl::SF_IDX2DX2,
            },
        };
        Boundary { a: length, t }
    }

    pub fn length(&self) -> f64 {
        self.a
    }

    /// Shape function X_i(x).
    ///
    /// ACCURACY: this is the one place that evaluates the series directly
    /// instead of reading a tabulated integral, and for clamped-clamped edges
    /// it loses accuracy as the term index rises. `c3 sinh(cv) + c4 cosh(cv)`
    /// has to cancel against the trigonometric part at the far edge, and by
    /// term 10 cosh(cv) is already ~1e15, so f64 constants cannot carry enough
    /// digits for the cancellation to survive. Worst far-edge value where it
    /// should be 0, measured on Windows/MSVC: ~2e-9 over the first 7 terms,
    /// ~5e-4 over 10, ~0.25 over 20. Those figures are not portable - what is
    /// left is pure cancellation noise, so a platform whose `cosh`/`sinh`
    /// round differently lands an order of magnitude away (a Linux/glibc build
    /// gives ~8e-3 over 10 terms). The test below therefore pins the residual
    /// against the size of the terms that cancel rather than against a
    /// measured number. Recovering the accuracy would need the shape-function
    /// constants at higher precision, which is where they came from originally
    /// but not what the tables store.
    ///
    /// This affects `buckling::mode_surface` (the plotted mode shape) only.
    /// Eigenvalues are unaffected: they are built entirely from the tabulated
    /// integrals, which never evaluate the series.
    pub fn wx(&self, i: usize, x: f64) -> f64 {
        let s = self.t.cv[i] * x / self.a;
        self.t.c1[i] * s.sin() + self.t.c3[i] * s.sinh() + self.t.c2[i] * s.cos()
            + self.t.c4[i] * s.cosh()
            + self.t.c5[i]
    }

    /// Integral over the full edge of X_i.
    pub fn ix(&self, i: usize) -> f64 {
        self.t.ix[i] * self.a
    }

    // The tables hold the integrals for a unit-length edge; each accessor
    // applies the power of `a` that its integrand's derivative order implies.
    // i and p are interchangeable in all of them, because displacement and its
    // variation use the same shape functions.

    /// Integral of X_i * X_p.
    pub fn ixx(&self, i: usize, p: usize) -> f64 {
        self.t.ixx[i][p] * self.a
    }

    /// Integral of X_i * dX_p/dx.
    pub fn ixdx(&self, i: usize, p: usize) -> f64 {
        self.t.ixdx[i][p]
    }

    /// Integral of X_i * d2X_p/dx2.
    pub fn ixdx2(&self, i: usize, p: usize) -> f64 {
        self.t.ixdx2[i][p] / self.a
    }

    /// Integral of dX_i/dx * dX_p/dx.
    pub fn idxdx(&self, i: usize, p: usize) -> f64 {
        self.t.idxdx[i][p] / self.a
    }

    /// Integral of dX_i/dx * d2X_p/dx2.
    pub fn idxdx2(&self, i: usize, p: usize) -> f64 {
        self.t.idxdx2[i][p] / (self.a * self.a)
    }

    /// Integral of d2X_i/dx2 * d2X_p/dx2.
    pub fn idx2dx2(&self, i: usize, p: usize) -> f64 {
        self.t.idx2dx2[i][p] / (self.a * self.a * self.a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simply_supported_shape_functions_are_sine_half_waves() {
        // SS is the one condition whose shape functions are elementary:
        // c1 = 1 with everything else 0 makes X_i = sin(i*pi*x/a).
        let b = Boundary::new(BoundaryCondition::SimplySimply, 2.0);
        for i in 0..5 {
            let x = 0.37;
            let expected = (((i + 1) as f64) * std::f64::consts::PI * x / 2.0).sin();
            assert!((b.wx(i, x) - expected).abs() < 1e-12, "term {i}");
        }
        // ...and they vanish at both edges.
        for i in 0..5 {
            assert!(b.wx(i, 0.0).abs() < 1e-12);
            assert!(b.wx(i, 2.0).abs() < 1e-12);
        }
    }

    #[test]
    fn simply_supported_integrals_match_closed_form() {
        // Integral of sin^2(i*pi*x/a) over [0,a] is a/2, and the shape
        // functions are orthogonal, so IXX is (a/2) * identity.
        let a = 3.0;
        let b = Boundary::new(BoundaryCondition::SimplySimply, a);
        for i in 0..6 {
            for p in 0..6 {
                let expected = if i == p { a / 2.0 } else { 0.0 };
                assert!((b.ixx(i, p) - expected).abs() < 1e-10, "IXX[{i}][{p}]");
            }
        }
        // Integral of (d2/dx2 sin)^2 = (i*pi/a)^4 * a/2.
        for i in 0..6 {
            let k = ((i + 1) as f64) * std::f64::consts::PI / a;
            let expected = k.powi(4) * a / 2.0;
            let got = b.idx2dx2(i, i);
            assert!((got - expected).abs() / expected < 1e-10, "IdX2dX2[{i}]");
        }
    }

    /// Every supported edge must show zero displacement; a FREE edge must not
    /// be held to that, since deflecting there is the whole point.
    #[test]
    fn shape_functions_vanish_at_every_supported_edge() {
        let a = 1.7;
        for bc in BoundaryCondition::ALL {
            let b = Boundary::new(bc, a);
            let code = bc.code().as_bytes();
            // CC is the one condition whose far-edge evaluation degrades (see
            // the accuracy note on `wx`); hold it to the range and tolerance
            // that are actually sound there, and everything else to machine
            // precision across all 20 terms.
            let clamped_both = bc == BoundaryCondition::ClampedClamped;
            let terms = if clamped_both { 7 } else { 20 };
            let tol = if clamped_both { 1e-8 } else { 1e-12 };
            for i in 0..terms {
                if code[0] != b'F' {
                    assert!(b.wx(i, 0.0).abs() < tol, "{} w(0) term {i}", bc.code());
                }
                if code[1] != b'F' {
                    assert!(b.wx(i, a).abs() < tol, "{} w(a) term {i}", bc.code());
                }
            }
        }
    }

    /// Pins the accuracy limit of `wx` so a future change to the tables or the
    /// evaluation shows up as a test failure rather than as a quietly wrong
    /// mode-shape plot.
    ///
    /// The far-edge residual is compared against the size of the terms that
    /// have to cancel there, not against a measured absolute value: what
    /// survives the cancellation is rounding noise, and it differs by more
    /// than an order of magnitude between platforms (~5e-4 over 10 terms on
    /// Windows/MSVC, ~8e-3 on Linux/glibc). A wrong constant in the tables,
    /// on the other hand, produces an error thousands of times larger than
    /// that floor wherever the floor is still small - which is what this
    /// guards.
    #[test]
    fn clamped_clamped_far_edge_error_stays_within_the_cancellation_floor() {
        let b = Boundary::new(BoundaryCondition::ClampedClamped, 1.0);

        // The range the mode-shape plot actually relies on is clean in
        // absolute terms on any platform.
        let worst_of_first_seven = (0..7)
            .map(|i| b.wx(i, 1.0).abs())
            .fold(0.0f64, f64::max);
        assert!(
            worst_of_first_seven < 1e-8,
            "first 7 terms should be clean: {worst_of_first_seven}"
        );

        for i in 0..20 {
            // c3*sinh(cv) and c4*cosh(cv) are the two large terms; their sum
            // has to cancel the trigonometric part exactly at x = a.
            let cv = b.t.cv[i];
            let cancelling = b.t.c3[i].abs() * cv.sinh() + b.t.c4[i].abs() * cv.cosh();
            let floor = 32.0 * f64::EPSILON * cancelling;
            let residual = b.wx(i, 1.0).abs();
            assert!(
                residual <= floor,
                "term {i}: far-edge residual {residual:.3e} exceeds the cancellation floor {floor:.3e}"
            );

            // The near edge stays exact at every term - cosh(0) = 1, so there
            // is nothing to cancel there. Only the far edge suffers.
            assert!(b.wx(i, 0.0).abs() < 1e-12, "near edge term {i}");
        }
    }

    #[test]
    fn integral_scaling_follows_edge_length() {
        // IXX scales with a, IdX2dX2 with 1/a^3 - guards the per-accessor
        // length powers, which is exactly what a transcription slip would hit.
        let b1 = Boundary::new(BoundaryCondition::ClampedClamped, 1.0);
        let b2 = Boundary::new(BoundaryCondition::ClampedClamped, 2.0);
        assert!((b2.ixx(1, 1) / b1.ixx(1, 1) - 2.0).abs() < 1e-12);
        assert!((b2.idx2dx2(1, 1) / b1.idx2dx2(1, 1) - 1.0 / 8.0).abs() < 1e-12);
        assert!((b2.idxdx(1, 1) / b1.idxdx(1, 1) - 0.5).abs() < 1e-12);
        // IXdX takes no length factor at all. Its DIAGONAL is identically zero
        // (the integral of X X' is [X^2/2] over an edge where X vanishes), so
        // the ratio has to be taken on an off-diagonal pair.
        assert_ne!(b1.ixdx(0, 1), 0.0);
        assert!((b2.ixdx(0, 1) / b1.ixdx(0, 1) - 1.0).abs() < 1e-12);
    }
}


