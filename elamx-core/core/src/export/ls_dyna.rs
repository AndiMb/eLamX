//! LS-DYNA: one `*MAT_...` card per material and an `*INTEGRATION_SHELL`.
//! Reference: eLamX2/Export/src/de/elamx/export/lsdyna/{LSDynaExport,LS_Dyna_Mat22_Writer,LS_Dyna_Mat54_55_Writer,LS_Dyna_Mat58_Writer}.java
//!
//! An LS-DYNA deck carries no units. The model is written in whatever system
//! its author picked - tonne/mm/s, kg/m/s, gram/cm/microsecond - and every
//! number has to be in that system already. So these three multipliers convert
//! eLamX's own N/mm/tonne into it, and they are the one thing here the user has
//! to get right.
//!
//! The layup is an integration rule rather than a section: LS-DYNA integrates
//! through the shell at points the deck places by hand, one per ply, each with
//! its share of the thickness as its weight.

use super::java_number::{java_exponential, pad_left};
use super::{total_thickness, ExportLayer};
use crate::model::Material;
use serde::{Deserialize, Serialize};

/// Which material card to write. The numbers are LS-DYNA's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum LsDynaCard {
    /// `*MAT_COMPOSITE_DAMAGE`.
    Mat22,
    /// `*MAT_ENHANCED_COMPOSITE_DAMAGE` with Chang-Chang selected.
    Mat54,
    /// The same card with the Tsai-Wu matrix mode selected.
    Mat55,
    /// `*MAT_LAMINATED_COMPOSITE_FABRIC`.
    #[default]
    Mat58,
}

/// The three multipliers, applied as the writers apply them.
#[derive(Debug, Clone, Copy)]
struct Units {
    mass: f64,
    length: f64,
    time: f64,
}

impl Units {
    /// A stiffness: mass / (time^2 * length).
    fn stiffness(&self, value: f64) -> f64 {
        value * self.mass / (self.time * self.time * self.length)
    }

    fn density(&self, value: f64) -> f64 {
        value * self.mass / (self.length * self.length * self.length)
    }

    /// A strength, scaled as the original scales it: mass * length / time^2.
    ///
    /// Which is a FORCE, not a stress - a strength should scale exactly as a
    /// stiffness does, and in all three writers it does not. At the default
    /// multipliers of one the difference never shows, which is presumably why
    /// it has survived. Transcribed rather than corrected, like every other
    /// departure in this port: a deck that disagrees with eLamX's would be the
    /// worse outcome. See the note in the roadmap.
    fn strength(&self, value: f64) -> f64 {
        value * self.mass * self.length / (self.time * self.time)
    }
}

/// `%10.4e`, which is how every number on these cards is written.
fn e(value: f64) -> String {
    pad_left(&java_exponential(value, 4), 10)
}

fn int(value: i64) -> String {
    pad_left(&value.to_string(), 10)
}

pub(super) fn export(
    layers: &[ExportLayer],
    materials: &[&Material],
    card: LsDynaCard,
    mass: f64,
    length: f64,
    time: f64,
) -> String {
    let units = Units { mass, length, time };
    let mut out = String::new();
    for (index, material) in materials.iter().enumerate() {
        let number = index as i64 + 1;
        out.push_str(&match card {
            LsDynaCard::Mat22 => mat22(material, number, units),
            LsDynaCard::Mat54 => mat54_55(material, number, units, "54.0"),
            LsDynaCard::Mat55 => mat54_55(material, number, units, "55.0"),
            LsDynaCard::Mat58 => mat58(material, number, units),
        });
    }
    out.push_str(&integration_shell(layers));
    out
}

/// The shear line, which is the one place the three cards agree: all three
/// moduli when the ply has them, and a dashed placeholder for the missing
/// transverse one when it does not.
fn shear_line(material: &Material, units: Units) -> String {
    if material.g13 != 0.0 && material.g23 != 0.0 {
        format!(
            "{}{}{}\n",
            e(units.stiffness(material.g)),
            e(units.stiffness(material.g13)),
            e(units.stiffness(material.g23))
        )
    } else {
        format!(
            "{}      ----{}\n",
            e(units.stiffness(material.g)),
            e(units.stiffness(material.g13))
        )
    }
}

fn mat22(material: &Material, number: i64, units: Units) -> String {
    let mut out = String::from("*MAT_COMPOSITE DAMAGE\n");
    out.push_str("$      MID        RO        EA        EB        EC      PRBA      PRCA      PRCB\n");
    // The same Poisson's ratio three times: eLamX knows one, and the card wants
    // all three of a transversely isotropic ply.
    out.push_str(&format!(
        "{}{}{}{}          {}{}{}\n",
        int(number),
        e(units.density(material.rho)),
        e(units.stiffness(material.e_par)),
        e(units.stiffness(material.e_nor)),
        e(material.nue21()),
        e(material.nue21()),
        e(material.nue21()),
    ));
    out.push_str("$      GAB       GBC       GCA     KFAIL      AOPT      MACF\n");
    out.push_str(&shear_line(material, units));
    out.push_str("$       XP        YP        ZP        A1        A2        A3\n");
    out.push('\n');
    out.push_str("$       V1        V2        V3        D1        D2        D3      BETA\n");
    out.push('\n');
    out.push_str("$       SC        XT        YT        YC      ALPH        SN       SYZ       SZX\n");
    out.push_str(&format!(
        "{}{}{}{}\n",
        e(units.strength(material.r_shear)),
        e(units.strength(material.r_par_ten)),
        e(units.strength(material.r_nor_ten)),
        e(units.strength(material.r_nor_com)),
    ));
    out.push_str("$\n");
    out
}

fn mat54_55(material: &Material, number: i64, units: Units, criterion: &str) -> String {
    let mut out = String::from("*MAT_ENHANCED_COMPOSITE_DAMAGE\n");
    out.push_str("$      MID        RO        EA        EB      (EC)      PRBA    (PRCA)    (PRCB)\n");
    out.push_str(&format!(
        "{}{}{}{}          {}\n",
        int(number),
        e(units.density(material.rho)),
        e(units.stiffness(material.e_par)),
        e(units.stiffness(material.e_nor)),
        e(material.nue21()),
    ));
    out.push_str("$      GAB       GBC       GCA      (KF)      AOPT\n");
    out.push_str(&shear_line(material, units));
    out.push_str("$                                     A1        A2        A3    MANGLE\n");
    out.push('\n');
    out.push_str("$       V1        V2        V3        D1        D2        D3   DFFAILM    DFAILS\n");
    out.push('\n');
    out.push_str("$    TFAIL      ALPH      SOFT      FBRT     YCFAC    DFAILT    DFAILC       EFS\n");
    out.push('\n');
    out.push_str("$       XC        XT        YC        YT        SC      CRIT      BETA\n");
    // CRIT is what separates MAT54 from MAT55: the same card, a different
    // matrix criterion, selected by writing 54.0 or 55.0 into a field.
    out.push_str(&format!(
        "{}{}{}{}{}{}\n",
        e(units.strength(material.r_par_com)),
        e(units.strength(material.r_par_ten)),
        e(units.strength(material.r_nor_com)),
        e(units.strength(material.r_nor_ten)),
        e(units.strength(material.r_shear)),
        pad_left(criterion, 10),
    ));
    out.push_str("$\n");
    out
}

fn mat58(material: &Material, number: i64, units: Units) -> String {
    let mut out = String::from("*MAT_LAMINATED_COMPOSITE_FABRIC\n");
    out.push_str("$      mid        ro        EA        EB      (EC)      PRBA      TAU1    GAMMA1\n");
    out.push_str(&format!(
        "{}{}{}{}          {}\n",
        int(number),
        e(units.density(material.rho)),
        e(units.stiffness(material.e_par)),
        e(units.stiffness(material.e_nor)),
        e(material.nue21()),
    ));
    out.push_str("$      GAB       GBC       GCA    SLIMT1    SLIMC1    SLIMT2    SLIMC2     SLIMS\n");
    out.push_str(&shear_line(material, units));
    out.push_str("$     AOPT     TSIZE     ERODS      SOFT        FS\n");
    out.push('\n');
    out.push_str("$       XP        YP        ZP        A1        A2        A3\n");
    out.push('\n');
    out.push_str("$       V1        V2        V3        D1        D2        D3      BETA\n");
    out.push('\n');
    out.push_str("$     E11C      E11T      E22C      E22T       GMS\n");
    out.push('\n');
    out.push_str("$       XC        XT        YC        YT        SC\n");
    out.push_str(&format!(
        "{}{}{}{}{}\n",
        e(units.strength(material.r_par_com)),
        e(units.strength(material.r_par_ten)),
        e(units.strength(material.r_nor_com)),
        e(units.strength(material.r_nor_ten)),
        e(units.strength(material.r_shear)),
    ));
    out.push_str("$\n");
    out
}

/// The layup, as an integration rule: each ply becomes an integration point at
/// its own mid-plane, in the shell's own coordinate running from -1 to +1, with
/// its share of the thickness as the weight.
fn integration_shell(layers: &[ExportLayer]) -> String {
    let total = total_thickness(layers);
    let mut out = String::from("*INTEGRATION_SHELL\n");
    out.push_str("$     irID       nIP      ESOP\n");
    out.push_str(&format!("      ----{}{}\n", int(layers.len() as i64), int(0)));
    out.push_str("$        S        wf       pid\n");

    let mut below = 0.0;
    for layer in layers {
        let location = 2.0 * (0.5 * layer.thickness + below) / total - 1.0;
        let weight = layer.thickness / total;
        out.push_str(&format!(
            "{}{}{}\n",
            pad_left(&format!("{location:.7}"), 10),
            e(weight),
            int(layer.material_number as i64),
        ));
        below += layer.thickness;
    }
    out.push_str("$\n");
    out
}

#[cfg(test)]
mod tests {
    use super::super::tests::laminate_and_materials;
    use super::super::{export as export_deck, ExportOptions, ExportTarget};
    use super::*;

    fn deck(card: LsDynaCard, mass: f64, length: f64, time: f64) -> String {
        let (laminate, materials) = laminate_and_materials();
        export_deck(
            &laminate,
            &materials,
            ExportTarget::LsDyna { card, mass, length, time },
            ExportOptions::default(),
        )
        .unwrap()
    }

    /// The MAT58 deck at unit multipliers, written out.
    #[test]
    fn the_deck_reads_as_ls_dyna_expects_it() {
        let expected = "\
*MAT_LAMINATED_COMPOSITE_FABRIC
$      mid        ro        EA        EB      (EC)      PRBA      TAU1    GAMMA1
         11.7000e-091.4100e+059.3400e+03          2.3184e-02
$      GAB       GBC       GCA    SLIMT1    SLIMC1    SLIMT2    SLIMC2     SLIMS
4.5000e+03      ----0.0000e+00
$     AOPT     TSIZE     ERODS      SOFT        FS

$       XP        YP        ZP        A1        A2        A3

$       V1        V2        V3        D1        D2        D3      BETA

$     E11C      E11T      E22C      E22T       GMS

$       XC        XT        YC        YT        SC
1.2000e+032.0000e+032.0000e+026.0000e+019.0000e+01
$
*MAT_LAMINATED_COMPOSITE_FABRIC
$      mid        ro        EA        EB      (EC)      PRBA      TAU1    GAMMA1
         22.7000e-097.0000e+047.0000e+04          2.5000e-01
$      GAB       GBC       GCA    SLIMT1    SLIMC1    SLIMT2    SLIMC2     SLIMS
2.8000e+04      ----0.0000e+00
$     AOPT     TSIZE     ERODS      SOFT        FS

$       XP        YP        ZP        A1        A2        A3

$       V1        V2        V3        D1        D2        D3      BETA

$     E11C      E11T      E22C      E22T       GMS

$       XC        XT        YC        YT        SC
3.0000e+023.0000e+023.0000e+023.0000e+021.7320e+02
$
*INTEGRATION_SHELL
$     irID       nIP      ESOP
      ----         5         0
$        S        wf       pid
-0.83333331.6667e-01         1
-0.50000001.6667e-01         1
 0.00000003.3333e-01         2
 0.50000001.6667e-01         1
 0.83333331.6667e-01         1
$
";
        assert_eq!(deck(LsDynaCard::Mat58, 1.0, 1.0, 1.0), expected);
    }

    /// The integration points run from -1 to +1 through the shell, their
    /// weights add up to one, and the middle ply of a symmetric stack sits at
    /// zero. That is checkable without reference to any deck.
    #[test]
    fn the_integration_points_span_the_shell_and_their_weights_sum_to_one() {
        let text = deck(LsDynaCard::Mat58, 1.0, 1.0, 1.0);
        let points: Vec<(f64, f64)> = text
            .lines()
            .skip_while(|l| !l.starts_with("$        S"))
            .skip(1)
            .take_while(|l| *l != "$")
            .map(|l| {
                (
                    l[0..10].trim().parse::<f64>().unwrap(),
                    l[10..20].trim().parse::<f64>().unwrap(),
                )
            })
            .collect();

        assert_eq!(points.len(), 5);
        // Not to machine precision: the weights are written with four decimals
        // and read back from the deck, so the deck's own rounding is the
        // tolerance.
        let weights: f64 = points.iter().map(|p| p.1).sum();
        assert!((weights - 1.0).abs() < 2e-5, "{weights}");
        assert_eq!(points[2].0, 0.0);
        assert!((points[0].0 + points[4].0).abs() < 1e-9);
        assert!(points.windows(2).all(|w| w[0].0 < w[1].0), "{points:?}");
    }

    /// MAT54 and MAT55 are the same card with one field changed, which is worth
    /// a test because it would be easy to give them two writers.
    #[test]
    fn mat54_and_mat55_differ_only_in_the_criterion_field() {
        let mat54 = deck(LsDynaCard::Mat54, 1.0, 1.0, 1.0);
        let mat55 = deck(LsDynaCard::Mat55, 1.0, 1.0, 1.0);
        assert_eq!(mat54.replace("      54.0", "      55.0"), mat55);
        assert!(mat54.contains("*MAT_ENHANCED_COMPOSITE_DAMAGE"), "{mat54}");
    }

    #[test]
    fn mat22_writes_the_composite_damage_card() {
        let text = deck(LsDynaCard::Mat22, 1.0, 1.0, 1.0);
        assert!(text.contains("*MAT_COMPOSITE DAMAGE\n"), "{text}");
        // Shear strength first on the MAT22 strength line, unlike the others.
        assert!(text.contains("\n9.0000e+012.0000e+036.0000e+012.0000e+02\n"), "{text}");
    }

    /// The multipliers, which are the whole reason the deck is not simply the
    /// numbers: a stiffness scales as mass/(time^2 * length), a density as
    /// mass/length^3.
    #[test]
    fn the_unit_multipliers_scale_every_number() {
        // tonne/mm/s to kg/m/s: mass * 1000, length * 0.001.
        let text = deck(LsDynaCard::Mat58, 1000.0, 0.001, 1.0);
        // 141000 * 1000 / 0.001 = 1.41e11
        assert!(text.contains("1.4100e+11"), "{text}");
        // 1.7e-9 * 1000 / 1e-9 = 1.7e3
        assert!(text.contains("1.7000e+03"), "{text}");
    }
}
