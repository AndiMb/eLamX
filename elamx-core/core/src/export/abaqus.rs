//! Abaqus: `*MATERIAL` blocks and one `*SHELL GENERAL SECTION`.
//! Reference: eLamX2/Export/src/de/elamx/export/Abaqus/AbaqusExport.java

use super::java_number::java_double;
use super::{ExportLayer, ExportOptions, Offset};
use crate::model::Material;

/// eLamX's own warning, word for word.
///
/// It is the first thing in the file because it is the most important thing in
/// it: a shell section needs transverse shear stiffnesses, eLamX has none
/// unless the user typed them in, and rather than refuse it invents them as
/// five sixths of the in-plane one and says so. Anyone reading the deck reads
/// this first.
const WARNING: &str = "\
** WARNING:
** No material properties for the transverse shear stiffnesses are specified in eLamX.
** Therefore, the inplane-shear stiffness is multiplied by a factor of 5/6 to obtain the transverse shear stiffnesses.
** The resulting values should not be used in FE-analyses

";

pub(super) fn export(
    layers: &[ExportLayer],
    materials: &[&Material],
    options: ExportOptions,
) -> String {
    let mut out = String::from(WARNING);
    for (index, material) in materials.iter().enumerate() {
        out.push_str(&material_block(material, index + 1, options));
    }
    out.push_str(&section(layers, options));
    out
}

fn material_name(number: usize) -> String {
    format!("mat{number}")
}

fn material_block(material: &Material, number: usize, options: ExportOptions) -> String {
    let name = material_name(number);
    let mut out = format!("*MATERIAL, NAME={name}\n*ELASTIC, TYPE=LAMINA\n");

    let g13 = if material.g13 != 0.0 { material.g13 } else { 5.0 / 6.0 * material.g };
    let g23 = if material.g23 != 0.0 { material.g23 } else { 5.0 / 6.0 * material.g };
    out.push_str(&format!(
        "{}, {}, {}, {}, {}, {}\n",
        java_double(material.e_par),
        java_double(material.e_nor),
        java_double(material.nue12),
        java_double(material.g),
        java_double(g13),
        java_double(g23),
    ));

    if options.strength {
        out.push_str("*FAIL STRESS\n");
        out.push_str(&format!(
            "{}, {}, {}, {}, {}\n",
            java_double(material.r_par_ten),
            java_double(material.r_par_com),
            java_double(material.r_nor_ten),
            java_double(material.r_nor_com),
            java_double(material.r_shear),
        ));
    }
    if options.hygrothermal {
        out.push_str("*EXPANSION,TYPE=ORTHO\n");
        out.push_str(&format!(
            "{}, {}\n",
            java_double(material.alpha_t_par),
            java_double(material.alpha_t_nor),
        ));
    }
    out.push_str("*DENSITY\n");
    out.push_str(&format!("{}\n\n", java_double(material.rho)));
    out
}

fn section(layers: &[ExportLayer], options: ExportOptions) -> String {
    let mut out = String::from("*SHELL GENERAL SECTION, ELSET=SET1, COMPOSITE\n");
    // SPOS and SNEG name the surface the reference plane sits on. The original
    // writes them on their own line, which Abaqus reads as a continuation of
    // the keyword line above only because the line ends without a comma - a
    // quirk of the deck this port keeps rather than tidies.
    match options.offset {
        Offset::Top => out.push_str(" OFFSET=SPOS\n"),
        Offset::Bot => out.push_str(" OFFSET=SNEG\n"),
        Offset::Mid => {}
    }
    for layer in layers {
        out.push_str(&format!(
            "{}, , {}, {}\n",
            java_double(layer.thickness),
            material_name(layer.material_number),
            java_double(layer.angle_deg),
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::tests::laminate_and_materials;
    use super::super::{export as export_deck, ExportOptions, ExportTarget, Offset};

    fn deck(options: ExportOptions) -> String {
        let (laminate, materials) = laminate_and_materials();
        export_deck(&laminate, &materials, ExportTarget::Abaqus, options).unwrap()
    }

    /// The whole deck at the defaults, written out. The transverse shear
    /// moduli are the invented ones - both materials have none - which is what
    /// the warning at the top is about.
    #[test]
    fn the_deck_reads_as_abaqus_expects_it() {
        let expected = "\
** WARNING:
** No material properties for the transverse shear stiffnesses are specified in eLamX.
** Therefore, the inplane-shear stiffness is multiplied by a factor of 5/6 to obtain the transverse shear stiffnesses.
** The resulting values should not be used in FE-analyses

*MATERIAL, NAME=mat1
*ELASTIC, TYPE=LAMINA
141000.0, 9340.0, 0.35, 4500.0, 3750.0, 3750.0
*DENSITY
1.7E-9

*MATERIAL, NAME=mat2
*ELASTIC, TYPE=LAMINA
70000.0, 70000.0, 0.25, 28000.0, 23333.333333333336, 23333.333333333336
*DENSITY
2.7E-9

*SHELL GENERAL SECTION, ELSET=SET1, COMPOSITE
0.125, , mat1, 0.0
0.125, , mat1, 45.0
0.25, , mat2, -45.0
0.125, , mat1, 45.0
0.125, , mat1, 0.0
";
        assert_eq!(deck(ExportOptions::default()), expected);
    }

    /// A ply's own transverse shear moduli are used when it has them, and then
    /// the five-sixths rule does not apply.
    #[test]
    fn a_material_that_has_transverse_shear_moduli_keeps_them() {
        let (laminate, mut materials) = laminate_and_materials();
        materials.get_mut("m-cfk").unwrap().g13 = 4500.0;
        materials.get_mut("m-cfk").unwrap().g23 = 3000.0;
        let text = super::super::export(
            &laminate,
            &materials,
            ExportTarget::Abaqus,
            ExportOptions::default(),
        )
        .unwrap();
        assert!(text.contains("141000.0, 9340.0, 0.35, 4500.0, 4500.0, 3000.0\n"), "{text}");
    }

    #[test]
    fn strength_expansion_and_offset_reach_the_deck() {
        let text = deck(ExportOptions {
            hygrothermal: true,
            strength: true,
            offset: Offset::Top,
        });
        assert!(text.contains("*FAIL STRESS\n2000.0, 1200.0, 60.0, 200.0, 90.0\n"), "{text}");
        assert!(text.contains("*EXPANSION,TYPE=ORTHO\n1.0E-6, 3.5E-5\n"), "{text}");
        assert!(text.contains("COMPOSITE\n OFFSET=SPOS\n"), "{text}");

        let bottom = deck(ExportOptions { offset: Offset::Bot, ..Default::default() });
        assert!(bottom.contains(" OFFSET=SNEG\n"), "{bottom}");
    }
}
