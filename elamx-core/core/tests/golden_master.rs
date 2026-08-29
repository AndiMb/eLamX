//! Golden-master tests against the Java eLamX 3.x reference implementation.
//!
//! Unlike the unit tests inside `src/`, which check self-consistency and
//! analytically known values, these compare against numbers the original
//! program actually produced. That is the only kind of test that answers the
//! question a port has to answer: *does it compute the same thing?*
//!
//! Data flow (see `tests/golden/README.md` for the regeneration commands):
//!
//! ```text
//!   golden/generate.mjs ─┬─> golden/reference.elamx ──[eLamX batch]──> golden/reference.txt
//!                        └─> golden/reference.input.json                        │
//!                                     │                                         │
//!                                  inputs                                   expected
//!                                     └──────────────> this test <──────────────┘
//! ```
//!
//! Both input forms come from one definition in `generate.mjs`, so the Java run
//! and this test can never diverge on the inputs. Tolerances are derived from
//! the batch writer's own `printf` format strings rather than picked by feel -
//! see `Tolerances` below.

use elamx_core::clt::{determine_values, get_layer_results, CltLaminate, Loads, Strains};
use elamx_core::failure::default_criterion_registry;
use elamx_core::model::{Laminate, Material};
use serde::Deserialize;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Inputs (golden/reference.input.json)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GoldenInput {
    materials: HashMap<String, Material>,
    laminates: Vec<GoldenLaminate>,
}

#[derive(Deserialize)]
struct GoldenLaminate {
    laminate: Laminate,
    /// Criterion display names in stacking order, as the batch output prints
    /// them. Checked explicitly because `LaminateLoadSaveImpl` falls back to
    /// Puck *silently* when it doesn't recognise a criterion class name - without
    /// this check a typo there would quietly compare Puck against something else.
    criterion_display_names: Vec<String>,
    calculations: Vec<GoldenCalculation>,
}

#[derive(Deserialize)]
struct GoldenCalculation {
    name: String,
    loads: Loads,
    strains: Strains,
    use_strain: [bool; 6],
}

// ---------------------------------------------------------------------------
// Expected values (golden/reference.txt, written by the eLamX batch mode)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct ExpectedLaminate {
    name: String,
    symmetric: bool,
    number_of_layers: usize,
    total_thickness: f64,
    /// (thickness, angle) per stored layer, in stacking order.
    stacking: Vec<(f64, f64)>,
    criterion_display_names: Vec<String>,
    abd: Vec<f64>,
    abd_inv: Vec<f64>,
    /// Exx, Eyy, Gxy - each as (simple, bend_simple, fixed, bend_fixed).
    ex: [f64; 4],
    ey: [f64; 4],
    g: [f64; 4],
    /// nu_xy, nu_yx - each as (simple, bend_simple).
    nuxy: [f64; 2],
    nuyx: [f64; 2],
    non_dimensional: [f64; 4],
}

#[derive(Debug, Default)]
struct ExpectedCalculation {
    name: String,
    loads: [f64; 6],
    hygrothermal: [f64; 6],
    delta_t: f64,
    delta_h: f64,
    strains: [f64; 6],
    layers: Vec<ExpectedLayer>,
}

#[derive(Debug, Default, Clone)]
struct ExpectedLayer {
    zm: f64,
    /// s11, s22, s12, e11, e22, e12, RF - in the local (fibre) system.
    upper: [f64; 7],
    lower: [f64; 7],
}

// ---------------------------------------------------------------------------
// Tolerances, derived from GeneralOutputWriterServiceImpl / CalculationOutputWriterServiceImpl
// ---------------------------------------------------------------------------

mod tolerances {
    /// ABD and the effective moduli print as `%10.1f` / `%-10.1f`: one decimal,
    /// so the printed value can be off by at most half a unit in that place.
    pub const ONE_DECIMAL: f64 = 0.050_001;
    /// Poisson's ratios print as `%-10.5f`.
    pub const FIVE_DECIMALS: f64 = 0.000_005_001;
    /// The flexibility matrix, loads, hygrothermal forces, strains and the
    /// non-dimensional parameters print as `%17.10E`: 11 significant digits.
    pub const ELEVEN_DIGITS: f64 = 5e-10;
    /// Layer results print as `%12.5E`: 6 significant digits.
    pub const SIX_DIGITS: f64 = 1e-5;
    /// Above this, a reserve factor is "no failure possible here" rather than a
    /// meaningful number (the Java side reports POSITIVE_INFINITY for an
    /// unstressed ply, which prints as a huge or literally infinite value).
    pub const RF_EFFECTIVELY_INFINITE: f64 = 1e12;
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/// Collects every mismatch instead of stopping at the first one: when auditing
/// a port, the shape of the failures across criteria and laminates says far
/// more than whichever one happens to be checked first.
#[derive(Default)]
struct Report {
    failures: Vec<String>,
    checks: usize,
}

impl Report {
    /// `|actual - expected| <= abs_floor + rel * |expected|`.
    fn close(&mut self, what: impl std::fmt::Display, actual: f64, expected: f64, abs_floor: f64, rel: f64) {
        self.checks += 1;
        let diff = (actual - expected).abs();
        if diff <= abs_floor + rel * expected.abs() {
            return;
        }
        self.failures.push(format!(
            "{what}: eLamX={expected:.10e}  Rust={actual:.10e}  Abw={diff:.3e}"
        ));
    }

    /// Compares a whole vector with a relative tolerance, using the group's own
    /// largest magnitude as the absolute floor. Without that floor, entries that
    /// are only numerical noise around zero (an off-axis ABD term of a balanced
    /// laminate, say) would be compared relative to the noise itself.
    fn close_group(&mut self, what: &str, actual: &[f64], expected: &[f64], rel: f64) {
        assert_eq!(actual.len(), expected.len(), "{what}: Länge unterschiedlich");
        let floor = rel * expected.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
            self.close(format!("{what}[{i}]"), *a, *e, floor, rel);
        }
    }

    fn eq<T: PartialEq + std::fmt::Debug>(&mut self, what: impl std::fmt::Display, actual: T, expected: T) {
        self.checks += 1;
        if actual != expected {
            self.failures.push(format!("{what}: eLamX={expected:?}  Rust={actual:?}"));
        }
    }

    fn finish(self, title: &str) {
        if self.failures.is_empty() {
            println!("{title}: {} Vergleiche, alle bestanden", self.checks);
            return;
        }
        panic!(
            "{title}: {} von {} Vergleichen fehlgeschlagen:\n  {}",
            self.failures.len(),
            self.checks,
            self.failures.join("\n  ")
        );
    }
}

// ---------------------------------------------------------------------------
// Parsing the batch output
// ---------------------------------------------------------------------------

fn try_parse_f64(token: &str) -> Option<f64> {
    match token.trim() {
        "Infinity" => Some(f64::INFINITY),
        "-Infinity" => Some(f64::NEG_INFINITY),
        "NaN" => Some(f64::NAN),
        t => t.parse().ok(),
    }
}

fn parse_f64(token: &str) -> f64 {
    try_parse_f64(token).unwrap_or_else(|| panic!("keine Zahl in reference.txt: {token:?}"))
}

/// Banner titles are centred by padding with `*` (see `Utilities.centeredText`).
fn banner_text(line: &str) -> &str {
    line.trim_matches('*').trim()
}

fn value_after_eq(line: &str) -> f64 {
    parse_f64(line.split('=').nth(1).unwrap_or_else(|| panic!("kein '=' in {line:?}")))
}

/// All whitespace-separated numbers after the first `=`, skipping the
/// non-numeric placeholders the batch writer mixes in (`-` for a quantity that
/// doesn't exist in that column, `%` as the unit behind `deltac`).
fn values_after_eq(line: &str) -> Vec<f64> {
    line.split('=')
        .nth(1)
        .unwrap_or_else(|| panic!("kein '=' in {line:?}"))
        .split_whitespace()
        .filter_map(try_parse_f64)
        .collect()
}

fn parse_matrix(lines: &[&str], start: usize) -> Vec<f64> {
    let mut values = Vec::with_capacity(36);
    for row in &lines[start..start + 6] {
        let row_values: Vec<f64> = row.split_whitespace().map(parse_f64).collect();
        assert_eq!(row_values.len(), 6, "Matrixzeile mit {} Werten: {row:?}", row_values.len());
        values.extend(row_values);
    }
    values
}

fn parse_reference(text: &str) -> (Vec<ExpectedLaminate>, Vec<ExpectedCalculation>) {
    let lines: Vec<&str> = text.lines().collect();
    let mut laminates: Vec<ExpectedLaminate> = Vec::new();
    let mut calculations: Vec<ExpectedCalculation> = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        if line.contains("LAMINATE INFORMATION") {
            let mut lam = ExpectedLaminate {
                name: banner_text(lines[i + 1]).to_string(),
                ..Default::default()
            };
            i += 2;
            // Read until the next section banner.
            while i < lines.len() && !lines[i].contains("CLASSICAL LAMINATED PLATE THEORY") {
                let l = lines[i];
                if let Some(rest) = l.strip_prefix("Lay-up is") {
                    lam.symmetric = !rest.contains("not");
                } else if l.starts_with("Total number of layers") {
                    lam.number_of_layers = value_after_eq(l) as usize;
                } else if l.starts_with("Total thickness") {
                    lam.total_thickness = value_after_eq(l);
                } else if l.contains("---top---") {
                    i += 1;
                    while !lines[i].contains("---mid-plane---") && !lines[i].contains("---bottom---") {
                        // "%4d :  %-30s%-20.5f%5.1f" - the name may contain
                        // spaces, so take thickness and angle from the end.
                        let after_colon = lines[i].split_once(':').expect("Lagenzeile ohne ':'").1;
                        let tokens: Vec<&str> = after_colon.split_whitespace().collect();
                        let n = tokens.len();
                        lam.stacking.push((parse_f64(tokens[n - 2]), parse_f64(tokens[n - 1])));
                        i += 1;
                    }
                } else if let Some((_, rest)) = l.split_once("Crit.") {
                    // The writer's preceding `S12 = ...` printf has no newline,
                    // so this lands mid-line rather than at the start of one.
                    let name = rest.split_once('=').expect("Crit-Zeile ohne '='").1.trim();
                    lam.criterion_display_names.push(name.to_string());
                } else if l.starts_with("ABD-Matrix") {
                    lam.abd = parse_matrix(&lines, i + 1);
                    i += 6;
                } else if l.starts_with("abd-Matrix") {
                    lam.abd_inv = parse_matrix(&lines, i + 1);
                    i += 6;
                } else if l.trim_start().starts_with("Exx  =") {
                    lam.ex = values_after_eq(l).try_into().expect("Exx: 4 Werte erwartet");
                } else if l.trim_start().starts_with("Eyy  =") {
                    lam.ey = values_after_eq(l).try_into().expect("Eyy: 4 Werte erwartet");
                } else if l.trim_start().starts_with("Gxy  =") {
                    lam.g = values_after_eq(l).try_into().expect("Gxy: 4 Werte erwartet");
                } else if l.trim_start().starts_with("vxy  =") {
                    lam.nuxy = values_after_eq(l).try_into().expect("vxy: 2 Werte erwartet");
                } else if l.trim_start().starts_with("vyx  =") {
                    lam.nuyx = values_after_eq(l).try_into().expect("vyx: 2 Werte erwartet");
                } else if l.trim_start().starts_with("beta_D") {
                    lam.non_dimensional[0] = value_after_eq(l);
                } else if l.trim_start().starts_with("nu_D") {
                    lam.non_dimensional[1] = value_after_eq(l);
                } else if l.trim_start().starts_with("gamma_D") {
                    lam.non_dimensional[2] = value_after_eq(l);
                } else if l.trim_start().starts_with("delta_D") {
                    lam.non_dimensional[3] = value_after_eq(l);
                }
                i += 1;
            }
            laminates.push(lam);
            continue;
        }

        if line.contains("CLASSICAL LAMINATED PLATE THEORY") {
            let mut calc = ExpectedCalculation {
                name: banner_text(lines[i + 1]).to_string(),
                ..Default::default()
            };
            i += 2;
            while i < lines.len()
                && !lines[i].contains("LAMINATE INFORMATION")
                && !lines[i].contains("CLASSICAL LAMINATED PLATE THEORY")
            {
                let l = lines[i];
                let t = l.trim_start();
                const MECH: [&str; 6] = ["nxx  =", "nyy  =", "nxy  =", "mxx  =", "myy  =", "mxy  ="];
                const THERM: [&str; 6] = ["nxx,th", "nyy,th", "nxy,th", "mxx,th", "myy,th", "mxy,th"];
                const STRAIN: [&str; 6] = ["exx  =", "eyy  =", "gxy  =", "kxx  =", "kyy  =", "kxy  ="];

                if let Some(k) = MECH.iter().position(|p| t.starts_with(p)) {
                    calc.loads[k] = value_after_eq(l);
                } else if let Some(k) = THERM.iter().position(|p| t.starts_with(p)) {
                    calc.hygrothermal[k] = value_after_eq(l);
                } else if let Some(k) = STRAIN.iter().position(|p| t.starts_with(p)) {
                    calc.strains[k] = value_after_eq(l);
                } else if t.starts_with("deltaT") {
                    calc.delta_t = value_after_eq(l);
                } else if t.starts_with("deltac") {
                    // "deltac = %-17.10E %%" - drop the trailing percent sign.
                    calc.delta_h = values_after_eq(l)[0];
                } else if t.starts_with("upper") || t.contains(" upper ") {
                    // "%3d  %12.5E upper" + 7 values, then a "lower" line with 7.
                    let tokens: Vec<&str> = l.split_whitespace().collect();
                    let at = tokens.iter().position(|x| *x == "upper").expect("kein 'upper'");
                    let mut layer = ExpectedLayer {
                        zm: parse_f64(tokens[at - 1]),
                        ..Default::default()
                    };
                    for (k, tok) in tokens[at + 1..at + 8].iter().enumerate() {
                        layer.upper[k] = parse_f64(tok);
                    }
                    let lower: Vec<&str> = lines[i + 1].split_whitespace().collect();
                    assert_eq!(lower[0], "lower", "auf 'upper' folgt keine 'lower'-Zeile");
                    for (k, tok) in lower[1..8].iter().enumerate() {
                        layer.lower[k] = parse_f64(tok);
                    }
                    calc.layers.push(layer);
                    i += 1;
                }
                i += 1;
            }
            calculations.push(calc);
            continue;
        }

        i += 1;
    }

    (laminates, calculations)
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

fn load() -> (GoldenInput, Vec<ExpectedLaminate>, Vec<ExpectedCalculation>) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden");
    let input: GoldenInput = serde_json::from_str(
        &std::fs::read_to_string(format!("{dir}/reference.input.json"))
            .expect("reference.input.json fehlt - siehe tests/golden/README.md"),
    )
    .expect("reference.input.json ist kein gültiges JSON");
    let text = std::fs::read_to_string(format!("{dir}/reference.txt"))
        .expect("reference.txt fehlt - siehe tests/golden/README.md");
    let (laminates, calculations) = parse_reference(&text);
    (input, laminates, calculations)
}

fn expected_laminate<'a>(all: &'a [ExpectedLaminate], name: &str) -> &'a ExpectedLaminate {
    all.iter()
        .find(|l| l.name == name)
        .unwrap_or_else(|| panic!("Laminat '{name}' nicht in reference.txt"))
}

fn expected_calculation<'a>(all: &'a [ExpectedCalculation], name: &str) -> &'a ExpectedCalculation {
    all.iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("Berechnung '{name}' nicht in reference.txt"))
}

/// The stacking sequence, symmetry expansion, offset handling and every
/// laminate-level stiffness quantity the batch mode reports.
#[test]
fn laminate_stiffness_matches_elamx() {
    let (input, expected_all, _) = load();
    let mut report = Report::default();

    for case in &input.laminates {
        let name = &case.laminate.name;
        let expected = expected_laminate(&expected_all, name);
        let clt = CltLaminate::new(&case.laminate, &input.materials)
            .unwrap_or_else(|e| panic!("{name}: CltLaminate::new schlug fehl: {e}"));

        // The file was read back as intended (guards against a silently
        // mis-parsed .elamx making everything below compare the wrong laminate).
        report.eq(format!("{name}/symmetrisch"), case.laminate.symmetric, expected.symmetric);
        report.eq(
            format!("{name}/Lagenzahl"),
            case.laminate.number_of_layers(),
            expected.number_of_layers,
        );
        report.eq(
            format!("{name}/Kriterien"),
            &case.criterion_display_names,
            &expected.criterion_display_names,
        );

        let stacking = case.laminate.layers_in_stacking_order();
        report.eq(format!("{name}/Stapelhöhe"), stacking.len(), expected.stacking.len());
        for (i, (layer, (thickness, angle))) in stacking.iter().zip(&expected.stacking).enumerate() {
            report.close(format!("{name}/Lage{}/Dicke", i + 1), layer.thickness, *thickness, 1e-5, 0.0);
            report.close(format!("{name}/Lage{}/Winkel", i + 1), layer.angle, *angle, 0.05, 0.0);
        }

        report.close(
            format!("{name}/t_ges"),
            clt.tges(),
            expected.total_thickness,
            0.0,
            tolerances::ELEVEN_DIGITS,
        );

        let abd: Vec<f64> = clt.abd_matrix().iter().flatten().copied().collect();
        for (i, (a, e)) in abd.iter().zip(&expected.abd).enumerate() {
            report.close(
                format!("{name}/ABD[{}][{}]", i / 6, i % 6),
                *a,
                *e,
                tolerances::ONE_DECIMAL,
                0.0,
            );
        }

        let abd_inv: Vec<f64> = clt.abd_inv_matrix().iter().flatten().copied().collect();
        report.close_group(
            &format!("{name}/abd"),
            &abd_inv,
            &expected.abd_inv,
            tolerances::ELEVEN_DIGITS,
        );

        // Column order in the batch output is (simple, bend_simple, fixed,
        // bend_fixed). The header labels the first pair "with Poisson effect"
        // and the second "without", which matches the definitions on both
        // sides: `*_simple` comes from the compliance (1/(abd_inv[0][0]*tges)),
        // so transverse contraction is free and the Poisson effect is present,
        // while `*_fixed` is the direct stiffness (a[0][0]/tges), i.e. the
        // transverse strain is restrained.
        for (label, actual, expected_row) in [
            ("Exx", [clt.ex_simple(), clt.ex_bend_simple(), clt.ex_fixed(), clt.ex_bend_fixed()], expected.ex),
            ("Eyy", [clt.ey_simple(), clt.ey_bend_simple(), clt.ey_fixed(), clt.ey_bend_fixed()], expected.ey),
            ("Gxy", [clt.g_simple(), clt.g_bend_simple(), clt.g_fixed(), clt.g_bend_fixed()], expected.g),
        ] {
            for (i, (a, e)) in actual.iter().zip(&expected_row).enumerate() {
                report.close(format!("{name}/{label}[{i}]"), *a, *e, tolerances::ONE_DECIMAL, 0.0);
            }
        }

        for (label, actual, expected_row) in [
            ("vxy", [clt.nuxy_simple(), clt.nuxy_bend_simple()], expected.nuxy),
            ("vyx", [clt.nuyx_simple(), clt.nuyx_bend_simple()], expected.nuyx),
        ] {
            for (i, (a, e)) in actual.iter().zip(&expected_row).enumerate() {
                report.close(format!("{name}/{label}[{i}]"), *a, *e, tolerances::FIVE_DECIMALS, 0.0);
            }
        }

        let non_dimensional = [clt.beta_d(), clt.nu_d(), clt.gamma_d(), clt.delta_d()];
        for (i, (a, e)) in non_dimensional.iter().zip(&expected.non_dimensional).enumerate() {
            let label = ["beta_D", "nu_D", "gamma_D", "delta_D"][i];
            report.close(format!("{name}/{label}"), *a, *e, 0.0, tolerances::ELEVEN_DIGITS);
        }
    }

    report.finish("Laminatsteifigkeiten");
}

/// The ABD solve itself: prescribed loads vs. prescribed strains, and the
/// hygrothermal force/moment contribution feeding back into the solution.
#[test]
fn solved_loads_and_strains_match_elamx() {
    let (input, _, expected_all) = load();
    let mut report = Report::default();

    for case in &input.laminates {
        let clt = CltLaminate::new(&case.laminate, &input.materials).unwrap();
        for calculation in &case.calculations {
            let expected = expected_calculation(&expected_all, &calculation.name);
            let label = &calculation.name;

            let mut loads = calculation.loads;
            let mut strains = calculation.strains;
            determine_values(&clt, &mut loads, &mut strains, &calculation.use_strain);

            report.close(
                format!("{label}/deltaT"),
                loads.delta_t,
                expected.delta_t,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(
                format!("{label}/deltac"),
                loads.delta_h,
                expected.delta_h,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close_group(
                &format!("{label}/Lasten"),
                &loads.force_moment_vector(),
                &expected.loads,
                tolerances::ELEVEN_DIGITS,
            );
            report.close_group(
                &format!("{label}/hygrothermisch"),
                &[loads.nt_x, loads.nt_y, loads.nt_xy, loads.mt_x, loads.mt_y, loads.mt_xy],
                &expected.hygrothermal,
                tolerances::ELEVEN_DIGITS,
            );
            report.close_group(
                &format!("{label}/Verzerrungen"),
                &strains.epsilon_kappa_vector(),
                &expected.strains,
                tolerances::ELEVEN_DIGITS,
            );
        }
    }

    report.finish("Lasten und Verzerrungen");
}

/// Per-ply stresses and strains in the local (fibre) system, and the reserve
/// factor each of the 15 ported failure criteria produces for them.
#[test]
fn layer_results_and_reserve_factors_match_elamx() {
    let (input, _, expected_all) = load();
    let criteria = default_criterion_registry();
    let mut report = Report::default();

    for case in &input.laminates {
        let clt = CltLaminate::new(&case.laminate, &input.materials).unwrap();
        for calculation in &case.calculations {
            let expected = expected_calculation(&expected_all, &calculation.name);
            let label = &calculation.name;

            let mut loads = calculation.loads;
            let mut strains = calculation.strains;
            determine_values(&clt, &mut loads, &mut strains, &calculation.use_strain);
            let results = get_layer_results(&clt, &loads, &strains, &input.materials, &criteria)
                .unwrap_or_else(|e| panic!("{label}: get_layer_results schlug fehl: {e}"));

            report.eq(format!("{label}/Lagenzahl"), results.len(), expected.layers.len());

            for (i, (result, expected_layer)) in results.iter().zip(&expected.layers).enumerate() {
                let ply = format!("{label}/Lage{}", i + 1);
                report.close(
                    format!("{ply}/zm"),
                    clt.layers()[i].zm,
                    expected_layer.zm,
                    0.0,
                    tolerances::SIX_DIGITS,
                );

                for (position, state, expected_row) in [
                    ("oben", &result.sss_upper, &expected_layer.upper),
                    ("unten", &result.sss_lower, &expected_layer.lower),
                ] {
                    let actual = [
                        state.stress[0], state.stress[1], state.stress[2],
                        state.strain[0], state.strain[1], state.strain[2],
                    ];
                    report.close_group(
                        &format!("{ply}/{position}"),
                        &actual,
                        &expected_row[..6],
                        tolerances::SIX_DIGITS,
                    );
                }

                let criterion = case
                    .laminate
                    .all_layers()
                    .get(i)
                    .and_then(|l| l.criterion_id)
                    .unwrap_or("puck")
                    .to_string();
                check_reserve_factor(
                    &mut report,
                    &format!("{ply}/RF oben ({criterion})"),
                    result.rr_upper.minimal_reserve_factor,
                    expected_layer.upper[6],
                );
                check_reserve_factor(
                    &mut report,
                    &format!("{ply}/RF unten ({criterion})"),
                    result.rr_lower.minimal_reserve_factor,
                    expected_layer.lower[6],
                );
            }
        }
    }

    report.finish("Lagenergebnisse und Reservefaktoren");
}

/// A reserve factor that is effectively infinite on both sides carries no
/// information beyond "this ply cannot fail under this load" - comparing the
/// exact magnitude of two different implementations' floating-point overflow
/// would be noise, not a check.
fn check_reserve_factor(report: &mut Report, what: &str, actual: f64, expected: f64) {
    let effectively_infinite =
        |v: f64| !v.is_finite() || v.abs() > tolerances::RF_EFFECTIVELY_INFINITE;
    if effectively_infinite(actual) && effectively_infinite(expected) {
        report.checks += 1;
        return;
    }
    report.close(what, actual, expected, 0.0, tolerances::SIX_DIGITS);
}

/// The reference data must actually exercise what it claims to: every ported
/// criterion at least once, and all the structural variants.
#[test]
fn reference_data_covers_every_ported_criterion() {
    let (input, _, _) = load();

    let used: std::collections::BTreeSet<&str> = input
        .laminates
        .iter()
        .flat_map(|c| c.laminate.layers.iter())
        .filter_map(|l| l.criterion_id.as_deref())
        .collect();
    let registry = default_criterion_registry();
    let registered: std::collections::BTreeSet<&str> = registry.keys().map(|k| k.as_str()).collect();
    let missing: Vec<&&str> = registered.difference(&used).collect();
    assert!(
        missing.is_empty(),
        "Referenzdaten decken diese Kriterien nicht ab: {missing:?}"
    );

    assert!(
        input.laminates.iter().any(|c| c.laminate.symmetric && c.laminate.with_middle_layer),
        "kein symmetrisches Laminat mit Mittellage in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().any(|c| c.laminate.symmetric && !c.laminate.with_middle_layer),
        "kein symmetrisches Laminat ohne Mittellage in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().any(|c| c.laminate.invert_z),
        "kein Laminat mit invertierter z-Achse in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().any(|c| c.laminate.offset != 0.0),
        "kein Laminat mit Offset der Bezugsebene in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().flat_map(|c| &c.calculations).any(|c| c.loads.delta_t != 0.0),
        "kein Lastfall mit Temperaturdifferenz in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().flat_map(|c| &c.calculations).any(|c| c.loads.delta_h != 0.0),
        "kein Lastfall mit Feuchtedifferenz in den Referenzdaten"
    );
    assert!(
        input.laminates.iter().flat_map(|c| &c.calculations).any(|c| c.use_strain.iter().any(|u| *u)),
        "kein Lastfall mit vorgegebener Verzerrung in den Referenzdaten"
    );
}
