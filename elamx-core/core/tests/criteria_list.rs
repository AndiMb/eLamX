//! Several failure criteria per ply (F2.1): the ply's reserve factor is the
//! minimum over its list, a tie going to the criterion listed first.
//!
//! eLamX 3.x knows one criterion per ply, so there is no Java output to
//! compare a list against. What can be checked against something other than
//! the list code itself is its definition: each list result must equal the
//! minimum of the one-criterion runs, which are the analyses the golden
//! master already pins to the Java original. Every check here is of that
//! kind - the list is compared against single-criterion results, never only
//! against itself.

use std::collections::HashMap;

use elamx_core::clt::{determine_values, get_layer_results, CltLaminate, LayerResult, Loads, Strains};
use elamx_core::failure::{
    default_additional_values, default_criterion_registry, laminate_envelope, LaminateEnvelopeInput,
    LaminateFailureKind, HASHIN_ID, MAX_STRAIN_ID, MAX_STRESS_ID, PUCK_ID, TSAI_HILL_ID, TSAI_WU_ID,
};
use elamx_core::model::{Laminate, Layer, Material};

fn materials() -> HashMap<String, Material> {
    let mut m = Material::new("mat", "UD", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
    m.r_par_ten = 2000.0;
    m.set_r_par_com(1200.0);
    m.r_nor_ten = 50.0;
    m.set_r_nor_com(150.0);
    m.set_r_shear(70.0);
    m.additional_values = default_additional_values();
    HashMap::from([("mat".to_string(), m)])
}

fn laminate(angles: &[f64], primary: Option<&str>, extras: &[&str]) -> Laminate {
    let mut laminate = Laminate::new("lam", "lam");
    for (i, angle) in angles.iter().enumerate() {
        let mut layer = Layer::new(format!("l{i}"), "", "mat", *angle, 0.125);
        layer.criterion_id = primary.map(str::to_string);
        layer.extra_criteria = extras.iter().map(|c| c.to_string()).collect();
        laminate.layers.push(layer);
    }
    laminate
}

fn results(laminate: &Laminate, loads: Loads) -> Vec<LayerResult> {
    let materials = materials();
    let clt = CltLaminate::new(laminate, &materials).unwrap();
    let mut loads = loads;
    let mut strains = Strains::default();
    determine_values(&clt, &mut loads, &mut strains, &[false; 6]);
    get_layer_results(&clt, &loads, &strains, &materials, &default_criterion_registry()).unwrap()
}

const STACKS: [&[f64]; 3] = [
    &[0.0, 45.0, -45.0, 90.0, 90.0, -45.0, 45.0, 0.0],
    &[0.0, 90.0, 0.0],
    &[30.0, -60.0, 15.0],
];

fn load_cases() -> Vec<Loads> {
    vec![
        Loads { n_x: 300.0, ..Default::default() },
        Loads { n_x: -200.0, n_y: 50.0, ..Default::default() },
        Loads { n_xy: 90.0, ..Default::default() },
        Loads { n_x: 100.0, n_y: -80.0, n_xy: 40.0, m_x: 3.0, m_xy: -1.0, ..Default::default() },
    ]
}

const LISTS: [&[&str]; 4] = [
    &[MAX_STRESS_ID, TSAI_WU_ID],
    &[PUCK_ID, HASHIN_ID, MAX_STRAIN_ID],
    &[TSAI_HILL_ID, MAX_STRESS_ID, PUCK_ID],
    &[HASHIN_ID, TSAI_WU_ID],
];

/// RF(list) = min over the single-criterion RFs, bit for bit, per surface;
/// the governing id and mode are those of the smallest (earliest on a tie);
/// `by_criterion` repeats each single run exactly.
#[test]
fn a_list_is_the_minimum_of_its_single_criterion_runs() {
    let mut compared = 0;
    for angles in STACKS {
        for loads in load_cases() {
            for list in LISTS {
                let listed = results(&laminate(angles, Some(list[0]), &list[1..]), loads);
                let singles: Vec<Vec<LayerResult>> = list
                    .iter()
                    .map(|id| results(&laminate(angles, Some(id), &[]), loads))
                    .collect();

                for (ply, result) in listed.iter().enumerate() {
                    assert_eq!(result.by_criterion.len(), list.len());
                    for (surface, pick) in [
                        (0, (|r: &LayerResult| r.rr_lower.clone()) as fn(&LayerResult) -> _),
                        (1, |r: &LayerResult| r.rr_upper.clone()),
                    ] {
                        let single_rfs: Vec<_> = singles.iter().map(|s| pick(&s[ply])).collect();
                        let mut expected = 0;
                        for (i, rf) in single_rfs.iter().enumerate() {
                            if rf.minimal_reserve_factor < single_rfs[expected].minimal_reserve_factor {
                                expected = i;
                            }
                        }
                        let got = pick(result);
                        assert_eq!(got, single_rfs[expected], "{angles:?} {list:?} ply {ply}");
                        let governing = if surface == 0 { &result.governing_lower } else { &result.governing_upper };
                        assert_eq!(governing, list[expected]);
                        for (i, by) in result.by_criterion.iter().enumerate() {
                            assert_eq!(by.id, list[i]);
                            let by_rf = if surface == 0 { &by.rr_lower } else { &by.rr_upper };
                            assert_eq!(*by_rf, single_rfs[i]);
                        }
                    }
                    // The states do not depend on the criteria at all.
                    assert_eq!(result.sss_lower, singles[0][ply].sss_lower);
                    compared += 1;
                }
            }
        }
    }
    assert!(compared > 100);
}

/// A one-element list is today's analysis: no extra field is filled and the
/// governing criterion is the ply's own, the Puck fallback included.
#[test]
fn a_single_criterion_fills_no_list_and_names_its_own_id() {
    for loads in load_cases() {
        for result in results(&laminate(STACKS[0], Some(MAX_STRESS_ID), &[]), loads) {
            assert!(result.by_criterion.is_empty());
            assert_eq!(result.governing_lower, MAX_STRESS_ID);
            assert_eq!(result.governing_upper, MAX_STRESS_ID);
        }
        for result in results(&laminate(STACKS[0], None, &[]), loads) {
            assert_eq!(result.governing_lower, PUCK_ID);
        }
        // An unassigned primary still falls back to Puck ahead of the extras.
        let listed = results(&laminate(STACKS[0], None, &[HASHIN_ID]), loads);
        assert_eq!(listed[0].by_criterion[0].id, PUCK_ID);
    }
}

/// A tie keeps the earlier criterion: listing the same criterion again under
/// the primary cannot move `governing_*` off it, and the primary repeated in
/// the extras is dropped rather than evaluated twice.
#[test]
fn ties_go_to_the_earlier_criterion() {
    let loads = load_cases()[0];
    let single = results(&laminate(STACKS[0], Some(MAX_STRESS_ID), &[]), loads);
    let repeated = results(&laminate(STACKS[0], Some(MAX_STRESS_ID), &[MAX_STRESS_ID]), loads);
    assert_eq!(single, repeated);
}

/// An extra criterion missing from the registry is an error, as a missing
/// primary one is.
#[test]
fn an_unknown_extra_criterion_is_reported() {
    let materials = materials();
    let laminate = laminate(&[0.0], Some(MAX_STRESS_ID), &["nope"]);
    let clt = CltLaminate::new(&laminate, &materials).unwrap();
    let error = get_layer_results(
        &clt,
        &Loads::default(),
        &Strains::default(),
        &materials,
        &default_criterion_registry(),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), "failure criterion 'nope' not found in the registry");
}

/// First-ply failure is linear in the load, so along every direction the
/// list's surface sits at the smallest of the single-criterion surfaces.
#[test]
fn the_first_ply_envelope_of_a_list_is_the_inner_hull_of_the_singles() {
    let angles = STACKS[0];
    let input = LaminateEnvelopeInput { kind: LaminateFailureKind::FirstPly, alpha_steps: 8, beta_steps: 16 };
    let registry = default_criterion_registry();
    let materials = materials();
    let envelope = |primary: &str, extras: &[&str]| {
        laminate_envelope(&laminate(angles, Some(primary), extras), &materials, &registry, &input).unwrap()
    };
    let list = envelope(MAX_STRESS_ID, &[TSAI_WU_ID, HASHIN_ID]);
    let singles = [envelope(MAX_STRESS_ID, &[]), envelope(TSAI_WU_ID, &[]), envelope(HASHIN_ID, &[])];
    let norm = |l: [f64; 3]| (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt();
    let mut inner_from = [0usize; 3];
    for (i, row) in list.points.iter().enumerate() {
        for (j, point) in row.iter().enumerate() {
            let radii: Vec<f64> = singles.iter().map(|s| norm(s.points[i][j].load)).collect();
            let inner = radii.iter().copied().fold(f64::INFINITY, f64::min);
            let r = norm(point.load);
            assert!((r - inner).abs() <= 1e-12 * inner, "({i},{j}): {r} vs {inner}");
            inner_from[radii.iter().position(|x| *x == inner).unwrap()] += 1;
        }
    }
    // More than one criterion shapes the hull - otherwise the test proves little.
    assert!(inner_from.iter().filter(|n| **n > 0).count() >= 2, "{inner_from:?}");
}
