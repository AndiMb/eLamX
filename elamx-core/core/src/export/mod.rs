//! Writing a laminate out as input for a finite-element solver.
//! Reference: eLamX2/Export/src/de/elamx/export/
//!
//! Four solvers, one shape: the material cards first, the layup second, and
//! nothing else. That is the whole extent of the coupling - the mesh, the
//! boundary conditions and the load case belong to whoever runs the solver,
//! and eLamX has never claimed otherwise.
//!
//! Which is worth saying plainly, because a deck that looks complete and is not
//! would be worse than no deck at all. What these files contain is the part
//! eLamX knows: the plies, their materials and their angles.
//!
//! The criteria in `failure` are the other half of the same idea - a laminate
//! checked here against `ls_dyna_chang_chang` and exported here as MAT54 is the
//! same laminate checked the same way in both programs.

mod abaqus;
mod ansys;
mod java_number;
mod ls_dyna;
mod nastran;

pub use ansys::AnsysLayout;
pub use ls_dyna::LsDynaCard;
pub use nastran::NastranFormat;

use crate::model::{Laminate, Material};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Where the reference plane sits relative to the stack, which every solver
/// spells differently and all four offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum Offset {
    Top,
    #[default]
    Mid,
    Bot,
}

/// What to put in the deck beyond the elastic constants.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct ExportOptions {
    /// Thermal and hygroscopic expansion. Also decides, in Nastran and ANSYS,
    /// whether an isotropic material may be written as an isotropic card: one
    /// that expands differently along and across cannot be.
    pub hygrothermal: bool,
    /// The strengths, as the solver's own allowables.
    pub strength: bool,
    pub offset: Offset,
}

/// Which solver the deck is for, with the options only that solver has.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "solver", rename_all = "snake_case")]
pub enum ExportTarget {
    Nastran {
        format: NastranFormat,
    },
    Abaqus,
    Ansys {
        layout: AnsysLayout,
    },
    /// The LS-DYNA writers scale every quantity, because a deck is written in
    /// whatever unit system the model uses and the card has no units of its
    /// own. The three multipliers convert eLamX's N/mm/t to that system.
    LsDyna {
        card: LsDynaCard,
        mass: f64,
        length: f64,
        time: f64,
    },
}

/// A material could not be resolved, which means the laminate and the material
/// list disagree - the caller built one of them wrong.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportError(pub String);

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ExportError {}

/// One ply of the expanded stack, with its material already resolved and the
/// number the deck refers to it by.
pub(crate) struct ExportLayer {
    pub angle_deg: f64,
    pub thickness: f64,
    /// 1-based, in the order the materials first appear in the stack. The
    /// material itself is not carried: every deck refers to it by this number,
    /// and the numbers are what the material cards are written under.
    pub material_number: usize,
}

/// The stack as the deck sees it, and the distinct materials in it.
///
/// Both come from `Laminate::all_layers`, so a symmetric laminate is unfolded
/// and an inverted one reversed before anything is written - a solver has no
/// notion of a stored half.
pub(crate) fn resolve<'a>(
    laminate: &Laminate,
    materials: &'a HashMap<String, Material>,
) -> Result<(Vec<ExportLayer>, Vec<&'a Material>), ExportError> {
    let mut distinct: Vec<&Material> = Vec::new();
    let mut layers = Vec::new();

    for resolved in laminate.all_layers() {
        let material = materials.get(resolved.material_id).ok_or_else(|| {
            ExportError(format!(
                "Das Laminat verweist auf das Material '{}', das nicht übergeben wurde",
                resolved.material_id
            ))
        })?;
        // By id, not by value: two materials with the same numbers are still
        // two materials, and the Java compares object identity here.
        let number = match distinct.iter().position(|m| m.id == material.id) {
            Some(index) => index + 1,
            None => {
                distinct.push(material);
                distinct.len()
            }
        };
        layers.push(ExportLayer {
            angle_deg: resolved.angle,
            thickness: resolved.thickness,
            material_number: number,
        });
    }

    Ok((layers, distinct))
}

/// Whether a material may be written as an isotropic card.
///
/// eLamX's own test, and a looser one than the isotropy check the metal
/// criteria use: equal moduli and a shear modulus within one percent of the
/// isotropic relation. The strengths do not enter.
pub(crate) fn is_isotropic_enough(material: &Material) -> bool {
    material.e_par == material.e_nor
        && (1.0 - material.e_par / (2.0 * (1.0 + material.nue12) * material.g)).abs() <= 0.01
}

/// The total thickness of the expanded stack.
pub(crate) fn total_thickness(layers: &[ExportLayer]) -> f64 {
    layers.iter().map(|l| l.thickness).sum()
}

/// Writes the deck: materials first, layup second.
pub fn export(
    laminate: &Laminate,
    materials: &HashMap<String, Material>,
    target: ExportTarget,
    options: ExportOptions,
) -> Result<String, ExportError> {
    let (layers, distinct) = resolve(laminate, materials)?;
    Ok(match target {
        ExportTarget::Nastran { format } => nastran::export(&layers, &distinct, options, format),
        ExportTarget::Abaqus => abaqus::export(&layers, &distinct, options),
        ExportTarget::Ansys { layout } => ansys::export(&layers, &distinct, options, layout),
        ExportTarget::LsDyna {
            card,
            mass,
            length,
            time,
        } => ls_dyna::export(&layers, &distinct, card, mass, length, time),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::model::Layer;

    /// Two materials and a five-ply stack, the same one every exporter test
    /// uses so the four decks can be read side by side.
    pub(crate) fn laminate_and_materials() -> (Laminate, HashMap<String, Material>) {
        let mut cfk = Material::new("m-cfk", "CFK", 141000.0, 9340.0, 0.35, 4500.0, 1.7e-9);
        cfk.alpha_t_par = 1.0e-6;
        cfk.alpha_t_nor = 3.5e-5;
        cfk.beta_par = 0.01;
        cfk.beta_nor = 0.38;
        cfk.r_par_ten = 2000.0;
        cfk.set_r_par_com(1200.0);
        cfk.r_nor_ten = 60.0;
        cfk.set_r_nor_com(200.0);
        cfk.set_r_shear(90.0);

        let mut alu = Material::new("m-alu", "Alu", 70000.0, 70000.0, 0.25, 28000.0, 2.7e-9);
        alu.alpha_t_par = 2.3e-5;
        alu.alpha_t_nor = 2.3e-5;
        alu.beta_par = 0.0;
        alu.beta_nor = 0.0;
        alu.r_par_ten = 300.0;
        alu.set_r_par_com(300.0);
        alu.r_nor_ten = 300.0;
        alu.set_r_nor_com(300.0);
        alu.set_r_shear(173.2);

        let mut laminate = Laminate::new("lam", "Export");
        for (angle, thickness, material) in [
            (0.0, 0.125, "m-cfk"),
            (45.0, 0.125, "m-cfk"),
            (-45.0, 0.25, "m-alu"),
        ] {
            laminate.layers.push(Layer::new(
                format!("l{angle}"),
                format!("{angle}"),
                material,
                angle,
                thickness,
            ));
        }
        laminate.symmetric = true;
        laminate.with_middle_layer = true;

        let materials = HashMap::from([
            ("m-cfk".to_string(), cfk),
            ("m-alu".to_string(), alu),
        ]);
        (laminate, materials)
    }

    /// The stack a solver sees is the unfolded one: three stored plies with a
    /// middle layer make five, and the materials are numbered in the order they
    /// first appear.
    #[test]
    fn the_symmetric_stack_is_unfolded_before_anything_is_written() {
        let (laminate, materials) = laminate_and_materials();
        let (layers, distinct) = resolve(&laminate, &materials).unwrap();

        assert_eq!(layers.len(), 5);
        let angles: Vec<f64> = layers.iter().map(|l| l.angle_deg).collect();
        assert_eq!(angles, vec![0.0, 45.0, -45.0, 45.0, 0.0]);
        let numbers: Vec<usize> = layers.iter().map(|l| l.material_number).collect();
        assert_eq!(numbers, vec![1, 1, 2, 1, 1]);
        assert_eq!(distinct.len(), 2);
        assert_eq!(distinct[0].id, "m-cfk");
        assert_eq!(total_thickness(&layers), 0.75);
    }

    #[test]
    fn a_missing_material_is_an_error_rather_than_a_deck_with_a_hole_in_it() {
        let (laminate, _) = laminate_and_materials();
        let error = match resolve(&laminate, &HashMap::new()) {
            Err(error) => error,
            Ok(_) => panic!("ein fehlendes Material muss ein Fehler sein"),
        };
        assert!(error.0.contains("m-cfk"), "{}", error.0);
    }

    /// eLamX's isotropy test for an export is the looser one: one percent on
    /// the shear modulus, and the strengths do not enter.
    #[test]
    fn the_isotropy_test_is_the_one_elamx_exports_by() {
        let (_, materials) = laminate_and_materials();
        assert!(is_isotropic_enough(&materials["m-alu"]));
        assert!(!is_isotropic_enough(&materials["m-cfk"]));

        let mut nearly = materials["m-alu"].clone();
        nearly.g = 28000.0 * 1.005;
        assert!(is_isotropic_enough(&nearly));
        nearly.g = 28000.0 * 1.05;
        assert!(!is_isotropic_enough(&nearly));
    }
}
