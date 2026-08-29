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

use elamx_core::clt::{
    calculate_last_ply_failure, determine_values, get_layer_results, CltLaminate,
    LastPlyFailureInput, Loads, Strains,
};
use elamx_core::failure::{default_criterion_registry, FailureType};
use elamx_core::model::{Laminate, Material};
use elamx_core::plate::{calculate_buckling, BoundaryCondition, BucklingInput, DMatrixKind};
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
    bucklings: Vec<GoldenBuckling>,
    last_ply_failures: Vec<GoldenLastPlyFailure>,
}

#[derive(Deserialize)]
struct GoldenBuckling {
    name: String,
    input: BucklingInput,
    /// How the batch output names the chosen bending-stiffness idealisation.
    /// Checked for the same reason as `criterion_display_names`: an
    /// unrecognised `dmatrixservice` class name silently falls back to the
    /// standard D matrix (see plateui/buckling/LoadSaveLaminateHookImpl).
    d_matrix_label: String,
}

#[derive(Deserialize)]
struct GoldenLastPlyFailure {
    name: String,
    input: LastPlyFailureInput,
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

#[derive(Debug, Default)]
struct ExpectedBuckling {
    name: String,
    laminate_name: String,
    d_matrix_label: String,
    /// The 3x3 bending stiffness the analysis actually ran on, row-major.
    d_matrix: Vec<f64>,
    length: f64,
    width: f64,
    /// Edge conditions, [x, y]. Taken positionally: the Java writer labels
    /// BOTH lines "x" (it prints getBcy() under an "x" caption), so the
    /// caption cannot be trusted to tell them apart.
    bc: [String; 2],
    m: usize,
    n: usize,
    n_crit: [f64; 3],
    eigenvalues: Vec<f64>,
}

/// One last-ply-failure analysis as the batch output reports it.
#[derive(Debug, Default)]
struct ExpectedLastPlyFailure {
    name: String,
    /// The load eLamX read from our file, echoed back: nxx..mxy.
    loads: [f64; 6],
    j_a: f64,
    degradation_factor: f64,
    epsilon_crit: f64,
    degrade_all_on_fibre_failure: bool,
    /// Reserve factor and the iteration it belongs to; `None` where the batch
    /// output prints `-`, i.e. the event never occurred.
    rf_epsilon: Option<(f64, usize)>,
    rf_ff: Option<(f64, usize)>,
    rf_iff: Option<(f64, usize)>,
    ef_lpf: Option<(f64, usize)>,
    ff_before_iff: bool,
    iterations: Vec<ExpectedLpfIteration>,
}

#[derive(Debug, Default)]
struct ExpectedLpfIteration {
    layer_of_failure: usize,
    reserve_factor: f64,
    /// ReserveFactor's own integer code: 1 = FF, 2 = IFF, 4 = GMF.
    failure_type: i32,
    failure_type_short: String,
    layers: Vec<ExpectedLpfLayer>,
}

#[derive(Debug, Default, Clone)]
struct ExpectedLpfLayer {
    layer: ExpectedLayer,
    fibre_failed: bool,
    matrix_failed: bool,
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
        // Bit-identical values need no tolerance - and this is the only way
        // two infinities can agree, since their difference is NaN. Free edges
        // legitimately produce infinite buckling factors (rigid-body modes),
        // and both implementations report them.
        if actual == expected {
            return;
        }
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

/// Every section of the batch output opens with one of these banners; a
/// section body runs until the next one.
fn is_section_banner(line: &str) -> bool {
    line.contains("LAMINATE INFORMATION")
        || line.contains("CLASSICAL LAMINATED PLATE THEORY")
        || line.contains("BUCKLING")
        || line.contains("LAST PLY FAILURE")
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

type Parsed = (
    Vec<ExpectedLaminate>,
    Vec<ExpectedCalculation>,
    Vec<ExpectedBuckling>,
    Vec<ExpectedLastPlyFailure>,
);

fn parse_reference(text: &str) -> Parsed {
    let lines: Vec<&str> = text.lines().collect();
    let mut laminates: Vec<ExpectedLaminate> = Vec::new();
    let mut calculations: Vec<ExpectedCalculation> = Vec::new();
    let mut bucklings: Vec<ExpectedBuckling> = Vec::new();
    let mut last_ply_failures: Vec<ExpectedLastPlyFailure> = Vec::new();
    // The laminate a section belongs to: sections follow their laminate's
    // header, and BUCKLING names it explicitly anyway.
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
            while i < lines.len() && !is_section_banner(lines[i]) {
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
            while i < lines.len() && !is_section_banner(lines[i]) {
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

        if line.contains("BUCKLING") {
            let mut buck = ExpectedBuckling {
                name: banner_text(lines[i + 1]).to_string(),
                ..Default::default()
            };
            i += 2;
            while i < lines.len() && !is_section_banner(lines[i]) {
                let l = lines[i];
                let t = l.trim_start();
                if let Some(rest) = t.strip_prefix("Laminate:") {
                    buck.laminate_name = rest.trim().to_string();
                } else if let Some(rest) = t.strip_prefix("D-matrix option:") {
                    buck.d_matrix_label = rest.trim().to_string();
                } else if t.starts_with("D-matrix used:") {
                    for row in &lines[i + 1..i + 4] {
                        let values: Vec<f64> = row.split_whitespace().map(parse_f64).collect();
                        assert_eq!(values.len(), 3, "D-Matrixzeile: {row:?}");
                        buck.d_matrix.extend(values);
                    }
                    i += 3;
                } else if t.starts_with("length") {
                    buck.length = value_after_eq(l);
                } else if t.starts_with("width") {
                    buck.width = value_after_eq(l);
                } else if t.starts_with("Boundary conditions:") {
                    // Both lines are captioned "x" in the Java writer; the
                    // second one is really y, so take them by position.
                    for (k, bc_line) in lines[i + 1..i + 3].iter().enumerate() {
                        buck.bc[k] = bc_line
                            .split_once(':')
                            .expect("Randbedingungszeile ohne ':'")
                            .1
                            .trim()
                            .to_string();
                    }
                    i += 2;
                } else if t.starts_with("n_x") {
                    buck.m = value_after_eq(l) as usize;
                } else if t.starts_with("n_y") {
                    buck.n = value_after_eq(l) as usize;
                } else if t.starts_with("nx_crit") {
                    buck.n_crit[0] = value_after_eq(l);
                } else if t.starts_with("ny_crit") {
                    buck.n_crit[1] = value_after_eq(l);
                } else if t.starts_with("nxy_crit") {
                    buck.n_crit[2] = value_after_eq(l);
                } else if t.starts_with("Eigenv") && l.contains('=') {
                    // "Eigenvalues 1 to 100" heads the list and shares the prefix.
                    buck.eigenvalues.push(value_after_eq(l));
                }
                i += 1;
            }
            bucklings.push(buck);
            continue;
        }

        if line.contains("LAST PLY FAILURE") {
            let mut lpf = ExpectedLastPlyFailure {
                name: banner_text(lines[i + 1]).to_string(),
                ..Default::default()
            };
            i += 2;
            while i < lines.len() && !is_section_banner(lines[i]) {
                let l = lines[i];
                let t = l.trim_start();
                const MECH: [&str; 6] = ["nxx  =", "nyy  =", "nxy  =", "mxx  =", "myy  =", "mxy  ="];

                if let Some(k) = MECH.iter().position(|p| t.starts_with(p)) {
                    lpf.loads[k] = value_after_eq(l);
                } else if t.starts_with("jA") {
                    lpf.j_a = value_after_eq(l);
                } else if t.starts_with("degFac") {
                    lpf.degradation_factor = value_after_eq(l);
                } else if t.starts_with("epsAllow") {
                    lpf.epsilon_crit = value_after_eq(l);
                } else if t.starts_with("degAllOnFibreFailure") {
                    lpf.degrade_all_on_fibre_failure = flag_after_eq(l);
                } else if t.starts_with("FLAG_FF_before_IFF") {
                    lpf.ff_before_iff = flag_after_eq(l);
                // The value and its iteration are printed on consecutive
                // lines, and both are "-" when the event never happened - so
                // they are read as one pair rather than two fields.
                } else if t.starts_with("RF_epsilon ") {
                    lpf.rf_epsilon = event_after_eq(l, lines[i + 1]);
                    i += 1;
                } else if t.starts_with("RF_FF ") {
                    lpf.rf_ff = event_after_eq(l, lines[i + 1]);
                    i += 1;
                } else if t.starts_with("RF_IFF ") {
                    lpf.rf_iff = event_after_eq(l, lines[i + 1]);
                    i += 1;
                } else if t.starts_with("EF_LPF ") {
                    lpf.ef_lpf = event_after_eq(l, lines[i + 1]);
                    i += 1;
                } else if l.starts_with('*') && l.contains("Iteration ") {
                    lpf.iterations.push(ExpectedLpfIteration::default());
                } else if t.starts_with("Layer of Failure:") {
                    current_iteration(&mut lpf).layer_of_failure =
                        parse_f64(after_colon(l)) as usize;
                } else if t.starts_with("RF Iteration:") {
                    current_iteration(&mut lpf).reserve_factor = parse_f64(after_colon(l));
                } else if t.starts_with("Failure Type Short:") {
                    current_iteration(&mut lpf).failure_type_short = after_colon(l).trim().to_string();
                } else if t.starts_with("Failure Type:") {
                    current_iteration(&mut lpf).failure_type = parse_f64(after_colon(l)) as i32;
                } else if t.starts_with("upper") || t.contains(" upper ") {
                    // Same two-line layout as the CLT section, with the ply's
                    // FF/IFF degradation flags appended to each line.
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
                    current_iteration(&mut lpf).layers.push(ExpectedLpfLayer {
                        layer,
                        fibre_failed: tokens[at + 8] == "true",
                        matrix_failed: tokens[at + 9] == "true",
                    });
                    i += 1;
                }
                i += 1;
            }
            last_ply_failures.push(lpf);
            continue;
        }

        i += 1;
    }

    (laminates, calculations, bucklings, last_ply_failures)
}

fn after_colon(line: &str) -> &str {
    line.split_once(':').unwrap_or_else(|| panic!("kein ':' in {line:?}")).1
}

fn flag_after_eq(line: &str) -> bool {
    line.split('=')
        .nth(1)
        .unwrap_or_else(|| panic!("kein '=' in {line:?}"))
        .trim()
        == "true"
}

/// The `RF_x = <value>` / `RF_x at iteration = <index>` pair, or `None` when
/// both print as `-`.
fn event_after_eq(value_line: &str, iteration_line: &str) -> Option<(f64, usize)> {
    let value = try_parse_f64(value_line.split('=').nth(1)?)?;
    let iteration = try_parse_f64(iteration_line.split('=').nth(1)?)? as usize;
    Some((value, iteration))
}

fn current_iteration(lpf: &mut ExpectedLastPlyFailure) -> &mut ExpectedLpfIteration {
    lpf.iterations
        .last_mut()
        .expect("Iterationsdaten vor dem ersten 'Iteration'-Banner")
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

type Loaded = (
    GoldenInput,
    Vec<ExpectedLaminate>,
    Vec<ExpectedCalculation>,
    Vec<ExpectedBuckling>,
    Vec<ExpectedLastPlyFailure>,
);

fn load() -> Loaded {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden");
    let input: GoldenInput = serde_json::from_str(
        &std::fs::read_to_string(format!("{dir}/reference.input.json"))
            .expect("reference.input.json fehlt - siehe tests/golden/README.md"),
    )
    .expect("reference.input.json ist kein gültiges JSON");
    let text = std::fs::read_to_string(format!("{dir}/reference.txt"))
        .expect("reference.txt fehlt - siehe tests/golden/README.md");
    let (laminates, calculations, bucklings, last_ply_failures) = parse_reference(&text);
    (input, laminates, calculations, bucklings, last_ply_failures)
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

fn expected_buckling<'a>(all: &'a [ExpectedBuckling], name: &str) -> &'a ExpectedBuckling {
    all.iter()
        .find(|b| b.name == name)
        .unwrap_or_else(|| panic!("Beulanalyse '{name}' nicht in reference.txt"))
}

fn expected_last_ply_failure<'a>(
    all: &'a [ExpectedLastPlyFailure],
    name: &str,
) -> &'a ExpectedLastPlyFailure {
    all.iter()
        .find(|l| l.name == name)
        .unwrap_or_else(|| panic!("Last-Ply-Failure-Analyse '{name}' nicht in reference.txt"))
}

/// The stacking sequence, symmetry expansion, offset handling and every
/// laminate-level stiffness quantity the batch mode reports.
#[test]
fn laminate_stiffness_matches_elamx() {
    let (input, expected_all, _, _, _) = load();
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
    let (input, _, expected_all, _, _) = load();
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
    let (input, _, expected_all, _, _) = load();
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


/// Plate buckling: the bending-stiffness idealisation, the critical load and
/// the full eigenvalue spectrum of the Ritz problem.
#[test]
fn buckling_matches_elamx() {
    let (input, _, _, expected_all, _) = load();
    let mut report = Report::default();

    for case in &input.laminates {
        let clt = CltLaminate::new(&case.laminate, &input.materials).unwrap();
        for analysis in &case.bucklings {
            let expected = expected_buckling(&expected_all, &analysis.name);
            let label = &analysis.name;

            // eLamX read our file as intended: same plate, same edges, same
            // term counts, and above all the D-matrix idealisation we asked
            // for rather than the silent fallback.
            report.eq(format!("{label}/Laminat"), case.laminate.name.as_str(), expected.laminate_name.as_str());
            report.eq(format!("{label}/D-Matrix-Wahl"), analysis.d_matrix_label.as_str(), expected.d_matrix_label.as_str());
            report.eq(format!("{label}/m"), analysis.input.m, expected.m);
            report.eq(format!("{label}/n"), analysis.input.n, expected.n);
            report.eq(
                format!("{label}/Randbedingungen"),
                [format!("{:?}", analysis.input.bc_x), format!("{:?}", analysis.input.bc_y)]
                    .map(|s| bc_short(&s)),
                expected.bc.clone(),
            );
            report.close(format!("{label}/Laenge"), analysis.input.length, expected.length, 0.0, tolerances::ELEVEN_DIGITS);
            report.close(format!("{label}/Breite"), analysis.input.width, expected.width, 0.0, tolerances::ELEVEN_DIGITS);

            let d = analysis.input.d_matrix.matrix(&clt);
            let flat: Vec<f64> = d.iter().flatten().copied().collect();
            for (k, (a, e)) in flat.iter().zip(&expected.d_matrix).enumerate() {
                report.close(
                    format!("{label}/D[{}][{}]", k / 3, k % 3),
                    *a,
                    *e,
                    tolerances::ONE_DECIMAL,
                    0.0,
                );
            }

            let result = calculate_buckling(&clt, &analysis.input)
                .unwrap_or_else(|e| panic!("{label}: calculate_buckling schlug fehl: {e:?}"));

            let n_crit = result
                .n_crit
                .unwrap_or_else(|| panic!("{label}: eLamX fand eine kritische Last, der Port nicht"));
            report.close_group(&format!("{label}/n_crit"), &n_crit, &expected.n_crit, tolerances::ELEVEN_DIGITS);

            // Both sides order the spectrum by ascending magnitude, so this
            // compares element-wise. Signs are part of the result: a negative
            // factor means the plate buckles under the REVERSED load.
            let actual: Vec<f64> = result.modes.iter().map(|m| m.eigenvalue).collect();
            report.eq(format!("{label}/Eigenwertanzahl"), actual.len(), expected.eigenvalues.len());
            if actual.len() == expected.eigenvalues.len() {
                report.close_group(
                    &format!("{label}/Eigenwerte"),
                    &actual,
                    &expected.eigenvalues,
                    tolerances::ELEVEN_DIGITS,
                );
            }
        }
    }

    report.finish("Plattenbeulen");
}

/// Last ply failure: the whole degradation path - which ply fails when, under
/// which criterion verdict, and what the laminate looks like after every step.
#[test]
fn last_ply_failure_matches_elamx() {
    let (input, _, _, _, expected_all) = load();
    let criteria = default_criterion_registry();
    let mut report = Report::default();

    for case in &input.laminates {
        for analysis in &case.last_ply_failures {
            let expected = expected_last_ply_failure(&expected_all, &analysis.name);
            let label = &analysis.name;
            let inp = &analysis.input;

            // eLamX read our file as intended. Worth checking explicitly: these
            // parameters are what distinguish the cases from one another, so a
            // misread one would silently compare two runs of the same analysis.
            report.close_group(
                &format!("{label}/Last"),
                &inp.loads.force_moment_vector(),
                &expected.loads,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(format!("{label}/jA"), inp.j_a, expected.j_a, 0.0, tolerances::ELEVEN_DIGITS);
            report.close(
                format!("{label}/degFac"),
                inp.degradation_factor,
                expected.degradation_factor,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(
                format!("{label}/epsAllow"),
                inp.epsilon_crit,
                expected.epsilon_crit,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.eq(
                format!("{label}/degAllOnFibreFailure"),
                inp.degrade_all_on_fibre_failure,
                expected.degrade_all_on_fibre_failure,
            );

            let result = calculate_last_ply_failure(&case.laminate, &input.materials, &criteria, inp)
                .unwrap_or_else(|e| panic!("{label}: calculate_last_ply_failure schlug fehl: {e}"));

            for (what, actual, expected_event) in [
                ("RF_epsilon", result.first_epsilon, expected.rf_epsilon),
                ("RF_FF", result.first_fibre_failure, expected.rf_ff),
                ("RF_IFF", result.first_matrix_failure, expected.rf_iff),
                ("EF_LPF", result.exceedance_factor, expected.ef_lpf),
            ] {
                // "Never happened" is itself a result - eLamX prints `-` for
                // it, and a port that produced a number here would be wrong in
                // a way no tolerance could catch.
                report.eq(
                    format!("{label}/{what} vorhanden"),
                    actual.is_some(),
                    expected_event.is_some(),
                );
                if let (Some(actual), Some((value, iteration))) = (actual, expected_event) {
                    report.close(
                        format!("{label}/{what}"),
                        actual.reserve_factor,
                        value,
                        0.0,
                        tolerances::ELEVEN_DIGITS,
                    );
                    report.eq(format!("{label}/{what} Iteration"), actual.iteration, iteration);
                }
            }

            report.eq(
                format!("{label}/FLAG_FF_before_IFF"),
                result.fibre_before_matrix_failure,
                expected.ff_before_iff,
            );

            // The writer stops one short of the last recorded iteration
            // (`maxIterationNumber = layerResults.length - 1`), so the printed
            // count pins down the recorded one exactly.
            report.eq(
                format!("{label}/Iterationen"),
                expected.iterations.len(),
                result.iterations.len().saturating_sub(1),
            );

            for (index, (actual, expected_iteration)) in
                result.iterations.iter().zip(&expected.iterations).enumerate()
            {
                let it = format!("{label}/Iter{index}");
                report.eq(
                    format!("{it}/versagende Lage"),
                    actual.layer_number,
                    expected_iteration.layer_of_failure,
                );
                report.close(
                    format!("{it}/RF"),
                    actual.reserve_factor,
                    expected_iteration.reserve_factor,
                    0.0,
                    tolerances::SIX_DIGITS,
                );
                report.eq(
                    format!("{it}/Versagensart"),
                    failure_type_code(actual.failure_type),
                    expected_iteration.failure_type,
                );
                report.eq(
                    format!("{it}/Versagensart kurz"),
                    failure_type_short(actual.failure_type),
                    expected_iteration.failure_type_short.as_str(),
                );
                report.eq(
                    format!("{it}/Lagenzahl"),
                    actual.layer_results.len(),
                    expected_iteration.layers.len(),
                );

                for (i, (ply_result, expected_ply)) in actual
                    .layer_results
                    .iter()
                    .zip(&expected_iteration.layers)
                    .enumerate()
                {
                    let ply = format!("{it}/Lage{}", i + 1);
                    for (position, state, rf, expected_row) in [
                        ("oben", &ply_result.sss_upper, &ply_result.rr_upper, &expected_ply.layer.upper),
                        ("unten", &ply_result.sss_lower, &ply_result.rr_lower, &expected_ply.layer.lower),
                    ] {
                        let values = [
                            state.stress[0], state.stress[1], state.stress[2],
                            state.strain[0], state.strain[1], state.strain[2],
                        ];
                        report.close_group(
                            &format!("{ply}/{position}"),
                            &values,
                            &expected_row[..6],
                            tolerances::SIX_DIGITS,
                        );
                        check_reserve_factor(
                            &mut report,
                            &format!("{ply}/RF {position}"),
                            rf.minimal_reserve_factor,
                            expected_row[6],
                        );
                    }

                    // The degradation state after this step: which plies have
                    // lost their fibres, and which their matrix.
                    report.eq(
                        format!("{ply}/FF-Flag"),
                        actual.fibre_failed[i],
                        expected_ply.fibre_failed,
                    );
                    report.eq(
                        format!("{ply}/IFF-Flag"),
                        actual.matrix_failed[i],
                        expected_ply.matrix_failed,
                    );
                }
            }
        }
    }

    report.finish("Last Ply Failure");
}

/// `ReserveFactor`'s integer codes and short names, as the batch output prints
/// them (see ReserveFactor.java and FailureTypeShortNameHandler).
fn failure_type_code(t: FailureType) -> i32 {
    match t {
        FailureType::Undamaged => 0,
        FailureType::FiberFailure => 1,
        FailureType::MatrixFailure => 2,
        FailureType::GeneralMaterialFailure => 4,
    }
}

fn failure_type_short(t: FailureType) -> &'static str {
    match t {
        FailureType::FiberFailure => "FF",
        FailureType::MatrixFailure => "IFF",
        FailureType::GeneralMaterialFailure => "GMF",
        // The handler has no entry for it, so Java prints the map's null.
        FailureType::Undamaged => "null",
    }
}

/// `BoundaryCondition`'s Debug name (`SimplySimply`) versus the two-letter form
/// the batch output prints (`SS`). Derived from the serde rename rather than
/// hand-written, so the two cannot drift apart.
fn bc_short(debug_name: &str) -> String {
    serde_json::to_value(match debug_name {
        "SimplySimply" => elamx_core::plate::BoundaryCondition::SimplySimply,
        "ClampedClamped" => elamx_core::plate::BoundaryCondition::ClampedClamped,
        "ClampedFree" => elamx_core::plate::BoundaryCondition::ClampedFree,
        "FreeFree" => elamx_core::plate::BoundaryCondition::FreeFree,
        "SimplyClamped" => elamx_core::plate::BoundaryCondition::SimplyClamped,
        "SimplyFree" => elamx_core::plate::BoundaryCondition::SimplyFree,
        other => panic!("unbekannte Randbedingung {other}"),
    })
    .expect("BoundaryCondition ist serialisierbar")
    .as_str()
    .expect("BoundaryCondition serialisiert als String")
    .to_string()
}

/// The reference data must actually exercise what it claims to: every ported
/// criterion at least once, and all the structural variants.
#[test]
fn reference_data_covers_every_ported_criterion() {
    let (input, _, _, _, _) = load();

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

    // Buckling: every edge condition and every bending-stiffness idealisation.
    let bucklings: Vec<&GoldenBuckling> =
        input.laminates.iter().flat_map(|c| &c.bucklings).collect();
    for bc in BoundaryCondition::ALL {
        assert!(
            bucklings.iter().any(|b| b.input.bc_x == bc || b.input.bc_y == bc),
            "Randbedingung {bc:?} kommt in keiner Beulanalyse vor"
        );
    }
    for kind in DMatrixKind::ALL {
        assert!(
            bucklings.iter().any(|b| b.input.d_matrix == kind),
            "D-Matrix-Variante {kind:?} kommt in keiner Beulanalyse vor"
        );
    }
    assert!(
        bucklings.iter().any(|b| b.input.n_xy != 0.0),
        "keine Beulanalyse unter Schub"
    );
    assert!(
        bucklings.iter().any(|b| b.input.length != b.input.width),
        "keine Beulanalyse an einer nicht-quadratischen Platte"
    );

    // Last ply failure: each input parameter has to appear with a value that
    // actually changes something, and jA only does so on a case that reaches
    // an inter-fibre failure at all.
    let lpf: Vec<&GoldenLastPlyFailure> =
        input.laminates.iter().flat_map(|c| &c.last_ply_failures).collect();
    assert!(!lpf.is_empty(), "keine Last-Ply-Failure-Analyse in den Referenzdaten");
    assert!(
        lpf.iter().any(|l| !l.input.degrade_all_on_fibre_failure),
        "keine Last-Ply-Failure-Analyse mit degradeAllOnFibreFailure = false"
    );
    assert!(
        lpf.iter().any(|l| l.input.degradation_factor != LastPlyFailureInput::default().degradation_factor),
        "keine Last-Ply-Failure-Analyse mit abweichendem Degradationsfaktor"
    );
    assert!(
        lpf.iter().any(|l| l.input.epsilon_crit != LastPlyFailureInput::default().epsilon_crit),
        "keine Last-Ply-Failure-Analyse mit abweichender Grenzdehnung"
    );
    let (_, _, _, _, expected_lpf) = load();
    assert!(
        lpf.iter().any(|l| {
            l.input.j_a != 1.0 && expected_last_ply_failure(&expected_lpf, &l.name).rf_iff.is_some()
        }),
        "keine Last-Ply-Failure-Analyse mit jA != 1, die einen Zfb erreicht - jA skaliert sonst nichts"
    );
    assert!(
        expected_lpf.iter().any(|l| l.rf_epsilon.is_none()),
        "keine Last-Ply-Failure-Analyse, in der die Dehnungsgrenze nie ausgewertet wird"
    );
    assert!(
        expected_lpf.iter().any(|l| l.iterations.len() > 1),
        "keine Last-Ply-Failure-Analyse mit mehreren Iterationen"
    );
}
