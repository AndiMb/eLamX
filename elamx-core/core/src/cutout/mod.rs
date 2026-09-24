//! Stress and moment resultants around a hole in a laminate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Cutout/ and
//! eLamX2/AdditionalCutoutGeometries/
//!
//! The one module in eLamX that is not a discretisation of anything: a closed-
//! form elasticity solution, Lekhnitskii's complex potentials as extended by
//! Ukadgaonker and Rao, evaluated exactly on the hole's edge. It answers the
//! question a drawing raises - "the load path has to go round this hole; how
//! much worse does it get at the edge?" - without a mesh.
//!
//! Three papers, and the split between them is the B matrix:
//!
//! - *A general solution for stresses around holes in symmetric laminates
//!   under inplane loading* - the force resultants;
//! - *A general solution for moments around holes in symmetric laminates* -
//!   the moments, solved separately because a symmetric stack does not couple
//!   the two;
//! - and one for unsymmetric laminates, where they cannot be separated.
//!
//! [`calculate`] picks between them on the laminate's symmetry, as
//! `Cutout.calc` does. The two are not an approximation of each other: the
//! symmetric solution is what the unsymmetric one becomes when B vanishes,
//! which is exactly what `the_two_solutions_meet_where_the_b_matrix_vanishes`
//! checks.

pub mod geometry;
pub mod symmetric;
pub mod unsymmetric;

use serde::{Deserialize, Serialize};

use crate::clt::CltLaminate;
use crate::mathtools::Complex;

pub use geometry::{CutoutGeometry, DEFAULT_TERMS, MAX_TERMS};
pub use symmetric::CutoutError;

/// How many points eLamX samples around the hole.
///
/// 721 is one every half degree, and it is the original's default. It is not
/// a convergence parameter - every point is an independent closed-form
/// evaluation - so it only decides how finely the curve is drawn and how
/// exactly the peak is located.
pub const DEFAULT_VALUES: usize = 721;

/// Everything the analysis needs besides the laminate.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct CutoutInput {
    pub geometry: CutoutGeometry,
    /// Force resultants far from the hole, in N/mm.
    pub n_x: f64,
    pub n_y: f64,
    pub n_xy: f64,
    /// Moment resultants far from the hole, in N.
    pub m_x: f64,
    pub m_y: f64,
    pub m_xy: f64,
    /// Points sampled around the hole.
    pub values: usize,
}

impl Default for CutoutInput {
    fn default() -> Self {
        // CutoutInput's no-arg Java constructor: a unit circle under n_x = 1.
        CutoutInput {
            geometry: CutoutGeometry::default(),
            n_x: 1.0,
            n_y: 0.0,
            n_xy: 0.0,
            m_x: 0.0,
            m_y: 0.0,
            m_xy: 0.0,
            values: DEFAULT_VALUES,
        }
    }
}

impl CutoutInput {
    fn loads(&self) -> [f64; 6] {
        [self.n_x, self.n_y, self.n_xy, self.m_x, self.m_y, self.m_xy]
    }
}

/// One point on the hole edge.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct CutoutPoint {
    /// Where on the edge, in degrees, measured in the PLATE - not the
    /// parameter angle the point was computed at. The two differ for every
    /// shape but the circle.
    pub alpha: f64,
    pub n_x: f64,
    pub n_y: f64,
    pub n_xy: f64,
    pub m_x: f64,
    pub m_y: f64,
    pub m_xy: f64,
    /// The force resultant along the edge itself. The number that matters:
    /// a free hole edge carries no load across itself, so all of it runs
    /// tangentially, and this is where a laminate at a hole fails.
    pub n_theta: f64,
    /// The moment resultant along the edge, likewise.
    pub m_theta: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct CutoutResult {
    pub points: Vec<CutoutPoint>,
    /// The largest tangential force resultant and the angle it sits at.
    pub peak_n_theta: f64,
    pub peak_n_theta_alpha: f64,
    /// The largest tangential moment resultant and its angle.
    pub peak_m_theta: f64,
    pub peak_m_theta_alpha: f64,
}

/// The most points the hole's edge is sampled at: every tenth of a degree,
/// the same ceiling the module's input field keeps. A file can ask for more,
/// and each point is a closed-form evaluation of its own.
pub const MAX_VALUES: usize = 3601;

/// The guards both solutions share, from `cutoutui/ControlPanel.checkInput`
/// plus the ones the original leaves implicit.
fn check_input(laminate: &CltLaminate, input: &CutoutInput) -> Result<(), CutoutError> {
    if laminate.layers().is_empty() || laminate.tges() <= 0.0 {
        return Err(CutoutError::EmptyLaminate);
    }
    if input.values < 5 {
        return Err(CutoutError::TooFewValues { values: input.values });
    }
    if input.values > MAX_VALUES {
        return Err(CutoutError::TooManyValues { values: input.values, maximum: MAX_VALUES });
    }
    if input.geometry.a() <= 0.0 || input.geometry.b() <= 0.0 {
        return Err(CutoutError::NonPositiveGeometry);
    }
    let ratio =
        (input.geometry.a() / input.geometry.b()).max(input.geometry.b() / input.geometry.a());
    if ratio > input.geometry.max_aspect_ratio() {
        return Err(CutoutError::AspectRatioTooLarge {
            ratio,
            maximum: input.geometry.max_aspect_ratio(),
        });
    }
    Ok(())
}

/// The parameter angles the contour is sampled at: a closed loop, first point
/// repeated at 360 degrees, as the original walks it.
fn sample_angles(values: usize) -> Vec<f64> {
    let step = 360.0 / (values - 1) as f64;
    (0..values).map(|i| i as f64 * step).collect()
}

/// One point, from its six resultants - including the two tangential ones,
/// which are the same projection in both solutions.
fn resultants_at(alpha: f64, nm: [f64; 6]) -> CutoutPoint {
    let (sin_a, cos_a) = alpha.to_radians().sin_cos();
    let [n_x, n_y, n_xy, m_x, m_y, m_xy] = nm;
    CutoutPoint {
        alpha,
        n_x,
        n_y,
        n_xy,
        m_x,
        m_y,
        m_xy,
        n_theta: n_x * sin_a * sin_a + n_y * cos_a * cos_a - 2.0 * n_xy * sin_a * cos_a,
        m_theta: m_x * sin_a * sin_a + m_y * cos_a * cos_a - 2.0 * m_xy * sin_a * cos_a,
    }
}

/// The peaks, and the result they belong to.
fn summarise(points: Vec<CutoutPoint>) -> CutoutResult {
    let peak = |pick: fn(&CutoutPoint) -> f64| {
        points.iter().fold((0.0f64, 0.0f64), |(best, at), p| {
            if pick(p).abs() > best.abs() {
                (pick(p), p.alpha)
            } else {
                (best, at)
            }
        })
    };
    let (peak_n_theta, peak_n_theta_alpha) = peak(|p| p.n_theta);
    let (peak_m_theta, peak_m_theta_alpha) = peak(|p| p.m_theta);
    CutoutResult { points, peak_n_theta, peak_n_theta_alpha, peak_m_theta, peak_m_theta_alpha }
}

/// Force and moment resultants around a hole in a SYMMETRIC laminate.
///
/// The guards are eLamX's own, from `cutoutui/ControlPanel.checkInput`, plus
/// the two the original leaves implicit (a real characteristic root, and a
/// sample count too small to close a contour).
pub fn calculate_symmetric(
    laminate: &CltLaminate,
    input: &CutoutInput,
) -> Result<CutoutResult, CutoutError> {
    check_input(laminate, input)?;

    let loads = input.loads();
    let thickness = laminate.tges();

    let force = symmetric::force_quantities(laminate.a_matrix(), thickness, &loads)?;
    let moment = symmetric::moment_quantities(
        &laminate.normalized_off_axis_flexural_moduli(),
        thickness,
        &loads,
    )?;

    let phi_n = symmetric::StressFunction::new(&force, &input.geometry);
    let phi_m = symmetric::StressFunction::new(&moment, &input.geometry);

    // The moment resultants come out of the normalised flexural moduli, which
    // are normalised by t^3/6 - so putting them back into N per mm is this
    // factor, and it is the only place the thickness enters the moment side.
    let moment_scale = thickness.powi(3) / 6.0;

    let points = sample_angles(input.values)
        .into_iter()
        .map(|theta| {
            let pn = phi_n.at(theta);
            let pm = phi_m.at(theta);
            let s = force.s;

            let m_of = |k: usize| {
                loads[3 + k] - (moment.p[k] * pm[0] + moment.q[k] * pm[1]).re * moment_scale
            };

            resultants_at(
                input.geometry.alpha(theta),
                [
                    loads[0] + 2.0 * (s[0].powi(2) * pn[0] + s[1].powi(2) * pn[1]).re * thickness,
                    loads[1] + 2.0 * (pn[0] + pn[1]).re * thickness,
                    loads[2] - 2.0 * (s[0] * pn[0] + s[1] * pn[1]).re * thickness,
                    m_of(0),
                    m_of(1),
                    m_of(2),
                ],
            )
        })
        .collect();

    Ok(summarise(points))
}

/// Force and moment resultants around a hole in an UNSYMMETRIC laminate.
///
/// One problem instead of two: the B matrix couples stretching to bending, so
/// the far field, the potentials and the six resultants all have to be solved
/// together. See [`unsymmetric`].
pub fn calculate_unsymmetric(
    laminate: &CltLaminate,
    input: &CutoutInput,
) -> Result<CutoutResult, CutoutError> {
    check_input(laminate, input)?;

    let q = unsymmetric::quantities(
        laminate.a_matrix(),
        laminate.b_matrix(),
        laminate.d_matrix(),
        laminate.abd_matrix(),
    )?;

    let angles: Vec<f64> = sample_angles(input.values);
    let potentials = unsymmetric::Potentials::new(&q, &input.geometry, &input.loads(), &angles)?;

    let points = angles
        .iter()
        .enumerate()
        .map(|(sample, theta)| {
            let phi = potentials.at(sample);
            let sum = |row: &[Complex; 4]| {
                (0..4).fold(0.0, |acc, j| acc + (row[j] * phi[j]).re * 2.0)
            };
            resultants_at(
                input.geometry.alpha(*theta),
                [sum(&q.c), sum(&q.d), sum(&q.e), sum(&q.f), sum(&q.g), sum(&q.h)],
            )
        })
        .collect();

    Ok(summarise(points))
}

/// Force and moment resultants around a hole, whichever solution applies.
///
/// A symmetric stack goes through the two decoupled problems, an unsymmetric
/// one through the coupled one - the same choice `Cutout.calc` makes, and for
/// the same reason: the symmetric solution is not an approximation of the
/// other, it is what the other becomes when B vanishes.
pub fn calculate(
    laminate: &CltLaminate,
    input: &CutoutInput,
) -> Result<CutoutResult, CutoutError> {
    if laminate.is_symmetric() {
        calculate_symmetric(laminate, input)
    } else {
        calculate_unsymmetric(laminate, input)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    /// A quasi-isotropic-by-construction plate: one material, all plies at the
    /// same angle, and the material itself isotropic. Then the laminate is an
    /// isotropic sheet and the hole solution has a textbook answer.
    fn isotropic_plate(layers: usize, thickness_per_layer: f64) -> CltLaminate {
        let e = 70_000.0;
        let nu = 0.3;
        let material = Material::new("iso", "iso", e, e, nu, e / (2.0 * (1.0 + nu)), 2.7e-9);
        let mut materials = HashMap::new();
        materials.insert("iso".to_string(), material);

        let mut laminate = Laminate::new("l", "l");
        for i in 0..layers {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "iso", 0.0, thickness_per_layer));
        }
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    /// A real carbon stack, symmetric and balanced.
    fn quasi_isotropic() -> CltLaminate {
        let material = Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);

        let mut laminate = Laminate::new("l", "l");
        laminate.symmetric = true;
        for (i, angle) in [0.0, 45.0, -45.0, 90.0].iter().enumerate() {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "cfk", *angle, 0.125));
        }
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    fn at_alpha(result: &CutoutResult, alpha: f64) -> CutoutPoint {
        *result
            .points
            .iter()
            .min_by(|a, b| {
                (a.alpha - alpha).abs().partial_cmp(&(b.alpha - alpha).abs()).unwrap()
            })
            .expect("Punkte")
    }

    /// **Kirsch, 1898.** A circular hole in an isotropic sheet under uniaxial
    /// tension raises the stress at the edge of the hole to three times the
    /// applied one, at the two points across from the load - and pushes it to
    /// minus one times the applied stress at the two points in line with it.
    ///
    /// This is the check the whole module rests on: it is a closed-form result
    /// from a different century, it does not depend on eLamX in any way, and
    /// nothing in this port could produce it by accident.
    #[test]
    fn a_circular_hole_in_an_isotropic_sheet_gives_kirschs_factor_of_three() {
        let plate = isotropic_plate(4, 0.25);
        let thickness = plate.tges();
        let applied = 100.0;
        let input = CutoutInput {
            geometry: CutoutGeometry::Circular { a: 5.0 },
            n_x: applied * thickness,
            ..Default::default()
        };

        let result = calculate_symmetric(&plate, &input).unwrap();

        // Across from the load: three times, and it is the maximum.
        let across = at_alpha(&result, 90.0);
        assert!(
            (across.n_theta / (applied * thickness) - 3.0).abs() < 1e-3,
            "90 Grad: {}",
            across.n_theta / (applied * thickness)
        );
        // In line with it: minus one times.
        let inline = at_alpha(&result, 0.0);
        assert!(
            (inline.n_theta / (applied * thickness) + 1.0).abs() < 1e-3,
            "0 Grad: {}",
            inline.n_theta / (applied * thickness)
        );

        assert!((result.peak_n_theta / (applied * thickness) - 3.0).abs() < 1e-3);
        assert!(
            (result.peak_n_theta_alpha - 90.0).abs() < 1.0
                || (result.peak_n_theta_alpha - 270.0).abs() < 1.0,
            "Spitze bei {}",
            result.peak_n_theta_alpha
        );
    }

    /// Kirsch again, one step further out: under EQUAL biaxial tension the
    /// factor is two everywhere on the edge, and under pure shear it is four
    /// on one diagonal and minus four on the other. Three different load cases,
    /// three different closed-form answers, one implementation.
    #[test]
    fn biaxial_tension_and_pure_shear_give_their_own_textbook_factors() {
        let plate = isotropic_plate(4, 0.25);
        let t = plate.tges();
        let circle = CutoutGeometry::Circular { a: 5.0 };

        let biaxial = calculate_symmetric(
            &plate,
            &CutoutInput { geometry: circle, n_x: 100.0 * t, n_y: 100.0 * t, ..Default::default() },
        )
        .unwrap();
        for p in biaxial.points.iter().step_by(37) {
            assert!((p.n_theta / (100.0 * t) - 2.0).abs() < 1e-3, "{} bei {}", p.n_theta, p.alpha);
        }

        let shear = calculate_symmetric(
            &plate,
            &CutoutInput { geometry: circle, n_x: 0.0, n_xy: 100.0 * t, ..Default::default() },
        )
        .unwrap();
        assert!(
            (at_alpha(&shear, 135.0).n_theta / (100.0 * t) - 4.0).abs() < 1e-2,
            "135 Grad: {}",
            at_alpha(&shear, 135.0).n_theta / (100.0 * t)
        );
        assert!(
            (at_alpha(&shear, 45.0).n_theta / (100.0 * t) + 4.0).abs() < 1e-2,
            "45 Grad: {}",
            at_alpha(&shear, 45.0).n_theta / (100.0 * t)
        );
    }

    /// **Inglis, 1913.** An elliptical hole concentrates in proportion to how
    /// blunt it is across the load: pulled along x, the edge stress at the end
    /// of the y semi-axis is `1 + 2b/a` times the applied one. At `a = b` that
    /// is Kirsch's three again, which is the join between the two results and
    /// the reason to check them together.
    ///
    /// The two flatter ellipses below are the blunt direction - a hole WIDER
    /// than it is tall, pulled across its width, concentrates LESS than a
    /// circle, and the fourth case turns it round to show the other half.
    #[test]
    fn an_elliptical_hole_follows_inglis() {
        let plate = isotropic_plate(4, 0.25);
        let t = plate.tges();
        for (a, b) in [(5.0, 5.0), (10.0, 5.0), (15.0, 5.0), (5.0, 15.0)] {
            let result = calculate_symmetric(
                &plate,
                &CutoutInput {
                    geometry: CutoutGeometry::Elliptical { a, b },
                    n_x: 100.0 * t,
                    ..Default::default()
                },
            )
            .unwrap();
            let expected = 1.0 + 2.0 * b / a;
            let found = at_alpha(&result, 90.0).n_theta / (100.0 * t);
            assert!((found - expected).abs() < 1e-3, "a/b = {}: {found} statt {expected}", a / b);
        }
    }

    /// The solution is linear in the load, which is worth pinning because the
    /// potentials are solved from the load rather than scaled by it.
    #[test]
    fn doubling_the_load_doubles_every_resultant() {
        let plate = quasi_isotropic();
        let single = calculate_symmetric(
            &plate,
            &CutoutInput { n_x: 100.0, n_y: -40.0, n_xy: 25.0, ..Default::default() },
        )
        .unwrap();
        let double = calculate_symmetric(
            &plate,
            &CutoutInput { n_x: 200.0, n_y: -80.0, n_xy: 50.0, ..Default::default() },
        )
        .unwrap();

        for (a, b) in single.points.iter().zip(&double.points) {
            assert!((2.0 * a.n_theta - b.n_theta).abs() < 1e-6 * b.n_theta.abs().max(1.0));
        }
    }

    /// A quasi-isotropic carbon stack reproduces Kirsch exactly.
    ///
    /// Every ply in it is wildly anisotropic - 141 GPa one way, 9 GPa the
    /// other - and the stack as a whole is not: [0/45/-45/90]s has an
    /// isotropic A matrix, and the hole cannot tell the difference. That the
    /// anisotropic machinery collapses to the isotropic answer at exactly the
    /// layup where it should is a stronger statement than either result alone.
    #[test]
    fn a_quasi_isotropic_carbon_stack_reproduces_kirsch() {
        let plate = quasi_isotropic();
        let result = calculate_symmetric(
            &plate,
            &CutoutInput {
                geometry: CutoutGeometry::Circular { a: 5.0 },
                n_x: 100.0,
                ..Default::default()
            },
        )
        .unwrap();
        assert!((result.peak_n_theta / 100.0 - 3.0).abs() < 1e-5, "{}", result.peak_n_theta / 100.0);
    }

    /// And a unidirectional stack does NOT - it follows the anisotropic
    /// concentration factor instead:
    ///
    /// ```text
    ///     K = 1 + sqrt( 2 (sqrt(E1/E2) - nu12) + E1/G12 )
    /// ```
    ///
    /// which for this carbon ply is 7.2, not 3. That is the whole reason the
    /// module exists: a laminate at a hole is far worse off than a metal
    /// sheet, and by how much depends on the layup.
    #[test]
    fn a_unidirectional_stack_follows_the_anisotropic_concentration_factor() {
        let (e1, e2, nu12, g12) = (141_000.0, 9_340.0, 0.35, 4_500.0);
        let material = Material::new("cfk", "CFK", e1, e2, nu12, g12, 1.7e-9);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);
        let mut laminate = Laminate::new("l", "l");
        for i in 0..4 {
            laminate.layers.push(Layer::new(format!("y{i}"), "", "cfk", 0.0, 0.125));
        }
        let plate = CltLaminate::new(&laminate, &materials).unwrap();

        let result = calculate_symmetric(
            &plate,
            &CutoutInput {
                geometry: CutoutGeometry::Circular { a: 5.0 },
                n_x: 100.0,
                ..Default::default()
            },
        )
        .unwrap();

        let expected = 1.0 + (2.0 * ((e1 / e2).sqrt() - nu12) + e1 / g12).sqrt();
        let found = result.peak_n_theta / 100.0;
        assert!((found - expected).abs() < 1e-3, "{found} statt {expected}");
        assert!(found > 7.0, "{found}");
    }

    /// A pure bending load produces moments and no forces, and the other way
    /// round - on a symmetric laminate the two problems really are separate,
    /// which is the assumption the whole symmetric path is built on.
    #[test]
    fn force_and_moment_do_not_mix_on_a_symmetric_stack() {
        let plate = quasi_isotropic();

        let pulled =
            calculate_symmetric(&plate, &CutoutInput { n_x: 100.0, ..Default::default() }).unwrap();
        for p in pulled.points.iter().step_by(37) {
            assert!(p.m_theta.abs() < 1e-9, "Moment unter reinem Zug: {}", p.m_theta);
        }

        let bent = calculate_symmetric(
            &plate,
            &CutoutInput { n_x: 0.0, m_x: 10.0, ..Default::default() },
        )
        .unwrap();
        for p in bent.points.iter().step_by(37) {
            assert!(p.n_theta.abs() < 1e-9, "Kraft unter reiner Biegung: {}", p.n_theta);
        }
        assert!(bent.peak_m_theta.abs() > 10.0, "Biegung muss ueberhaupt etwas bewirken");
    }

    /// A stack of `layers` plies at the given angles, with `extra` more plies
    /// of the same material tacked on one face to break the symmetry.
    fn stack(angles: &[f64]) -> CltLaminate {
        let material = Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);
        let mut laminate = Laminate::new("l", "l");
        for (i, angle) in angles.iter().enumerate() {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "cfk", *angle, 0.125));
        }
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    /// **The check that ties the two halves of this module together.**
    ///
    /// The unsymmetric solution is not an alternative to the symmetric one; it
    /// is the general case, and the symmetric one is what it becomes when the
    /// B matrix vanishes. So a stack whose B matrix is nearly zero has to give
    /// nearly the same answer through both paths - and the closer to zero, the
    /// closer the answers.
    ///
    /// Nothing here compares either solution against itself: each is an
    /// independent transcription of a different paper, they share only the
    /// hole geometry, and on a nearly symmetric stack they agree to two
    /// percent.
    ///
    /// Two percent and not more, and the offset is not driven to zero, for a
    /// reason worth knowing: the coupled formulation divides by quantities
    /// that vanish WITH the B matrix, so pushing B towards zero makes it
    /// worse conditioned rather than more accurate. The symmetric solution is
    /// the limit, not the fine end of a sequence.
    #[test]
    fn the_two_solutions_meet_where_the_b_matrix_vanishes() {
        let material = Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);

        // A [0/90]s stack with one face a hair thicker: symmetric in angle,
        // not quite in thickness, so B is small but not zero.
        let mut laminate = Laminate::new("l", "l");
        for (i, (angle, t)) in
            [(0.0, 0.130), (90.0, 0.125), (90.0, 0.125), (0.0, 0.125)].iter().enumerate()
        {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "cfk", *angle, *t));
        }
        let skewed = CltLaminate::new(&laminate, &materials).unwrap();
        assert!(!skewed.is_symmetric(), "der Aufbau muss unsymmetrisch sein");

        let input = CutoutInput {
            geometry: CutoutGeometry::Circular { a: 5.0 },
            n_x: 100.0,
            n_y: -30.0,
            n_xy: 20.0,
            ..Default::default()
        };

        let general = calculate_unsymmetric(&skewed, &input).unwrap();
        let reduced = calculate_symmetric(&stack(&[0.0, 90.0, 90.0, 0.0]), &input).unwrap();

        let difference =
            (general.peak_n_theta - reduced.peak_n_theta).abs() / reduced.peak_n_theta.abs();
        assert!(difference < 0.02, "Abweichung {difference}");
    }

    /// The dispatcher sends a laminate down the path its stiffness calls for.
    #[test]
    fn the_dispatcher_picks_by_symmetry() {
        let input = CutoutInput {
            geometry: CutoutGeometry::Circular { a: 5.0 },
            n_x: 100.0,
            ..Default::default()
        };

        let symmetric = stack(&[0.0, 90.0, 90.0, 0.0]);
        assert!(symmetric.is_symmetric());
        assert_eq!(
            calculate(&symmetric, &input).unwrap(),
            calculate_symmetric(&symmetric, &input).unwrap()
        );

        let unsymmetric = stack(&[0.0, 90.0]);
        assert!(!unsymmetric.is_symmetric());
        assert_eq!(
            calculate(&unsymmetric, &input).unwrap(),
            calculate_unsymmetric(&unsymmetric, &input).unwrap()
        );
    }

    /// An unsymmetric stack under a pure in-plane load carries MOMENTS at the
    /// hole edge - that is what the B matrix does, and the whole reason the
    /// coupled solution exists. The symmetric one cannot produce this.
    #[test]
    fn an_unsymmetric_stack_bends_under_a_pure_in_plane_load() {
        let plate = stack(&[0.0, 90.0]);
        let result = calculate_unsymmetric(
            &plate,
            &CutoutInput {
                geometry: CutoutGeometry::Circular { a: 5.0 },
                n_x: 100.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert!(result.points.iter().all(|p| p.n_theta.is_finite()));
        assert!(result.peak_m_theta.abs() > 0.0, "die B-Matrix muss Momente erzeugen");
        // And the force concentration is still of the expected order.
        assert!(result.peak_n_theta / 100.0 > 2.0, "{}", result.peak_n_theta / 100.0);
        assert!(result.peak_n_theta / 100.0 < 8.0, "{}", result.peak_n_theta / 100.0);
    }

    /// Linear in the load here too - and worth its own check, because the
    /// unsymmetric path solves a seven-by-seven system from the load rather
    /// than scaling anything.
    #[test]
    fn the_coupled_solution_is_linear_in_the_load_as_well() {
        let plate = stack(&[0.0, 90.0]);
        let once = calculate_unsymmetric(
            &plate,
            &CutoutInput { n_x: 100.0, m_y: 5.0, ..Default::default() },
        )
        .unwrap();
        let twice = calculate_unsymmetric(
            &plate,
            &CutoutInput { n_x: 200.0, m_y: 10.0, ..Default::default() },
        )
        .unwrap();
        for (a, b) in once.points.iter().zip(&twice.points) {
            assert!((2.0 * a.n_theta - b.n_theta).abs() < 1e-6 * b.n_theta.abs().max(1.0));
            assert!((2.0 * a.m_theta - b.m_theta).abs() < 1e-6 * b.m_theta.abs().max(1.0));
        }
    }

    /// A quasi-isotropic stack is refused, with the reason, rather than
    /// answered with a number twelve orders too large.
    ///
    /// `[0/45/-45/90]` has an isotropic A matrix, and an isotropic plate has
    /// the DOUBLE characteristic root `i` - which is exactly the case
    /// Lekhnitskii's formulation cannot represent, because four potentials
    /// built on two distinct roots are not four independent functions. The
    /// coupled systems inherit that and run away: eLamX reports a tangential
    /// force resultant of 4e12 for this laminate under a 100 N/mm load, with no
    /// indication that anything is wrong.
    ///
    /// The symmetric path is untouched by this. It is degenerate for an
    /// isotropic plate too, but the limit it takes there is the right one -
    /// `a_circular_hole_in_an_isotropic_sheet_gives_kirschs_factor_of_three`
    /// gets Kirsch to six digits.
    #[test]
    fn a_quasi_isotropic_unsymmetric_stack_is_refused_rather_than_answered() {
        let plate = stack(&[0.0, 45.0, -45.0, 90.0]);
        assert!(!plate.is_symmetric());

        match calculate(&plate, &CutoutInput { n_x: 100.0, ..Default::default() }) {
            Err(CutoutError::DegenerateRoots { separation }) => {
                assert!(separation < 1e-2, "{separation}");
            }
            other => panic!("erwartet wurde DegenerateRoots, kam: {other:?}"),
        }
    }

    /// The laminate that forced the one correction this module makes to the
    /// original, and the reason it is a correction rather than a preference.
    ///
    /// `[30/0/60]s` is symmetric but badly unbalanced: its normalised D16 comes
    /// out larger than its D22. eLamX builds the bending characteristic quartic
    /// with 4*D16 at BOTH the cubic and the linear term, and on this stack that
    /// quartic has real roots - which an elastic plate cannot have, and which
    /// leaves the complex-potential solution undefined rather than merely
    /// approximate. With 4*D26 at the cubic term, where the theory puts it, the
    /// roots are two proper conjugate pairs and the answer is finite.
    ///
    /// See the note in `symmetric::moment_quantities`.
    #[test]
    fn a_twisted_stack_needs_d26_in_the_bending_quartic() {
        let material = Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);
        let mut laminate = Laminate::new("l", "l");
        laminate.symmetric = true;
        for (i, angle) in [30.0, 0.0, 60.0].iter().enumerate() {
            laminate
                .layers
                .push(Layer::new(format!("y{i}"), "", "cfk", *angle, 0.125));
        }
        let plate = CltLaminate::new(&laminate, &materials).unwrap();

        // The stack really is the awkward one: D16 above D22, and D26 nothing
        // like D16, so the two readings of the quartic are far apart.
        let d = plate.normalized_off_axis_flexural_moduli();
        assert!(d[0][2] > d[1][1], "D16 {} sollte ueber D22 {} liegen", d[0][2], d[1][1]);
        assert!(d[0][2] > 2.0 * d[1][2], "D16 und D26 sollten weit auseinander liegen");

        let result =
            calculate_symmetric(&plate, &CutoutInput { n_x: 0.0, m_x: 10.0, ..Default::default() })
                .unwrap();
        assert!(result.peak_m_theta.is_finite());
        assert!(result.peak_m_theta.abs() > 10.0, "{}", result.peak_m_theta);
    }

    /// The other correction, and the one with a number on it.
    ///
    /// Bairstow stops when the deflation remainder falls below an ABSOLUTE
    /// 1e-6. The membrane quartic is built from compliances, whose coefficients
    /// are around 1e-5, so that threshold is most of the coefficient and the
    /// roots come out to about three digits - which shows up as half a percent
    /// on Kirsch's three. Scaling the polynomial before solving costs nothing,
    /// changes no root, and buys seven digits. The original does exactly this
    /// on its unsymmetric path ("damit Koeffizienten des Polynoms nicht zu
    /// gross") and not on its symmetric one.
    ///
    /// This test is the evidence: without the scaling the number below was
    /// 2.984, which is what eLamX reports.
    #[test]
    fn scaling_the_characteristic_polynomial_is_what_makes_kirsch_exact() {
        let plate = isotropic_plate(4, 0.25);
        let result = calculate_symmetric(
            &plate,
            &CutoutInput {
                geometry: CutoutGeometry::Circular { a: 5.0 },
                n_x: 100.0,
                ..Default::default()
            },
        )
        .unwrap();
        let factor = result.peak_n_theta / 100.0;
        assert!((factor - 3.0).abs() < 1e-6, "{factor}");
    }

    #[test]
    fn the_guards_catch_what_the_theory_cannot_answer() {
        let plate = quasi_isotropic();
        assert_eq!(
            calculate_symmetric(&plate, &CutoutInput { values: 3, ..Default::default() }),
            Err(CutoutError::TooFewValues { values: 3 })
        );
        assert_eq!(
            calculate_symmetric(&plate, &CutoutInput { values: MAX_VALUES + 1, ..Default::default() }),
            Err(CutoutError::TooManyValues { values: MAX_VALUES + 1, maximum: MAX_VALUES })
        );
        assert_eq!(
            calculate_symmetric(
                &plate,
                &CutoutInput {
                    geometry: CutoutGeometry::Circular { a: 0.0 },
                    ..Default::default()
                }
            ),
            Err(CutoutError::NonPositiveGeometry)
        );
        assert!(matches!(
            calculate_symmetric(
                &plate,
                &CutoutInput {
                    geometry: CutoutGeometry::Rectangular { a: 500.0, b: 1.0, terms: MAX_TERMS },
                    ..Default::default()
                }
            ),
            Err(CutoutError::AspectRatioTooLarge { .. })
        ));
    }
}
