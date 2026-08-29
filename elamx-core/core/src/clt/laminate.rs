//! Laminate-level ABD-matrix assembly.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/CLT_Laminate.java

use super::layer::CltLayer;
use crate::mathtools::{self, Matrix};
use crate::model::{Laminate, Material};
use std::collections::HashMap;

const EPS: f64 = 1e-12;

/// Assembled ABD stiffness matrix and derived engineering constants for a
/// fully resolved laminate stack. Built once from a [`Laminate`] and its
/// material catalog; a snapshot, independent of both afterwards (this module
/// is a stateless calculation engine, not a live, listener-driven object graph).
#[derive(Debug, Clone)]
pub struct CltLaminate {
    a: Matrix,
    b: Matrix,
    d: Matrix,
    abd: Matrix,
    abd_inv: Matrix,
    tges: f64,
    is_symmetric: bool,
    beta_d: f64,
    nu_d: f64,
    gamma_d: f64,
    delta_d: f64,
    layers: Vec<CltLayer>,
}

/// Mass moments of inertia (only meaningful for symmetric laminates, matching
/// the Java original's restriction).
#[derive(Debug, Clone, Copy)]
pub struct MassMoments {
    pub i0: f64,
    pub i1: f64,
    pub i2: f64,
}

/// One layer's contribution to the assembled A/B/D matrices - i.e. the exact
/// per-layer terms that get summed in [`CltLaminate::new`], surfaced so a UI
/// can show *how* the laminate stiffness is built up ply by ply instead of
/// only the final sum.
#[derive(Debug, Clone)]
pub struct LayerContribution {
    pub layer_number: usize,
    pub angle_deg: f64,
    pub thickness: f64,
    pub zm: f64,
    /// Material and failure criterion of this ply, so a consumer can look up
    /// what the ply is made of without re-deriving the symmetry expansion -
    /// the expanded stack exists only in here.
    pub material_id: String,
    pub criterion_id: Option<String>,
    pub q_global: Matrix,
    pub a_contribution: Matrix,
    pub b_contribution: Matrix,
    pub d_contribution: Matrix,
}

/// A single layer's `Qglo*t`-derived contribution to the A/B/D matrices.
/// Shared by [`CltLaminate::new`] (which sums these) and
/// [`CltLaminate::layer_contributions`] (which reports them individually), so
/// the underlying formula exists in exactly one place.
fn layer_abd_contribution(q_global: &Matrix, thickness: f64, zm: f64) -> (Matrix, Matrix, Matrix) {
    let mut a = vec![vec![0.0; 3]; 3];
    let mut b = vec![vec![0.0; 3]; 3];
    let mut d = vec![vec![0.0; 3]; 3];
    for m in 0..3 {
        for n in 0..3 {
            let temp = q_global[m][n] * thickness;
            a[m][n] = temp;
            b[m][n] = temp * zm;
            d[m][n] = temp * (thickness * thickness / 12.0 + zm * zm);
        }
    }
    (a, b, d)
}

/// A layer referenced a material id that isn't present in the material
/// catalog passed to [`CltLaminate::new`]. Reported as an error rather than a
/// panic since the laminate and material catalog can both come from untrusted
/// external input (e.g. the WASM/JSON boundary), not just from code that
/// already guarantees consistency between the two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingMaterialError(pub String);

impl std::fmt::Display for MissingMaterialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "material '{}' not found", self.0)
    }
}

impl std::error::Error for MissingMaterialError {}

impl CltLaminate {
    /// Builds the ABD matrix from the laminate's fully expanded stacking
    /// sequence ([`Laminate::all_layers`]). `materials` must contain every
    /// material referenced by the laminate's layers, keyed by material id.
    pub fn new(
        laminate: &Laminate,
        materials: &HashMap<String, Material>,
    ) -> Result<Self, MissingMaterialError> {
        let resolved = laminate.all_layers();
        let mut layers: Vec<CltLayer> = resolved
            .iter()
            .map(|r| {
                let material = materials
                    .get(r.material_id)
                    .ok_or_else(|| MissingMaterialError(r.material_id.to_string()))?;
                Ok(CltLayer::new(
                    r.angle,
                    r.thickness,
                    material,
                    r.criterion_id.map(str::to_string),
                ))
            })
            .collect::<Result<Vec<_>, MissingMaterialError>>()?;

        // Layer 0 sits at +tges/2 (plus any reference-plane offset); each
        // subsequent layer's mid-plane is stacked downward from there.
        let tges: f64 = layers.iter().map(|l| l.thickness).sum();
        let mut zold = tges / 2.0 + laminate.offset;
        for (i, layer) in layers.iter_mut().enumerate() {
            let t = layer.thickness;
            layer.zm = zold - t / 2.0;
            layer.number = resolved[i].number;
            layer.embedded = resolved[i].embedded;
            zold -= t;
        }

        let mut a = vec![vec![0.0; 3]; 3];
        let mut b = vec![vec![0.0; 3]; 3];
        let mut d = vec![vec![0.0; 3]; 3];
        for layer in &layers {
            let q_glo = layer.q_matrix_global();
            let (a_i, b_i, d_i) = layer_abd_contribution(&q_glo, layer.thickness, layer.zm);
            for m in 0..3 {
                for n in 0..3 {
                    a[m][n] += a_i[m][n];
                    b[m][n] += b_i[m][n];
                    d[m][n] += d_i[m][n];
                }
            }
        }

        // The B-matrix vanishes (up to numerical noise) for a physically
        // symmetric laminate, even if the stored layer list itself isn't
        // symmetric (e.g. two 0.5mm layers behave like one 1mm layer).
        let mut a_max = 0.0_f64;
        let mut b_max = 0.0_f64;
        for m in 0..3 {
            for n in 0..=m {
                a_max = a_max.max(a[m][n].abs());
                b_max = b_max.max(b[m][n].abs());
            }
        }
        let is_symmetric = b_max < EPS * a_max;

        let mut abd = vec![vec![0.0; 6]; 6];
        for ii in 0..3 {
            for jj in 0..=ii {
                abd[ii][jj] = a[ii][jj];
            }
        }
        for (ii, row) in b.iter().enumerate() {
            abd[ii + 3][0..3].copy_from_slice(row);
        }
        for ii in 0..3 {
            for jj in 0..=ii {
                abd[ii + 3][jj + 3] = d[ii][jj];
            }
        }
        for ii in 0..6 {
            for jj in (ii + 1)..6 {
                abd[ii][jj] = abd[jj][ii];
            }
        }

        let abd_inv = mathtools::get_inverse(&abd);

        let beta_d = (d[0][1] + 2.0 * d[2][2]) / (d[0][0] * d[1][1]).sqrt();
        let nu_d = d[0][1] / (d[0][0] * d[1][1]).sqrt();
        let gamma_d = d[0][2] / (d[0][0].powi(3) * d[1][1]).powf(0.25);
        let delta_d = d[1][2] / (d[0][0] * d[1][1].powi(3)).powf(0.25);

        Ok(CltLaminate {
            a,
            b,
            d,
            abd,
            abd_inv,
            tges,
            is_symmetric,
            beta_d,
            nu_d,
            gamma_d,
            delta_d,
            layers,
        })
    }

    pub fn layers(&self) -> &[CltLayer] {
        &self.layers
    }

    pub fn a_matrix(&self) -> &Matrix {
        &self.a
    }
    pub fn b_matrix(&self) -> &Matrix {
        &self.b
    }
    pub fn d_matrix(&self) -> &Matrix {
        &self.d
    }
    pub fn abd_matrix(&self) -> &Matrix {
        &self.abd
    }
    pub fn abd_inv_matrix(&self) -> &Matrix {
        &self.abd_inv
    }

    /// Whether the B-matrix vanishes numerically, i.e. whether the laminate
    /// *behaves* symmetrically - independent of [`Laminate::symmetric`], which
    /// only reflects the user's declared stacking intent.
    pub fn is_symmetric(&self) -> bool {
        self.is_symmetric
    }
    pub fn tges(&self) -> f64 {
        self.tges
    }
    pub fn beta_d(&self) -> f64 {
        self.beta_d
    }
    pub fn nu_d(&self) -> f64 {
        self.nu_d
    }
    pub fn gamma_d(&self) -> f64 {
        self.gamma_d
    }
    pub fn delta_d(&self) -> f64 {
        self.delta_d
    }

    /// Total area weight (mass per unit area) of the fully expanded stack.
    /// Equal to `Laminate::area_weight` for the same laminate/materials, since
    /// the expanded stack already contains each physical layer instance once.
    pub fn area_weight(&self) -> f64 {
        self.layers.iter().map(|l| l.rho * l.thickness).sum()
    }

    /// Top-left 3x3 block of the inverse ABD matrix (compliance for in-plane loads).
    pub fn a_inv_block(&self) -> Matrix {
        self.abd_inv[0..3]
            .iter()
            .map(|row| row[0..3].to_vec())
            .collect()
    }

    /// Top-right 3x3 block of the inverse ABD matrix (extension/bending coupling compliance).
    pub fn b_inv_block(&self) -> Matrix {
        self.abd_inv[0..3]
            .iter()
            .map(|row| row[3..6].to_vec())
            .collect()
    }

    /// Bottom-right 3x3 block of the inverse ABD matrix (compliance for bending loads).
    pub fn d_inv_block(&self) -> Matrix {
        self.abd_inv[3..6]
            .iter()
            .map(|row| row[3..6].to_vec())
            .collect()
    }

    // --- Engineering constants (see CLT_Laminate.java for the physical background) ---

    /// Extensional modulus E_x, without Poisson restraint.
    pub fn ex_simple(&self) -> f64 {
        1.0 / (self.abd_inv[0][0] * self.tges)
    }
    /// Extensional modulus E_y, without Poisson restraint.
    pub fn ey_simple(&self) -> f64 {
        1.0 / (self.abd_inv[1][1] * self.tges)
    }
    pub fn nuxy_simple(&self) -> f64 {
        -self.abd_inv[0][1] / self.abd_inv[0][0]
    }
    pub fn nuyx_simple(&self) -> f64 {
        -self.abd_inv[0][1] / self.abd_inv[1][1]
    }
    /// Shear modulus, without Poisson restraint.
    pub fn g_simple(&self) -> f64 {
        1.0 / (self.abd_inv[2][2] * self.tges)
    }

    /// Extensional modulus E_x, with Poisson restraint.
    pub fn ex_fixed(&self) -> f64 {
        self.a[0][0] / self.tges
    }
    /// Extensional modulus E_y, with Poisson restraint.
    pub fn ey_fixed(&self) -> f64 {
        self.a[1][1] / self.tges
    }
    pub fn nuxy_fixed(&self) -> f64 {
        -self.a[0][0] / self.a[0][1]
    }
    pub fn nuyx_fixed(&self) -> f64 {
        -self.a[0][0] / self.a[1][1]
    }
    /// Shear modulus, with Poisson restraint.
    pub fn g_fixed(&self) -> f64 {
        self.a[2][2] / self.tges
    }

    /// Bending modulus E_x, without Poisson restraint.
    pub fn ex_bend_simple(&self) -> f64 {
        12.0 / self.abd_inv[3][3] / self.tges.powi(3)
    }
    /// Bending modulus E_y, without Poisson restraint.
    pub fn ey_bend_simple(&self) -> f64 {
        12.0 / self.abd_inv[4][4] / self.tges.powi(3)
    }
    /// Bending shear modulus, without Poisson restraint.
    pub fn g_bend_simple(&self) -> f64 {
        12.0 / self.abd_inv[5][5] / self.tges.powi(3)
    }
    pub fn nuxy_bend_simple(&self) -> f64 {
        -self.abd_inv[3][4] / self.abd_inv[3][3]
    }
    pub fn nuyx_bend_simple(&self) -> f64 {
        -self.abd_inv[3][4] / self.abd_inv[4][4]
    }

    /// Bending modulus E_x, with Poisson restraint.
    pub fn ex_bend_fixed(&self) -> f64 {
        12.0 * self.d[0][0] / self.tges.powi(3)
    }
    /// Bending modulus E_y, with Poisson restraint.
    pub fn ey_bend_fixed(&self) -> f64 {
        12.0 * self.d[1][1] / self.tges.powi(3)
    }
    /// Bending shear modulus, with Poisson restraint.
    pub fn g_bend_fixed(&self) -> f64 {
        12.0 * self.d[2][2] / self.tges.powi(3)
    }
    pub fn nuxy_bend_fixed(&self) -> f64 {
        -self.d[0][1] / self.d[0][0]
    }
    pub fn nuyx_bend_fixed(&self) -> f64 {
        -self.d[0][1] / self.d[1][1]
    }

    /// "Normalized off-axis flexural moduli", Tsai & Hahn (1980), eq. (5.49).
    pub fn normalized_off_axis_flexural_moduli(&self) -> Matrix {
        let n = self.layers.len();
        let nt = (n * n * n) as f64;
        let halb = n / 2 + n % 2;

        let mut d_norm = vec![vec![0.0; 3]; 3];
        for i in 0..3 {
            for j in i..3 {
                let mut acc = 0.0;
                for (t, layer) in self.layers.iter().enumerate().take(halb) {
                    let ht = (halb - t) as f64;
                    let htmo = ht - 1.0;
                    acc += layer.q_matrix_global()[i][j] * (ht.powi(3) - htmo.powi(3));
                }
                d_norm[i][j] = 8.0 * acc / nt;
            }
        }
        d_norm[1][0] = d_norm[0][1];
        d_norm[2][0] = d_norm[0][2];
        d_norm[2][1] = d_norm[1][2];
        d_norm
    }

    /// Per-layer breakdown of the A/B/D matrix build-up, in stacking order.
    /// Summing each field across the returned vector reproduces
    /// [`CltLaminate::a_matrix`]/[`b_matrix`](CltLaminate::b_matrix)/[`d_matrix`](CltLaminate::d_matrix).
    pub fn layer_contributions(&self) -> Vec<LayerContribution> {
        self.layers
            .iter()
            .map(|layer| {
                let q_global = layer.q_matrix_global();
                let (a_contribution, b_contribution, d_contribution) =
                    layer_abd_contribution(&q_global, layer.thickness, layer.zm);
                LayerContribution {
                    layer_number: layer.number,
                    angle_deg: layer.angle_deg,
                    thickness: layer.thickness,
                    zm: layer.zm,
                    material_id: layer.material_id().to_string(),
                    criterion_id: layer.criterion_id().map(str::to_string),
                    q_global,
                    a_contribution,
                    b_contribution,
                    d_contribution,
                }
            })
            .collect()
    }

    /// Mass moments of inertia, only defined for symmetric laminates (matches
    /// the Java original, which returns `null` otherwise).
    pub fn mass_moments(&self) -> Option<MassMoments> {
        if !self.is_symmetric {
            return None;
        }
        let mut i0 = 0.0;
        let mut i1 = 0.0;
        let mut i2 = 0.0;
        for layer in &self.layers {
            let t = layer.thickness;
            let zm = layer.zm;
            let temp = layer.rho * t;
            i0 += temp;
            i1 += temp * zm;
            i2 += temp * (t * t / 12.0 + zm * zm);
        }
        Some(MassMoments { i0, i1, i2 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Layer;

    fn material(id: &str) -> Material {
        Material::new(id, "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9)
    }

    fn materials_map() -> HashMap<String, Material> {
        let mut m = HashMap::new();
        m.insert("mat".to_string(), material("mat"));
        m
    }

    #[test]
    fn balanced_cross_ply_has_equal_ax_and_ay() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "90", "mat", 90.0, 0.2));
        let clt = CltLaminate::new(&lam, &materials_map()).unwrap();
        assert!((clt.a_matrix()[0][0] - clt.a_matrix()[1][1]).abs() < 1e-6);
    }

    #[test]
    fn symmetric_layup_has_vanishing_b_matrix_and_matches_thickness() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "45", "mat", 45.0, 0.1));
        lam.layers.push(Layer::new("l2", "90", "mat", 90.0, 0.15));
        lam.symmetric = true;

        let clt = CltLaminate::new(&lam, &materials_map()).unwrap();
        assert!(clt.is_symmetric());
        assert!((clt.tges() - lam.thickness()).abs() < 1e-12);
    }

    #[test]
    fn abd_times_its_inverse_is_identity() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "30", "mat", 30.0, 0.15));
        lam.layers.push(Layer::new("l2", "-30", "mat", -30.0, 0.15));
        let clt = CltLaminate::new(&lam, &materials_map()).unwrap();

        let product = mathtools::mat_mult(clt.abd_matrix(), clt.abd_inv_matrix());
        for i in 0..6 {
            for j in 0..6 {
                let expected = if i == j { 1.0 } else { 0.0 };
                assert!((product[i][j] - expected).abs() < 1e-6);
            }
        }
    }

    #[test]
    fn clt_area_weight_matches_model_area_weight() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "45", "mat", 45.0, 0.1));
        lam.layers.push(Layer::new("l2", "90", "mat", 90.0, 0.15));
        lam.symmetric = true;
        lam.with_middle_layer = true;

        let materials = materials_map();
        let clt = CltLaminate::new(&lam, &materials).unwrap();
        assert!((clt.area_weight() - lam.area_weight(&materials)).abs() < 1e-15);
    }

    #[test]
    fn non_symmetric_layup_is_not_symmetric() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "90", "mat", 90.0, 0.4));
        let clt = CltLaminate::new(&lam, &materials_map()).unwrap();
        assert!(!clt.is_symmetric());
    }

    #[test]
    fn layer_contributions_sum_to_the_assembled_abd_matrices() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(Layer::new("l0", "0", "mat", 0.0, 0.2));
        lam.layers.push(Layer::new("l1", "45", "mat", 45.0, 0.15));
        lam.layers.push(Layer::new("l2", "-30", "mat", -30.0, 0.1));
        let clt = CltLaminate::new(&lam, &materials_map()).unwrap();

        let contributions = clt.layer_contributions();
        assert_eq!(contributions.len(), 3);
        assert_eq!(
            contributions.iter().map(|c| c.layer_number).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let mut summed_a = vec![vec![0.0; 3]; 3];
        let mut summed_b = vec![vec![0.0; 3]; 3];
        let mut summed_d = vec![vec![0.0; 3]; 3];
        for c in &contributions {
            for m in 0..3 {
                for n in 0..3 {
                    summed_a[m][n] += c.a_contribution[m][n];
                    summed_b[m][n] += c.b_contribution[m][n];
                    summed_d[m][n] += c.d_contribution[m][n];
                }
            }
        }

        for m in 0..3 {
            for n in 0..3 {
                assert!((summed_a[m][n] - clt.a_matrix()[m][n]).abs() < 1e-9);
                assert!((summed_b[m][n] - clt.b_matrix()[m][n]).abs() < 1e-9);
                assert!((summed_d[m][n] - clt.d_matrix()[m][n]).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn missing_material_is_an_error_not_a_panic() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers
            .push(Layer::new("l0", "0", "unknown-material", 0.0, 0.2));
        let result = CltLaminate::new(&lam, &materials_map());
        assert_eq!(
            result.unwrap_err(),
            MissingMaterialError("unknown-material".to_string())
        );
    }
}
