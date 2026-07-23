//! A single ply within a laminate. Reference: eLamX2/Laminate/src/de/elamx/laminate/{Layer,DataLayer}.java

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single ply. `angle` is kept private so it can only be set through
/// [`Layer::new`]/[`Layer::set_angle`], which normalize it to -90..=90 degrees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub name: String,
    #[serde(deserialize_with = "deserialize_normalized_angle")]
    angle: f64,
    pub thickness: f64,
    pub material_id: String,
    /// Id of the failure criterion assigned to this layer, if any. The failure
    /// criterion registry itself is not ported yet (see the `failure` module) -
    /// the Java original falls back to a default Puck criterion here, which is
    /// deferred until that module exists.
    pub criterion_id: Option<String>,
}

impl Layer {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        material_id: impl Into<String>,
        angle: f64,
        thickness: f64,
    ) -> Self {
        Layer {
            id: id.into(),
            name: name.into(),
            angle: reduce_angle(angle),
            thickness,
            material_id: material_id.into(),
            criterion_id: None,
        }
    }

    /// Ply angle in degrees, always normalized to the range -90..=90.
    pub fn angle(&self) -> f64 {
        self.angle
    }

    /// Sets the ply angle, normalizing it to the range -90..=90 (e.g. 100 -> -80).
    pub fn set_angle(&mut self, angle: f64) {
        self.angle = reduce_angle(angle);
    }

    /// Ply angle in radians.
    pub fn rad_angle(&self) -> f64 {
        self.angle.to_radians()
    }

    /// A copy of this layer with a freshly generated id, matching the Java
    /// `DataLayer.getCopy()` semantics.
    pub fn duplicate(&self) -> Layer {
        let mut copy = self.clone();
        copy.id = Uuid::new_v4().to_string();
        copy
    }
}

/// Normalizes an angle in degrees to the range -90..=90, preserving the physical
/// ply orientation (e.g. a 100 degree ply is equivalent to -80 degrees).
fn reduce_angle(angle: f64) -> f64 {
    let sign = angle.signum();
    let mut a = angle.abs() % 180.0;
    if a > 90.0 {
        a -= 180.0;
    }
    sign * a
}

fn deserialize_normalized_angle<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = f64::deserialize(deserializer)?;
    Ok(reduce_angle(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduce_angle_normalizes_to_plus_minus_90() {
        assert_eq!(reduce_angle(45.0), 45.0);
        assert_eq!(reduce_angle(90.0), 90.0);
        assert_eq!(reduce_angle(0.0), 0.0);
        assert_eq!(reduce_angle(100.0), -80.0);
        assert_eq!(reduce_angle(-100.0), 80.0);
        assert_eq!(reduce_angle(200.0), 20.0);
        assert_eq!(reduce_angle(91.0), -89.0);
    }

    #[test]
    fn constructor_and_setter_normalize_angle() {
        let mut l = Layer::new("id", "ply", "mat", 100.0, 0.125);
        assert_eq!(l.angle(), -80.0);
        l.set_angle(91.0);
        assert_eq!(l.angle(), -89.0);
    }

    #[test]
    fn rad_angle_matches_to_radians() {
        let l = Layer::new("id", "ply", "mat", 90.0, 0.125);
        assert!((l.rad_angle() - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn deserialize_normalizes_out_of_range_angle_from_json() {
        let json = r#"{"id":"id","name":"ply","angle":100.0,"thickness":0.125,"material_id":"mat","criterion_id":null}"#;
        let l: Layer = serde_json::from_str(json).unwrap();
        assert_eq!(l.angle(), -80.0);
    }

    #[test]
    fn duplicate_has_new_id() {
        let l = Layer::new("id", "ply", "mat", 45.0, 0.125);
        let copy = l.duplicate();
        assert_ne!(l.id, copy.id);
        assert_eq!(l.angle(), copy.angle());
        assert_eq!(l.thickness, copy.thickness);
    }
}
