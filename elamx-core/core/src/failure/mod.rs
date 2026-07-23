//! Failure criteria (Puck, Hashin, Tsai-Wu, ...) as Rust traits, replacing the
//! Java plugin hierarchy (`Criterion` abstract class + NetBeans `layer.xml`
//! registration) with a plain trait implemented by one type per criterion.
//! Reference: eLamX2/Laminate/src/de/elamx/laminate/failure/{Criterion,ReserveFactor}.java,
//! eLamX2/AdditionalFailureCriteria/src/de/elamx/laminate/addFailureCriteria/*.java
//!
//! 3D failure-envelope mesh generation (`getAsMesh` in the Java original) is
//! not ported: that's a rendering concern for the future Three.js-based
//! visualization, not this calculation core. The FEA-specific criterion
//! variants (LS-DYNA/ANSYS/Abaqus/Autodesk modules) and the metal criteria
//! (von Mises, Tresca) aren't ported yet either; they follow the same pattern.

mod christensen;
mod edge;
mod fibre_failure;
mod fmc;
mod hashin;
mod hoffman;
mod max_strain;
mod max_stress;
mod mayes;
mod puck;
mod reserve_factor;
mod rotem;
mod sun;
mod tsai_hill;
mod tsai_wu;
mod ztl;

pub use christensen::Christensen;
pub use edge::Edge;
pub use fibre_failure::FibreFailure;
pub use fmc::{Fmc, M as FMC_M, MUE_SP as FMC_MUE_SP};
pub use hashin::Hashin;
pub use hoffman::Hoffman;
pub use max_strain::{MaxStrain, EPS_X, EPS_Y, GAMMA_XY, GLOBAL_LOCAL};
pub use max_stress::MaxStress;
pub use mayes::Mayes;
pub use puck::{Puck, A0, LAMBDA_MIN, PSPD, PSPZ};
pub use reserve_factor::{FailureType, ReserveFactor};
pub use rotem::Rotem;
pub use sun::Sun;
pub use tsai_hill::TsaiHill;
pub use tsai_wu::{TsaiWu, F12_STAR};
pub use ztl::{Ztl, F12_STAR as ZTL_F12_STAR};

use crate::model::{Material, StressStrainState};
use std::collections::HashMap;

/// Minimal per-layer context a failure criterion may need beyond the material
/// and stress/strain state: the ply angle (used by `MaxStrain`'s global/local
/// strain option) and whether the ply is sandwiched between others rather than
/// sitting at a free surface (used by `Sun` to raise the in-situ transverse
/// tensile/shear strength). Kept as an explicit, minimal struct rather than a
/// full `model::Layer` reference so this module doesn't need to depend on the
/// whole layer type - and because `embedded` is a computed property of a
/// laminate's stacking order in this codebase, not a field stored on `Layer`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayerContext {
    pub angle_deg: f64,
    pub embedded: bool,
}

/// A ply failure criterion: given a material, optional layer context (angle/
/// embedded-ness - only used by criteria that need it), and a local stress/
/// strain state, returns the governing reserve factor.
pub trait Criterion {
    fn reserve_factor(
        &self,
        material: &Material,
        context: Option<&LayerContext>,
        state: &StressStrainState,
    ) -> Result<ReserveFactor, CriterionError>;
}

/// A named set of available failure criteria, replacing the Java original's
/// NetBeans `Lookup`-based plugin discovery (`Lookups.forPath("elamx/failurecriteria")`).
/// Each [`crate::model::Layer`]/`CltLayer` references a criterion by one of
/// these keys via its `criterion_id`.
pub type CriterionRegistry = HashMap<String, Box<dyn Criterion>>;

/// Canonical id for [`Puck`] - the default criterion new layers fall back to
/// in the Java original (see `DataLayer`'s constructor).
pub const PUCK_ID: &str = "puck";
pub const MAX_STRESS_ID: &str = "max_stress";
pub const MAX_STRAIN_ID: &str = "max_strain";
pub const TSAI_HILL_ID: &str = "tsai_hill";
pub const TSAI_WU_ID: &str = "tsai_wu";
pub const HASHIN_ID: &str = "hashin";
pub const CHRISTENSEN_ID: &str = "christensen";
pub const EDGE_ID: &str = "edge";
pub const FIBRE_FAILURE_ID: &str = "fibre_failure";
pub const FMC_ID: &str = "fmc";
pub const HOFFMAN_ID: &str = "hoffman";
pub const MAYES_ID: &str = "mayes";
pub const ROTEM_ID: &str = "rotem";
pub const SUN_ID: &str = "sun";
pub const ZTL_ID: &str = "ztl";

/// Registry containing the criteria implemented so far, keyed by their `*_ID` constants.
pub fn default_criterion_registry() -> CriterionRegistry {
    let mut registry: CriterionRegistry = HashMap::new();
    registry.insert(MAX_STRESS_ID.to_string(), Box::new(MaxStress));
    registry.insert(MAX_STRAIN_ID.to_string(), Box::new(MaxStrain));
    registry.insert(TSAI_HILL_ID.to_string(), Box::new(TsaiHill));
    registry.insert(TSAI_WU_ID.to_string(), Box::new(TsaiWu));
    registry.insert(HASHIN_ID.to_string(), Box::new(Hashin));
    registry.insert(PUCK_ID.to_string(), Box::new(Puck));
    registry.insert(CHRISTENSEN_ID.to_string(), Box::new(Christensen));
    registry.insert(EDGE_ID.to_string(), Box::new(Edge));
    registry.insert(FIBRE_FAILURE_ID.to_string(), Box::new(FibreFailure));
    registry.insert(FMC_ID.to_string(), Box::new(Fmc));
    registry.insert(HOFFMAN_ID.to_string(), Box::new(Hoffman));
    registry.insert(MAYES_ID.to_string(), Box::new(Mayes));
    registry.insert(ROTEM_ID.to_string(), Box::new(Rotem));
    registry.insert(SUN_ID.to_string(), Box::new(Sun));
    registry.insert(ZTL_ID.to_string(), Box::new(Ztl));
    registry
}

/// A material is missing a value a criterion needs (e.g. Puck's `p_spd`), or
/// the criterion's equations produced a mathematically undefined result for
/// the given inputs (e.g. a negative value under a square root, which the
/// Java original raises as an `ArithmeticException`).
#[derive(Debug, Clone, PartialEq)]
pub struct CriterionError(pub String);

impl std::fmt::Display for CriterionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CriterionError {}

fn additional_value(material: &Material, key: &str) -> Result<f64, CriterionError> {
    material.additional_values.get(key).copied().ok_or_else(|| {
        CriterionError(format!(
            "material '{}' is missing the additional value '{key}'",
            material.id
        ))
    })
}

fn non_negative(value: f64, context: &str) -> Result<(), CriterionError> {
    if value < 0.0 {
        Err(CriterionError(format!(
            "{context}: illegal negative value under a square root ({value})"
        )))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_registry_contains_all_ported_criteria() {
        let registry = default_criterion_registry();
        for id in [
            MAX_STRESS_ID,
            MAX_STRAIN_ID,
            TSAI_HILL_ID,
            TSAI_WU_ID,
            HASHIN_ID,
            PUCK_ID,
            CHRISTENSEN_ID,
            EDGE_ID,
            FIBRE_FAILURE_ID,
            FMC_ID,
            HOFFMAN_ID,
            MAYES_ID,
            ROTEM_ID,
            SUN_ID,
            ZTL_ID,
        ] {
            assert!(registry.contains_key(id), "missing criterion '{id}'");
        }
    }
}
