//! Reading the eLamX batch mode's text output back into numbers.
//!
//! Shared by the two golden suites: `golden_master.rs`, which drives the
//! reference cases from a JSON twin of the inputs, and `batch_crosscheck.rs`,
//! which drives whole `.elamx` files through this crate's own reader. Both
//! compare against a file the original program wrote, so both need the same
//! parser - and a parser written twice is a parser that will disagree with
//! itself about the writer's quirks (see the notes on `parse_reference`).

#![allow(dead_code)] // each test target uses a different part of this.

use elamx_core::failure::FailureType;


// ---------------------------------------------------------------------------
// Expected values (golden/reference.txt, written by the eLamX batch mode)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ExpectedLaminate {
    pub name: String,
    pub symmetric: bool,
    pub number_of_layers: usize,
    pub total_thickness: f64,
    /// (thickness, angle) per stored layer, in stacking order.
    pub stacking: Vec<(f64, f64)>,
    pub criterion_display_names: Vec<String>,
    pub abd: Vec<f64>,
    pub abd_inv: Vec<f64>,
    /// Exx, Eyy, Gxy - each as (simple, bend_simple, fixed, bend_fixed).
    pub ex: [f64; 4],
    pub ey: [f64; 4],
    pub g: [f64; 4],
    /// nu_xy, nu_yx - each as (simple, bend_simple).
    pub nuxy: [f64; 2],
    pub nuyx: [f64; 2],
    pub non_dimensional: [f64; 4],
    /// Per stored layer, in stacking order: E11, E22, v12, G12 as the original
    /// printed them. The only place a micromechanic model's result is visible
    /// in the batch output at all.
    pub material_data: Vec<[f64; 4]>,
}

#[derive(Debug, Default)]
pub struct ExpectedCalculation {
    pub name: String,
    pub loads: [f64; 6],
    pub hygrothermal: [f64; 6],
    pub delta_t: f64,
    pub delta_h: f64,
    pub strains: [f64; 6],
    pub layers: Vec<ExpectedLayer>,
}

#[derive(Debug, Default)]
pub struct ExpectedBuckling {
    pub name: String,
    pub laminate_name: String,
    pub d_matrix_label: String,
    /// The 3x3 bending stiffness the analysis actually ran on, row-major.
    pub d_matrix: Vec<f64>,
    pub length: f64,
    pub width: f64,
    /// Edge conditions, [x, y]. Taken positionally: the Java writer labels
    /// BOTH lines "x" (it prints getBcy() under an "x" caption), so the
    /// caption cannot be trusted to tell them apart.
    pub bc: [String; 2],
    pub m: usize,
    pub n: usize,
    pub n_crit: [f64; 3],
    pub eigenvalues: Vec<f64>,
}

/// One last-ply-failure analysis as the batch output reports it.
#[derive(Debug, Default)]
pub struct ExpectedLastPlyFailure {
    pub name: String,
    /// The load eLamX read from our file, echoed back: nxx..mxy.
    pub loads: [f64; 6],
    pub j_a: f64,
    pub degradation_factor: f64,
    pub epsilon_crit: f64,
    pub degrade_all_on_fibre_failure: bool,
    /// Reserve factor and the iteration it belongs to; `None` where the batch
    /// output prints `-`, i.e. the event never occurred.
    pub rf_epsilon: Option<(f64, usize)>,
    pub rf_ff: Option<(f64, usize)>,
    pub rf_iff: Option<(f64, usize)>,
    pub ef_lpf: Option<(f64, usize)>,
    pub ff_before_iff: bool,
    pub iterations: Vec<ExpectedLpfIteration>,
}

#[derive(Debug, Default)]
pub struct ExpectedLpfIteration {
    pub layer_of_failure: usize,
    pub reserve_factor: f64,
    /// ReserveFactor's own integer code: 1 = FF, 2 = IFF, 4 = GMF.
    pub failure_type: i32,
    pub failure_type_short: String,
    pub layers: Vec<ExpectedLpfLayer>,
}

#[derive(Debug, Default, Clone)]
pub struct ExpectedLpfLayer {
    pub layer: ExpectedLayer,
    pub fibre_failed: bool,
    pub matrix_failed: bool,
}

#[derive(Debug, Default, Clone)]
pub struct ExpectedLayer {
    pub zm: f64,
    /// s11, s22, s12, e11, e22, e12, RF - in the local (fibre) system.
    pub upper: [f64; 7],
    pub lower: [f64; 7],
}

// ---------------------------------------------------------------------------
// Tolerances, derived from GeneralOutputWriterServiceImpl / CalculationOutputWriterServiceImpl
// ---------------------------------------------------------------------------

pub mod tolerances {
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
pub struct Report {
    pub failures: Vec<String>,
    pub checks: usize,
}

impl Report {
    /// `|actual - expected| <= abs_floor + rel * |expected|`.
    pub fn close(&mut self, what: impl std::fmt::Display, actual: f64, expected: f64, abs_floor: f64, rel: f64) {
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
    pub fn close_group(&mut self, what: &str, actual: &[f64], expected: &[f64], rel: f64) {
        assert_eq!(actual.len(), expected.len(), "{what}: Länge unterschiedlich");
        let floor = rel * expected.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
            self.close(format!("{what}[{i}]"), *a, *e, floor, rel);
        }
    }

    pub fn eq<T: PartialEq + std::fmt::Debug>(&mut self, what: impl std::fmt::Display, actual: T, expected: T) {
        self.checks += 1;
        if actual != expected {
            self.failures.push(format!("{what}: eLamX={expected:?}  Rust={actual:?}"));
        }
    }

    pub fn finish(self, title: &str) {
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

pub fn try_parse_f64(token: &str) -> Option<f64> {
    match token.trim() {
        "Infinity" => Some(f64::INFINITY),
        "-Infinity" => Some(f64::NEG_INFINITY),
        "NaN" => Some(f64::NAN),
        t => t.parse().ok(),
    }
}

pub fn parse_f64(token: &str) -> f64 {
    try_parse_f64(token).unwrap_or_else(|| panic!("keine Zahl in reference.txt: {token:?}"))
}

/// Every section of the batch output opens with one of these banners; a
/// section body runs until the next one.
pub fn is_section_banner(line: &str) -> bool {
    line.contains("LAMINATE INFORMATION")
        || line.contains("CLASSICAL LAMINATED PLATE THEORY")
        || line.contains("BUCKLING")
        || line.contains("LAST PLY FAILURE")
}

/// Banner titles are centred by padding with `*` (see `Utilities.centeredText`).
pub fn banner_text(line: &str) -> &str {
    line.trim_matches('*').trim()
}

pub fn value_after_eq(line: &str) -> f64 {
    parse_f64(line.split('=').nth(1).unwrap_or_else(|| panic!("kein '=' in {line:?}")))
}

/// All whitespace-separated numbers after the first `=`, skipping the
/// non-numeric placeholders the batch writer mixes in (`-` for a quantity that
/// doesn't exist in that column, `%` as the unit behind `deltac`).
pub fn values_after_eq(line: &str) -> Vec<f64> {
    line.split('=')
        .nth(1)
        .unwrap_or_else(|| panic!("kein '=' in {line:?}"))
        .split_whitespace()
        .filter_map(try_parse_f64)
        .collect()
}

/// Every number on a line, in order. For the material-data block, where the
/// writer puts two labelled quantities on one line.
pub fn numbers_in(line: &str) -> Vec<f64> {
    line.split_whitespace().filter_map(try_parse_f64).collect()
}

pub fn parse_matrix(lines: &[&str], start: usize) -> Vec<f64> {
    let mut values = Vec::with_capacity(36);
    for row in &lines[start..start + 6] {
        let row_values: Vec<f64> = row.split_whitespace().map(parse_f64).collect();
        assert_eq!(row_values.len(), 6, "Matrixzeile mit {} Werten: {row:?}", row_values.len());
        values.extend(row_values);
    }
    values
}

pub type Parsed = (
    Vec<ExpectedLaminate>,
    Vec<ExpectedCalculation>,
    Vec<ExpectedBuckling>,
    Vec<ExpectedLastPlyFailure>,
);

pub fn parse_reference(text: &str) -> Parsed {
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
                } else if l.trim_start().starts_with("E11") {
                    // Two quantities per line, each with its own '=', so
                    // `values_after_eq` (which stops at the second one) is the
                    // wrong tool here: take every number on the line instead.
                    let values = numbers_in(l);
                    lam.material_data.push([values[0], values[1], 0.0, 0.0]);
                } else if l.trim_start().starts_with("v12") {
                    lam.material_data.last_mut().expect("v12 ohne E11")[2] = numbers_in(l)[0];
                } else if l.trim_start().starts_with("G12") {
                    lam.material_data.last_mut().expect("G12 ohne E11")[3] = numbers_in(l)[0];
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

pub fn after_colon(line: &str) -> &str {
    line.split_once(':').unwrap_or_else(|| panic!("kein ':' in {line:?}")).1
}

pub fn flag_after_eq(line: &str) -> bool {
    line.split('=')
        .nth(1)
        .unwrap_or_else(|| panic!("kein '=' in {line:?}"))
        .trim()
        == "true"
}

/// The `RF_x = <value>` / `RF_x at iteration = <index>` pair, or `None` when
/// both print as `-`.
pub fn event_after_eq(value_line: &str, iteration_line: &str) -> Option<(f64, usize)> {
    let value = try_parse_f64(value_line.split('=').nth(1)?)?;
    let iteration = try_parse_f64(iteration_line.split('=').nth(1)?)? as usize;
    Some((value, iteration))
}

pub fn current_iteration(lpf: &mut ExpectedLastPlyFailure) -> &mut ExpectedLpfIteration {
    lpf.iterations
        .last_mut()
        .expect("Iterationsdaten vor dem ersten 'Iteration'-Banner")
}

/// A reserve factor that is effectively infinite on both sides carries no
/// information beyond "this ply cannot fail under this load" - comparing the
/// exact magnitude of two different implementations' floating-point overflow
/// would be noise, not a check.
pub fn check_reserve_factor(report: &mut Report, what: &str, actual: f64, expected: f64) {
    let effectively_infinite =
        |v: f64| !v.is_finite() || v.abs() > tolerances::RF_EFFECTIVELY_INFINITE;
    if effectively_infinite(actual) && effectively_infinite(expected) {
        report.checks += 1;
        return;
    }
    report.close(what, actual, expected, 0.0, tolerances::SIX_DIGITS);
}

/// `ReserveFactor`'s integer codes and short names, as the batch output prints
/// them (see ReserveFactor.java and FailureTypeShortNameHandler).
pub fn failure_type_code(t: FailureType) -> i32 {
    match t {
        FailureType::Undamaged => 0,
        FailureType::FiberFailure => 1,
        FailureType::MatrixFailure => 2,
        FailureType::GeneralMaterialFailure => 4,
    }
}

pub fn failure_type_short(t: FailureType) -> &'static str {
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
pub fn bc_short(debug_name: &str) -> String {
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
