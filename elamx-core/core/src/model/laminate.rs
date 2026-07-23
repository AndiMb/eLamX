//! A stack of plies. Reference: eLamX2/Laminate/src/de/elamx/laminate/Laminat.java

use super::layer::Layer;
use super::material::Material;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Laminate {
    pub id: String,
    pub name: String,
    /// Stored layers. For symmetric laminates this holds only one half of the
    /// stack; use [`Laminate::all_layers`] for the fully expanded stacking sequence.
    pub layers: Vec<Layer>,
    pub symmetric: bool,
    /// Whether the last stored layer is a shared middle layer (counted once,
    /// not mirrored) rather than being reflected like the other stored layers.
    pub with_middle_layer: bool,
    /// If set, the stacking sequence is reversed (the first stored layer ends
    /// up at the largest z-coordinate instead of the smallest).
    pub invert_z: bool,
    pub offset: f64,
}

/// A layer as it appears in the fully expanded stacking sequence, i.e. after
/// mirroring (for symmetric laminates) and stacking-order numbering. Corresponds
/// to what Java's `Laminat.getAllLayers()`/`getLayers()` return (`DataLayer` or
/// `SymmetricLayer` instances), minus the UI-only per-view identity.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedLayer<'a> {
    pub number: usize,
    pub original_layer_id: &'a str,
    pub angle: f64,
    pub thickness: f64,
    pub material_id: &'a str,
    pub criterion_id: Option<&'a str>,
    pub embedded: bool,
}

impl Laminate {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Laminate {
            id: id.into(),
            name: name.into(),
            layers: Vec::new(),
            symmetric: false,
            with_middle_layer: false,
            invert_z: false,
            offset: 0.0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.layers.is_empty()
    }

    /// Number of layers in the fully expanded stacking sequence.
    pub fn number_of_layers(&self) -> usize {
        let mut num = self.layers.len();
        if self.symmetric {
            num *= 2;
            if self.with_middle_layer {
                num -= 1;
            }
        }
        num
    }

    /// Total laminate thickness, including mirrored layers for symmetric laminates.
    pub fn thickness(&self) -> f64 {
        let mut thick: f64 = self.layers.iter().map(|l| l.thickness).sum();
        if self.symmetric {
            thick *= 2.0;
            if self.with_middle_layer {
                if let Some(last) = self.layers.last() {
                    thick -= last.thickness;
                }
            }
        }
        thick
    }

    /// Total area weight (mass per unit area), including mirrored layers for
    /// symmetric laminates. `materials` must contain every material referenced
    /// by this laminate's layers, keyed by material id.
    pub fn area_weight(&self, materials: &HashMap<String, Material>) -> f64 {
        let rho_of = |layer: &Layer| {
            materials
                .get(&layer.material_id)
                .unwrap_or_else(|| panic!("material {} not found", layer.material_id))
                .rho
        };
        let mut weight: f64 = self.layers.iter().map(|l| rho_of(l) * l.thickness).sum();
        if self.symmetric {
            weight *= 2.0;
            if self.with_middle_layer {
                if let Some(last) = self.layers.last() {
                    weight -= rho_of(last) * last.thickness;
                }
            }
        }
        weight
    }

    /// The stored layers only (no symmetry mirroring), numbered in stacking
    /// order, reversed if `invert_z` is set. Matches `getLayers()` in the Java original.
    pub fn layers_in_stacking_order(&self) -> Vec<ResolvedLayer<'_>> {
        let stored_len = self.layers.len();
        let mut resolved: Vec<ResolvedLayer> = self
            .layers
            .iter()
            .enumerate()
            .map(|(i, l)| resolved_from(i, l, stored_len, self.symmetric, i + 1))
            .collect();
        if self.invert_z {
            resolved.reverse();
        }
        resolved
    }

    /// The fully expanded stacking sequence: stored layers, mirrored for
    /// symmetric laminates, numbered in stacking order, reversed if `invert_z`
    /// is set. Matches `getAllLayers()` in the Java original.
    pub fn all_layers(&self) -> Vec<ResolvedLayer<'_>> {
        let stored_len = self.layers.len();
        let mut resolved: Vec<ResolvedLayer> = self
            .layers
            .iter()
            .enumerate()
            .map(|(i, l)| resolved_from(i, l, stored_len, self.symmetric, 0))
            .collect();

        if self.symmetric && stored_len > 0 {
            let mut start = stored_len as isize - 1;
            if self.with_middle_layer {
                start -= 1;
            }
            let mut i = start;
            while i >= 0 {
                let idx = i as usize;
                resolved.push(resolved_from(idx, &self.layers[idx], stored_len, self.symmetric, 0));
                i -= 1;
            }
        }

        // Stacking-order numbers are assigned before reversal, so with invert_z
        // the numbers end up descending from the first entry (matches Java,
        // where Collections.reverse() runs after setNumber()).
        for (i, r) in resolved.iter_mut().enumerate() {
            r.number = i + 1;
        }

        if self.invert_z {
            resolved.reverse();
        }

        resolved
    }

    /// A copy of this laminate with a freshly generated id and freshly generated
    /// layer ids, matching the Java `getCopy()` semantics.
    pub fn duplicate(&self) -> Laminate {
        Laminate {
            id: Uuid::new_v4().to_string(),
            name: self.name.clone(),
            layers: self.layers.iter().map(Layer::duplicate).collect(),
            symmetric: self.symmetric,
            with_middle_layer: self.with_middle_layer,
            invert_z: self.invert_z,
            offset: self.offset,
        }
    }
}

fn resolved_from(
    stored_index: usize,
    layer: &Layer,
    stored_len: usize,
    symmetric: bool,
    number: usize,
) -> ResolvedLayer<'_> {
    ResolvedLayer {
        number,
        original_layer_id: &layer.id,
        angle: layer.angle(),
        thickness: layer.thickness,
        material_id: &layer.material_id,
        criterion_id: layer.criterion_id.as_deref(),
        embedded: embedded_at(stored_index, stored_len, symmetric),
    }
}

/// Whether the layer at `stored_index` (within the stored half of the stack)
/// touches a free surface (`false`) or is sandwiched between other layers
/// (`true`). Matches `Laminat.checkEmbedded()` in the Java original, which is
/// evaluated here as a pure function of position instead of cached mutable state.
fn embedded_at(stored_index: usize, stored_len: usize, symmetric: bool) -> bool {
    if symmetric {
        stored_index != 0
    } else {
        stored_index != 0 && stored_index != stored_len - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(name: &str, angle: f64, thickness: f64) -> Layer {
        Layer::new(format!("id-{name}"), name, "mat-1", angle, thickness)
    }

    fn material() -> Material {
        Material::new("mat-1", "UD", 140000.0, 10000.0, 0.3, 5000.0, 1.6e-9)
    }

    #[test]
    fn thickness_and_number_of_layers_plain() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("90", 90.0, 0.3));
        assert_eq!(lam.number_of_layers(), 2);
        assert!((lam.thickness() - 0.5).abs() < 1e-12);
    }

    #[test]
    fn thickness_and_number_of_layers_symmetric_without_middle_layer() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("45", 45.0, 0.1));
        lam.layers.push(layer("90", 90.0, 0.3));
        lam.symmetric = true;
        assert_eq!(lam.number_of_layers(), 6);
        assert!((lam.thickness() - 1.2).abs() < 1e-12);
    }

    #[test]
    fn thickness_and_number_of_layers_symmetric_with_middle_layer() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("45", 45.0, 0.1));
        lam.layers.push(layer("90", 90.0, 0.3));
        lam.symmetric = true;
        lam.with_middle_layer = true;
        // 2*(0.2+0.1+0.3) - 0.3 (middle layer counted once)
        assert_eq!(lam.number_of_layers(), 5);
        assert!((lam.thickness() - 0.9).abs() < 1e-12);
    }

    #[test]
    fn area_weight_uses_material_density() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("90", 90.0, 0.3));
        let mut materials = HashMap::new();
        materials.insert("mat-1".to_string(), material());
        let expected = 1.6e-9 * (0.2 + 0.3);
        assert!((lam.area_weight(&materials) - expected).abs() < 1e-15);
    }

    #[test]
    fn all_layers_mirrors_and_numbers_symmetric_stack_without_middle_layer() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("45", 45.0, 0.1));
        lam.layers.push(layer("90", 90.0, 0.3));
        lam.symmetric = true;

        let all = lam.all_layers();
        let angles: Vec<f64> = all.iter().map(|r| r.angle).collect();
        assert_eq!(angles, vec![0.0, 45.0, 90.0, 90.0, 45.0, 0.0]);

        let numbers: Vec<usize> = all.iter().map(|r| r.number).collect();
        assert_eq!(numbers, vec![1, 2, 3, 4, 5, 6]);

        let embedded: Vec<bool> = all.iter().map(|r| r.embedded).collect();
        assert_eq!(embedded, vec![false, true, true, true, true, false]);
    }

    #[test]
    fn all_layers_mirrors_symmetric_stack_with_middle_layer() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("45", 45.0, 0.1));
        lam.layers.push(layer("90", 90.0, 0.3));
        lam.symmetric = true;
        lam.with_middle_layer = true;

        let all = lam.all_layers();
        let angles: Vec<f64> = all.iter().map(|r| r.angle).collect();
        // The 90 deg middle layer is shared, not mirrored again.
        assert_eq!(angles, vec![0.0, 45.0, 90.0, 45.0, 0.0]);
    }

    #[test]
    fn invert_z_reverses_the_expanded_stack_and_its_numbers() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        lam.layers.push(layer("90", 90.0, 0.3));
        lam.invert_z = true;

        let all = lam.all_layers();
        let angles: Vec<f64> = all.iter().map(|r| r.angle).collect();
        let numbers: Vec<usize> = all.iter().map(|r| r.number).collect();
        assert_eq!(angles, vec![90.0, 0.0]);
        assert_eq!(numbers, vec![2, 1]);
    }

    #[test]
    fn duplicate_has_new_ids_for_laminate_and_layers() {
        let mut lam = Laminate::new("id", "lam");
        lam.layers.push(layer("0", 0.0, 0.2));
        let copy = lam.duplicate();
        assert_ne!(lam.id, copy.id);
        assert_ne!(lam.layers[0].id, copy.layers[0].id);
        assert_eq!(lam.layers[0].angle(), copy.layers[0].angle());
    }
}
