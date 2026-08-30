//! Deflection of a rectangular plate under transverse load.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/Deformation.java
//! and its `Mechanical/` load classes.
//!
//! Same Ritz series as the buckling analysis, and the same stiffness matrix -
//! what changes is the right-hand side. A transverse load is projected onto
//! the shape functions to give a load vector, and `K a = f` is solved for the
//! coefficients. The result is a displacement field with a real amplitude,
//! unlike a buckling mode, which only has a shape.

use super::boundary::{Boundary, BoundaryCondition};
use super::boundary_tables::MAX_TERMS;
use super::dmatrix::DMatrixKind;
use super::ritz::{add_plate_stiffness, surface, SurfaceScale};
use crate::clt::CltLaminate;
use crate::mathtools;
use serde::{Deserialize, Serialize};

/// A load acting normal to the plate.
///
/// Only the two the Java original offers: a constant pressure over the whole
/// plate, and a point force. Both are projected onto the shape functions the
/// same way - the difference is only whether that projection is an integral or
/// an evaluation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "kind")]
pub enum TransverseLoad {
    /// Constant pressure over the whole plate.
    Surface { force: f64 },
    /// Point force at (x, y), measured from the plate's CENTRE - which is what
    /// the original's input means by those coordinates.
    Point { x: f64, y: f64, force: f64 },
}

/// A load together with the name it carries in the UI and in the file.
///
/// The name is not part of the arithmetic, which is why it sits beside the
/// load rather than inside it - but it IS part of the user's document (the
/// original lets you name each load and lists them by name), so it travels
/// with the input rather than being invented on the way out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct NamedLoad {
    pub name: String,
    #[serde(flatten)]
    pub load: TransverseLoad,
}

impl NamedLoad {
    pub fn surface(name: impl Into<String>, force: f64) -> Self {
        NamedLoad {
            name: name.into(),
            load: TransverseLoad::Surface { force },
        }
    }

    pub fn point(name: impl Into<String>, x: f64, y: f64, force: f64) -> Self {
        NamedLoad {
            name: name.into(),
            load: TransverseLoad::Point { x, y, force },
        }
    }
}

impl TransverseLoad {
    /// Adds this load's contribution to the Ritz load vector.
    fn add(&self, f: &mut [f64], m: usize, n: usize, bx: &Boundary, by: &Boundary) {
        let mut k = 0;
        match *self {
            TransverseLoad::Surface { force } => {
                for pp in 0..m {
                    for qq in 0..n {
                        f[k] += force * bx.ix(pp) * by.ix(qq);
                        k += 1;
                    }
                }
            }
            TransverseLoad::Point { x, y, force } => {
                // The shape functions are written over [0, a]; the input gives
                // the position from the centre.
                let xt = x + bx.length() / 2.0;
                let yt = y + by.length() / 2.0;
                for pp in 0..m {
                    for qq in 0..n {
                        f[k] += force * bx.wx(pp, xt) * by.wx(qq, yt);
                        k += 1;
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct DeformationInput {
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
    pub loads: Vec<NamedLoad>,
}

impl Default for DeformationInput {
    fn default() -> Self {
        // Mirrors DeformationInput's Java constructor, with one surface load
        // so that the analysis has something to do.
        DeformationInput {
            length: 500.0,
            width: 500.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 10,
            n: 10,
            d_matrix: DMatrixKind::Standard,
            loads: vec![NamedLoad::surface("q", 0.01)],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct DeformationResult {
    /// Ritz coefficients, m rows of n - the deflection field's own definition.
    pub coefficients: Vec<Vec<f64>>,
    /// Deflection sampled on a regular grid, rows along y. In the same length
    /// unit as the plate, NOT normalised: here the amplitude is the answer.
    pub surface: Vec<Vec<f64>>,
    /// Largest deflection in either direction, and where it sits.
    pub max_deflection: f64,
    pub max_at: [f64; 2],
    pub min_deflection: f64,
    /// Set when the chosen D matrix assumes a symmetric laminate but this one
    /// is not - the numbers are still returned, as eLamX also computes them.
    pub symmetry_warning: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeformationError {
    TermCountOutOfRange { m: usize, n: usize, max: usize },
    NonPositiveDimensions { length: f64, width: f64 },
    /// No load at all: the plate simply does not move, and reporting a field
    /// of zeros as a result would suggest it was computed from something.
    NoLoad,
    /// The stiffness matrix could not be factorised - a plate whose edges are
    /// all free has rigid-body motions and no unique deflection.
    Singular,
}

impl std::fmt::Display for DeformationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeformationError::TermCountOutOfRange { m, n, max } => {
                write!(f, "term counts m={m}, n={n} must be within 1..={max}")
            }
            DeformationError::NonPositiveDimensions { length, width } => {
                write!(f, "plate dimensions must be positive, got {length} x {width}")
            }
            DeformationError::NoLoad => write!(f, "no transverse load acts on the plate"),
            DeformationError::Singular => {
                write!(f, "the plate is not supported enough to have a unique deflection")
            }
        }
    }
}

impl std::error::Error for DeformationError {}

/// Grid resolution of the sampled deflection field.
const SURFACE_SAMPLES: usize = 41;

/// Solves `K a = f` for the plate's deflection under `input`.
pub fn calculate(
    laminate: &CltLaminate,
    input: &DeformationInput,
) -> Result<DeformationResult, DeformationError> {
    if input.m < 1 || input.n < 1 || input.m > MAX_TERMS || input.n > MAX_TERMS {
        return Err(DeformationError::TermCountOutOfRange {
            m: input.m,
            n: input.n,
            max: MAX_TERMS,
        });
    }
    if !(input.length > 0.0) || !(input.width > 0.0) {
        return Err(DeformationError::NonPositiveDimensions {
            length: input.length,
            width: input.width,
        });
    }
    if input.loads.is_empty() {
        return Err(DeformationError::NoLoad);
    }

    let bx = Boundary::new(input.bc_x, input.length);
    let by = Boundary::new(input.bc_y, input.width);
    let size = input.m * input.n;

    let d = input.d_matrix.matrix(laminate);
    let mut k = vec![vec![0.0; size]; size];
    add_plate_stiffness(&mut k, &d, input.m, input.n, &bx, &by);

    let mut f = vec![0.0; size];
    for load in &input.loads {
        load.load.add(&mut f, input.m, input.n, &bx, &by);
    }
    if f.iter().all(|v| *v == 0.0) {
        return Err(DeformationError::NoLoad);
    }

    let solution = mathtools::solve_ab_cholesky(&k, &f);
    if solution.iter().any(|v| !v.is_finite()) {
        return Err(DeformationError::Singular);
    }

    // Back into the (i in x, j in y) grid the shared evaluator expects.
    let coefficients: Vec<Vec<f64>> = (0..input.m)
        .map(|i| (0..input.n).map(|j| solution[i * input.n + j]).collect())
        .collect();

    let field = surface(
        &coefficients,
        input.length,
        input.width,
        &bx,
        &by,
        SURFACE_SAMPLES,
        SURFACE_SAMPLES,
        SurfaceScale::Absolute,
    );

    let mut max_deflection = f64::NEG_INFINITY;
    let mut min_deflection = f64::INFINITY;
    let mut max_at = [0.0, 0.0];
    for (row, values) in field.iter().enumerate() {
        for (col, value) in values.iter().enumerate() {
            if *value > max_deflection {
                max_deflection = *value;
                max_at = [
                    input.length * col as f64 / (SURFACE_SAMPLES - 1) as f64,
                    input.width * row as f64 / (SURFACE_SAMPLES - 1) as f64,
                ];
            }
            min_deflection = min_deflection.min(*value);
        }
    }

    Ok(DeformationResult {
        coefficients,
        surface: field,
        max_deflection,
        max_at,
        min_deflection,
        symmetry_warning: input.d_matrix.needs_symmetric_laminate() && !laminate.is_symmetric(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    /// An isotropic-equivalent plate, so the deflection can be checked against
    /// the closed-form Navier solution.
    fn isotropic_plate(thickness_per_layer: f64, layers: usize) -> CltLaminate {
        let mut materials = HashMap::new();
        // nu12 = nu21 and E_par = E_nor makes the ply isotropic.
        materials.insert(
            "iso".to_string(),
            Material::new("iso", "iso", 70000.0, 70000.0, 0.33, 70000.0 / (2.0 * 1.33), 2.7e-9),
        );
        let mut laminate = Laminate::new("lam", "plate");
        for i in 0..layers {
            laminate
                .layers
                .push(Layer::new(format!("l{i}"), "", "iso", 0.0, thickness_per_layer));
        }
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    fn simply_supported(load: NamedLoad) -> DeformationInput {
        DeformationInput {
            length: 400.0,
            width: 400.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 12,
            n: 12,
            d_matrix: DMatrixKind::Standard,
            loads: vec![load],
        }
    }

    #[test]
    fn a_uniformly_loaded_square_plate_matches_the_closed_form() {
        // Navier: w_max = 0.00406 q a^4 / D for a simply supported square
        // isotropic plate under constant pressure.
        let plate = isotropic_plate(0.5, 8);
        let pressure = 0.01;
        let input = simply_supported(NamedLoad::surface("q", pressure));
        let result = calculate(&plate, &input).expect("solvable");

        let d = plate.d_matrix()[0][0];
        let expected = 0.00406 * pressure * input.length.powi(4) / d;
        let error = (result.max_deflection - expected).abs() / expected;
        assert!(
            error < 0.02,
            "w_max {} vs closed form {expected} ({:.1}% off)",
            result.max_deflection,
            error * 100.0
        );
    }

    #[test]
    fn the_deflection_peaks_in_the_middle_and_vanishes_at_the_edges() {
        let plate = isotropic_plate(0.5, 8);
        let input = simply_supported(NamedLoad::surface("q", 0.01));
        let result = calculate(&plate, &input).expect("solvable");

        assert!((result.max_at[0] - input.length / 2.0).abs() < input.length / 20.0);
        assert!((result.max_at[1] - input.width / 2.0).abs() < input.width / 20.0);

        let last = result.surface.len() - 1;
        for edge in [&result.surface[0], &result.surface[last]] {
            for value in edge {
                assert!(value.abs() < 1e-9 * result.max_deflection.abs().max(1.0));
            }
        }
    }

    #[test]
    fn deflection_scales_with_the_load() {
        let plate = isotropic_plate(0.5, 8);
        let single = calculate(&plate, &simply_supported(NamedLoad::surface("q", 0.01)))
            .unwrap()
            .max_deflection;
        let double = calculate(&plate, &simply_supported(NamedLoad::surface("q", 0.02)))
            .unwrap()
            .max_deflection;
        assert!((double - 2.0 * single).abs() < 1e-9 * single);
    }

    #[test]
    fn a_stiffer_plate_deflects_less() {
        let thin = isotropic_plate(0.5, 4);
        let thick = isotropic_plate(0.5, 8);
        let input = simply_supported(NamedLoad::surface("q", 0.01));
        assert!(
            calculate(&thick, &input).unwrap().max_deflection
                < calculate(&thin, &input).unwrap().max_deflection
        );
    }

    #[test]
    fn clamping_the_edges_stiffens_the_plate() {
        let plate = isotropic_plate(0.5, 8);
        let simple = simply_supported(NamedLoad::surface("q", 0.01));
        let clamped = DeformationInput {
            bc_x: BoundaryCondition::ClampedClamped,
            bc_y: BoundaryCondition::ClampedClamped,
            ..simple.clone()
        };
        assert!(
            calculate(&plate, &clamped).unwrap().max_deflection
                < calculate(&plate, &simple).unwrap().max_deflection
        );
    }

    #[test]
    fn a_central_point_load_deflects_the_centre_most() {
        let plate = isotropic_plate(0.5, 8);
        let input = simply_supported(NamedLoad::point("F", 0.0, 0.0, 100.0));
        let result = calculate(&plate, &input).expect("solvable");
        assert!(result.max_deflection > 0.0);
        assert!((result.max_at[0] - input.length / 2.0).abs() < input.length / 20.0);
        assert!((result.max_at[1] - input.width / 2.0).abs() < input.width / 20.0);
    }

    #[test]
    fn an_off_centre_point_load_moves_the_peak_with_it() {
        let plate = isotropic_plate(0.5, 8);
        let centred = calculate(
            &plate,
            &simply_supported(NamedLoad::point("F", 0.0, 0.0, 100.0)),
        )
        .unwrap();
        let offset = calculate(
            &plate,
            &simply_supported(NamedLoad::point("F", 100.0, 0.0, 100.0)),
        )
        .unwrap();
        assert!(offset.max_at[0] > centred.max_at[0] + 50.0);
    }

    #[test]
    fn loads_add_up() {
        let plate = isotropic_plate(0.5, 8);
        let a = NamedLoad::surface("q", 0.01);
        let b = NamedLoad::point("F", 0.0, 0.0, 100.0);
        let both = DeformationInput {
            loads: vec![a.clone(), b.clone()],
            ..simply_supported(a.clone())
        };
        let sum = calculate(&plate, &simply_supported(a)).unwrap().max_deflection
            + calculate(&plate, &simply_supported(b)).unwrap().max_deflection;
        // Both peak at the centre, so the peaks add too.
        let combined = calculate(&plate, &both).unwrap().max_deflection;
        assert!((combined - sum).abs() < 1e-6 * sum);
    }

    #[test]
    fn rejects_degenerate_input() {
        let plate = isotropic_plate(0.5, 8);
        let base = simply_supported(NamedLoad::surface("q", 0.01));

        assert!(matches!(
            calculate(&plate, &DeformationInput { m: 0, ..base.clone() }),
            Err(DeformationError::TermCountOutOfRange { .. })
        ));
        assert!(matches!(
            calculate(&plate, &DeformationInput { length: 0.0, ..base.clone() }),
            Err(DeformationError::NonPositiveDimensions { .. })
        ));
        assert!(matches!(
            calculate(&plate, &DeformationInput { loads: vec![], ..base.clone() }),
            Err(DeformationError::NoLoad)
        ));
        assert!(matches!(
            calculate(
                &plate,
                &DeformationInput {
                    loads: vec![NamedLoad::surface("q", 0.0)],
                    ..base
                }
            ),
            Err(DeformationError::NoLoad)
        ));
    }
}
