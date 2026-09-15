//! The shape of the hole, as a conformal map from the unit circle.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Cutout/.../CutoutGeometry.java
//! and the three shapes in eLamX2/AdditionalCutoutGeometries/.
//!
//! Lekhnitskii's solution only knows one hole: a unit circle. Every other shape
//! reaches it through a mapping
//!
//! ```text
//!     z = R ( zeta + sum_k m_k / zeta^k )
//! ```
//!
//! so a geometry here is nothing but its list of `m_k`. A circle has none, an
//! ellipse has one, and a rectangle has as many as it is given - the corners
//! are a Fourier series and they only get sharp in the limit.
//!
//! The `terms` count is therefore a real input and not a quality knob to be
//! hidden: too few and the "rectangle" is a rounded square, too many and the
//! mapping folds over itself. eLamX offers up to 21 and starts at 11.

// Two kinds of noise this file makes on purpose.
//
// The fitted mapping constants are written with every digit the Java source
// has, a couple more than an f64 can hold; trimming them to what clippy calls
// enough would be editing someone else's curve fit. And the corner series is
// indexed by term AND by column, with a break that depends on both, so the
// index loop is the algebra rather than a missed iterator.
#![allow(clippy::excessive_precision, clippy::needless_range_loop)]

use serde::{Deserialize, Serialize};

use crate::mathtools::Complex;

/// Which hole, and how big.
///
/// In the Java these are four Lookup services with reflected property sheets.
/// Here they are one enum, as with the stiffener profiles and the spring-in
/// models: the choice has to survive JSON and the `.elamx` file.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum CutoutGeometry {
    /// `a` is the radius.
    Circular { a: f64 },
    /// `a` and `b` are the two semi-axes.
    Elliptical { a: f64, b: f64 },
    /// `a` is the half-side; `terms` is how far the corner series runs.
    Square { a: f64, terms: usize },
    /// `a` and `b` are the half-sides.
    Rectangular { a: f64, b: f64, terms: usize },
}

/// The mapping series eLamX tabulates, and the most it will use.
pub const MAX_TERMS: usize = 21;
/// What the original opens with.
pub const DEFAULT_TERMS: usize = 11;

impl Default for CutoutGeometry {
    fn default() -> Self {
        // CutoutInput's no-arg Java constructor: a unit circle.
        CutoutGeometry::Circular { a: 1.0 }
    }
}

impl CutoutGeometry {
    pub fn code(&self) -> &'static str {
        match self {
            CutoutGeometry::Circular { .. } => "circular",
            CutoutGeometry::Elliptical { .. } => "elliptical",
            CutoutGeometry::Square { .. } => "square",
            CutoutGeometry::Rectangular { .. } => "rectangular",
        }
    }

    /// The first semi-axis: a circle's radius, an ellipse's or a rectangle's
    /// half-length.
    pub fn a(&self) -> f64 {
        match *self {
            CutoutGeometry::Circular { a }
            | CutoutGeometry::Elliptical { a, .. }
            | CutoutGeometry::Square { a, .. }
            | CutoutGeometry::Rectangular { a, .. } => a,
        }
    }

    /// The second semi-axis. Equal to `a` for the shapes that have only one.
    pub fn b(&self) -> f64 {
        match *self {
            CutoutGeometry::Circular { a } | CutoutGeometry::Square { a, .. } => a,
            CutoutGeometry::Elliptical { b, .. } | CutoutGeometry::Rectangular { b, .. } => b,
        }
    }

    /// How far `a / b` may stray before the mapping stops describing the shape.
    ///
    /// Unbounded for the circle and the ellipse, whose mappings are exact at
    /// any ratio; 100 for the rectangle, whose fit was made over that range.
    pub fn max_aspect_ratio(&self) -> f64 {
        match self {
            CutoutGeometry::Circular { .. } | CutoutGeometry::Elliptical { .. } => f64::INFINITY,
            CutoutGeometry::Square { .. } | CutoutGeometry::Rectangular { .. } => 100.0,
        }
    }

    /// The mapping coefficients `m_k`, index k = 0, 1, 2, ...
    ///
    /// `m_0` is always zero - the map has no constant term, the hole is
    /// centred - and the series is written out in full, zeros included,
    /// because the stress functions index into it by power.
    pub fn constants(&self) -> Vec<f64> {
        match *self {
            CutoutGeometry::Circular { .. } => vec![0.0, 0.0],
            CutoutGeometry::Elliptical { a, b } => vec![0.0, (a - b) / (a + b)],
            CutoutGeometry::Square { a, terms } => rectangular_constants(a, a, terms),
            CutoutGeometry::Rectangular { a, b, terms } => rectangular_constants(a, b, terms),
        }
    }

    /// The angle in the real plane, in degrees, for an angle on the unit
    /// circle.
    ///
    /// The two are the same only for a circle. Everywhere else the map
    /// stretches the parameter, which is why every result is reported against
    /// this angle rather than against the one it was computed at.
    pub fn alpha(&self, theta_deg: f64) -> f64 {
        let constants = self.constants();

        let mut angle = theta_deg;
        while angle < 0.0 {
            angle += 360.0;
        }
        while angle > 360.0 {
            angle -= 360.0;
        }

        let t = angle.to_radians();
        let mut sum_sin = t.sin();
        let mut sum_cos = t.cos();
        for (k, m) in constants.iter().enumerate().skip(1) {
            sum_sin -= m * (k as f64 * t).sin();
            sum_cos += m * (k as f64 * t).cos();
        }

        // `atan`, not `atan2`: the original takes the principal branch and then
        // puts the angle back in the right quadrant from the INPUT angle, which
        // is not the same thing. Kept, because the quadrant of the mapped point
        // is the quadrant of the parameter for every shape here anyway.
        let alpha = (sum_sin / sum_cos).atan().to_degrees();
        if angle <= 90.0 {
            alpha
        } else if angle <= 270.0 {
            180.0 + alpha
        } else {
            360.0 + alpha
        }
    }

    /// The idealised outline - a true circle, ellipse or rectangle at the given
    /// angles, in mm.
    ///
    /// This is the shape the user asked for, not the one the mapping produces;
    /// eLamX draws it beside the results so the rounding of the corners is
    /// visible rather than implied.
    pub fn simplified_outline(&self, angles_deg: &[f64]) -> Vec<[f64; 2]> {
        match *self {
            CutoutGeometry::Circular { a } => angles_deg
                .iter()
                .map(|deg| {
                    let t = deg.to_radians();
                    [a * t.cos(), a * t.sin()]
                })
                .collect(),
            CutoutGeometry::Elliptical { a, b } => angles_deg
                .iter()
                .map(|deg| {
                    let t = deg.to_radians();
                    [a * t.cos(), b * t.sin()]
                })
                .collect(),
            CutoutGeometry::Square { a, .. } => rectangular_outline(a, a, angles_deg),
            CutoutGeometry::Rectangular { a, b, .. } => rectangular_outline(a, b, angles_deg),
        }
    }

    /// The contour the mapping actually produces, over the full circle,
    /// normalised so its largest coordinate is 1.
    ///
    /// The Java computes only the first quadrant and mirrors it for drawing;
    /// this returns the whole loop, because a rectangle mapped with few terms
    /// is NOT symmetric to machine precision and showing one quadrant four
    /// times would hide that.
    pub fn mapped_contour(&self, samples: usize) -> Vec<[f64; 2]> {
        let constants = self.constants();
        let points: Vec<Complex> = (0..samples)
            .map(|i| {
                let t = (i as f64) * std::f64::consts::TAU / (samples as f64);
                let zeta = Complex::new(t.cos(), t.sin());
                let mut sum = zeta;
                for (k, m) in constants.iter().enumerate() {
                    if *m != 0.0 {
                        sum = sum + Complex::real(*m) / zeta.powi(k as i32);
                    }
                }
                sum
            })
            .collect();

        let max = points
            .iter()
            .fold(0.0f64, |m, p| m.max(p.re.abs()).max(p.im.abs()))
            .max(f64::MIN_POSITIVE);
        points.iter().map(|p| [p.re / max, p.im / max]).collect()
    }
}

/// A rectangle's corner series.
///
/// `cs` and `ks` are eLamX's own tabulated coefficients, and `k` is a mapping
/// exponent fitted to the aspect ratio - a closed-form curve fit, not a
/// derivation, which is why it is eight magic constants and why the shape is
/// only claimed up to an aspect ratio of 100.
fn rectangular_constants(a: f64, b: f64, terms: usize) -> Vec<f64> {
    let terms = terms.clamp(2, MAX_TERMS);
    let ratio = a / b;

    // The fit eLamX ships. An earlier, simpler one is left commented out in the
    // Java; this is the one it uses.
    let c1: f64 = 0.317_215_638_729_231_31;
    let c2: f64 = 0.215_037_776_360_950_87e1;
    let c3: f64 = -0.215_649_142_071_418_88e1;
    let c4: f64 = 0.214_486_612_558_465_96;
    let c5: f64 = -0.230_461_584_304_583_72;
    let c6: f64 = -0.100_001_127_095_185_94e1;
    let c7: f64 = -0.500_271_974_396_742_09e1;
    let c8: f64 = -0.250_000_527_918_605_94;
    let k = c1 * (c2 * (c3 * (c4 * (c5 * (c6 * ratio).abs().ln()).tanh() / c7.tanh()).tanh()).tanh())
        .sin()
        - c8;

    let mut nzcs = vec![0.0; terms];
    for (ii, slot) in nzcs.iter_mut().enumerate() {
        for jj in 0..=ii {
            if 2 * jj >= ii {
                break;
            }
            *slot += CS[ii][jj] * 2.0 * ((ii - 2 * jj) as f64 * 2.0 * k * std::f64::consts::PI).cos();
        }
        *slot += KS[ii];
    }

    // Only the odd powers carry anything: a rectangle is symmetric about both
    // axes, so the even coefficients vanish - and the series is written out
    // with those zeros in place because the stress functions index by power.
    let mut constants = vec![0.0; (terms - 1) * 2];
    for ii in 0..terms - 1 {
        constants[2 * ii] = 0.0;
        constants[2 * ii + 1] = nzcs[ii + 1];
    }
    constants
}

/// The idealised rectangle, as a fan of rays from the centre.
fn rectangular_outline(a: f64, b: f64, angles_deg: &[f64]) -> Vec<[f64; 2]> {
    angles_deg
        .iter()
        .map(|deg| {
            let t = deg.to_radians();
            let (sin, cos) = t.sin_cos();
            // Where the ray leaves the rectangle: the side it hits is whichever
            // limit it reaches first.
            let scale = (a / cos.abs()).min(b / sin.abs());
            [scale * cos, scale * sin]
        })
        .collect()
}

/// Corner-series coefficients, transcribed from `RectangularCutoutGeometry.cs`.
/// Row `i` is the `i`-th mapping term, column `j` its contribution at
/// `cos((i - 2j) * 2 k pi)`.
#[rustfmt::skip]
const CS: [[f64; 11]; 21] = [
    [0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [5.0000000000000000e-01, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [4.1666666666666660e-02, -8.3333333333333320e-02, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.2500000000000000e-02, -1.2500000000000000e-02, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [5.5803571428571420e-03, -4.4642857142857135e-03, -2.2321428571428568e-03, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [3.0381944444444440e-03, -2.1701388888888890e-03, -8.6805555555555550e-04, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.8643465909090910e-03, -1.2428977272727273e-03, -4.4389204545454550e-04, -3.5511363636363638e-04, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.2394831730769231e-03, -7.8876201923076925e-04, -2.6292067307692313e-04, -1.8780048076923077e-04, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [8.7280273437499980e-04, -5.3710937500000000e-04, -1.7089843749999998e-04, -1.1393229166666667e-04, -1.0172526041666667e-04, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [6.4176671645220580e-04, -3.8506002987132350e-04, -1.1848000919117647e-04, -7.5396369485294110e-05, -6.2830307904411760e-05, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [4.8808047645970390e-04, -2.8710616262335520e-04, -8.6131848787006580e-05, -5.3004214638157885e-05, -4.2162443462171040e-05, -3.9351613898026314e-05, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [3.8137890043712790e-04, -2.2079831077938987e-04, -6.4940679640997010e-05, -3.8964407784598207e-05, -2.9972621372767850e-05, -2.6702880859375000e-05, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [3.0468857806661855e-04, -1.7410775889521060e-04, -5.0399614417034650e-05, -2.9646832010020376e-05, -2.2235124007515283e-05, -1.9156414529551629e-05, -1.8285668414572010e-05, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [2.4796962738037105e-04, -1.4015674591064453e-04, -4.0044784545898440e-05, -2.3183822631835938e-05, -1.7046928405761717e-05, -1.4319419860839844e-05, -1.3217926025390623e-05, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [2.0500134538721153e-04, -1.1480075341683846e-04, -3.2443691183019560e-05, -1.8539252104582606e-05, -1.3416564023053204e-05, -1.1048935077808520e-05, -9.9440415700276680e-06, -9.6162160237630200e-06, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.7177698941066342e-04, -9.5431660783701910e-05, -2.6720865019436540e-05, -1.5103097619681523e-05, -1.0787926871201086e-05, -8.7438986219208800e-06, -7.7152046664007770e-06, -7.2743358283207336e-06, 0.0000000000000000e+00, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.4562948396609672e-04, -8.0347301498536120e-05, -2.2318694860704480e-05, -1.2498469121994509e-05, -8.8304401405396000e-06, -7.0643521124316800e-06, -6.1348320976380380e-06, -5.6708531994973460e-06, -5.5290818695099130e-06, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.2473256157880480e-04, -6.8401727317409060e-05, -1.8869442018595606e-05, -1.0483023343664226e-05, -7.3381163405649590e-06, -5.8066833651427070e-06, -4.9771571701223200e-06, -4.5280903577804565e-06, -4.3283216655254360e-06, 0.0000000000000000e+00, 0.0000000000000000e+00],
    [1.0780457107882413e-04, -5.8802493315722260e-05, -1.6123264296246422e-05, -8.8955940944807850e-06, -6.1774958989449910e-06, -4.8431567847728730e-06, -4.1061546653509140e-06, -3.6871592913355147e-06, -3.4688406490853856e-06, -3.4008241657699860e-06, 0.0000000000000000e+00],
    [9.3926457732261440e-05, -5.0988648483227630e-05, -1.3905995040880264e-05, -7.6258682482246610e-06, -5.2592194815342490e-06, -4.0905040411933060e-06, -3.4360233946023760e-06, -3.0518717107337876e-06, -2.8338808742528030e-06, -2.7344464576123535e-06, 0.0000000000000000e+00],
    [8.2426487586837100e-05, -4.4554858155047095e-05, -1.2093461499227065e-05, -6.5964335450329460e-06, -4.5217488010306480e-06, -3.4926611428650520e-06, -2.9105509523875440e-06, -2.5612848381010385e-06, -2.3524844436906280e-06, -2.2404613749434548e-06, -2.2050856690232950e-06],
];

/// The aspect-ratio-independent part of each term, `RectangularCutoutGeometry.ks`.
#[rustfmt::skip]
const KS: [f64; 21] = [
    0.0000000000000000e+00, 0.0000000000000000e+00, -8.3333333333333320e-02, 0.0000000000000000e+00,
    -2.2321428571428568e-03, 0.0000000000000000e+00, -3.5511363636363638e-04, 0.0000000000000000e+00,
    -1.0172526041666667e-04, 0.0000000000000000e+00, -3.9351613898026314e-05, 0.0000000000000000e+00,
    -1.8285668414572010e-05, 0.0000000000000000e+00, -9.6162160237630200e-06, 0.0000000000000000e+00,
    -5.5290818695099130e-06, 0.0000000000000000e+00, -3.4008241657699860e-06, 0.0000000000000000e+00,
    -2.2050856690232950e-06,
];

#[cfg(test)]
mod tests {
    use super::*;

    /// The extreme x and y of a mapped contour, which is what says how wide and
    /// how tall the hole actually came out.
    fn extent(g: &CutoutGeometry) -> (f64, f64) {
        g.mapped_contour(2000)
            .iter()
            .fold((0.0f64, 0.0f64), |(x, y), p| (x.max(p[0].abs()), y.max(p[1].abs())))
    }

    #[test]
    fn a_circle_maps_to_itself() {
        let circle = CutoutGeometry::Circular { a: 7.5 };
        assert!(circle.constants().iter().all(|m| *m == 0.0));

        // The map is the identity, so the parameter angle IS the real angle.
        for theta in [0.0, 17.0, 45.0, 90.0, 123.0, 180.0, 275.0, 359.0] {
            assert!((circle.alpha(theta) - theta).abs() < 1e-9, "theta = {theta}");
        }

        // And the contour is the unit circle, normalised.
        for p in circle.mapped_contour(360) {
            assert!(((p[0] * p[0] + p[1] * p[1]).sqrt() - 1.0).abs() < 1e-12);
        }

        // The drawn outline is the circle the user asked for, at its own size.
        let outline = circle.simplified_outline(&[0.0, 90.0, 180.0]);
        assert!((outline[0][0] - 7.5).abs() < 1e-12);
        assert!((outline[1][1] - 7.5).abs() < 1e-12);
    }

    /// The ellipse's one coefficient is what sets its aspect ratio, and the
    /// check is that the SHAPE that comes out has the ratio asked for - not
    /// that the coefficient equals the formula, which would be reading the
    /// implementation back.
    #[test]
    fn an_ellipse_comes_out_with_the_axes_it_was_given() {
        for (a, b) in [(2.0, 1.0), (5.0, 1.0), (1.0, 1.0), (1.0, 3.0)] {
            let ellipse = CutoutGeometry::Elliptical { a, b };
            let (x, y) = extent(&ellipse);
            assert!((x / y - a / b).abs() < 1e-9, "a = {a}, b = {b}: {x} x {y}");
        }
    }

    /// A circle is the ellipse with equal axes, and the two must agree - the
    /// mapping coefficient is then zero and the shapes coincide exactly.
    #[test]
    fn an_ellipse_with_equal_axes_is_a_circle() {
        let ellipse = CutoutGeometry::Elliptical { a: 3.0, b: 3.0 };
        assert_eq!(ellipse.constants(), vec![0.0, 0.0]);
        for theta in [0.0, 30.0, 200.0] {
            assert!((ellipse.alpha(theta) - theta).abs() < 1e-9);
        }
    }

    /// An ellipse's real angle runs ahead of or behind the parameter
    /// everywhere except on the axes, where the two have to meet.
    #[test]
    fn the_mapped_angle_meets_the_parameter_on_the_axes() {
        let ellipse = CutoutGeometry::Elliptical { a: 4.0, b: 1.0 };
        for theta in [0.0, 90.0, 180.0, 270.0, 360.0] {
            assert!((ellipse.alpha(theta) - theta).abs() < 1e-9, "theta = {theta}");
        }
        // And between them it lags: a point a quarter of the way round the
        // parameter circle sits closer to the long axis on a flat ellipse.
        assert!(ellipse.alpha(45.0) < 45.0);
        assert!(ellipse.alpha(45.0) > 0.0);
    }

    /// The corner series is the whole point of the rectangular mapping, so what
    /// is checked is that it produces a corner: at 45 degrees a square contour
    /// must reach out toward the diagonal, a factor sqrt(2) beyond the middle
    /// of a side, where a circle would stay at 1.
    #[test]
    fn a_square_has_corners_and_a_circle_does_not() {
        let square = CutoutGeometry::Square { a: 1.0, terms: DEFAULT_TERMS };
        let contour = square.mapped_contour(3600);

        let at = |deg: f64| {
            let i = ((deg / 360.0) * 3600.0).round() as usize % 3600;
            contour[i]
        };
        let radius = |p: [f64; 2]| (p[0] * p[0] + p[1] * p[1]).sqrt();
        let ratio = radius(at(45.0)) / radius(at(0.0));

        // Within a tenth of the true corner - the series is truncated, so the
        // corner is rounded, which is exactly what the term count controls.
        assert!(ratio > 1.3, "Eckenverhaeltnis {ratio}");
        assert!((2.0f64.sqrt() - ratio).abs() < 0.12, "Eckenverhaeltnis {ratio}");
    }

    /// More terms, sharper corner. This is the property that makes the term
    /// count a real input rather than a hidden constant.
    #[test]
    fn more_terms_sharpen_the_corner() {
        let radius_at_45 = |terms: usize| {
            let contour = CutoutGeometry::Square { a: 1.0, terms }.mapped_contour(3600);
            let p = contour[450];
            (p[0] * p[0] + p[1] * p[1]).sqrt()
        };
        let few = radius_at_45(3);
        let some = radius_at_45(DEFAULT_TERMS);
        let many = radius_at_45(MAX_TERMS);
        assert!(few < some, "{few} < {some}");
        assert!(some < many, "{some} < {many}");
        assert!(many < 2.0f64.sqrt(), "darf die echte Ecke nicht ueberschreiten");
    }

    /// A rectangle mapped shape has to carry the aspect ratio it was given -
    /// which is what the fitted mapping exponent is there to achieve, and the
    /// only check on that fit that does not simply restate it.
    #[test]
    fn a_rectangle_comes_out_with_roughly_the_aspect_ratio_asked_for() {
        for (a, b, tolerance) in [(1.0, 1.0, 0.01), (2.0, 1.0, 0.05), (4.0, 1.0, 0.1)] {
            let rect = CutoutGeometry::Rectangular { a, b, terms: MAX_TERMS };
            let (x, y) = extent(&rect);
            let ratio = x / y;
            assert!(
                (ratio - a / b).abs() < tolerance * (a / b),
                "a/b = {}, gemappt {ratio}",
                a / b
            );
        }
    }

    /// A square is the rectangle with equal sides, coefficient for coefficient.
    #[test]
    fn a_square_is_a_rectangle_with_equal_sides() {
        assert_eq!(
            CutoutGeometry::Square { a: 2.0, terms: 7 }.constants(),
            CutoutGeometry::Rectangular { a: 2.0, b: 2.0, terms: 7 }.constants()
        );
    }

    /// Only odd powers survive: a rectangle is symmetric about both axes, so
    /// every even coefficient is zero. A transcription that shifted the series
    /// by one would break this immediately.
    #[test]
    fn a_rectangles_even_coefficients_all_vanish() {
        let constants = CutoutGeometry::Rectangular { a: 3.0, b: 1.0, terms: MAX_TERMS }.constants();
        for (k, m) in constants.iter().enumerate() {
            if k % 2 == 0 {
                assert_eq!(*m, 0.0, "m_{k} sollte null sein");
            }
        }
        assert!(constants.iter().any(|m| *m != 0.0), "alle Koeffizienten null");
    }

    /// The drawn rectangle is the true one, corners and all.
    #[test]
    fn the_drawn_rectangle_has_square_corners() {
        let rect = CutoutGeometry::Rectangular { a: 4.0, b: 2.0, terms: DEFAULT_TERMS };
        let outline = rect.simplified_outline(&[0.0, 90.0, 180.0, 270.0]);
        assert!((outline[0][0] - 4.0).abs() < 1e-12);
        assert!((outline[1][1] - 2.0).abs() < 1e-12);
        assert!((outline[2][0] + 4.0).abs() < 1e-12);
        assert!((outline[3][1] + 2.0).abs() < 1e-12);

        // The corner sits where both limits are reached at once.
        let corner = rect.simplified_outline(&[(2.0f64 / 4.0).atan().to_degrees()]);
        assert!((corner[0][0] - 4.0).abs() < 1e-9, "{:?}", corner[0]);
        assert!((corner[0][1] - 2.0).abs() < 1e-9, "{:?}", corner[0]);
    }

    #[test]
    fn the_angle_wraps_rather_than_running_off() {
        let ellipse = CutoutGeometry::Elliptical { a: 3.0, b: 1.0 };
        assert!((ellipse.alpha(-90.0) - ellipse.alpha(270.0)).abs() < 1e-9);
        assert!((ellipse.alpha(400.0) - ellipse.alpha(40.0)).abs() < 1e-9);
    }
}
