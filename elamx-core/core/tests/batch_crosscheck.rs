//! Whole `.elamx` files, read by this crate and by the original, computed by
//! both, compared number for number.
//!
//! The suite in `golden_master.rs` takes one case definition into two forms -
//! a `.elamx` for the Java run and a JSON twin for the Rust one - so that the
//! two sides cannot drift apart on the inputs. That is the right shape for
//! reference cases, but it means the Rust side never reads the file the
//! original read.
//!
//! This one does. Each case is a pair of files in `golden/crosscheck/`:
//!
//! ```text
//!   crosscheck/<case>.elamx ─┬─[eLamX batch]──> crosscheck/<case>.txt
//!                            └─[project::read_elamx]──> this test
//! ```
//!
//! So a laminate the reader assembles differently - a mirrored stack, an
//! offset reference plane, a reversed stacking order, an angle outside
//! -90..90 - fails here even when the arithmetic downstream of it is perfect.
//! Adding a case is dropping two more files into that directory; the test
//! walks it and needs no edit.
//!
//! Regenerating the `.txt` files after changing an input (see also
//! `golden/README.md`, whose three warnings about `--locale`, the `=` in
//! `--input=` and the stale `lock` apply unchanged):
//!
//! ```sh
//! cd elamx-core/core/tests/golden/crosscheck
//! "<eLamX>/bin/elamx64.exe" --locale en --userdir /tmp/elamx-batch \
//!     --input="$(pwd)/stacks.elamx" --output="$(pwd)/stacks.txt"
//! ```

use elamx_core::clt::{
    calculate_last_ply_failure, determine_values, get_layer_results, CltLaminate,
    LastPlyFailureInput,
};
use elamx_core::failure::{default_criterion_registry, CriterionRegistry};
use elamx_core::model::{Laminate, Material};
use elamx_core::plate::{calculate_buckling, DMatrixKind};
use elamx_core::project::{read_elamx, NamedBuckling, ProjectLaminate};
use std::collections::HashMap;

mod common;
use common::{
    bc_short, check_reserve_factor, failure_type_code, failure_type_short, parse_reference,
    tolerances, ExpectedBuckling, ExpectedLaminate, ExpectedLastPlyFailure, Report,
};

/// How the batch output names each bending-stiffness idealisation. Checked
/// because an unrecognised `dmatrixservice` class name does not fail the read:
/// the Java hook substitutes the standard D matrix silently, and so would a
/// port that copied it - both then computing something the file did not ask
/// for.
fn d_matrix_label(kind: DMatrixKind) -> &'static str {
    match kind {
        DMatrixKind::Standard => "Original D matrix",
        DMatrixKind::SpecialOrthotropic => "D matrix with D_{16} = D_{26} = 0",
        DMatrixKind::DTilde => "D-tilde matrix",
    }
}

/// The criterion names the batch prints, for the ones these files use. Same
/// purpose as the labels above: `LaminateLoadSaveImpl` falls back to Puck
/// without complaining when it does not recognise a criterion class, so a
/// reader that mapped a class name wrongly would otherwise be compared
/// against whatever it happened to choose.
fn criterion_display_name(id: &str) -> &'static str {
    match id {
        "puck" => "Puck",
        "max_stress" => "maximum Stress",
        "max_strain" => "maximum Strain",
        "tsai_hill" => "Tsai-Hill",
        "tsai_wu" => "TsaiWu",
        "hashin" => "Hashin",
        "christensen" => "Christensen",
        "hoffman" => "Hoffman",
        "fmc" => "FMC",
        other => panic!("kein Anzeigename für Kriterium '{other}' hinterlegt"),
    }
}

/// Tolerances of this suite's own, where the printed precision is not the
/// limit.
mod limits {
    /// A ply stress that is exactly zero in theory - the mid-plane ply of a
    /// symmetric stack under pure bending, say - comes out of both programs as
    /// rounding noise, around 1e-15 MPa on one side and 1e-14 on the other.
    /// Below a micropascal there is nothing to compare, and comparing two
    /// kinds of noise relative to each other says only which one rounded
    /// first.
    pub const STRESS_FLOOR: f64 = 1e-6;
    /// The same for the strains that go with them, in their own unit: a strain
    /// of 1e-12 is noise on any laminate.
    pub const STRAIN_FLOOR: f64 = 1e-12;
    /// The eigenvalue spectrum, unlike the critical load it starts with, is
    /// compared to eight significant digits rather than the eleven the batch
    /// prints.
    ///
    /// Not a concession to the port: a shear-loaded plate's Ritz problem has
    /// an indefinite geometric stiffness and a spectrum spanning nine decades
    /// (32 to 1.2e10 in `XC-QI-Beul-Schub`), and its TOP is where two
    /// different eigensolvers - Java's and nalgebra's - stop agreeing to the
    /// last printed digit. The bottom is where the physics is, and `n_crit` is
    /// still compared at the full printed precision.
    pub const EIGENVALUE: f64 = 1e-8;
}

/// One ply face: three stresses and three strains, each in its own unit.
///
/// Not one group of six. `close_group` takes its absolute floor from the
/// largest value in the group, and a stress in MPa is some thousands of times
/// a strain - so a group holding both would compare the strains to the
/// precision of the stresses, which is to say not at all.
fn check_ply_face(report: &mut Report, what: &str, stress: &[f64], strain: &[f64], expected: &[f64]) {
    for (k, (a, e)) in stress.iter().zip(&expected[0..3]).enumerate() {
        report.close(
            format!("{what}/Spannung[{k}]"),
            *a,
            *e,
            limits::STRESS_FLOOR,
            tolerances::SIX_DIGITS,
        );
    }
    for (k, (a, e)) in strain.iter().zip(&expected[3..6]).enumerate() {
        report.close(
            format!("{what}/Verzerrung[{k}]"),
            *a,
            *e,
            limits::STRAIN_FLOOR,
            tolerances::SIX_DIGITS,
        );
    }
}

/// Every `.elamx` in `golden/crosscheck/` that has a `.txt` beside it.
fn cases() -> Vec<(String, String, String)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/crosscheck");
    let mut found: Vec<(String, String, String)> = std::fs::read_dir(dir)
        .expect("tests/golden/crosscheck fehlt")
        .filter_map(|entry| {
            let path = entry.expect("Verzeichniseintrag lesbar").path();
            if path.extension()? != "elamx" {
                return None;
            }
            let name = path.file_stem()?.to_string_lossy().into_owned();
            let text = path.with_extension("txt");
            let expected = std::fs::read_to_string(&text).unwrap_or_else(|_| {
                panic!("{name}.txt fehlt - siehe den Kopf dieser Datei zum Erzeugen")
            });
            Some((name, std::fs::read_to_string(&path).ok()?, expected))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(found.len() >= 2, "nur {} Vergleichsfälle gefunden", found.len());
    found
}

fn find<'a, T>(all: &'a [T], name: &str, of: impl Fn(&T) -> &str, kind: &str) -> &'a T {
    all.iter()
        .find(|item| of(item) == name)
        .unwrap_or_else(|| panic!("{kind} '{name}' steht nicht in der Ausgabe von eLamX"))
}

#[test]
fn every_crosscheck_file_matches_elamx() {
    let criteria = default_criterion_registry();
    let mut report = Report::default();

    for (case, xml, text) in cases() {
        let project = read_elamx(&xml).unwrap_or_else(|e| panic!("{case}.elamx: {e}"));
        let (laminates, calculations, bucklings, last_ply_failures) = parse_reference(&text);
        let materials: HashMap<String, Material> = project
            .materials
            .iter()
            .map(|m| (m.id.clone(), m.clone()))
            .collect();

        // Both programs made the same set of laminates out of the file. Not a
        // formality: the reduced format invents laminates, and a reader that
        // dropped one would otherwise just check fewer of them.
        let mut ours: Vec<&str> = project.laminates.iter().map(|l| l.laminate.name.as_str()).collect();
        let mut theirs: Vec<&str> = laminates.iter().map(|l| l.name.as_str()).collect();
        ours.sort_unstable();
        theirs.sort_unstable();
        report.eq(format!("{case}/Laminate"), ours, theirs);

        for lam in &project.laminates {
            let name = format!("{case}/{}", lam.laminate.name);
            let expected = find(&laminates, &lam.laminate.name, |l| &l.name, "Laminat");
            let clt = CltLaminate::new(&lam.laminate, &materials)
                .unwrap_or_else(|e| panic!("{name}: CltLaminate::new schlug fehl: {e}"));

            check_stack(&mut report, &name, lam, expected, &materials, &clt);
            check_stiffness(&mut report, &name, expected, &clt);

            for analysis in &lam.calculations {
                let label = format!("{case}/{}", analysis.name);
                let expected = find(&calculations, &analysis.name, |c| &c.name, "Berechnung");
                let mut loads = analysis.loads;
                let mut strains = analysis.strains;
                determine_values(&clt, &mut loads, &mut strains, &analysis.use_strain);

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

                let results = get_layer_results(&clt, &loads, &strains, &materials, &criteria)
                    .unwrap_or_else(|e| panic!("{label}: get_layer_results schlug fehl: {e}"));
                report.eq(format!("{label}/Lagenzahl"), results.len(), expected.layers.len());
                let plies = lam.laminate.all_layers();
                for (i, (result, want)) in results.iter().zip(&expected.layers).enumerate() {
                    let ply = format!("{label}/Lage{}", i + 1);
                    report.close(
                        format!("{ply}/zm"),
                        clt.layers()[i].zm,
                        want.zm,
                        0.0,
                        tolerances::SIX_DIGITS,
                    );
                    for (position, state, rf, row) in [
                        ("oben", &result.sss_upper, &result.rr_upper, &want.upper),
                        ("unten", &result.sss_lower, &result.rr_lower, &want.lower),
                    ] {
                        check_ply_face(
                            &mut report,
                            &format!("{ply}/{position}"),
                            &state.stress,
                            &state.strain,
                            &row[..6],
                        );
                        let criterion = plies[i].criterion_id.unwrap_or("puck");
                        check_reserve_factor(
                            &mut report,
                            &format!("{ply}/RF {position} ({criterion})"),
                            rf.minimal_reserve_factor,
                            row[6],
                        );
                    }
                }
            }

            for analysis in &lam.bucklings {
                let label = format!("{case}/{}", analysis.name);
                let expected = find(&bucklings, &analysis.name, |b| &b.name, "Beulanalyse");
                check_buckling(&mut report, &label, &lam.laminate.name, analysis, expected, &clt);
            }

            for analysis in &lam.last_ply_failures {
                let label = format!("{case}/{}", analysis.name);
                let expected =
                    find(&last_ply_failures, &analysis.name, |l| &l.name, "Last-Ply-Failure-Analyse");
                check_last_ply_failure(
                    &mut report,
                    &label,
                    &lam.laminate,
                    &analysis.input,
                    expected,
                    &materials,
                    &criteria,
                );
            }
        }
    }

    // A directory walk that found nothing would otherwise pass in silence.
    assert!(report.checks > 10_000, "nur {} Vergleiche - die Fälle sind nicht angekommen", report.checks);
    report.finish("Vergleich ganzer .elamx-Dateien");
}

/// What the reader made of the stack itself, before any arithmetic: how many
/// plies, how thick, in which order, of which material and under which
/// criterion.
fn check_stack(
    report: &mut Report,
    name: &str,
    lam: &ProjectLaminate,
    expected: &ExpectedLaminate,
    materials: &HashMap<String, Material>,
    clt: &CltLaminate,
) {
    report.eq(format!("{name}/symmetrisch"), lam.laminate.symmetric, expected.symmetric);
    report.eq(
        format!("{name}/Lagenzahl"),
        lam.laminate.number_of_layers(),
        expected.number_of_layers,
    );
    report.close(
        format!("{name}/Gesamtdicke"),
        clt.tges(),
        expected.total_thickness,
        0.0,
        tolerances::ELEVEN_DIGITS,
    );

    // The stored plies, which is what the batch tabulates: a symmetric
    // laminate lists its half, and an inverted one lists it backwards.
    let stacking = lam.laminate.layers_in_stacking_order();
    report.eq(format!("{name}/Stapelhöhe"), stacking.len(), expected.stacking.len());
    for (i, (layer, (thickness, angle))) in stacking.iter().zip(&expected.stacking).enumerate() {
        report.close(format!("{name}/Lage{}/Dicke", i + 1), layer.thickness, *thickness, 1e-5, 0.0);
        // The angle as PRINTED, i.e. after the original reduced it into
        // -90..90. A file may well store 220.
        report.close(format!("{name}/Lage{}/Winkel", i + 1), layer.angle, *angle, 0.05, 0.0);
    }

    let names: Vec<&str> = stacking
        .iter()
        .map(|l| criterion_display_name(l.criterion_id.unwrap_or("puck")))
        .collect();
    let expected_names: Vec<&str> =
        expected.criterion_display_names.iter().map(|s| s.as_str()).collect();
    report.eq(format!("{name}/Kriterien"), names, expected_names);

    // The ply properties the original printed. For a plain material this only
    // restates the file - but it restates it after the reader has been
    // through it, which is the point here.
    report.eq(
        format!("{name}/Materialdaten Lagenzahl"),
        stacking.len(),
        expected.material_data.len(),
    );
    for (i, layer) in stacking.iter().enumerate() {
        let material = materials
            .get(layer.material_id)
            .unwrap_or_else(|| panic!("{name}: Material '{}' fehlt", layer.material_id));
        let want = expected.material_data[i];
        let what = format!("{name}/Lage {}/{}", i + 1, material.name);
        let one = tolerances::ONE_DECIMAL;
        let five = tolerances::FIVE_DECIMALS;
        report.close(format!("{what}/E11"), material.e_par, want[0], one, 0.0);
        report.close(format!("{what}/E22"), material.e_nor, want[1], one, 0.0);
        report.close(format!("{what}/v12"), material.nue12, want[2], five, 0.0);
        report.close(format!("{what}/G12"), material.g, want[3], one, 0.0);
    }
}

/// The ABD matrix, its inverse and every laminate-level stiffness the batch
/// reports.
fn check_stiffness(
    report: &mut Report,
    name: &str,
    expected: &ExpectedLaminate,
    clt: &CltLaminate,
) {
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
    report.close_group(&format!("{name}/abd"), &abd_inv, &expected.abd_inv, tolerances::ELEVEN_DIGITS);

    for (label, actual, want) in [
        ("Exx", [clt.ex_simple(), clt.ex_bend_simple(), clt.ex_fixed(), clt.ex_bend_fixed()], expected.ex),
        ("Eyy", [clt.ey_simple(), clt.ey_bend_simple(), clt.ey_fixed(), clt.ey_bend_fixed()], expected.ey),
        ("Gxy", [clt.g_simple(), clt.g_bend_simple(), clt.g_fixed(), clt.g_bend_fixed()], expected.g),
    ] {
        for (i, (a, e)) in actual.iter().zip(&want).enumerate() {
            report.close(format!("{name}/{label}[{i}]"), *a, *e, tolerances::ONE_DECIMAL, 0.0);
        }
    }

    for (label, actual, want) in [
        ("vxy", [clt.nuxy_simple(), clt.nuxy_bend_simple()], expected.nuxy),
        ("vyx", [clt.nuyx_simple(), clt.nuyx_bend_simple()], expected.nuyx),
    ] {
        for (i, (a, e)) in actual.iter().zip(&want).enumerate() {
            report.close(format!("{name}/{label}[{i}]"), *a, *e, tolerances::FIVE_DECIMALS, 0.0);
        }
    }

    for (i, (a, e)) in [clt.beta_d(), clt.nu_d(), clt.gamma_d(), clt.delta_d()]
        .iter()
        .zip(&expected.non_dimensional)
        .enumerate()
    {
        let label = ["beta_D", "nu_D", "gamma_D", "delta_D"][i];
        report.close(format!("{name}/{label}"), *a, *e, 0.0, tolerances::ELEVEN_DIGITS);
    }
}

fn check_buckling(
    report: &mut Report,
    label: &str,
    laminate_name: &str,
    analysis: &NamedBuckling,
    expected: &ExpectedBuckling,
    clt: &CltLaminate,
) {
    report.eq(format!("{label}/Laminat"), laminate_name, expected.laminate_name.as_str());
    report.eq(
        format!("{label}/D-Matrix-Wahl"),
        d_matrix_label(analysis.input.d_matrix),
        expected.d_matrix_label.as_str(),
    );
    report.eq(format!("{label}/m"), analysis.input.m, expected.m);
    report.eq(format!("{label}/n"), analysis.input.n, expected.n);
    report.eq(
        format!("{label}/Randbedingungen"),
        [format!("{:?}", analysis.input.bc_x), format!("{:?}", analysis.input.bc_y)].map(|s| bc_short(&s)),
        expected.bc.clone(),
    );
    report.close(format!("{label}/Laenge"), analysis.input.length, expected.length, 0.0, tolerances::ELEVEN_DIGITS);
    report.close(format!("{label}/Breite"), analysis.input.width, expected.width, 0.0, tolerances::ELEVEN_DIGITS);

    let d: Vec<f64> = analysis.input.d_matrix.matrix(clt).iter().flatten().copied().collect();
    for (k, (a, e)) in d.iter().zip(&expected.d_matrix).enumerate() {
        report.close(format!("{label}/D[{}][{}]", k / 3, k % 3), *a, *e, tolerances::ONE_DECIMAL, 0.0);
    }

    let result = calculate_buckling(clt, &analysis.input)
        .unwrap_or_else(|e| panic!("{label}: calculate_buckling schlug fehl: {e:?}"));
    let n_crit = result
        .n_crit
        .unwrap_or_else(|| panic!("{label}: eLamX fand eine kritische Last, der Port nicht"));
    report.close_group(&format!("{label}/n_crit"), &n_crit, &expected.n_crit, tolerances::ELEVEN_DIGITS);

    let eigenvalues: Vec<f64> = result.modes.iter().map(|m| m.eigenvalue).collect();
    report.eq(format!("{label}/Eigenwertanzahl"), eigenvalues.len(), expected.eigenvalues.len());
    if eigenvalues.len() == expected.eigenvalues.len() {
        report.close_group(
            &format!("{label}/Eigenwerte"),
            &eigenvalues,
            &expected.eigenvalues,
            limits::EIGENVALUE,
        );
    }
}

/// The whole degradation path, as in `golden_master.rs`: which ply fails in
/// which step, at which reserve factor, and what the laminate looks like
/// afterwards.
fn check_last_ply_failure(
    report: &mut Report,
    label: &str,
    laminate: &Laminate,
    input: &LastPlyFailureInput,
    expected: &ExpectedLastPlyFailure,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
) {
    report.close_group(
        &format!("{label}/Last"),
        &input.loads.force_moment_vector(),
        &expected.loads,
        tolerances::ELEVEN_DIGITS,
    );
    report.close(format!("{label}/jA"), input.j_a, expected.j_a, 0.0, tolerances::ELEVEN_DIGITS);
    report.close(
        format!("{label}/degFac"),
        input.degradation_factor,
        expected.degradation_factor,
        0.0,
        tolerances::ELEVEN_DIGITS,
    );
    report.close(
        format!("{label}/epsAllow"),
        input.epsilon_crit,
        expected.epsilon_crit,
        0.0,
        tolerances::ELEVEN_DIGITS,
    );
    report.eq(
        format!("{label}/degAllOnFibreFailure"),
        input.degrade_all_on_fibre_failure,
        expected.degrade_all_on_fibre_failure,
    );

    let result = calculate_last_ply_failure(laminate, materials, criteria, input)
        .unwrap_or_else(|e| panic!("{label}: calculate_last_ply_failure schlug fehl: {e}"));

    for (what, actual, want) in [
        ("RF_epsilon", result.first_epsilon, expected.rf_epsilon),
        ("RF_FF", result.first_fibre_failure, expected.rf_ff),
        ("RF_IFF", result.first_matrix_failure, expected.rf_iff),
        ("EF_LPF", result.exceedance_factor, expected.ef_lpf),
    ] {
        report.eq(format!("{label}/{what} vorhanden"), actual.is_some(), want.is_some());
        if let (Some(actual), Some((value, iteration))) = (actual, want) {
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
    // The writer stops one short of the last recorded iteration, so the
    // printed count pins down the recorded one exactly.
    report.eq(
        format!("{label}/Iterationen"),
        result.iterations.len().saturating_sub(1),
        expected.iterations.len(),
    );

    for (index, (actual, want)) in result.iterations.iter().zip(&expected.iterations).enumerate() {
        let it = format!("{label}/Iter{index}");
        report.eq(format!("{it}/versagende Lage"), actual.layer_number, want.layer_of_failure);
        report.close(
            format!("{it}/RF"),
            actual.reserve_factor,
            want.reserve_factor,
            0.0,
            tolerances::SIX_DIGITS,
        );
        report.eq(
            format!("{it}/Versagensart"),
            failure_type_code(actual.failure_type),
            want.failure_type,
        );
        report.eq(
            format!("{it}/Versagensart kurz"),
            failure_type_short(actual.failure_type),
            want.failure_type_short.as_str(),
        );
        report.eq(format!("{it}/Lagenzahl"), actual.layer_results.len(), want.layers.len());

        for (i, (ply_result, want_ply)) in
            actual.layer_results.iter().zip(&want.layers).enumerate()
        {
            let ply = format!("{it}/Lage{}", i + 1);
            for (position, state, rf, row) in [
                ("oben", &ply_result.sss_upper, &ply_result.rr_upper, &want_ply.layer.upper),
                ("unten", &ply_result.sss_lower, &ply_result.rr_lower, &want_ply.layer.lower),
            ] {
                check_ply_face(
                    report,
                    &format!("{ply}/{position}"),
                    &state.stress,
                    &state.strain,
                    &row[..6],
                );
                check_reserve_factor(
                    report,
                    &format!("{ply}/RF {position}"),
                    rf.minimal_reserve_factor,
                    row[6],
                );
            }
            report.eq(format!("{ply}/FF-Flag"), actual.fibre_failed[i], want_ply.fibre_failed);
            report.eq(format!("{ply}/IFF-Flag"), actual.matrix_failed[i], want_ply.matrix_failed);
        }
    }
}
