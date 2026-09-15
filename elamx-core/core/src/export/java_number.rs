//! Java's number formatting, because the exported deck is text and the text is
//! the artifact.
//!
//! Every exporter in eLamX builds its output with `"" + double` or with
//! `String.format`, so a deck written here only matches one written there if
//! the digits do. Two shapes are needed: `Double.toString`, which is what
//! string concatenation calls, and `%.<n>e`, which the LS-DYNA writers use.

/// Java's `Double.toString`.
///
/// Plain decimal for `1e-3 <= |d| < 1e7`, always with at least one digit after
/// the point; scientific notation outside that range, with the exponent written
/// bare (`1.0E-6`, `1.41E7` - no plus sign, no leading zero). The digits
/// themselves are the shortest decimal that reads back as the same double,
/// which is what both Java (since 19) and Rust produce.
pub fn java_double(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == 0.0 {
        return if value.is_sign_negative() { "-0.0" } else { "0.0" }.to_string();
    }

    // Rust's `{:e}` gives the shortest round-tripping digits with a normalised
    // mantissa, which is exactly what both branches below need.
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific.split_once('e').expect("{:e} writes an exponent");
    let exponent: i32 = exponent.parse().expect("{:e} writes an integer exponent");

    if (-3..7).contains(&exponent) {
        let plain = format!("{value}");
        if plain.contains('.') {
            plain
        } else {
            format!("{plain}.0")
        }
    } else if mantissa.contains('.') {
        format!("{mantissa}E{exponent}")
    } else {
        format!("{mantissa}.0E{exponent}")
    }
}

/// Java's `%.<decimals>e`: one digit before the point, `decimals` after it, and
/// an exponent of at least two digits carrying its sign always.
pub fn java_exponential(value: f64, decimals: usize) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }

    let formatted = format!("{value:.*e}", decimals);
    let (mantissa, exponent) = formatted.split_once('e').expect("{:e} writes an exponent");
    let exponent: i32 = exponent.parse().expect("{:e} writes an integer exponent");
    let sign = if exponent < 0 { '-' } else { '+' };
    format!("{mantissa}e{sign}{:02}", exponent.abs())
}

/// The same, uppercase: Java's `%.<decimals>E`.
pub fn java_exponential_upper(value: f64, decimals: usize) -> String {
    java_exponential(value, decimals).to_uppercase()
}

/// Right-aligned in `width`, the way `%<width>.<decimals>e` pads.
pub fn pad_left(text: &str, width: usize) -> String {
    if text.len() >= width {
        text.to_string()
    } else {
        format!("{}{}", " ".repeat(width - text.len()), text)
    }
}

/// Left-aligned in `width`, the way `%-<width>s` pads.
pub fn pad_right(text: &str, width: usize) -> String {
    if text.len() >= width {
        text.to_string()
    } else {
        format!("{}{}", text, " ".repeat(width - text.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The switch between plain and scientific notation, at both ends, plus the
    /// cases that made the function necessary in the first place: a density of
    /// 1.6e-9 and a modulus of 141000 have to come out as Java writes them.
    #[test]
    fn java_double_switches_notation_where_java_does() {
        for (value, expected) in [
            (0.0, "0.0"),
            (-0.0, "-0.0"),
            (1.0, "1.0"),
            (141000.0, "141000.0"),
            (0.125, "0.125"),
            (0.001, "0.001"),
            // Below 1e-3 Java stops writing the zeros out.
            (0.0001, "1.0E-4"),
            (1.6e-9, "1.6E-9"),
            (1.0e-6, "1.0E-6"),
            (9999999.0, "9999999.0"),
            // At 1e7 it switches again.
            (1.0e7, "1.0E7"),
            (1.41e7, "1.41E7"),
            (-1.6e-9, "-1.6E-9"),
            (-45.0, "-45.0"),
        ] {
            assert_eq!(java_double(value), expected, "{value}");
        }
    }

    /// The exponent shape the batch output shows - `1.0000E-06`, two digits and
    /// a sign - is the one thing about `%e` that Rust does differently, and it
    /// is the reason this function exists.
    #[test]
    fn the_exponent_carries_its_sign_and_two_digits() {
        assert_eq!(java_exponential_upper(1.0e-6, 4), "1.0000E-06");
        assert_eq!(java_exponential_upper(3.5e-5, 4), "3.5000E-05");
        assert_eq!(java_exponential(141000.0, 4), "1.4100e+05");
        assert_eq!(java_exponential(1.6e-9, 4), "1.6000e-09");
        assert_eq!(java_exponential(-2000.0, 4), "-2.0000e+03");
        assert_eq!(java_exponential(0.0, 4), "0.0000e+00");
        // Three-digit exponents keep all three.
        assert_eq!(java_exponential(1.0e-123, 4), "1.0000e-123");
    }

    /// Rounding is the printf kind - the digit shown is the rounded one, not
    /// the truncated one.
    #[test]
    fn the_mantissa_is_rounded_not_cut() {
        assert_eq!(java_exponential(1.23456e5, 4), "1.2346e+05");
        assert_eq!(java_exponential(9.99999e5, 4), "1.0000e+06");
    }
}
