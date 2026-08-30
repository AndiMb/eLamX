//! The Ritz machinery every rectangular-plate analysis shares: the stiffness
//! matrix built from the plate's bending stiffness, and the evaluation of a
//! coefficient grid back into a displacement field.
//!
//! Buckling and deformation differ only in what they put beside this - a
//! geometric stiffness matrix and an eigenvalue problem in one case, a load
//! vector and a linear solve in the other. Vibration will add a mass matrix
//! and take the same road.

use super::boundary::Boundary;

/// Assembles the Ritz stiffness matrix from the plate's bending stiffness.
///
/// Port of Mechanical/Plate.java `addStiffness`. The index pair (pp, qq) walks
/// the variation and (ii, jj) the displacement; both flatten to `row * n + col`.
pub fn add_plate_stiffness(
    k: &mut [Vec<f64>],
    d: &[[f64; 3]; 3],
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

/// How a sampled displacement field is scaled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceScale {
    /// Divide by the peak magnitude. For a buckling mode, which has no
    /// amplitude of its own - only a shape.
    Normalised,
    /// Leave the values as they are. For a deformation, where the amplitude
    /// IS the answer.
    Absolute,
}

/// Evaluates a Ritz coefficient grid into a displacement field on a regular
/// grid over the plate. Rows run along y, columns along x.
///
/// `coefficients[i][j]` belongs to the shape-function pair (i in x, j in y),
/// which is the layout both the eigenvector reshaping and the linear solve
/// produce.
// Same as add_geometric_stiffness: the arguments are the plate, its edges and
// the sampling resolution, and a struct for them would be a struct with one
// call site.
#[allow(clippy::too_many_arguments)]
pub fn surface(
    coefficients: &[Vec<f64>],
    length: f64,
    width: f64,
    bx: &Boundary,
    by: &Boundary,
    nx_samples: usize,
    ny_samples: usize,
    scale: SurfaceScale,
) -> Vec<Vec<f64>> {
    let m = coefficients.len();
    let n = coefficients.first().map_or(0, |row| row.len());

    // Precompute each shape function at every sample station: without this the
    // sinh/cosh calls dominate, being evaluated m*n times per grid point.
    let xs: Vec<Vec<f64>> = (0..m)
        .map(|i| {
            (0..nx_samples)
                .map(|s| bx.wx(i, length * s as f64 / (nx_samples - 1).max(1) as f64))
                .collect()
        })
        .collect();
    let ys: Vec<Vec<f64>> = (0..n)
        .map(|j| {
            (0..ny_samples)
                .map(|s| by.wx(j, width * s as f64 / (ny_samples - 1).max(1) as f64))
                .collect()
        })
        .collect();

    let mut field = vec![vec![0.0f64; nx_samples]; ny_samples];
    for (i, xrow) in xs.iter().enumerate() {
        for (j, yrow) in ys.iter().enumerate() {
            let a = coefficients[i][j];
            if a == 0.0 {
                continue;
            }
            for (sy, &yv) in yrow.iter().enumerate() {
                let ay = a * yv;
                for (sx, &xv) in xrow.iter().enumerate() {
                    field[sy][sx] += ay * xv;
                }
            }
        }
    }

    if scale == SurfaceScale::Normalised {
        let peak = field
            .iter()
            .flat_map(|r| r.iter())
            .fold(0.0f64, |acc, v| acc.max(v.abs()));
        if peak > 0.0 {
            for row in field.iter_mut() {
                for v in row.iter_mut() {
                    *v /= peak;
                }
            }
        }
    }

    field
}
