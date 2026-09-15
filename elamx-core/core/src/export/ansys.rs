//! ANSYS: `MP` material properties and either a section or a real constant set.
//! Reference: eLamX2/Export/src/de/elamx/export/Ansys/AnsysExport.java

use super::java_number::java_double;
use super::{is_isotropic_enough, ExportLayer, ExportOptions, Offset};
use crate::model::Material;
use serde::{Deserialize, Serialize};

/// How the layup is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum AnsysLayout {
    /// `SECTYPE`/`SECDATA`, which is how current ANSYS shells take a layup and
    /// the only one of the two that can carry the offset.
    Section,
    /// `R`/`RMODIF` real constants, for the older element types. eLamX's own
    /// default.
    #[default]
    Real,
}

pub(super) fn export(
    layers: &[ExportLayer],
    materials: &[&Material],
    options: ExportOptions,
    layout: AnsysLayout,
) -> String {
    let mut out = String::new();
    for (index, material) in materials.iter().enumerate() {
        out.push_str(&material_properties(material, index + 1, options));
    }
    out.push_str(&match layout {
        AnsysLayout::Real => real_constants(layers, options),
        AnsysLayout::Section => section(layers, options),
    });
    out
}

fn material_properties(material: &Material, number: usize, options: ExportOptions) -> String {
    let mut out = String::new();
    let isotropic = if options.hygrothermal {
        is_isotropic_enough(material)
            && material.alpha_t_par == material.alpha_t_nor
            && material.beta_par == material.beta_nor
    } else {
        is_isotropic_enough(material)
    };

    out.push_str(&property("EX", number, material.e_par));
    if !isotropic {
        out.push_str(&property("EY", number, material.e_nor));
    }
    out.push_str(&property("PRXY", number, material.nue12));
    if !isotropic {
        out.push_str(&property("GXY", number, material.g));
        if material.g13 != 0.0 {
            out.push_str(&property("GXZ", number, material.g13));
        }
        if material.g23 != 0.0 {
            out.push_str(&property("GYZ", number, material.g23));
        }
    }
    if options.hygrothermal {
        if isotropic {
            out.push_str(&property("BTEX", number, material.beta_par));
            out.push_str(&property("CTEX", number, material.alpha_t_par));
        } else {
            out.push_str(&property("BTEX", number, material.beta_par));
            out.push_str(&property("BTEY", number, material.beta_nor));
            out.push_str(&property("CTEX", number, material.alpha_t_par));
            out.push_str(&property("CTEY", number, material.alpha_t_nor));
        }
    }

    // A density of zero is left out rather than written as zero: ANSYS would
    // take it literally and a modal analysis on a massless shell is not an
    // error anyone wants to debug.
    if !material.rho.is_nan() && material.rho > 0.0 {
        out.push_str(&property("DENS", number, material.rho));
    }

    if options.strength {
        // The compressive allowables go in negative, because that is the sign
        // convention ANSYS's failure criteria use.
        out.push_str(&format!(
            "FC, {number}, S, XTEN,  {}\n",
            java_double(material.r_par_ten)
        ));
        out.push_str(&format!(
            "FC, {number}, S, XCMP, -{}\n",
            java_double(material.r_par_com)
        ));
        out.push_str(&format!(
            "FC, {number}, S, YTEN,  {}\n",
            java_double(material.r_nor_ten)
        ));
        out.push_str(&format!(
            "FC, {number}, S, YCMP, -{}\n",
            java_double(material.r_nor_com)
        ));
        out.push_str(&format!(
            "FC, {number}, S, XY, {}\n",
            java_double(material.r_shear)
        ));
    }

    out
}

fn property(name: &str, number: usize, value: f64) -> String {
    format!("MP, {name},{number},{}\n", java_double(value))
}

fn real_constants(layers: &[ExportLayer], options: ExportOptions) -> String {
    let mut out = format!("R,1,{}\n", layers.len());
    for (index, layer) in layers.iter().enumerate() {
        out.push_str(&format!(
            "RMODIF,1,{},{},{},{}\n",
            13 + 3 * index,
            layer.material_number,
            java_double(layer.angle_deg),
            java_double(layer.thickness),
        ));
    }
    // A real constant set has no offset field at all, so the original writes a
    // reminder instead of a command. Kept: silently dropping the offset would
    // be the worse answer.
    if options.offset != Offset::Mid {
        out.push_str("! Offset must be defined via element KEYOPTS\n");
    }
    out
}

fn section(layers: &[ExportLayer], options: ExportOptions) -> String {
    let mut out = String::from("SECTYPE, 1 , SHELL\n");
    for layer in layers {
        out.push_str(&format!(
            "SECDATA, {} , {}, {}\n",
            java_double(layer.thickness),
            layer.material_number,
            java_double(layer.angle_deg),
        ));
    }
    if options.offset != Offset::Mid {
        let offset = match options.offset {
            Offset::Top => "TOP",
            Offset::Bot => "BOT",
            Offset::Mid => "MID",
        };
        out.push_str(&format!("SECOFFSET, {offset}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::tests::laminate_and_materials;
    use super::super::{export as export_deck, ExportOptions, ExportTarget, Offset};
    use super::*;

    fn deck(layout: AnsysLayout, options: ExportOptions) -> String {
        let (laminate, materials) = laminate_and_materials();
        export_deck(&laminate, &materials, ExportTarget::Ansys { layout }, options).unwrap()
    }

    /// The default deck: real constants, and an isotropic material written as
    /// two properties rather than five.
    #[test]
    fn the_deck_reads_as_ansys_expects_it() {
        let expected = "\
MP, EX,1,141000.0
MP, EY,1,9340.0
MP, PRXY,1,0.35
MP, GXY,1,4500.0
MP, DENS,1,1.7E-9
MP, EX,2,70000.0
MP, PRXY,2,0.25
MP, DENS,2,2.7E-9
R,1,5
RMODIF,1,13,1,0.0,0.125
RMODIF,1,16,1,45.0,0.125
RMODIF,1,19,2,-45.0,0.25
RMODIF,1,22,1,45.0,0.125
RMODIF,1,25,1,0.0,0.125
";
        assert_eq!(deck(AnsysLayout::Real, ExportOptions::default()), expected);
    }

    #[test]
    fn the_section_layout_carries_the_offset_and_the_real_one_cannot() {
        let section = deck(
            AnsysLayout::Section,
            ExportOptions { offset: Offset::Top, ..Default::default() },
        );
        assert!(section.contains("SECTYPE, 1 , SHELL\n"), "{section}");
        assert!(section.contains("SECDATA, 0.25 , 2, -45.0\n"), "{section}");
        assert!(section.ends_with("SECOFFSET, TOP\n"), "{section}");

        let real = deck(
            AnsysLayout::Real,
            ExportOptions { offset: Offset::Top, ..Default::default() },
        );
        assert!(real.ends_with("! Offset must be defined via element KEYOPTS\n"), "{real}");

        // At the middle plane neither writes anything.
        let middle = deck(AnsysLayout::Section, ExportOptions::default());
        assert!(!middle.contains("SECOFFSET"), "{middle}");
    }

    #[test]
    fn expansion_and_strength_reach_the_material_properties() {
        let text = deck(
            AnsysLayout::Real,
            ExportOptions { hygrothermal: true, strength: true, ..Default::default() },
        );
        assert!(text.contains("MP, CTEX,1,1.0E-6\n"), "{text}");
        assert!(text.contains("MP, CTEY,1,3.5E-5\n"), "{text}");
        assert!(text.contains("MP, BTEY,1,0.38\n"), "{text}");
        // The aluminium expands the same way in both directions, so it stays
        // isotropic and writes one coefficient.
        assert!(text.contains("MP, CTEX,2,2.3E-5\n"), "{text}");
        assert!(!text.contains("MP, CTEY,2,"), "{text}");
        assert!(text.contains("FC, 1, S, XCMP, -1200.0\n"), "{text}");
    }

    /// A material that expands differently along and across cannot be written
    /// as an isotropic one, however isotropic its stiffness is.
    #[test]
    fn expansion_can_take_isotropy_away() {
        let (laminate, mut materials) = laminate_and_materials();
        materials.get_mut("m-alu").unwrap().alpha_t_nor = 1.0e-5;
        let text = export_deck(
            &laminate,
            &materials,
            ExportTarget::Ansys { layout: AnsysLayout::Real },
            ExportOptions { hygrothermal: true, ..Default::default() },
        )
        .unwrap();
        assert!(text.contains("MP, EY,2,70000.0\n"), "{text}");
        assert!(text.contains("MP, GXY,2,28000.0\n"), "{text}");
    }
}
