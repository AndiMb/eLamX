//! Per-layer stiffness and stress/strain computation.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory/src/de/elamx/clt/CLT_Layer.java

use crate::mathtools::{self, Matrix};
use crate::model::{Material, StressStrainState};
use serde::{Deserialize, Serialize};

/// Where within a layer's thickness a stress/strain state is evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub enum LayerPosition {
    Upper,
    Lower,
    Middle,
}

/// A single ply's stiffness and thermal/moisture properties, prepared for CLT
/// assembly. Unlike the Java `CLT_Layer`, this holds a snapshot of the values
/// it needs rather than a live reference to `Layer`/`Material` - this module is
/// a stateless calculation engine, not a live, listener-driven object graph.
#[derive(Debug, Clone)]
pub struct CltLayer {
    pub angle_deg: f64,
    pub thickness: f64,
    /// z-coordinate of this layer's mid-plane, set once the full laminate stack is known.
    pub zm: f64,
    pub rho: f64,
    /// Stacking-order position (1-based), set once the full laminate stack is
    /// known - matches `Layer.getNumber()` in the Java original.
    pub number: usize,
    /// Whether this ply is sandwiched between others rather than sitting at a
    /// free surface, set once the full laminate stack is known. Used by some
    /// failure criteria (e.g. `Sun`) to raise the in-situ strength.
    pub embedded: bool,
    material_id: String,
    criterion_id: Option<String>,
    q_local: Matrix,
    alpha_t_par: f64,
    alpha_t_nor: f64,
    beta_par: f64,
    beta_nor: f64,
}

impl CltLayer {
    pub fn new(
        angle_deg: f64,
        thickness: f64,
        material: &Material,
        criterion_id: Option<String>,
    ) -> Self {
        let nu21 = material.nue21();
        let temp = 1.0 / (1.0 - material.nue12 * nu21);
        let mut q_local = vec![vec![0.0; 3]; 3];
        q_local[0][0] = temp * material.e_par;
        q_local[0][1] = temp * material.e_par * nu21;
        q_local[1][0] = q_local[0][1];
        q_local[1][1] = temp * material.e_nor;
        q_local[2][2] = material.g;

        CltLayer {
            angle_deg,
            thickness,
            zm: 0.0,
            rho: material.rho,
            number: 0,
            embedded: false,
            material_id: material.id.clone(),
            criterion_id,
            q_local,
            alpha_t_par: material.alpha_t_par,
            alpha_t_nor: material.alpha_t_nor,
            beta_par: material.beta_par,
            beta_nor: material.beta_nor,
        }
    }

    pub fn material_id(&self) -> &str {
        &self.material_id
    }
    pub fn criterion_id(&self) -> Option<&str> {
        self.criterion_id.as_deref()
    }
    pub fn alpha_t_par(&self) -> f64 {
        self.alpha_t_par
    }
    pub fn alpha_t_nor(&self) -> f64 {
        self.alpha_t_nor
    }
    pub fn beta_par(&self) -> f64 {
        self.beta_par
    }
    pub fn beta_nor(&self) -> f64 {
        self.beta_nor
    }

    /// Reduced stiffness matrix in the local (fibre-aligned) coordinate system.
    pub fn q_matrix_local(&self) -> &Matrix {
        &self.q_local
    }

    /// Reduced stiffness matrix in the global coordinate system (rotated by `angle_deg`).
    pub fn q_matrix_global(&self) -> Matrix {
        rotate_q(&self.q_local, self.angle_deg)
    }

    /// Reduced stiffness matrix in a coordinate system rotated `delta_angle_deg`
    /// beyond the layer's own angle.
    pub fn q_matrix_global_delta(&self, delta_angle_deg: f64) -> Matrix {
        rotate_q(&self.q_local, self.angle_deg + delta_angle_deg)
    }

    /// Compliance matrix in the local coordinate system.
    pub fn s_matrix_local(&self) -> Matrix {
        mathtools::get_inverse(&self.q_local)
    }

    /// Compliance matrix in the global coordinate system.
    pub fn s_matrix_global(&self) -> Matrix {
        mathtools::get_inverse(&self.q_matrix_global())
    }

    /// Stress/strain state at a given through-thickness position, given the
    /// laminate's mid-plane strains and curvatures `epskappa` (order: eps_x,
    /// eps_y, gamma_xy, kappa_x, kappa_y, kappa_xy). Returns the local state,
    /// and the global state if `calc_global` is set.
    pub fn stress_state(
        &self,
        epskappa: &[f64; 6],
        delta_temp: f64,
        delta_hygro: f64,
        position: LayerPosition,
        calc_global: bool,
    ) -> (StressStrainState, Option<StressStrainState>) {
        let pos = self.through_thickness_position(position);
        let strain_glo = [
            epskappa[0] + pos * epskappa[3],
            epskappa[1] + pos * epskappa[4],
            epskappa[2] + pos * epskappa[5],
        ];
        self.stress_strain_state(strain_glo, delta_temp, delta_hygro, calc_global)
    }

    /// Stress/strain state for the axisymmetric (pressure vessel) formulation,
    /// where the hoop strain is derived from `epskappa[1]` (a rotation-like
    /// quantity) and the mean radius instead of a linear through-thickness strain.
    pub fn stress_state_radial(
        &self,
        epskappa: &[f64; 6],
        delta_temp: f64,
        delta_hygro: f64,
        position: LayerPosition,
        mean_radius: f64,
        calc_global: bool,
    ) -> (StressStrainState, Option<StressStrainState>) {
        let w = epskappa[1] * mean_radius;
        let pos = self.through_thickness_position(position);
        let strain_glo = [epskappa[0], w / (mean_radius + pos), epskappa[2]];
        self.stress_strain_state(strain_glo, delta_temp, delta_hygro, calc_global)
    }

    fn through_thickness_position(&self, position: LayerPosition) -> f64 {
        match position {
            LayerPosition::Upper => self.zm + self.thickness / 2.0,
            LayerPosition::Lower => self.zm - self.thickness / 2.0,
            LayerPosition::Middle => self.zm,
        }
    }

    fn stress_strain_state(
        &self,
        strain_glo: [f64; 3],
        delta_temp: f64,
        delta_hygro: f64,
        calc_global: bool,
    ) -> (StressStrainState, Option<StressStrainState>) {
        let trans = mathtools::strain_transform_glo_to_loc(self.angle_deg.to_radians());
        let alpha = [self.alpha_t_par, self.alpha_t_nor, 0.0];
        let beta = [self.beta_par, self.beta_nor, 0.0];

        let mut strain_loc = [0.0; 3];
        for ii in 0..3 {
            let mut acc = 0.0;
            for jj in 0..3 {
                acc += trans[ii][jj] * strain_glo[jj];
            }
            strain_loc[ii] = acc;
        }

        let mut stress_loc = [0.0; 3];
        for ii in 0..3 {
            let mut acc = 0.0;
            for jj in 0..3 {
                acc += self.q_local[ii][jj]
                    * (strain_loc[jj] - alpha[jj] * delta_temp - beta[jj] * delta_hygro);
            }
            stress_loc[ii] = acc;
        }

        let local = StressStrainState {
            stress: stress_loc,
            strain: strain_loc,
        };

        if !calc_global {
            return (local, None);
        }

        let mut stress_glo = [0.0; 3];
        for ii in 0..3 {
            let mut acc = 0.0;
            for jj in 0..3 {
                acc += trans[jj][ii] * stress_loc[jj];
            }
            stress_glo[ii] = acc;
        }
        let global = StressStrainState {
            stress: stress_glo,
            strain: strain_glo,
        };

        (local, Some(global))
    }

}

fn rotate_q(q_local: &Matrix, angle_deg: f64) -> Matrix {
    let rad = angle_deg.to_radians();
    let c = rad.cos();
    let (c2, c3, c4) = (c * c, c * c * c, c * c * c * c);
    let s = rad.sin();
    let (s2, s3, s4) = (s * s, s * s * s, s * s * s * s);

    let mut q_glo = vec![vec![0.0; 3]; 3];
    q_glo[0][0] = c4 * q_local[0][0] + 2.0 * c2 * s2 * q_local[0][1] + s4 * q_local[1][1]
        + 4.0 * c2 * s2 * q_local[2][2];
    q_glo[0][1] = c2 * s2 * q_local[0][0] + (c4 + s4) * q_local[0][1] + c2 * s2 * q_local[1][1]
        - 4.0 * c2 * s2 * q_local[2][2];
    q_glo[0][2] = s * c3 * q_local[0][0]
        - c * s * (c2 - s2) * q_local[0][1]
        - c * s3 * q_local[1][1]
        - 2.0 * c * s * (c2 - s2) * q_local[2][2];
    q_glo[1][0] = q_glo[0][1];
    q_glo[1][1] = s4 * q_local[0][0] + 2.0 * c2 * s2 * q_local[0][1] + c4 * q_local[1][1]
        + 4.0 * c2 * s2 * q_local[2][2];
    q_glo[1][2] = c * s3 * q_local[0][0] + c * s * (c2 - s2) * q_local[0][1]
        - s * c3 * q_local[1][1]
        + 2.0 * c * s * (c2 - s2) * q_local[2][2];
    q_glo[2][0] = q_glo[0][2];
    q_glo[2][1] = q_glo[1][2];
    q_glo[2][2] = c2 * s2 * q_local[0][0] - 2.0 * c2 * s2 * q_local[0][1]
        + c2 * s2 * q_local[1][1]
        + (c2 - s2) * (c2 - s2) * q_local[2][2];

    q_glo
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mathtools::mat_vec_mult;
    use approx::assert_relative_eq;

    fn isotropic_ish(rho: f64) -> Material {
        let mut m = Material::new("m", "test", 100.0, 100.0, 0.3, 40.0, rho);
        m.alpha_t_par = 1.0e-6;
        m.alpha_t_nor = 2.0e-6;
        m
    }

    #[test]
    fn q_local_matches_known_formula() {
        let layer = CltLayer::new(0.0, 0.2, &isotropic_ish(1.0), None);
        let temp = 1.0 / (1.0 - 0.3 * 0.3);
        let q = layer.q_matrix_local();
        assert_relative_eq!(q[0][0], temp * 100.0, epsilon = 1e-9);
        assert_relative_eq!(q[0][1], temp * 100.0 * 0.3, epsilon = 1e-9);
        assert_relative_eq!(q[1][1], temp * 100.0, epsilon = 1e-9);
        assert_relative_eq!(q[2][2], 40.0, epsilon = 1e-9);
    }

    #[test]
    fn q_global_at_zero_degrees_matches_local() {
        let layer = CltLayer::new(0.0, 0.2, &isotropic_ish(1.0), None);
        let q_local = layer.q_matrix_local().clone();
        let q_glo = layer.q_matrix_global();
        for i in 0..3 {
            for j in 0..3 {
                assert_relative_eq!(q_glo[i][j], q_local[i][j], epsilon = 1e-9);
            }
        }
    }

    #[test]
    fn q_global_at_90_degrees_swaps_axes() {
        let layer = CltLayer::new(90.0, 0.2, &isotropic_ish(1.0), None);
        let q_local = layer.q_matrix_local().clone();
        let q_glo = layer.q_matrix_global();
        assert_relative_eq!(q_glo[0][0], q_local[1][1], epsilon = 1e-9);
        assert_relative_eq!(q_glo[1][1], q_local[0][0], epsilon = 1e-9);
        assert_relative_eq!(q_glo[2][2], q_local[2][2], epsilon = 1e-9);
    }

    #[test]
    fn s_matrix_local_is_inverse_of_q_matrix_local() {
        let layer = CltLayer::new(30.0, 0.2, &isotropic_ish(1.0), None);
        let q = layer.q_matrix_local();
        let s = layer.s_matrix_local();
        let product = crate::mathtools::mat_mult(q, &s);
        for i in 0..3 {
            for j in 0..3 {
                let expected = if i == j { 1.0 } else { 0.0 };
                assert_relative_eq!(product[i][j], expected, epsilon = 1e-9);
            }
        }
    }

    #[test]
    fn stress_state_at_zero_degrees_matches_direct_q_times_strain() {
        let layer = CltLayer::new(0.0, 0.2, &isotropic_ish(1.0), None);
        let epskappa = [0.001, -0.0005, 0.0002, 0.0, 0.0, 0.0];
        let (local, global) = layer.stress_state(&epskappa, 0.0, 0.0, LayerPosition::Middle, true);

        let expected_stress = mat_vec_mult(layer.q_matrix_local(), &epskappa[0..3]);
        for i in 0..3 {
            assert_relative_eq!(local.stress[i], expected_stress[i], epsilon = 1e-6);
        }
        // At 0 degrees, local == global.
        let global = global.unwrap();
        for i in 0..3 {
            assert_relative_eq!(global.stress[i], local.stress[i], epsilon = 1e-9);
            assert_relative_eq!(global.strain[i], local.strain[i], epsilon = 1e-9);
        }
    }

    #[test]
    fn stress_state_ignores_curvature_terms_when_curvature_is_zero() {
        let mut layer = CltLayer::new(15.0, 0.2, &isotropic_ish(1.0), None);
        layer.zm = 0.05;
        let epskappa = [0.001, -0.0005, 0.0002, 0.0, 0.0, 0.0];
        let (upper, _) = layer.stress_state(&epskappa, 0.0, 0.0, LayerPosition::Upper, false);
        let (middle, _) = layer.stress_state(&epskappa, 0.0, 0.0, LayerPosition::Middle, false);
        for i in 0..3 {
            assert_relative_eq!(upper.stress[i], middle.stress[i], epsilon = 1e-9);
        }
    }
}
