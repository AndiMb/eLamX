//! Translation between the Java class names an `.elamx` file stores and the
//! ids this crate uses.
//!
//! The file format identifies failure criteria, bending-stiffness idealisations
//! and material parameters by fully qualified Java class name, because that is
//! how the NetBeans `Lookup` registry addressed them. This crate uses short
//! stable ids instead. Every such pairing lives here rather than being spread
//! across the reader and the writer, so the two directions cannot drift apart -
//! `round_trip_every_mapping` in the tests below enforces that.
//!
//! Reference: eLamX2/File_Support/src/de/elamx/filesupport/,
//! eLamX2/Classical_Laminated_Plate_Theory_UI/.../buckling/LoadSaveLaminateHookImpl.java

use crate::failure;
use crate::plate::{BoundaryCondition, DMatrixKind};

/// Failure criteria: `(core id, Java class name)`.
///
/// A criterion eLamX cannot resolve falls back to Puck *silently* when the
/// original reads a file (see `LaminateLoadSaveImpl`). This crate reports the
/// unknown name instead - a laminate quietly evaluated against the wrong
/// criterion is worse than a refused file.
const CRITERIA: &[(&str, &str)] = &[
    (failure::PUCK_ID, "de.elamx.laminate.failure.Puck"),
    (failure::MAX_STRESS_ID, "de.elamx.laminate.addFailureCriteria.MaxStress"),
    (failure::MAX_STRAIN_ID, "de.elamx.laminate.addFailureCriteria.MaxStrain"),
    (failure::TSAI_HILL_ID, "de.elamx.laminate.addFailureCriteria.TsaiHill"),
    (failure::TSAI_WU_ID, "de.elamx.laminate.addFailureCriteria.TsaiWu"),
    (failure::HASHIN_ID, "de.elamx.laminate.addFailureCriteria.Hashin"),
    (failure::CHRISTENSEN_ID, "de.elamx.laminate.addFailureCriteria.Christensen"),
    (failure::EDGE_ID, "de.elamx.laminate.addFailureCriteria.Edge"),
    (failure::FIBRE_FAILURE_ID, "de.elamx.laminate.addFailureCriteria.FibreFailure"),
    (failure::FMC_ID, "de.elamx.laminate.addFailureCriteria.FMC"),
    (failure::HOFFMAN_ID, "de.elamx.laminate.addFailureCriteria.Hoffman"),
    (failure::MAYES_ID, "de.elamx.laminate.addFailureCriteria.Mayes"),
    (failure::ROTEM_ID, "de.elamx.laminate.addFailureCriteria.Rotem"),
    (failure::SUN_ID, "de.elamx.laminate.addFailureCriteria.Sun"),
    (failure::ZTL_ID, "de.elamx.laminate.addFailureCriteria.ZTL"),
];

/// Extra per-material values: `(core key, Java tag name)`.
///
/// Only the parameters the ported criteria actually read are listed. Anything
/// else in the file - the Abaqus/Ansys/LS-Dyna/Autodesk parameters, say - is
/// preserved verbatim under its Java name (see `Material::additional_values`),
/// so writing a file back does not silently drop what this crate cannot use.
const ADDITIONAL_VALUES: &[(&str, &str)] = &[
    (failure::PSPD, "de.elamx.laminate.failure.Puck.pspd"),
    (failure::PSPZ, "de.elamx.laminate.failure.Puck.pspz"),
    (failure::A0, "de.elamx.laminate.failure.Puck.a0"),
    (failure::LAMBDA_MIN, "de.elamx.laminate.failure.Puck.lambda_min"),
    (failure::F12_STAR, "de.elamx.laminate.addFailureCriteria.TsaiWu.f12star"),
    (failure::ZTL_F12_STAR, "de.elamx.laminate.addFailureCriteria.ZTL.f12star"),
    (failure::EPS_X, "de.elamx.laminate.addFailureCriteria.MaxStrain.eps_x"),
    (failure::EPS_Y, "de.elamx.laminate.addFailureCriteria.MaxStrain.eps_y"),
    (failure::GAMMA_XY, "de.elamx.laminate.addFailureCriteria.MaxStrain.gamma_xy"),
    (failure::GLOBAL_LOCAL, "de.elamx.laminate.addFailureCriteria.MaxStrain.global_lokal"),
    (failure::FMC_M, "de.elamx.laminate.addFailureCriteria.FMC.m"),
    (failure::FMC_MUE_SP, "de.elamx.laminate.addFailureCriteria.FMC.muesp"),
];

/// Bending-stiffness idealisations: `(kind, Java class name)`. Same silent
/// fallback in the original, same refusal here.
const D_MATRIX: &[(DMatrixKind, &str)] = &[
    (DMatrixKind::Standard, "de.elamx.clt.plate.dmatrix.StandardDMatrixServiceImpl"),
    (DMatrixKind::SpecialOrthotropic, "de.elamx.clt.plate.dmatrix.SpecialOrthotropicDMatrixServiceImpl"),
    (DMatrixKind::DTilde, "de.elamx.clt.plate.dmatrix.DtildeDMatrixServiceImpl"),
];

/// Edge conditions are stored as the index into eLamX's own `boundary_cond`
/// array (`plateui/buckling/InputPanel`), so the ORDER here is the file format.
const BOUNDARY: [BoundaryCondition; 6] = [
    BoundaryCondition::SimplySimply,
    BoundaryCondition::ClampedClamped,
    BoundaryCondition::ClampedFree,
    BoundaryCondition::FreeFree,
    BoundaryCondition::SimplyClamped,
    BoundaryCondition::SimplyFree,
];

pub fn criterion_from_java(java: &str) -> Option<&'static str> {
    CRITERIA.iter().find(|(_, j)| *j == java).map(|(id, _)| *id)
}

pub fn criterion_to_java(id: &str) -> Option<&'static str> {
    CRITERIA.iter().find(|(i, _)| *i == id).map(|(_, j)| *j)
}

pub fn additional_value_from_java(java: &str) -> Option<&'static str> {
    ADDITIONAL_VALUES.iter().find(|(_, j)| *j == java).map(|(k, _)| *k)
}

pub fn additional_value_to_java(key: &str) -> Option<&'static str> {
    ADDITIONAL_VALUES.iter().find(|(k, _)| *k == key).map(|(_, j)| *j)
}

pub fn d_matrix_from_java(java: &str) -> Option<DMatrixKind> {
    D_MATRIX.iter().find(|(_, j)| *j == java).map(|(k, _)| *k)
}

pub fn d_matrix_to_java(kind: DMatrixKind) -> &'static str {
    D_MATRIX
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, j)| *j)
        .expect("every DMatrixKind has a Java class name")
}

pub fn boundary_from_index(index: usize) -> Option<BoundaryCondition> {
    BOUNDARY.get(index).copied()
}

pub fn boundary_to_index(bc: BoundaryCondition) -> usize {
    BOUNDARY
        .iter()
        .position(|b| *b == bc)
        .expect("every BoundaryCondition has a file-format index")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::default_criterion_registry;

    #[test]
    fn round_trip_every_mapping() {
        for (id, java) in CRITERIA {
            assert_eq!(criterion_to_java(id), Some(*java));
            assert_eq!(criterion_from_java(java), Some(*id));
        }
        for (key, java) in ADDITIONAL_VALUES {
            assert_eq!(additional_value_to_java(key), Some(*java));
            assert_eq!(additional_value_from_java(java), Some(*key));
        }
        for (kind, java) in D_MATRIX {
            assert_eq!(d_matrix_to_java(*kind), *java);
            assert_eq!(d_matrix_from_java(java), Some(*kind));
        }
        for (index, bc) in BOUNDARY.iter().enumerate() {
            assert_eq!(boundary_to_index(*bc), index);
            assert_eq!(boundary_from_index(index), Some(*bc));
        }
    }

    /// A criterion that can be calculated but not saved would lose data on the
    /// next write, so the two sets have to stay in step.
    #[test]
    fn every_registered_criterion_has_a_java_name() {
        for id in default_criterion_registry().keys() {
            assert!(
                criterion_to_java(id).is_some(),
                "Kriterium '{id}' hat keinen Java-Klassennamen"
            );
        }
    }

    #[test]
    fn every_d_matrix_kind_and_boundary_condition_is_mapped() {
        for kind in DMatrixKind::ALL {
            assert!(D_MATRIX.iter().any(|(k, _)| *k == kind), "{kind:?} fehlt");
        }
        for bc in BoundaryCondition::ALL {
            assert!(BOUNDARY.contains(&bc), "{bc:?} fehlt");
        }
    }

    #[test]
    fn unknown_names_are_rejected_rather_than_defaulted() {
        assert_eq!(criterion_from_java("de.example.NotACriterion"), None);
        assert_eq!(d_matrix_from_java("de.example.NotAService"), None);
        assert_eq!(boundary_from_index(99), None);
    }
}
