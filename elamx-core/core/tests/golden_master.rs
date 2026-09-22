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
//! see `common::tolerances`.

use elamx_core::clt::{
    calculate_last_ply_failure, determine_values, get_layer_results, CltLaminate,
    LastPlyFailureInput, Loads, Strains,
};
use elamx_core::failure::default_criterion_registry;
use elamx_core::micromechanics::{Fibre, MatrixMaterial};
use elamx_core::model::{Laminate, Material};
use elamx_core::plate::{calculate_buckling, BoundaryCondition, BucklingInput, DMatrixKind};
use elamx_core::project::read_elamxb;
use elamx_core::spring_in::{calculate as calculate_spring_in, SpringInInput, SpringInModel};
use serde::Deserialize;
use std::collections::HashMap;

mod common;
use common::{
    bc_short, check_buckling_spectrum, check_reserve_factor, failure_type_code, failure_type_short, parse_reference,
    tolerances, ExpectedBuckling, ExpectedCalculation, ExpectedLaminate, ExpectedLastPlyFailure,
    Report,
};

// ---------------------------------------------------------------------------
// Inputs (golden/reference.input.json)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GoldenInput {
    materials: HashMap<String, Material>,
    #[serde(default)]
    fibres: Vec<Fibre>,
    #[serde(default)]
    matrices: Vec<MatrixMaterial>,
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
    #[serde(default)]
    spring_ins: Vec<GoldenSpringIn>,
}

#[derive(Deserialize)]
struct GoldenSpringIn {
    name: String,
    input: SpringInInput,
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
    let mut input: GoldenInput = serde_json::from_str(
        &std::fs::read_to_string(format!("{dir}/reference.input.json"))
            .expect("reference.input.json fehlt - siehe tests/golden/README.md"),
    )
    .expect("reference.input.json ist kein gültiges JSON");
    // The JSON stores what the .elamx stores, which for a model-driven
    // property is a placeholder eLamX ignores. Resolving here is the same step
    // `project::read_elamx` takes, and it is what makes every test below see
    // the ply the original computed rather than the one the file wrote down.
    {
        let mut resolved: Vec<Material> = input.materials.values().cloned().collect();
        elamx_core::micromechanics::resolve(&mut resolved, &input.fibres, &input.matrices)
            .expect("Faser oder Matrix einer mikromechanischen Lage fehlt");
        input.materials = resolved.into_iter().map(|m| (m.id.clone(), m)).collect();
    }
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

/// The ply properties the original printed, per layer.
///
/// For a plain material this only restates the file. For a micromechanic one
/// it is the whole test: eLamX ignores the values stored beside the models and
/// asks the models instead - the reference file stores 1.0 there on purpose,
/// so any number below that is right had to be COMPUTED, by both sides, from
/// the fibre and the matrix.
///
/// The density is not among them. It prints as `%10.5f` and a real one is
/// about 1e-9 t/mm^3, so the original writes `0.00000` for every material in
/// the file; there is nothing to compare. Its rule is one line and is covered
/// by the unit tests in `micromechanics`.
#[test]
fn material_data_matches_elamx() {
    let (input, expected_all, _, _, _) = load();
    let mut report = Report::default();

    let mut micro_layers = 0;
    for case in &input.laminates {
        let name = &case.laminate.name;
        let expected = expected_laminate(&expected_all, name);
        let stacking = case.laminate.layers_in_stacking_order();
        report.eq(
            format!("{name}/Materialdaten Lagenzahl"),
            stacking.len(),
            expected.material_data.len(),
        );

        for (index, layer) in stacking.iter().enumerate() {
            let material = input
                .materials
                .get(layer.material_id)
                .unwrap_or_else(|| panic!("{name}: Material '{}' fehlt", layer.material_id));
            if material.micro.is_some() {
                micro_layers += 1;
            }

            let want = expected.material_data[index];
            let what = format!("{name}/Lage {}/{}", index + 1, material.name);
            // Absolute floors, no relative part: these print with a fixed
            // number of decimals, so the tolerance is the printed precision.
            let one = tolerances::ONE_DECIMAL;
            let five = tolerances::FIVE_DECIMALS;
            report.close(format!("{what}/E11"), material.e_par, want[0], one, 0.0);
            report.close(format!("{what}/E22"), material.e_nor, want[1], one, 0.0);
            report.close(format!("{what}/v12"), material.nue12, want[2], five, 0.0);
            report.close(format!("{what}/G12"), material.g, want[3], one, 0.0);
        }
    }

    // A silently empty micromechanics section would make this test pass by
    // checking nothing but the materials that were already covered.
    assert!(micro_layers >= 9, "nur {micro_layers} mikromechanische Lagen geprüft");
    report.finish("Materialdaten");
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

/// Spring-in, by way of the one number it does not get from the user.
///
/// The batch mode prints nothing for this module, so it cannot be compared
/// directly - but the whole model is `alpha_circ` and four typed-in values, and
/// `alpha_circ` IS something the original will print if asked the right
/// question. A symmetric laminate under a temperature change and nothing else
/// just expands, so the global strains it reports, divided by dT, are the
/// laminate's thermal expansion coefficients. `GM-Sym-AlphaT` is that question.
///
/// Radford's formula is then written out here a second time, independently of
/// `spring_in::calculate`, and fed the Java's coefficient rather than this
/// crate's. What is left untested against the original is only the two
/// conversions to and from radians - which the unit tests pin against a
/// hand-computed value.
#[test]
fn spring_in_follows_the_expansion_elamx_reports() {
    let (input, _, expected_all, _, _) = load();
    let mut report = Report::default();

    for case in &input.laminates {
        if case.spring_ins.is_empty() {
            continue;
        }
        let clt = CltLaminate::new(&case.laminate, &input.materials).unwrap();

        // The pure-temperature calculation on the same stack. Its presence is
        // asserted rather than assumed: without it this test would silently
        // compare nothing.
        let thermal = expected_calculation(&expected_all, "GM-Sym-AlphaT");
        assert_eq!(thermal.delta_h, 0.0, "GM-Sym-AlphaT darf keine Feuchte tragen");
        assert!(thermal.loads.iter().all(|l| *l == 0.0), "GM-Sym-AlphaT darf keine Last tragen");
        let alpha_java = [
            thermal.strains[0] / thermal.delta_t,
            thermal.strains[1] / thermal.delta_t,
            thermal.strains[2] / thermal.delta_t,
        ];
        // The curvatures have to be zero for that division to mean anything -
        // if the stack warped, one expansion coefficient would not describe it.
        for (i, kappa) in thermal.strains[3..6].iter().enumerate() {
            report.close(format!("GM-Sym-AlphaT/kappa[{i}]"), *kappa, 0.0, 1e-12, 0.0);
        }
        report.close_group(
            "alpha_global",
            &elamx_core::clt::alpha_global(&clt),
            &alpha_java,
            tolerances::ELEVEN_DIGITS,
        );

        for analysis in &case.spring_ins {
            let label = &analysis.name;
            let it = &analysis.input;
            let result = calculate_spring_in(&clt, it).unwrap();

            let alpha_circ = if it.zero_deg_as_circum_dir { alpha_java[0] } else { alpha_java[1] };
            let d_t = it.base_temp - it.hardening_temp;
            let mut relative =
                (alpha_circ - it.alphat_thick) * d_t / (1.0 + it.alphat_thick * d_t);
            if let SpringInModel::EnhancedRadford { eps_circumferential, eps_thickness } = it.model {
                relative += (eps_circumferential - eps_thickness) / (1.0 + eps_thickness);
            }

            report.close(
                format!("{label}/alpha_circ"),
                result.alpha_circumferential,
                alpha_circ,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(
                format!("{label}/dAngle"),
                result.delta_angle,
                it.angle * relative,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(
                format!("{label}/Winkel"),
                result.final_angle,
                it.angle * (1.0 + relative),
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
        }
    }

    report.finish("Spring-In");
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
                    // Stresses and strains in separate groups, because
                    // `close_group` takes its absolute floor from the largest
                    // value in the group: a stress in MPa is some thousands of
                    // times a strain, so one group of six would compare the
                    // strains to the precision of the stresses - which is to
                    // say not at all. The strains get a floor in their own
                    // unit instead, below which a strain is noise.
                    report.close_group(
                        &format!("{ply}/{position}/Spannung"),
                        &state.stress,
                        &expected_row[0..3],
                        tolerances::SIX_DIGITS,
                    );
                    for (k, (a, e)) in state.strain.iter().zip(&expected_row[3..6]).enumerate() {
                        report.close(
                            format!("{ply}/{position}/Verzerrung[{k}]"),
                            *a,
                            *e,
                            1e-12,
                            tolerances::SIX_DIGITS,
                        );
                    }
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
            let actual: Vec<f64> = result.modes.iter().map(|m| m.eigenvalue).collect();
            check_buckling_spectrum(&mut report, label, &n_crit, &expected.n_crit, &actual, &expected.eigenvalues);
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

/// The reference data must actually exercise what it claims to: every ported
/// criterion at least once, and all the structural variants.
/// The reduced input file, read here and by the original, and computed by both.
///
/// A different kind of golden test from the others: they take one definition
/// into two forms and compare the results, whereas this takes ONE FILE - the
/// original's own example, not written for this suite - and compares what each
/// program made of it. So it checks the reader as much as the arithmetic, and
/// the reader is where this format's substance lies: a load case written once
/// and referred to by name, a layer inheriting its thickness from its material,
/// a material carrying degraded moduli that a second laminate is built from,
/// and an unsymmetric stack silently getting a second buckling analysis.
///
/// The batch needs `--reducedinput` alongside `--input` for this file; see
/// `tests/golden/README.md`.
#[test]
fn the_reduced_input_file_is_read_the_way_the_original_reads_it() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden");
    let xml = std::fs::read_to_string(format!("{dir}/reduced.elamxb"))
        .expect("reduced.elamxb fehlt - siehe tests/golden/README.md");
    let project = read_elamxb(&xml).expect("reduced.elamxb muss lesbar sein");
    let text = std::fs::read_to_string(format!("{dir}/reduced.txt"))
        .expect("reduced.txt fehlt - siehe tests/golden/README.md");
    let (expected_laminates, expected_calculations, expected_bucklings, expected_lpf) =
        parse_reference(&text);

    let materials: HashMap<String, Material> = project
        .materials
        .iter()
        .map(|m| (m.id.clone(), m.clone()))
        .collect();
    let criteria = default_criterion_registry();
    let mut report = Report::default();

    // Both programs built the same set of laminates from the file - which is
    // the claim about the degraded twin, since "... Buckling" is not in the
    // file at all: the reader invents it.
    let mut names: Vec<&str> = project.laminates.iter().map(|l| l.laminate.name.as_str()).collect();
    names.sort_unstable();
    let mut expected_names: Vec<&str> = expected_laminates.iter().map(|l| l.name.as_str()).collect();
    expected_names.sort_unstable();
    report.eq("Laminate", names, expected_names);

    for case in &project.laminates {
        let name = &case.laminate.name;
        let expected = expected_laminate(&expected_laminates, name);
        let clt = CltLaminate::new(&case.laminate, &materials)
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));

        report.eq(format!("{name}/Lagenzahl"), clt.layers().len(), expected.number_of_layers);
        report.close(
            format!("{name}/Gesamtdicke"),
            clt.tges(),
            expected.total_thickness,
            tolerances::ONE_DECIMAL,
            0.0,
        );
        report.eq(format!("{name}/symmetrisch"), clt.is_symmetric(), expected.symmetric);
        // The STORED layers, which is what the batch prints: a symmetric
        // laminate lists its half.
        let stacking: Vec<(f64, f64)> = case
            .laminate
            .layers
            .iter()
            .map(|l| (l.thickness, l.angle()))
            .collect();
        report.eq(format!("{name}/Lagenaufbau"), stacking, expected.stacking.clone());
        // The ABD matrix, which is where a wrongly resolved material would show
        // up even if the stacking looked right.
        let abd: Vec<f64> = clt.abd_matrix().iter().flatten().copied().collect();
        report.close_group(&format!("{name}/ABD"), &abd, &expected.abd, tolerances::ONE_DECIMAL);

        for analysis in &case.calculations {
            let label = format!("{name}/{}", analysis.name);
            let expected = expected_calculation(&expected_calculations, &analysis.name);
            let mut loads = analysis.loads;
            let mut strains = analysis.strains;
            determine_values(&clt, &mut loads, &mut strains, &analysis.use_strain);
            report.close_group(
                &format!("{label}/Lasten"),
                &loads.force_moment_vector(),
                &expected.loads,
                tolerances::ELEVEN_DIGITS,
            );
            report.close_group(
                &format!("{label}/Verzerrungen"),
                &strains.epsilon_kappa_vector(),
                &expected.strains,
                tolerances::ELEVEN_DIGITS,
            );
            // The ply results too: a load that reached the laminate correctly
            // can still be shared out wrongly.
            let layers = get_layer_results(&clt, &loads, &strains, &materials, &criteria)
                .unwrap_or_else(|e| panic!("{label}: {e:?}"));
            report.eq(format!("{label}/Lagenergebnisse"), layers.len(), expected.layers.len());
            for (i, (layer, expected_layer)) in layers.iter().zip(&expected.layers).enumerate() {
                // The three local stresses on the upper surface, which is where
                // a ply whose thickness was inherited from its material would
                // show up: the z-coordinates would be wrong and with them the
                // bending share of every stress.
                // A floor of a millipascal: a balanced stack under a pure
                // in-plane load has layer stresses that are exactly zero in
                // theory and 1e-14 in both programs, and comparing two kinds of
                // rounding noise relative to each other says nothing.
                for (k, (actual, expected_value)) in layer
                    .sss_upper
                    .stress
                    .iter()
                    .zip(&expected_layer.upper[0..3])
                    .enumerate()
                {
                    report.close(
                        format!("{label}/Lage {}/Spannung oben[{k}]", i + 1),
                        *actual,
                        *expected_value,
                        1e-3,
                        tolerances::SIX_DIGITS,
                    );
                }
            }
        }

        for analysis in &case.bucklings {
            let label = format!("{name}/{}", analysis.name);
            let expected = expected_buckling(&expected_bucklings, &analysis.name);
            // The analysis sits on the laminate the original put it on, which
            // for a degraded material is NOT the one it was written under.
            report.eq(format!("{label}/Laminat"), name.as_str(), expected.laminate_name.as_str());
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
            let result = calculate_buckling(&clt, &analysis.input)
                .unwrap_or_else(|e| panic!("{label}: {e:?}"));
            let eigenvalues: Vec<f64> = result.modes.iter().map(|m| m.eigenvalue).collect();
            report.eq(format!("{label}/Eigenwertanzahl"), eigenvalues.len(), expected.eigenvalues.len());
            if eigenvalues.len() == expected.eigenvalues.len() {
                report.close_group(
                    &format!("{label}/Eigenwerte"),
                    &eigenvalues,
                    &expected.eigenvalues,
                    tolerances::ELEVEN_DIGITS,
                );
            }
        }

        for analysis in &case.last_ply_failures {
            let label = format!("{name}/{}", analysis.name);
            let expected = expected_lpf
                .iter()
                .find(|l| l.name == analysis.name)
                .unwrap_or_else(|| panic!("{label} nicht in reduced.txt"));
            // The four inputs this format assembles from two places: the load
            // from the named case, the rest from the element itself - and j_a,
            // which is the load case's ultimate-load factor and nothing else.
            report.close_group(
                &format!("{label}/Lasten"),
                &analysis.input.loads.force_moment_vector(),
                &expected.loads,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(format!("{label}/j_a"), analysis.input.j_a, expected.j_a, 0.0, tolerances::ELEVEN_DIGITS);
            report.close(
                format!("{label}/Degradationsfaktor"),
                analysis.input.degradation_factor,
                expected.degradation_factor,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.close(
                format!("{label}/epsilon_crit"),
                analysis.input.epsilon_crit,
                expected.epsilon_crit,
                0.0,
                tolerances::ELEVEN_DIGITS,
            );
            report.eq(
                format!("{label}/alle_bei_Faserbruch"),
                analysis.input.degrade_all_on_fibre_failure,
                expected.degrade_all_on_fibre_failure,
            );

            let result =
                calculate_last_ply_failure(&case.laminate, &materials, &criteria, &analysis.input)
                    .unwrap_or_else(|e| panic!("{label}: {e}"));
            // The batch prints every iteration but the last: the final one is
            // the laminate after the last ply failed, which has nothing left to
            // report. The other golden test counts them the same way.
            report.eq(
                format!("{label}/Iterationen"),
                result.iterations.len().saturating_sub(1),
                expected.iterations.len(),
            );
            for (i, (iteration, expected_iteration)) in
                result.iterations.iter().zip(&expected.iterations).enumerate()
            {
                report.close(
                    format!("{label}/Iteration {}/RF", i + 1),
                    iteration.reserve_factor,
                    expected_iteration.reserve_factor,
                    0.0,
                    tolerances::SIX_DIGITS,
                );
                report.eq(
                    format!("{label}/Iteration {}/versagende Lage", i + 1),
                    iteration.layer_number,
                    expected_iteration.layer_of_failure,
                );
            }
        }
    }

    report.finish("Reduzierte Eingabedatei");
}

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
