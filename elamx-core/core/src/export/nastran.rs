//! Nastran: MAT1/MAT8 material cards and one PCOMP.
//! Reference: eLamX2/Export/src/de/elamx/export/Nastran/{NastranExport,NastranCardCreator,FixedFloat}.java
//!
//! A Nastran card is a grid: eight fields of eight characters, or five of
//! sixteen in the large format, continued onto as many lines as the data needs.
//! So the card is not written left to right - values are placed at a (line,
//! column) and the gaps are filled afterwards, which is what `Card` below does
//! and why it exists at all.

use super::java_number::{java_double, java_exponential_upper, pad_left, pad_right};
use super::{is_isotropic_enough, ExportLayer, ExportOptions, Offset};
use crate::model::Material;
use serde::{Deserialize, Serialize};

/// Which field width to write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(rename_all = "snake_case")]
pub enum NastranFormat {
    /// Eight characters per field.
    #[default]
    Small,
    /// Sixteen, for values that do not fit in eight.
    Large,
    /// Offered by eLamX and NOT implemented there: `getCard()` has no branch
    /// for it and falls through to the small format. Kept so the option means
    /// the same thing in both programs.
    Free,
}

/// One value at its place in the card's grid.
struct Entry {
    line: usize,
    column: usize,
    value: Value,
}

enum Value {
    Int(i64),
    Real(f64),
    Text(String),
}

/// A card under construction. Values may be added in any order; `finish` sorts
/// them and fills the gaps.
struct Card {
    name: String,
    format: NastranFormat,
    entries: Vec<Entry>,
}

impl Card {
    fn new(name: &str, format: NastranFormat) -> Self {
        Card {
            name: name.to_string(),
            format,
            entries: Vec::new(),
        }
    }

    fn int(&mut self, line: usize, column: usize, value: i64) {
        debug_assert!((2..10).contains(&column), "Nastran-Spalte liegt ausserhalb 2..9");
        self.entries.push(Entry { line, column, value: Value::Int(value) });
    }

    fn real(&mut self, line: usize, column: usize, value: f64) {
        debug_assert!((2..10).contains(&column), "Nastran-Spalte liegt ausserhalb 2..9");
        self.entries.push(Entry { line, column, value: Value::Real(value) });
    }

    #[allow(dead_code)]
    fn text(&mut self, line: usize, column: usize, value: &str) {
        let value = if value.len() > 8 { &value[..8] } else { value };
        self.entries.push(Entry {
            line,
            column,
            value: Value::Text(value.to_string()),
        });
    }

    fn finish(mut self) -> String {
        self.entries.sort_by_key(|e| (e.line, e.column));
        match self.format {
            NastranFormat::Large => self.large(),
            // Free is the original's silent fall-through to small.
            NastranFormat::Small | NastranFormat::Free => self.small(),
        }
    }

    fn small(&self) -> String {
        let mut card = pad_right(&self.name, 8);
        let mut column = 2;
        let mut line = 1;

        for entry in &self.entries {
            if column == 10 {
                card.push_str("+\n+       ");
                column = 2;
                line += 1;
            }
            while column != entry.column || line != entry.line {
                card.push_str("        ");
                column += 1;
                if column == 10 {
                    card.push_str("+\n+       ");
                    column = 2;
                    line += 1;
                }
            }
            card.push_str(&entry.value.field(8));
            column += 1;
        }

        card
    }

    fn large(&self) -> String {
        // The name gets a star, and every field is sixteen wide - which means
        // one logical line of eight fields becomes two physical ones, hence the
        // doubling of the line number below.
        let mut card = if self.name.len() < 8 {
            pad_right(&format!("{}*", self.name), 8)
        } else {
            pad_right(&format!("{}*", &self.name[..7]), 8)
        };
        let mut column = 2;
        let mut line = 1;

        for entry in &self.entries {
            if column == 6 {
                card.push_str("*\n*       ");
                column = 2;
                line += 1;
            }
            let (entry_column, entry_line) = if entry.column < 6 {
                (entry.column, entry.line * 2 - 1)
            } else {
                (entry.column - 4, entry.line * 2)
            };
            while column != entry_column || line != entry_line {
                card.push_str("                ");
                column += 1;
                if column == 6 {
                    card.push_str("*\n*       ");
                    column = 2;
                    line += 1;
                }
            }
            card.push_str(&entry.value.field(16));
            column += 1;
        }

        // A large-format card always ends on an even physical line, so an odd
        // one is padded out and continued. The original leaves the dangling
        // continuation marker behind; so does this.
        if line % 2 > 0 {
            while column != 6 {
                card.push_str("                ");
                column += 1;
            }
            card.push_str("*\n*       ");
        }

        card
    }
}

impl Value {
    fn field(&self, width: usize) -> String {
        match self {
            Value::Text(text) => pad_right(text, width),
            Value::Int(value) => pad_left(&value.to_string(), width),
            Value::Real(value) => fixed_float(*value, width),
        }
    }
}

/// A real number squeezed into `digits` characters, eLamX's way.
///
/// Transcribed from `FixedFloat`, including what it does rather than what it
/// looks like it should do: a value that is too long is TRUNCATED, not rounded,
/// and one below 1 loses its leading zero - which is the Nastran convention,
/// and the reason the function is not simply a format string.
fn fixed_float(value: f64, digits: usize) -> String {
    let plain = java_double(value);
    if plain.len() <= digits {
        return pad_left(&plain, digits);
    }

    if value < 0.0 {
        return format!("-{}", fixed_float(-value, digits - 1));
    }

    if value >= 1.0 {
        // The largest value whose digits still fit: 10^(digits-1) - 1.
        let max_plain = 10f64.powi(digits as i32 - 1) - 1.0;
        if value <= max_plain {
            return if plain.len() > digits {
                plain[..digits].to_string()
            } else {
                plain
            };
        }
        return java_exponential_upper(value, digits - 6);
    }

    // Below one: fixed point without the leading zero.
    let fixed = format!("{value:.*}", digits - 1);
    let fixed = fixed.strip_prefix('0').unwrap_or(&fixed).to_string();
    let zeros = fixed
        .chars()
        .skip(2)
        .take_while(|c| *c == '0')
        .count();
    if digits as i64 - zeros as i64 - 1 < digits as i64 + 1 - 5 {
        return java_exponential_upper(value, digits - 6);
    }
    fixed
}

pub(super) fn export(
    layers: &[ExportLayer],
    materials: &[&Material],
    options: ExportOptions,
    format: NastranFormat,
) -> String {
    let mut out = String::new();
    for (index, material) in materials.iter().enumerate() {
        out.push_str(&material_card(material, index + 1, options, format));
        out.push('\n');
    }
    out.push_str(&pcomp(layers, options, format));
    out.push('\n');
    out
}

fn material_card(
    material: &Material,
    number: usize,
    options: ExportOptions,
    format: NastranFormat,
) -> String {
    let number = number as i64;
    let isotropic = if options.hygrothermal {
        // With expansion in the deck, a material that expands differently along
        // and across is anisotropic whatever its stiffness says.
        is_isotropic_enough(material)
            && material.alpha_t_par == material.alpha_t_nor
            && material.beta_par == material.beta_nor
    } else {
        is_isotropic_enough(material)
    };

    let mut card = Card::new(if isotropic { "MAT1" } else { "MAT8" }, format);
    if isotropic {
        card.int(1, 2, number);
        card.real(1, 3, material.e_par);
        // Field 4 is G, which eLamX leaves empty on purpose - Nastran derives
        // it from E and NU, and the commented-out line in the original says so.
        card.real(1, 5, material.nue12);
        card.real(1, 6, material.rho);
        if options.hygrothermal {
            card.real(1, 7, material.alpha_t_par);
        }
    } else {
        card.int(1, 2, number);
        card.real(1, 3, material.e_par);
        card.real(1, 4, material.e_nor);
        card.real(1, 5, material.nue12);
        card.real(1, 6, material.g);
        if material.g13 != 0.0 {
            card.real(1, 7, material.g13);
        }
        if material.g23 != 0.0 {
            card.real(1, 8, material.g23);
        }
        card.real(1, 9, material.rho);
        if options.hygrothermal {
            card.real(2, 2, material.alpha_t_par);
            card.real(2, 3, material.alpha_t_nor);
        }
    }

    // The strengths only reach the card when the expansion does. That is not a
    // choice made here - in the original the strength block sits INSIDE the
    // hygrothermal branch, so asking for strengths alone silently writes none.
    // Carried as it stands: a deck that differs from eLamX's would be worse
    // than one that shares its omission.
    if options.hygrothermal && options.strength {
        if isotropic {
            card.real(2, 2, material.r_par_ten);
            card.real(2, 3, material.r_par_com);
            card.real(2, 4, material.r_shear);
        } else {
            card.real(2, 5, material.r_par_ten);
            card.real(2, 6, material.r_par_com);
            card.real(2, 7, material.r_nor_ten);
            card.real(2, 8, material.r_nor_com);
            card.real(2, 9, material.r_shear);
        }
    }

    card.finish()
}

fn pcomp(layers: &[ExportLayer], options: ExportOptions, format: NastranFormat) -> String {
    let mut card = Card::new("PCOMP", format);
    card.int(1, 2, 1);
    match options.offset {
        Offset::Bot => card.real(1, 3, 0.0),
        Offset::Top => card.real(1, 3, -super::total_thickness(layers)),
        Offset::Mid => {}
    }

    // Four fields per ply - material, thickness, angle, and the stress-output
    // flag eLamX leaves empty - starting on the card's second line.
    let mut line = 2;
    let mut column = 2;
    for layer in layers {
        if column == 10 {
            line += 1;
            column = 2;
        }
        card.int(line, column, layer.material_number as i64);
        card.real(line, column + 1, layer.thickness);
        card.real(line, column + 2, layer.angle_deg);
        column += 4;
    }

    card.finish()
}

#[cfg(test)]
mod tests {
    use super::super::tests::laminate_and_materials;
    use super::super::{export as export_deck, ExportOptions, ExportTarget, Offset};
    use super::*;

    fn deck(format: NastranFormat, options: ExportOptions) -> String {
        let (laminate, materials) = laminate_and_materials();
        export_deck(
            &laminate,
            &materials,
            ExportTarget::Nastran { format },
            options,
        )
        .unwrap()
    }

    /// The format's own rule, checked rather than assumed: a small-field card
    /// is a name and then fields of exactly eight characters, and a card that
    /// breaks the grid is read WRONGLY by Nastran rather than rejected by it.
    /// The trailing marker is the continuation flag, which sits beyond the
    /// eight data fields.
    #[test]
    fn every_field_is_eight_characters_wide() {
        let text = deck(NastranFormat::Small, ExportOptions::default());
        for line in text.lines().filter(|l| !l.is_empty()) {
            let data = line.strip_suffix('+').unwrap_or(line);
            assert_eq!(data.len() % 8, 0, "{line:?} ist kein Vielfaches von acht");
            assert!(data.len() <= 72, "{line:?} ist laenger als eine Nastran-Zeile");
        }
    }

    #[test]
    fn every_large_field_is_sixteen_characters_wide() {
        let text = deck(NastranFormat::Large, ExportOptions::default());
        for line in text.lines().filter(|l| !l.is_empty()) {
            let data = line.strip_suffix('*').unwrap_or(line);
            assert_eq!((data.len() - 8) % 16, 0, "{line:?}");
            assert!(data.len() <= 72, "{line:?}");
        }
    }

    /// The whole small-format deck, written out.
    ///
    /// An anisotropic material becomes MAT8 and an isotropic one MAT1; the two
    /// empty fields on the MAT8 line are the transverse shear moduli these
    /// materials do not have; and the PCOMP carries five plies, two per line,
    /// because the stored three are symmetric with a middle layer and each ply
    /// takes four fields of which eLamX fills three.
    ///
    /// Read against the Java a second time rather than produced by it: the
    /// export is a GUI action there, so unlike every calculating module it
    /// cannot be run from the batch mode. What CAN be checked independently is
    /// the format itself, and the two tests above do that.
    #[test]
    fn the_deck_reads_as_nastran_expects_it() {
        let text = deck(NastranFormat::Small, ExportOptions::default());
        let expected = "\
MAT8           1141000.0  9340.0    0.35  4500.0                  1.7E-9
MAT1           2 70000.0            0.25  2.7E-9
PCOMP          1                                                        +
+              1   0.125     0.0               1   0.125    45.0        +
+              2    0.25   -45.0               1   0.125    45.0        +
+              1   0.125     0.0
";
        assert_eq!(text, expected);
    }

    /// `Free` is offered by eLamX and not implemented there - it writes a
    /// small-field card. Stated as a test so that it is a transcribed quirk and
    /// not a gap.
    #[test]
    fn the_free_format_is_the_small_format() {
        assert_eq!(
            deck(NastranFormat::Free, ExportOptions::default()),
            deck(NastranFormat::Small, ExportOptions::default())
        );
    }

    /// Z0 is only written when the reference plane is not the middle one, and
    /// the top offset is the whole stack below the plane.
    #[test]
    fn the_offset_reaches_the_pcomp() {
        let mid = deck(NastranFormat::Small, ExportOptions::default());
        assert!(mid.contains("PCOMP          1        "), "{mid}");

        let bottom = deck(
            NastranFormat::Small,
            ExportOptions { offset: Offset::Bot, ..Default::default() },
        );
        assert!(bottom.contains("PCOMP          1     0.0"), "{bottom}");

        let top = deck(
            NastranFormat::Small,
            ExportOptions { offset: Offset::Top, ..Default::default() },
        );
        assert!(top.contains("PCOMP          1   -0.75"), "{top}");
    }

    /// Expansion turns the aluminium's card from an eight-field MAT1 into one
    /// carrying A, and the strengths follow it - including the original's
    /// coupling of the two options.
    #[test]
    fn expansion_and_strength_reach_the_material_cards() {
        let text = deck(
            NastranFormat::Small,
            ExportOptions { hygrothermal: true, strength: true, ..Default::default() },
        );
        assert!(text.contains(" 2.3E-5"), "{text}");
        assert!(text.contains("  300.0"), "{text}");
        assert!(text.contains(" 2000.0"), "{text}");

        // Strength alone writes none, because the original's strength block
        // sits inside its hygrothermal branch.
        let strength_only = deck(
            NastranFormat::Small,
            ExportOptions { strength: true, ..Default::default() },
        );
        assert_eq!(strength_only, deck(NastranFormat::Small, ExportOptions::default()));
    }

    /// `FixedFloat` is the reason a Nastran field is readable at all, and each
    /// of its branches does something different enough to be worth stating.
    #[test]
    fn a_real_is_squeezed_into_its_field_the_way_nastran_wants() {
        // Fits as it stands, right-aligned.
        assert_eq!(fixed_float(0.35, 8), "    0.35");
        assert_eq!(fixed_float(141000.0, 8), "141000.0");
        // A value that already fits is written as it stands - the branches
        // below only run when Java's own notation is too long for the field.
        assert_eq!(fixed_float(0.125, 8), "   0.125");
        // Below one and too long: the leading zero goes, which buys a digit.
        assert_eq!(fixed_float(1.0 / 3.0, 8), ".3333333");
        // Too long above one: TRUNCATED, not rounded.
        assert_eq!(fixed_float(123456.789, 8), "123456.7");
        // Java's own notation when it is shorter than the field.
        assert_eq!(fixed_float(1.7e-9, 8), "  1.7E-9");
        // Negative values lose a character to the sign.
        assert_eq!(fixed_float(-45.0, 8), "   -45.0");
        assert_eq!(fixed_float(-1.0 / 3.0, 8), "-.333333");
    }
}
