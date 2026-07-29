//! Buckling of a rectangular laminated plate under in-plane loads.
//!
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Plate/src/de/elamx/clt/plate/
//!            Buckling.java, Mechanical/Plate.java, Mechanical/InplaneLoad.java
//!
//! Ritz method: the out-of-plane displacement is approximated by a product
//! series of the two edge pairs' beam shape functions,
//!
//!   w(x, y) = sum_i sum_j  a_ij  X_i(x) Y_j(y),
//!
//! which turns the stability problem into the generalised symmetric eigenvalue
//! problem `Kg a = mu K a` over m*n degrees of freedom. The buckling load
//! factor of a mode is `-1/mu`; the critical one is the smallest positive
//! value, and the critical load flow is that factor times the applied one.

use serde::{Deserialize, Serialize};

use super::boundary::{Boundary, BoundaryCondition};
use super::boundary_tables::MAX_TERMS;
use super::dmatrix::DMatrixKind;
use crate::clt::CltLaminate;
use crate::mathtools::{generalized_symmetric_eigen, EigenError};

/// Everything the buckling calculation needs besides the laminate itself.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BucklingInput {
    /// Plate extent in x, in mm.
    pub length: f64,
    /// Plate extent in y, in mm.
    pub width: f64,
    /// Applied in-plane load flows, in N/mm. Their RATIO is what matters -
    /// the result scales the whole triple by one common factor.
    pub n_x: f64,
    pub n_y: f64,
    pub n_xy: f64,
    /// Edge condition of the two edges normal to x.
    pub bc_x: BoundaryCondition,
    /// Edge condition of the two edges normal to y.
    pub bc_y: BoundaryCondition,
    /// Ritz terms in x and y. m*n is the size of the eigenvalue problem, so
    /// cost grows as (m*n)^3 - eLamX2 defaults to 10 and caps at 20.
    pub m: usize,
    pub n: usize,
    /// Which bending stiffness matrix the plate is analysed with.
    pub d_matrix: DMatrixKind,
}

impl Default for BucklingInput {
    fn default() -> Self {
        // Mirrors BucklingInput's no-arg Java constructor.
        BucklingInput {
            length: 500.0,
            width: 500.0,
            n_x: 1.0,
            n_y: 0.0,
            n_xy: 0.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 10,
            n: 10,
            d_matrix: DMatrixKind::Standard,
        }
    }
}

/// One buckling mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucklingMode {
    /// Load factor: the applied load flows multiplied by this buckle the plate.
    pub eigenvalue: f64,
    /// Modal amplitudes a_ij, m rows of n, matching the Ritz series above.
    /// Unit-normalised as a flat vector, so only the SHAPE is meaningful.
    pub shape: Vec<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucklingResult {
    /// Smallest positive load factor, i.e. the critical one. `None` when no
    /// eigenvalue came out positive, which means the plate does not buckle
    /// under this load direction (e.g. pure tension).
    pub critical_factor: Option<f64>,
    /// Critical load flows: `critical_factor` times the applied n_x/n_y/n_xy.
    pub n_crit: Option<[f64; 3]>,
    /// All m*n modes, ordered by ascending |load factor|.
    pub modes: Vec<BucklingMode>,
    /// Set when the chosen D-matrix assumes a symmetric laminate but the
    /// laminate is not - the numbers are still returned, since eLamX2 also
    /// computes them, but they are only as good as that assumption.
    pub symmetry_warning: bool,
}

// No Eq: the degenerate-input variants carry the offending f64s, which is
// worth more in an error message than deriving a trait nothing needs here.
#[derive(Debug, Clone, PartialEq)]
pub enum BucklingError {
    /// m or n outside 1..=MAX_TERMS.
    TermCountOutOfRange { m: usize, n: usize, max: usize },
    /// Plate dimensions must be strictly positive.
    NonPositiveDimensions { length: f64, width: f64 },
    /// No load at all: the geometric stiffness matrix is identically zero and
    /// there is nothing to scale.
    NoLoad,
    /// The stiffness matrix was not positive definite.
    Eigen(EigenError),
}

impl std::fmt::Display for BucklingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BucklingError::TermCountOutOfRange { m, n, max } => {
                write!(f, "Ritz term counts m={m}, n={n} must each be within 1..={max}")
            }
            BucklingError::NonPositiveDimensions { length, width } => write!(
                f,
                "plate dimensions must be positive (got length={length}, width={width})"
            ),
            BucklingError::NoLoad => {
                write!(f, "all in-plane load flows are zero - nothing to scale")
            }
            BucklingError::Eigen(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for BucklingError {}

impl From<EigenError> for BucklingError {
    fn from(e: EigenError) -> Self {
        BucklingError::Eigen(e)
    }
}

/// Assembles the Ritz stiffness matrix from the plate's bending stiffness.
///
/// Port of Mechanical/Plate.java `addStiffness`. The index pair (pp, qq) walks
/// the variation and (ii, jj) the displacement; both flatten to `row * n + col`.
fn add_plate_stiffness(k: &mut [Vec<f64>], d: &[[f64; 3]; 3], m: usize, n: usize, bx: &Boundary, by: &Boundary) {
    let mut row = 0;
    for pp in 0..m {
        for qq in 0..n {
            let mut col = 0;
            for ii in 0..m {
                for jj in 0..n {
                    k[row][col] += d[0][0] * (bx.idx2dx2(ii, pp) * by.ixx(jj, qq))
                        + d[0][1]
                            * (bx.ixdx2(ii, pp) * by.ixdx2(qq, jj)
                                + bx.ixdx2(pp, ii) * by.ixdx2(jj, qq))
                        + 2.0
                            * d[0][2]
                            * (bx.idxdx2(ii, pp) * by.ixdx(qq, jj)
                                + bx.idxdx2(pp, ii) * by.ixdx(jj, qq))
                        + d[1][1] * (bx.ixx(ii, pp) * by.idx2dx2(jj, qq))
                        + 2.0
                            * d[1][2]
                            * (bx.ixdx(pp, ii) * by.idxdx2(jj, qq)
                                + bx.ixdx(ii, pp) * by.idxdx2(qq, jj))
                        + 4.0 * d[2][2] * (bx.idxdx(ii, pp) * by.idxdx(jj, qq));
                    col += 1;
                }
            }
            row += 1;
        }
    }
}

/// Assembles the geometric stiffness matrix from the in-plane load flows.
///
/// Port of Mechanical/InplaneLoad.java `add`. Note this ASSIGNS rather than
/// accumulates, matching the Java.
fn add_geometric_stiffness(
    kg: &mut [Vec<f64>],
    n_x: f64,
    n_y: f64,
    n_xy: f64,
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
                    kg[row][col] = n_x * (bx.idxdx(ii, pp) * by.ixx(jj, qq))
                        + n_xy
                            * (bx.ixdx(ii, pp) * by.ixdx(qq, jj)
                                + bx.ixdx(pp, ii) * by.ixdx(jj, qq))
                        + n_y * (bx.ixx(ii, pp) * by.idxdx(jj, qq));
                    col += 1;
                }
            }
            row += 1;
        }
    }
}

/// Solves the buckling eigenvalue problem for `laminate` under `input`.
pub fn calculate(laminate: &CltLaminate, input: &BucklingInput) -> Result<BucklingResult, BucklingError> {
    if input.m < 1 || input.n < 1 || input.m > MAX_TERMS || input.n > MAX_TERMS {
        return Err(BucklingError::TermCountOutOfRange {
            m: input.m,
            n: input.n,
            max: MAX_TERMS,
        });
    }
    if !(input.length > 0.0) || !(input.width > 0.0) {
        return Err(BucklingError::NonPositiveDimensions {
            length: input.length,
            width: input.width,
        });
    }
    if input.n_x == 0.0 && input.n_y == 0.0 && input.n_xy == 0.0 {
        return Err(BucklingError::NoLoad);
    }

    let (m, n) = (input.m, input.n);
    let size = m * n;

    let bx = Boundary::new(input.bc_x, input.length);
    let by = Boundary::new(input.bc_y, input.width);
    let d = input.d_matrix.matrix(laminate);

    let mut k = vec![vec![0.0f64; size]; size];
    let mut kg = vec![vec![0.0f64; size]; size];
    add_plate_stiffness(&mut k, &d, m, n, &bx, &by);
    add_geometric_stiffness(&mut kg, input.n_x, input.n_y, input.n_xy, m, n, &bx, &by);

    let solution = generalized_symmetric_eigen(&kg, &k, size)?;

    // Eigenvalues arrive ordered by ascending magnitude, so the first
    // non-negative one is the critical load factor.
    let critical_factor = solution.eigenvalues.iter().copied().find(|v| *v >= 0.0);
    let n_crit =
        critical_factor.map(|f| [f * input.n_x, f * input.n_y, f * input.n_xy]);

    let modes = solution
        .eigenvalues
        .iter()
        .zip(solution.eigenvectors.iter())
        .map(|(&eigenvalue, vector)| BucklingMode {
            eigenvalue,
            shape: (0..m)
                .map(|i| vector[i * n..(i + 1) * n].to_vec())
                .collect(),
        })
        .collect();

    Ok(BucklingResult {
        critical_factor,
        n_crit,
        modes,
        symmetry_warning: input.d_matrix.needs_symmetric_laminate() && !laminate.is_symmetric(),
    })
}

/// Samples a mode's displacement surface on a `nx_samples` x `ny_samples`
/// grid, normalised so the largest absolute deflection is 1.
///
/// Takes the modal amplitudes rather than a whole `BucklingMode` so a caller
/// that kept only the amplitudes (the web frontend does - the eigenvalue list
/// travels without surfaces, and one gets sampled on demand when the user
/// picks a mode) can ask for a surface without reassembling the mode.
///
/// The amplitudes alone are not plottable: turning them back into w(x, y)
/// needs the shape functions, which live here. Sampling in the core rather
/// than the frontend also keeps the shape-function definitions in exactly one
/// place. Note the accuracy caveat on `Boundary::wx` - it applies to this
/// surface, not to any eigenvalue.
pub fn mode_surface(
    shape: &[Vec<f64>],
    input: &BucklingInput,
    nx_samples: usize,
    ny_samples: usize,
) -> Vec<Vec<f64>> {
    let bx = Boundary::new(input.bc_x, input.length);
    let by = Boundary::new(input.bc_y, input.width);
    let (m, n) = (input.m, input.n);

    // Precompute each shape function at every sample station: without this the
    // sinh/cosh calls dominate, being evaluated m*n times per grid point.
    let xs: Vec<Vec<f64>> = (0..m)
        .map(|i| {
            (0..nx_samples)
                .map(|s| {
                    let x = input.length * s as f64 / (nx_samples - 1).max(1) as f64;
                    bx.wx(i, x)
                })
                .collect()
        })
        .collect();
    let ys: Vec<Vec<f64>> = (0..n)
        .map(|j| {
            (0..ny_samples)
                .map(|s| {
                    let y = input.width * s as f64 / (ny_samples - 1).max(1) as f64;
                    by.wx(j, y)
                })
                .collect()
        })
        .collect();

    let mut surface = vec![vec![0.0f64; nx_samples]; ny_samples];
    for (i, xrow) in xs.iter().enumerate() {
        for (j, yrow) in ys.iter().enumerate() {
            let a = shape[i][j];
            if a == 0.0 {
                continue;
            }
            for (sy, &yv) in yrow.iter().enumerate() {
                let ay = a * yv;
                for (sx, &xv) in xrow.iter().enumerate() {
                    surface[sy][sx] += ay * xv;
                }
            }
        }
    }

    let peak = surface
        .iter()
        .flat_map(|r| r.iter())
        .fold(0.0f64, |acc, v| acc.max(v.abs()));
    if peak > 0.0 {
        for row in surface.iter_mut() {
            for v in row.iter_mut() {
                *v /= peak;
            }
        }
    }
    surface
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clt::CltLaminate;
    use crate::model::{Laminate, Layer, Material};
    use std::collections::HashMap;

    /// Isotropic-ish layup whose D matrix is easy to reason about.
    fn isotropic_plate(thickness_per_layer: f64, layers: usize) -> CltLaminate {
        // An isotropic material: E_par = E_nor, G = E/(2(1+nu)).
        let e = 70_000.0;
        let nu = 0.3;
        let material = Material::new("iso", "iso", e, e, nu, e / (2.0 * (1.0 + nu)), 1.6e-9);

        let mut materials = HashMap::new();
        materials.insert("iso".to_string(), material);

        let laminate = Laminate {
            id: "l".into(),
            name: "l".into(),
            layers: (0..layers)
                .map(|i| {
                    Layer::new(
                        format!("y{i}"),
                        format!("y{i}"),
                        "iso",
                        0.0,
                        thickness_per_layer,
                    )
                })
                .collect(),
            symmetric: false,
            with_middle_layer: false,
            invert_z: false,
            offset: 0.0,
        };
        CltLaminate::new(&laminate, &materials).unwrap()
    }

    /// Closed-form buckling of a simply supported isotropic plate under
    /// uniaxial compression: N_crit = k * pi^2 * D / b^2 with
    /// k = (m*b/a + a/(m*b))^2. This is the textbook check the Ritz solution
    /// has to reproduce, and it is independent of the Java implementation.
    #[test]
    fn square_simply_supported_isotropic_plate_matches_closed_form() {
        let t_layer = 0.25;
        let layers = 8;
        let t = t_layer * layers as f64;
        let plate = isotropic_plate(t_layer, layers);

        let e = 70_000.0;
        let nu = 0.3;
        let d_iso = e * t.powi(3) / (12.0 * (1.0 - nu * nu));

        let a = 400.0;
        let b = 400.0;
        let input = BucklingInput {
            length: a,
            width: b,
            // Compression is negative in this sign convention: the load factor
            // has to come out positive for a compressive load.
            n_x: -1.0,
            n_y: 0.0,
            n_xy: 0.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 8,
            n: 8,
            d_matrix: DMatrixKind::Standard,
        };
        let result = calculate(&plate, &input).unwrap();
        let factor = result.critical_factor.expect("plate should buckle");

        // Square plate: k = 4 for the first mode.
        let expected = 4.0 * std::f64::consts::PI.powi(2) * d_iso / (b * b);
        let got = factor; // load flow was 1.0, so factor IS the critical flow
        assert!(
            (got - expected).abs() / expected < 5e-3,
            "critical load {got} vs closed form {expected}"
        );
    }

    #[test]
    fn longer_plate_buckles_into_more_half_waves() {
        // a/b = 2 is the classic case where two half-waves in x beat one, and
        // k returns to 4. Same critical load as the square plate.
        let t_layer = 0.25;
        let layers = 8;
        let t = t_layer * layers as f64;
        let plate = isotropic_plate(t_layer, layers);
        let d_iso = 70_000.0 * t.powi(3) / (12.0 * (1.0 - 0.3 * 0.3));

        let b = 300.0;
        let input = BucklingInput {
            length: 2.0 * b,
            width: b,
            n_x: -1.0,
            n_y: 0.0,
            n_xy: 0.0,
            bc_x: BoundaryCondition::SimplySimply,
            bc_y: BoundaryCondition::SimplySimply,
            m: 8,
            n: 8,
            d_matrix: DMatrixKind::Standard,
        };
        let factor = calculate(&plate, &input).unwrap().critical_factor.unwrap();
        let expected = 4.0 * std::f64::consts::PI.powi(2) * d_iso / (b * b);
        assert!(
            (factor - expected).abs() / expected < 5e-3,
            "{factor} vs {expected}"
        );
    }

    #[test]
    fn clamped_edges_carry_more_load_than_simply_supported() {
        let plate = isotropic_plate(0.25, 8);
        let base = BucklingInput {
            length: 400.0,
            width: 400.0,
            n_x: -1.0,
            m: 8,
            n: 8,
            ..Default::default()
        };
        let ss = calculate(&plate, &base).unwrap().critical_factor.unwrap();
        let clamped = calculate(
            &plate,
            &BucklingInput {
                bc_x: BoundaryCondition::ClampedClamped,
                bc_y: BoundaryCondition::ClampedClamped,
                ..base
            },
        )
        .unwrap()
        .critical_factor
        .unwrap();
        assert!(
            clamped > ss * 2.0,
            "clamped {clamped} should be far above simply supported {ss}"
        );
    }

    #[test]
    fn tension_does_not_buckle_the_plate() {
        // Pure tension: every eigenvalue that would scale it into buckling is
        // negative, so there is no positive critical factor.
        let plate = isotropic_plate(0.25, 8);
        let result = calculate(
            &plate,
            &BucklingInput {
                length: 400.0,
                width: 400.0,
                n_x: 1.0,
                m: 6,
                n: 6,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(
            result.critical_factor.is_none() || result.critical_factor.unwrap() > 1e6,
            "tension gave critical factor {:?}",
            result.critical_factor
        );
    }

    #[test]
    fn load_factor_scales_inversely_with_applied_load() {
        let plate = isotropic_plate(0.25, 8);
        let base = BucklingInput {
            length: 400.0,
            width: 400.0,
            n_x: -1.0,
            m: 6,
            n: 6,
            ..Default::default()
        };
        let f1 = calculate(&plate, &base).unwrap().critical_factor.unwrap();
        let f2 = calculate(&plate, &BucklingInput { n_x: -2.0, ..base })
            .unwrap()
            .critical_factor
            .unwrap();
        assert!((f1 / f2 - 2.0).abs() < 1e-6, "{f1} vs {f2}");
    }

    #[test]
    fn refining_the_ritz_series_converges_from_above() {
        // More terms can only lower the computed load - the Ritz method is an
        // upper bound on the true buckling load.
        let plate = isotropic_plate(0.25, 8);
        let base = BucklingInput {
            length: 500.0,
            width: 300.0,
            n_x: -1.0,
            bc_x: BoundaryCondition::ClampedClamped,
            bc_y: BoundaryCondition::SimplySimply,
            ..Default::default()
        };
        let coarse = calculate(&plate, &BucklingInput { m: 4, n: 4, ..base })
            .unwrap()
            .critical_factor
            .unwrap();
        let fine = calculate(&plate, &BucklingInput { m: 10, n: 10, ..base })
            .unwrap()
            .critical_factor
            .unwrap();
        assert!(fine <= coarse * (1.0 + 1e-9), "fine {fine} exceeded coarse {coarse}");
        assert!((fine - coarse).abs() / fine < 0.1, "suspiciously far apart");
    }

    #[test]
    fn rejects_degenerate_input() {
        let plate = isotropic_plate(0.25, 8);
        assert!(matches!(
            calculate(&plate, &BucklingInput { m: 0, ..Default::default() }),
            Err(BucklingError::TermCountOutOfRange { .. })
        ));
        assert!(matches!(
            calculate(&plate, &BucklingInput { m: 21, ..Default::default() }),
            Err(BucklingError::TermCountOutOfRange { .. })
        ));
        assert!(matches!(
            calculate(&plate, &BucklingInput { length: 0.0, ..Default::default() }),
            Err(BucklingError::NonPositiveDimensions { .. })
        ));
        assert!(matches!(
            calculate(
                &plate,
                &BucklingInput { n_x: 0.0, n_y: 0.0, n_xy: 0.0, ..Default::default() }
            ),
            Err(BucklingError::NoLoad)
        ));
    }

    #[test]
    fn mode_surface_respects_the_edge_conditions() {
        let plate = isotropic_plate(0.25, 8);
        let input = BucklingInput {
            length: 400.0,
            width: 400.0,
            n_x: -1.0,
            m: 6,
            n: 6,
            ..Default::default()
        };
        let result = calculate(&plate, &input).unwrap();
        let critical = result
            .modes
            .iter()
            .find(|m| m.eigenvalue >= 0.0)
            .expect("a positive mode");
        let surface = mode_surface(&critical.shape, &input, 21, 21);

        assert_eq!(surface.len(), 21);
        assert_eq!(surface[0].len(), 21);
        // Simply supported all round: zero deflection along every edge.
        for s in 0..21 {
            assert!(surface[0][s].abs() < 1e-6, "top edge at {s}");
            assert!(surface[20][s].abs() < 1e-6, "bottom edge at {s}");
            assert!(surface[s][0].abs() < 1e-6, "left edge at {s}");
            assert!(surface[s][20].abs() < 1e-6, "right edge at {s}");
        }
        // Normalised to a peak of exactly 1, and the first mode has a single
        // bulge, so the centre is where that peak sits.
        assert!((surface[10][10].abs() - 1.0).abs() < 1e-6);
    }
}
