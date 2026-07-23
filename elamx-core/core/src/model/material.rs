//! Ply material properties. Reference: eLamX2/Laminate/src/de/elamx/laminate/{Material,DefaultMaterial}.java

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Ply material properties, corresponding to the Java `DefaultMaterial` (the only
/// concrete `Material` implementation in the original application).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    pub name: String,

    /// E-modulus parallel to the fibre direction.
    pub e_par: f64,
    /// E-modulus perpendicular to the fibre direction.
    pub e_nor: f64,
    /// Poisson's ratio nu12 (nu12 * e_nor = nu21 * e_par).
    pub nue12: f64,
    /// In-plane shear modulus.
    pub g: f64,
    /// Transverse shear modulus G13.
    pub g13: f64,
    /// Transverse shear modulus G23.
    pub g23: f64,
    /// Density.
    pub rho: f64,

    /// Thermal expansion coefficient parallel to the fibre direction.
    pub alpha_t_par: f64,
    /// Thermal expansion coefficient perpendicular to the fibre direction.
    pub alpha_t_nor: f64,
    /// Moisture expansion coefficient parallel to the fibre direction.
    pub beta_par: f64,
    /// Moisture expansion coefficient perpendicular to the fibre direction.
    pub beta_nor: f64,

    /// Tensile strength parallel to the fibre direction.
    pub r_par_ten: f64,
    /// Compressive strength parallel to the fibre direction (always >= 0, see `set_r_par_com`).
    pub r_par_com: f64,
    /// Tensile strength perpendicular to the fibre direction.
    pub r_nor_ten: f64,
    /// Compressive strength perpendicular to the fibre direction (always >= 0, see `set_r_nor_com`).
    pub r_nor_com: f64,
    /// Shear strength (always >= 0, see `set_r_shear`).
    pub r_shear: f64,

    /// Extra named values used by specific failure criteria (e.g. Puck's p_par_ten).
    pub additional_values: HashMap<String, f64>,
}

impl Material {
    /// Creates a material with the properties that were required by the Java
    /// constructor; all other properties default to 0.0.
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        e_par: f64,
        e_nor: f64,
        nue12: f64,
        g: f64,
        rho: f64,
    ) -> Self {
        Material {
            id: id.into(),
            name: name.into(),
            e_par,
            e_nor,
            nue12,
            g,
            rho,
            g13: 0.0,
            g23: 0.0,
            alpha_t_par: 0.0,
            alpha_t_nor: 0.0,
            beta_par: 0.0,
            beta_nor: 0.0,
            r_par_ten: 0.0,
            r_par_com: 0.0,
            r_nor_ten: 0.0,
            r_nor_com: 0.0,
            r_shear: 0.0,
            additional_values: HashMap::new(),
        }
    }

    /// Poisson's ratio nu21, derived from nu12 (nu12 * e_nor = nu21 * e_par).
    pub fn nue21(&self) -> f64 {
        self.nue12 * self.e_nor / self.e_par
    }

    /// Sets the parallel compressive strength, always stored as a positive magnitude.
    pub fn set_r_par_com(&mut self, value: f64) {
        self.r_par_com = value.abs();
    }

    /// Sets the perpendicular compressive strength, always stored as a positive magnitude.
    pub fn set_r_nor_com(&mut self, value: f64) {
        self.r_nor_com = value.abs();
    }

    /// Sets the shear strength, always stored as a positive magnitude.
    pub fn set_r_shear(&mut self, value: f64) {
        self.r_shear = value.abs();
    }

    /// Value-equality of two materials: same properties, independent of `id`.
    /// Matches the Java `isEqual`, which deliberately does not compare uid/name identity.
    #[allow(clippy::float_cmp)]
    pub fn is_equal(&self, other: &Material) -> bool {
        self.name == other.name
            && self.e_par == other.e_par
            && self.e_nor == other.e_nor
            && self.nue12 == other.nue12
            && self.g == other.g
            && self.g13 == other.g13
            && self.g23 == other.g23
            && self.rho == other.rho
            && self.r_par_ten == other.r_par_ten
            && self.r_par_com == other.r_par_com
            && self.r_nor_ten == other.r_nor_ten
            && self.r_nor_com == other.r_nor_com
            && self.r_shear == other.r_shear
            && self.alpha_t_nor == other.alpha_t_nor
            && self.alpha_t_par == other.alpha_t_par
            && self.beta_nor == other.beta_nor
            && self.beta_par == other.beta_par
            && self.additional_values == other.additional_values
    }

    /// A copy of this material with a freshly generated id, matching the Java
    /// `getCopy()` semantics: a distinct entity, not merely an equal-valued one.
    pub fn duplicate(&self) -> Material {
        let mut copy = self.clone();
        copy.id = Uuid::new_v4().to_string();
        copy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Material {
        let mut m = Material::new("id-1", "UD-CFK", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9);
        m.set_r_par_com(-1200.0);
        m
    }

    #[test]
    fn nue21_derived_from_nue12() {
        let m = sample();
        assert!((m.nue21() - (0.3 * 10000.0 / 140000.0)).abs() < 1e-12);
    }

    #[test]
    fn compressive_and_shear_strengths_are_always_positive() {
        let mut m = sample();
        assert_eq!(m.r_par_com, 1200.0);
        m.set_r_nor_com(-50.0);
        m.set_r_shear(-30.0);
        assert_eq!(m.r_nor_com, 50.0);
        assert_eq!(m.r_shear, 30.0);
    }

    #[test]
    fn duplicate_has_new_id_but_equal_properties() {
        let m = sample();
        let copy = m.duplicate();
        assert_ne!(m.id, copy.id);
        assert!(m.is_equal(&copy));
    }

    #[test]
    fn is_equal_ignores_id_but_not_properties() {
        let mut a = sample();
        a.id = "a".into();
        let mut b = sample();
        b.id = "b".into();
        assert!(a.is_equal(&b));

        b.e_par = 999.0;
        assert!(!a.is_equal(&b));
    }
}
