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
use crate::micromechanics::Model;
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
    // The two isotropic ones come from their own module, hence the package.
    (failure::VON_MISES_ID, "de.elamx.laminate.addFailureCriteriaMetal.vonMises"),
    (failure::TRESCA_ID, "de.elamx.laminate.addFailureCriteriaMetal.Tresca"),
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

/// Micromechanical models: `(model, Java class name)`.
///
/// Two packages, because the rule of mixtures and the manual-input dummy ship
/// with the program while the other six come from the separately deployed
/// `AdditionalMicroMechanicModels`. eLamX's reader falls back to the rule of
/// mixtures for a name it cannot resolve - silently, and for each of the four
/// stored model choices independently; this crate reports the name instead.
const MICRO_MODELS: &[(Model, &str)] = &[
    (Model::Manual, "de.elamx.micromechanics.models.ManualInputDummyModel"),
    (Model::RuleOfMixture, "de.elamx.micromechanics.models.Mischungsregel_m"),
    (Model::Abolinsh, "de.elamx.micromechanics.addmicromechanicmodels.Abolinsh"),
    (Model::Chamis, "de.elamx.micromechanics.addmicromechanicmodels.Chamis"),
    (Model::HalpinTsai, "de.elamx.micromechanics.addmicromechanicmodels.HalpinTsai"),
    (Model::HopkinsChamis, "de.elamx.micromechanics.addmicromechanicmodels.HopkinsChamis"),
    (Model::Puck, "de.elamx.micromechanics.addmicromechanicmodels.Puck"),
    (Model::Hsb3710202, "de.elamx.micromechanics.addmicromechanicmodels.HSB3710202"),
];

/// Stiffener profiles: `(profile code, Java class name)`.
///
/// Note where the classes live: the direct input is part of the plate UI
/// module, the two profiles come from the separately deployed
/// `AdditionalStiffeners`. A file written by an eLamX without that module
/// installed can therefore only carry the direct input - and a file that names
/// a profile eLamX cannot resolve loses that stiffener *silently*
/// (`LoadSaveStiffeners.load` just skips it). This crate refuses instead, for
/// the reason the module header gives.
const STIFFENER_PROFILES: &[(&str, &str)] = &[
    ("direct", "de.elamx.clt.plateui.stiffenerui.DefaultStiffenerProperties"),
    ("i_profile", "de.elamx.clt.plate.AdditionalStiffeners.I_StiffenerProperties"),
    ("t_profile", "de.elamx.clt.plate.AdditionalStiffeners.T_StiffenerProperties"),
];

/// Spring-in models: `(model code, Java class name)`. The enhanced model is
/// the one that ships in `AdditionalSpringInModels`, which is why the two
/// packages differ.
const SPRING_IN_MODELS: &[(&str, &str)] = &[
    ("simple_radford", "de.elamx.clt.springin.SimpleRadfordSpringInModel"),
    (
        "enhanced_radford",
        "de.elamx.clt.springin.additionalmodels.EnhancedRadfordSpringInModel",
    ),
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

pub fn micro_model_from_java(java: &str) -> Option<Model> {
    MICRO_MODELS.iter().find(|(_, j)| *j == java).map(|(m, _)| *m)
}

pub fn micro_model_to_java(model: Model) -> &'static str {
    MICRO_MODELS
        .iter()
        .find(|(m, _)| *m == model)
        .map(|(_, j)| *j)
        .expect("every micromechanical model has a Java class name")
}

pub fn stiffener_profile_from_java(java: &str) -> Option<&'static str> {
    STIFFENER_PROFILES.iter().find(|(_, j)| *j == java).map(|(c, _)| *c)
}

pub fn stiffener_profile_to_java(code: &str) -> Option<&'static str> {
    STIFFENER_PROFILES.iter().find(|(c, _)| *c == code).map(|(_, j)| *j)
}

pub fn spring_in_model_from_java(java: &str) -> Option<&'static str> {
    SPRING_IN_MODELS.iter().find(|(_, j)| *j == java).map(|(c, _)| *c)
}

pub fn spring_in_model_to_java(code: &str) -> Option<&'static str> {
    SPRING_IN_MODELS.iter().find(|(c, _)| *c == code).map(|(_, j)| *j)
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
    use crate::plate::StiffenerGeometry;

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
        for (model, java) in MICRO_MODELS {
            assert_eq!(micro_model_to_java(*model), *java);
            assert_eq!(micro_model_from_java(java), Some(*model));
        }
        for (code, java) in STIFFENER_PROFILES {
            assert_eq!(stiffener_profile_to_java(code), Some(*java));
            assert_eq!(stiffener_profile_from_java(java), Some(*code));
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
        for model in Model::ALL {
            assert!(MICRO_MODELS.iter().any(|(m, _)| *m == model), "{model:?} fehlt");
        }
    }

    /// A profile that can be calculated but not written would be lost on the
    /// next save, so every variant needs a class name.
    #[test]
    fn every_stiffener_profile_is_mapped() {
        let all = [
            StiffenerGeometry::Direct { e: 0.0, i: 0.0, g: 0.0, j: 0.0, a: 0.0, rho: 0.0 },
            StiffenerGeometry::IProfile { w1: 0.0, t1: 0.0, e: 0.0, g: 0.0, rho: 0.0 },
            StiffenerGeometry::TProfile {
                w1: 0.0, t1: 0.0, w2: 0.0, t2: 0.0, e: 0.0, g: 0.0, rho: 0.0,
            },
        ];
        for geometry in all {
            assert!(
                stiffener_profile_to_java(geometry.code()).is_some(),
                "Profil '{}' hat keinen Java-Klassennamen",
                geometry.code()
            );
        }
    }

    #[test]
    fn unknown_names_are_rejected_rather_than_defaulted() {
        assert_eq!(criterion_from_java("de.example.NotACriterion"), None);
        assert_eq!(d_matrix_from_java("de.example.NotAService"), None);
        assert_eq!(stiffener_profile_from_java("de.example.NotAProfile"), None);
        assert_eq!(micro_model_from_java("de.example.NotAModel"), None);
        assert_eq!(boundary_from_index(99), None);
    }
}
