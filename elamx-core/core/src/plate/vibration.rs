//! Free vibration of a rectangular plate.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/Vibration.java
//!
//! The third and last of the Java module's analyses, and the one that needed
//! the least new machinery: the same Ritz stiffness matrix as buckling and
//! deformation, the same stiffeners, the same generalised eigensolver - what
//! is new is a mass matrix in place of the geometric stiffness.
//!
//! Which is also why the sign convention looks odd. `add_plate_mass`
//! ACCUMULATES NEGATIVE entries, exactly as the Java does, because the solver
//! both share is written for `(K + lambda B) x = 0`: buckling hands it a
//! geometric stiffness that is already negative under compression, and
//! vibration hands it minus the mass matrix so that the same solver returns
//! `lambda = omega^2` rather than its negative.
//!
//! Units follow from the rest of the crate: mm, N and MPa, with masses in
//! tonnes - so a mass moment is t/mm^2, `lambda` comes out in 1/s^2 and the
//! frequency in Hz with no conversion factor anywhere.

use super::boundary::{Boundary, BoundaryCondition};
use super::boundary_tables::MAX_TERMS;
use super::dmatrix::DMatrixKind;
use super::ritz::{add_plate_stiffness, surface, SurfaceScale};
use super::stiffener::{add_stiffener_mass, add_stiffener_stiffness, Stiffener};
use crate::clt::{CltLaminate, MassMoments};
use crate::mathtools::{generalized_symmetric_eigen, EigenError};
use serde::{Deserialize, Serialize};

/// Everything the vibration analysis needs besides the laminate.
///
/// The buckling input without the load flows: a free vibration has no applied
/// load, which is the whole difference between the two analyses at this level.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct VibrationInput {
    /// Plate extent in x, in mm.
    pub length: f64,
    /// Plate extent in y, in mm.
    pub width: f64,
    pub bc_x: BoundaryCondition,
    pub bc_y: BoundaryCondition,
    /// Ritz terms in x and y.
    pub m: usize,
    pub n: usize,
    pub d_matrix: DMatrixKind,
    /// Beam stiffeners. Unlike in the other two analyses these carry mass as
    /// well as stiffness, which is the only place a stiffener's area and
    /// density are used at all.
    #[serde(default)]
    pub stiffeners: Vec<Stiffener>,
}

impl Default for VibrationInput {
    fn default() -> Self {
        // Mirrors VibrationInput's no-arg Java constructor.
        VibrationInput {
            length: 500.0,
            width: 500.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 10,
            n: 10,
            d_matrix: DMatrixKind::Standard,
            stiffeners: Vec::new(),
        }
    }
}

/// One natural vibration mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct VibrationMode {
    /// The eigenvalue itself, omega^2 in 1/s^2. Kept beside the frequency
    /// because it is what the solver returned and what a reader comparing
    /// against another tool will want.
    pub eigenvalue: f64,
    /// Natural frequency in Hz: sqrt(eigenvalue) / (2 pi).
    pub frequency: f64,
    /// Modal amplitudes a_ij, m rows of n. A shape, with no amplitude of its
    /// own - as for a buckling mode.
    pub shape: Vec<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct VibrationResult {
    /// Lowest natural frequency, in Hz.
    pub fundamental_frequency: f64,
    /// All m*n modes, by ascending frequency.
    pub modes: Vec<VibrationMode>,
    /// Set when the chosen D matrix assumes a symmetric laminate and this one
    /// is not - the numbers are returned anyway, as eLamX returns them.
    pub symmetry_warning: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum VibrationError {
    TermCountOutOfRange { m: usize, n: usize, max: usize },
    NonPositiveDimensions { length: f64, width: f64 },
    /// The laminate is not symmetric, so it has no mass moments.
    ///
    /// `CltLaminate::mass_moments` returns `None` there, matching the Java
    /// `CLT_Laminate.getMassMoments`. The restriction is not arbitrary: an
    /// unsymmetric stack has a non-zero first mass moment, which couples the
    /// in-plane inertia to the bending one, and this Ritz series carries only
    /// the out-of-plane displacement - there is nowhere to put that coupling.
    ///
    /// The Java notices too, but only by leaving the mass matrix at zero and
    /// reporting infinite frequencies. Saying so is the difference between a
    /// module that cannot answer and one that answers nonsense.
    UnsymmetricLaminate,
    /// The laminate has mass moments, but they are zero: every ply's density
    /// is zero. An input someone forgot to fill in, not a stiff plate.
    MasslessLaminate,
    Eigen(EigenError),
}

impl std::fmt::Display for VibrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VibrationError::TermCountOutOfRange { m, n, max } => {
                write!(f, "Ritz term counts m={m}, n={n} must each be within 1..={max}")
            }
            VibrationError::NonPositiveDimensions { length, width } => write!(
                f,
                "plate dimensions must be positive (got length={length}, width={width})"
            ),
            VibrationError::UnsymmetricLaminate => write!(
                f,
                "free vibration needs a symmetric laminate: an unsymmetric one couples in-plane and bending inertia, which this analysis does not model"
            ),
            VibrationError::MasslessLaminate => write!(
                f,
                "the laminate has no mass - every ply's density is zero, so it has no natural frequency"
            ),
            VibrationError::Eigen(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for VibrationError {}

impl From<EigenError> for VibrationError {
    fn from(e: EigenError) -> Self {
        VibrationError::Eigen(e)
    }
}

/// Assembles the plate's mass matrix.
///
/// Port of Mechanical/Plate.java `addMass`, negative entries and all - see the
/// module header on why. `i0` is the mass per area and `i2` its second moment,
/// the rotary inertia; the Java includes the latter, so this does too, even
/// though thin-plate theory usually drops it.
pub fn add_plate_mass(
    mass: &mut [Vec<f64>],
    moments: &MassMoments,
    m: usize,
    n: usize,
    bx: &Boundary,
    by: &Boundary,
) {
    let mut row = 0;
    for pp in 0..m {
        for qq in 0..n {
            let mut col = 0;
            for ii in 0..m {
                for jj in 0..n {
                    mass[row][col] -= moments.i0 * bx.ixx(ii, pp) * by.ixx(jj, qq)
                        + moments.i2
                            * (bx.idxdx(ii, pp) * by.ixx(jj, qq)
                                + bx.ixx(ii, pp) * by.idxdx(jj, qq));
                    col += 1;
                }
            }
            row += 1;
        }
    }
}

/// Solves the free-vibration eigenvalue problem for `laminate` under `input`.
pub fn calculate(
    laminate: &CltLaminate,
    input: &VibrationInput,
) -> Result<VibrationResult, VibrationError> {
    if input.m < 1 || input.n < 1 || input.m > MAX_TERMS || input.n > MAX_TERMS {
        return Err(VibrationError::TermCountOutOfRange {
            m: input.m,
            n: input.n,
            max: MAX_TERMS,
        });
    }
    if !(input.length > 0.0) || !(input.width > 0.0) {
        return Err(VibrationError::NonPositiveDimensions {
            length: input.length,
            width: input.width,
        });
    }
    let moments = laminate
        .mass_moments()
        .ok_or(VibrationError::UnsymmetricLaminate)?;
    if moments.i0 <= 0.0 {
        return Err(VibrationError::MasslessLaminate);
    }

    let (m, n) = (input.m, input.n);
    let size = m * n;

    let bx = Boundary::new(input.bc_x, input.length);
    let by = Boundary::new(input.bc_y, input.width);
    let d = input.d_matrix.matrix(laminate);

    let mut k = vec![vec![0.0f64; size]; size];
    let mut mass = vec![vec![0.0f64; size]; size];
    add_plate_stiffness(&mut k, &d, m, n, &bx, &by);
    add_plate_mass(&mut mass, &moments, m, n, &bx, &by);
    add_stiffener_stiffness(&mut k, &input.stiffeners, m, n, &bx, &by);
    add_stiffener_mass(&mut mass, &input.stiffeners, m, n, &bx, &by);

    let solution = generalized_symmetric_eigen(&mass, &k, size)?;

    let modes: Vec<VibrationMode> = solution
        .eigenvalues
        .iter()
        .zip(solution.eigenvectors.iter())
        .map(|(&eigenvalue, vector)| VibrationMode {
            eigenvalue,
            // A negative eigenvalue has no frequency. The solver orders by
            // magnitude and a well-posed plate gives only positive ones, but
            // a NaN here would travel silently into a table.
            frequency: if eigenvalue >= 0.0 {
                eigenvalue.sqrt() / (2.0 * std::f64::consts::PI)
            } else {
                f64::NAN
            },
            shape: (0..m).map(|i| vector[i * n..(i + 1) * n].to_vec()).collect(),
        })
        .collect();

    let fundamental_frequency = modes
        .iter()
        .map(|mode| mode.frequency)
        .find(|f| f.is_finite())
        .unwrap_or(f64::NAN);

    Ok(VibrationResult {
        fundamental_frequency,
        modes,
        symmetry_warning: input.d_matrix.needs_symmetric_laminate() && !laminate.is_symmetric(),
    })
}

/// Samples a mode's displacement surface, normalised to a peak of 1.
///
/// The same call as `buckling::mode_surface`, and for the same reason: a mode
/// has a shape and no amplitude, so the view exaggerates it from a normalised
/// one.
pub fn mode_surface(
    shape: &[Vec<f64>],
    input: &VibrationInput,
    nx_samples: usize,
    ny_samples: usize,
) -> Vec<Vec<f64>> {
    surface(
        shape,
        input.length,
        input.width,
        &Boundary::new(input.bc_x, input.length),
        &Boundary::new(input.bc_y, input.width),
        nx_samples,
        ny_samples,
        SurfaceScale::Normalised,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    /// An isotropic-equivalent plate, so the frequencies can be checked
    /// against the closed form.
    fn isotropic_plate(thickness_per_layer: f64, layers: usize, rho: f64) -> CltLaminate {
        let e = 70_000.0;
        let nu = 0.3;
        let material = Material::new("iso", "iso", e, e, nu, e / (2.0 * (1.0 + nu)), rho);
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

    /// Closed-form natural frequencies of a simply supported isotropic plate:
    ///
    /// omega_mn = pi^2 [ (m/a)^2 + (n/b)^2 ] sqrt(D / (rho t))
    ///
    /// This is the textbook check, independent of the Java implementation and
    /// of everything else in this crate. It is thin-plate theory, which drops
    /// the rotary inertia the port keeps, so the agreement is only as good as
    /// that term is small - hence the thin plate below.
    #[test]
    fn simply_supported_isotropic_plate_matches_its_closed_form() {
        let t_layer = 0.125;
        let layers = 8;
        let t = t_layer * layers as f64;
        let rho = 1.6e-9;
        let plate = isotropic_plate(t_layer, layers, rho);

        let (a, b) = (400.0, 300.0);
        let nu = 0.3;
        let d = 70_000.0 * t.powi(3) / (12.0 * (1.0 - nu * nu));

        let input = VibrationInput {
            length: a,
            width: b,
            m: 8,
            n: 8,
            ..Default::default()
        };
        let result = calculate(&plate, &input).unwrap();

        let pi = std::f64::consts::PI;
        let omega = |mm: f64, nn: f64| {
            pi * pi * ((mm / a).powi(2) + (nn / b).powi(2)) * (d / (rho * t)).sqrt()
        };

        // The three lowest half-wave combinations, in the order they come out.
        for (index, (mm, nn)) in [(1.0, 1.0), (2.0, 1.0), (1.0, 2.0)].iter().enumerate() {
            let expected = omega(*mm, *nn) / (2.0 * pi);
            let got = result.modes[index].frequency;
            assert!(
                (got - expected).abs() / expected < 5e-3,
                "mode {index}: {got} Hz vs closed form {expected} Hz"
            );
        }
        assert!((result.fundamental_frequency - result.modes[0].frequency).abs() < 1e-12);
    }

    /// Frequency scales as 1/sqrt(density): a plate of twice the density
    /// vibrates at 1/sqrt(2) of the frequency, with the same mode shapes.
    #[test]
    fn a_heavier_plate_vibrates_more_slowly() {
        let light = isotropic_plate(0.125, 8, 1.6e-9);
        let heavy = isotropic_plate(0.125, 8, 3.2e-9);
        let input = VibrationInput { m: 6, n: 6, ..Default::default() };
        let f_light = calculate(&light, &input).unwrap().fundamental_frequency;
        let f_heavy = calculate(&heavy, &input).unwrap().fundamental_frequency;
        assert!(
            (f_light / f_heavy - 2.0f64.sqrt()).abs() < 1e-6,
            "{f_light} vs {f_heavy}"
        );
    }

    #[test]
    fn clamped_edges_ring_higher_than_simply_supported() {
        let plate = isotropic_plate(0.125, 8, 1.6e-9);
        let base = VibrationInput { m: 8, n: 8, ..Default::default() };
        let simply = calculate(&plate, &base).unwrap().fundamental_frequency;
        let clamped = calculate(
            &plate,
            &VibrationInput {
                bc_x: BoundaryCondition::ClampedClamped,
                bc_y: BoundaryCondition::ClampedClamped,
                ..base.clone()
            },
        )
        .unwrap()
        .fundamental_frequency;
        assert!(clamped > simply * 1.5, "clamped {clamped} vs simply {simply}");
    }

    /// A stiffener raises the frequency: it adds far more stiffness than mass.
    /// The mass term is checked separately below, because a stiffener whose
    /// mass was silently dropped would still pass this.
    #[test]
    fn a_stiffener_raises_the_fundamental_frequency() {
        use crate::plate::{StiffenerDirection, StiffenerGeometry};
        let plate = isotropic_plate(0.125, 8, 1.6e-9);
        let base = VibrationInput { m: 8, n: 8, ..Default::default() };
        let plain = calculate(&plate, &base).unwrap().fundamental_frequency;

        let stiffened = calculate(
            &plate,
            &VibrationInput {
                stiffeners: vec![Stiffener {
                    name: "s".into(),
                    direction: StiffenerDirection::X,
                    position: 0.0,
                    geometry: StiffenerGeometry::IProfile {
                        w1: 20.0,
                        t1: 2.0,
                        e: 70000.0,
                        g: 27000.0,
                        rho: 2.7e-9,
                    },
                }],
                ..base.clone()
            },
        )
        .unwrap()
        .fundamental_frequency;
        assert!(stiffened > plain, "{stiffened} vs {plain}");
    }

    /// The stiffener's own mass, isolated: a stiffener of no stiffness at all
    /// but real density can only slow the plate down.
    #[test]
    fn a_stiffeners_mass_lowers_the_frequency() {
        use crate::plate::{StiffenerDirection, StiffenerGeometry};
        let plate = isotropic_plate(0.125, 8, 1.6e-9);
        let base = VibrationInput { m: 6, n: 6, ..Default::default() };
        let plain = calculate(&plate, &base).unwrap().fundamental_frequency;

        let dead_weight = calculate(
            &plate,
            &VibrationInput {
                stiffeners: vec![Stiffener {
                    name: "ballast".into(),
                    direction: StiffenerDirection::X,
                    position: 0.0,
                    geometry: StiffenerGeometry::Direct {
                        e: 0.0,
                        i: 0.0,
                        g: 0.0,
                        j: 0.0,
                        a: 500.0,
                        rho: 7.85e-9,
                    },
                }],
                ..base.clone()
            },
        )
        .unwrap()
        .fundamental_frequency;
        assert!(dead_weight < plain, "{dead_weight} vs {plain}");
    }

    #[test]
    fn a_laminate_without_density_is_an_error_not_an_infinity() {
        // Still symmetric - a zero density does not make a stack unbalanced.
        let weightless = isotropic_plate(0.125, 8, 0.0);
        assert!(matches!(
            calculate(&weightless, &VibrationInput::default()),
            Err(VibrationError::MasslessLaminate)
        ));
    }

    /// The two reasons this module can refuse are different reasons, and the
    /// message has to say which - eLamX reports neither, it just returns
    /// infinite frequencies.
    #[test]
    fn an_unsymmetric_laminate_is_told_apart_from_a_weightless_one() {
        // [0/90] of an orthotropic ply - the web app's own default laminate,
        // and the reason this module refuses more often than the other two.
        let material = Material::new("ud", "ud", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        let mut materials = HashMap::new();
        materials.insert("ud".to_string(), material);
        let mut laminate = Laminate::new("l", "l");
        laminate.layers.push(Layer::new("a", "", "ud", 0.0, 0.2));
        laminate.layers.push(Layer::new("b", "", "ud", 90.0, 0.2));
        let unsymmetric = CltLaminate::new(&laminate, &materials).unwrap();
        assert!(!unsymmetric.is_symmetric());

        assert!(matches!(
            calculate(&unsymmetric, &VibrationInput::default()),
            Err(VibrationError::UnsymmetricLaminate)
        ));
    }

    #[test]
    fn rejects_degenerate_input() {
        let plate = isotropic_plate(0.125, 8, 1.6e-9);
        assert!(matches!(
            calculate(&plate, &VibrationInput { m: 0, ..Default::default() }),
            Err(VibrationError::TermCountOutOfRange { .. })
        ));
        assert!(matches!(
            calculate(&plate, &VibrationInput { length: 0.0, ..Default::default() }),
            Err(VibrationError::NonPositiveDimensions { .. })
        ));
    }

    #[test]
    fn mode_surface_respects_the_edge_conditions() {
        let plate = isotropic_plate(0.125, 8, 1.6e-9);
        let input = VibrationInput { m: 6, n: 6, ..Default::default() };
        let result = calculate(&plate, &input).unwrap();
        let surface = mode_surface(&result.modes[0].shape, &input, 21, 21);

        #[allow(clippy::needless_range_loop)]
        for s in 0..21 {
            assert!(surface[0][s].abs() < 1e-6, "top edge at {s}");
            assert!(surface[20][s].abs() < 1e-6, "bottom edge at {s}");
            assert!(surface[s][0].abs() < 1e-6, "left edge at {s}");
            assert!(surface[s][20].abs() < 1e-6, "right edge at {s}");
        }
        assert!((surface[10][10].abs() - 1.0).abs() < 1e-6);
    }
}
