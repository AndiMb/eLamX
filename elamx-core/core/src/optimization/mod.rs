//! Finding a stacking sequence instead of checking one.
//! Reference: eLamX2/Classical_Laminated_Plate_Theory_Optimzation/ and
//! eLamX2/AdditionalOptimizers/
//!
//! Every other module in this crate answers "what does this laminate do?".
//! This one answers "which laminate would do?", and that is a different kind
//! of thing: a search over stacking sequences, with the other modules as its
//! constraints.
//!
//! The shape is simple enough to state in a sentence. A candidate is a list of
//! ply angles drawn from an allowed set, all of one material and one
//! thickness. A constraint turns a candidate into a reserve factor - the CLT
//! one takes the worst ply under a load case, the buckling one the smallest
//! positive eigenvalue, the deformation one the allowable deflection over the
//! actual. A candidate is acceptable when the SMALLEST reserve factor over all
//! its constraints reaches 1, and the search wants the thinnest such stack.
//!
//! What is deliberately not here is a cost function over stiffness or weight.
//! eLamX optimises for ply count and nothing else, which is the right question
//! when every ply is the same material and thickness - and it is why the
//! search can stop the moment a stack passes rather than having to explore
//! past it.

use serde::{Deserialize, Serialize};

use crate::clt::{determine_values, get_layer_results, CltLaminate, Loads, Strains};
use crate::failure::CriterionRegistry;
use crate::model::{Laminate, Layer, Material};
use crate::plate::{
    calculate_buckling, calculate_deformation, BucklingInput, DeformationInput,
};
use std::collections::HashMap;

/// One requirement the stack has to meet.
///
/// In the Java this is the `MinimalReserveFactorCalculator` interface, with an
/// implementation living in each analysis module. Here it is an enum, for the
/// reason every other service-turned-enum in this crate gives: the set is
/// fixed, it has to survive JSON, and a reader should be able to see what the
/// alternatives are.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Constraint {
    /// A load case the laminate has to carry: the reserve factor is the worst
    /// ply's, over both surfaces.
    Clt { loads: Loads },
    /// A plate cut from the laminate has to not buckle under its load: the
    /// reserve factor is the smallest positive eigenvalue.
    Buckling { input: BucklingInput },
    /// A plate cut from the laminate has to stay within an allowable
    /// deflection: the reserve factor is that allowable over the actual.
    Deformation { input: DeformationInput },
}

impl Constraint {
    /// Whether this constraint can only be evaluated on a symmetric stack.
    ///
    /// Buckling and deformation solve on the D matrix and want no B matrix
    /// under them, so eLamX forces the whole search symmetric as soon as one
    /// of them is present - not as an option but as a consequence.
    pub fn needs_symmetric_laminate(&self) -> bool {
        match self {
            Constraint::Clt { .. } => false,
            Constraint::Buckling { .. } | Constraint::Deformation { .. } => true,
        }
    }

    /// The reserve factor this constraint gives a candidate, or `None` if it
    /// cannot be evaluated on it at all.
    ///
    /// `None` is treated as "this candidate fails", not as an error: a search
    /// walks through stacks that the analyses have nothing to say about (a
    /// single ply has no bending stiffness worth the name), and stopping the
    /// whole optimisation for one of them would be the wrong answer to a
    /// question about a different stack.
    pub fn reserve_factor(
        &self,
        laminate: &CltLaminate,
        materials: &HashMap<String, Material>,
        criteria: &CriterionRegistry,
    ) -> Option<f64> {
        match self {
            Constraint::Clt { loads } => {
                let mut loads = *loads;
                let mut strains = Strains::default();
                determine_values(laminate, &mut loads, &mut strains, &[false; 6]);
                let results =
                    get_layer_results(laminate, &loads, &strains, materials, criteria).ok()?;
                let worst = results.iter().fold(f64::INFINITY, |acc, r| {
                    acc.min(r.rr_lower.minimal_reserve_factor)
                        .min(r.rr_upper.minimal_reserve_factor)
                });
                worst.is_finite().then_some(worst).or(Some(f64::INFINITY))
            }
            Constraint::Buckling { input } => {
                let result = calculate_buckling(laminate, input).ok()?;
                // A plate with no positive eigenvalue cannot buckle under this
                // load at all, which the Java reports as infinity rather than
                // as a failure - and it is right to: nothing constrains it.
                Some(result.critical_factor.unwrap_or(f64::INFINITY))
            }
            Constraint::Deformation { input } => {
                if input.max_displacement_z <= 0.0 {
                    // No limit set is no constraint, not a limit of zero.
                    return Some(f64::INFINITY);
                }
                let result = calculate_deformation(laminate, input).ok()?;
                let peak = result.max_deflection.abs().max(result.min_deflection.abs());
                if peak == 0.0 {
                    return Some(f64::INFINITY);
                }
                Some(input.max_displacement_z / peak)
            }
        }
    }
}

/// Everything the search needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct OptimizationInput {
    /// The ply angles the search may choose from, in degrees.
    pub angles: Vec<f64>,
    /// The thickness of one ply, in mm. Every ply has it - that is what makes
    /// "thinnest" the same question as "fewest plies".
    pub thickness: f64,
    pub material_id: String,
    pub criterion_id: String,
    pub constraints: Vec<Constraint>,
    /// Whether the stack must be symmetric. Forced on by a constraint that
    /// needs it, whatever this says.
    pub symmetric: bool,
    /// How many plies the search may add before giving up.
    ///
    /// Not in the original, which loops until the reserve factor reaches 1 and
    /// therefore never returns on a load no stack of these angles can carry.
    pub max_layers: usize,
}

impl Default for OptimizationInput {
    fn default() -> Self {
        OptimizationInput {
            // eLamX's own default set.
            angles: vec![0.0, 45.0, -45.0, 90.0],
            thickness: 0.125,
            material_id: String::new(),
            criterion_id: String::new(),
            constraints: Vec::new(),
            symmetric: false,
            max_layers: 200,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct OptimizationResult {
    /// The STORED stacking sequence, in degrees, outside in.
    ///
    /// Stored, not total: when the search is symmetric this is half the stack,
    /// the way a symmetric laminate is written down and the way eLamX keeps
    /// it. `[-45/45/45]` with `symmetric` set is six plies, not three - which
    /// is also why each step of a symmetric search adds two.
    pub angles: Vec<f64>,
    /// Whether the sequence above is mirrored to make the stack.
    pub symmetric: bool,
    /// Plies in the whole stack, mirroring included.
    pub layer_count: usize,
    /// Its smallest reserve factor over all constraints - at or just above 1
    /// when the search succeeded.
    pub min_reserve_factor: f64,
    /// Total laminate thickness, in mm - the whole stack, not the stored half.
    pub thickness: f64,
    /// How many candidates were built and evaluated. The honest measure of
    /// what the search cost.
    pub checked_laminates: usize,
    /// How many times a constraint was asked for a reserve factor.
    pub constraint_evaluations: usize,
    /// Whether the search reached a stack that carries the load.
    pub succeeded: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OptimizationError {
    /// No angles to choose from.
    NoAngles,
    /// No requirement to satisfy - every stack would do, including none.
    NoConstraints,
    /// A ply thickness of zero or less.
    NonPositiveThickness,
    /// The material the plies are made of is not in the catalogue.
    UnknownMaterial { id: String },
    /// The search hit `max_layers` without the stack carrying the load.
    ///
    /// Reported as a result rather than thrown, because the stack it got to is
    /// worth seeing - it says how far off the requirement is.
    Exhausted { layers: usize },
}

impl std::fmt::Display for OptimizationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OptimizationError::NoAngles => {
                write!(f, "the search needs at least one ply angle to choose from")
            }
            OptimizationError::NoConstraints => write!(
                f,
                "the search needs at least one requirement - without one, the empty laminate is already optimal"
            ),
            OptimizationError::NonPositiveThickness => {
                write!(f, "the ply thickness must be positive")
            }
            OptimizationError::UnknownMaterial { id } => {
                write!(f, "material '{id}' is not in the catalogue")
            }
            OptimizationError::Exhausted { layers } => write!(
                f,
                "no stack of up to {layers} plies from these angles carries the load"
            ),
        }
    }
}

impl std::error::Error for OptimizationError {}

/// The sequential decision approach.
/// Reference: eLamX2/.../optimization/sda/SequentialDecisionApproach.java
///
/// The simplest of eLamX's four optimisers and the one that always terminates:
/// add a ply in the middle, try it at every allowed angle, keep the angle that
/// leaves the best worst-case reserve factor, repeat until the stack carries
/// the load.
///
/// It is greedy, so it is not guaranteed to find the thinnest stack - a ply
/// chosen early is never revisited. What it is guaranteed to do is terminate
/// in `angles * layers` constraint evaluations rather than `angles^layers`,
/// which is why it is the one to have when the answer is wanted now.
pub fn sequential_decision(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
) -> Result<OptimizationResult, OptimizationError> {
    if input.angles.is_empty() {
        return Err(OptimizationError::NoAngles);
    }
    if input.constraints.is_empty() {
        return Err(OptimizationError::NoConstraints);
    }
    if input.thickness <= 0.0 {
        return Err(OptimizationError::NonPositiveThickness);
    }
    if !materials.contains_key(&input.material_id) {
        return Err(OptimizationError::UnknownMaterial { id: input.material_id.clone() });
    }

    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);

    let mut angles: Vec<f64> = Vec::new();
    let mut checked = 0usize;
    let mut evaluations = 0usize;

    while angles.len() < input.max_layers {
        // The new ply goes in the MIDDLE, which is what keeps a symmetric
        // stack symmetric as it grows and what makes the sequence build from
        // the outside in.
        let middle = angles.len() / 2;
        angles.insert(middle, input.angles[0]);

        let mut best = f64::NEG_INFINITY;
        let mut best_angle = input.angles[0];
        for candidate in &input.angles {
            angles[middle] = *candidate;
            let worst = worst_case(&angles, input, materials, criteria, symmetric, &mut evaluations);
            if worst > best {
                best = worst;
                best_angle = *candidate;
            }
        }
        angles[middle] = best_angle;
        checked += 1;

        if best >= 1.0 {
            let layer_count =
                build(&angles, input, materials, symmetric).map_or(angles.len(), |l| l.layers().len());
            return Ok(OptimizationResult {
                angles: angles.clone(),
                symmetric,
                layer_count,
                min_reserve_factor: best,
                thickness: input.thickness * layer_count as f64,
                checked_laminates: checked,
                constraint_evaluations: evaluations,
                succeeded: true,
            });
        }
    }

    Err(OptimizationError::Exhausted { layers: input.max_layers })
}

/// The smallest reserve factor this candidate gets from any of its
/// constraints.
fn worst_case(
    angles: &[f64],
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    symmetric: bool,
    evaluations: &mut usize,
) -> f64 {
    let Some(clt) = build(angles, input, materials, symmetric) else {
        return f64::NEG_INFINITY;
    };
    let mut worst = f64::INFINITY;
    for constraint in &input.constraints {
        *evaluations += 1;
        match constraint.reserve_factor(&clt, materials, criteria) {
            Some(value) => worst = worst.min(value),
            // A constraint that cannot judge this candidate rules it out - see
            // `Constraint::reserve_factor`.
            None => return f64::NEG_INFINITY,
        }
    }
    worst
}

/// One candidate as a CLT laminate.
fn build(
    angles: &[f64],
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    symmetric: bool,
) -> Option<CltLaminate> {
    let mut laminate = Laminate::new("opt", "opt");
    laminate.symmetric = symmetric;
    for (i, angle) in angles.iter().enumerate() {
        let mut layer = Layer::new(
            format!("l{i}"),
            format!("{}", i + 1),
            &input.material_id,
            *angle,
            input.thickness,
        );
        layer.criterion_id = Some(input.criterion_id.clone());
        laminate.layers.push(layer);
    }
    CltLaminate::new(&laminate, materials).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::default_criterion_registry;
    use crate::plate::BoundaryCondition;

    fn carbon() -> HashMap<String, Material> {
        let mut material =
            Material::new("cfk", "CFK", 141_000.0, 9_340.0, 0.35, 4_500.0, 1.7e-9);
        material.r_par_ten = 2000.0;
        material.set_r_par_com(1200.0);
        material.r_nor_ten = 50.0;
        material.set_r_nor_com(150.0);
        material.set_r_shear(70.0);
        let mut materials = HashMap::new();
        materials.insert("cfk".to_string(), material);
        materials
    }

    fn base(constraints: Vec<Constraint>) -> OptimizationInput {
        OptimizationInput {
            material_id: "cfk".to_string(),
            criterion_id: "max_stress".to_string(),
            constraints,
            ..Default::default()
        }
    }

    fn run(input: &OptimizationInput) -> Result<OptimizationResult, OptimizationError> {
        sequential_decision(input, &carbon(), &default_criterion_registry())
    }

    fn loads(n_x: f64, n_y: f64, n_xy: f64) -> Loads {
        Loads { n_x, n_y, n_xy, ..Default::default() }
    }

    /// Pulled along x and nothing else, the search has one sensible answer:
    /// put every fibre along x. Nothing in the code says so - the angles are
    /// all offered at every step and the criterion decides - which is what
    /// makes this a check on the search rather than on a table.
    #[test]
    fn a_stack_pulled_along_x_comes_out_all_zero_degrees() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();

        assert!(result.succeeded);
        assert!(result.angles.iter().all(|a| *a == 0.0), "{:?}", result.angles);
        assert!(result.min_reserve_factor >= 1.0);
        // And only just: a greedy search stops at the first stack that carries
        // the load, so one ply fewer must not.
        let thinner = OptimizationInput {
            max_layers: result.angles.len() - 1,
            ..base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])
        };
        assert!(matches!(run(&thinner), Err(OptimizationError::Exhausted { .. })));
    }

    /// Pure shear is carried by fibres at 45 degrees, so that is what comes
    /// out - and the pair, not one of them twice, because the criterion sees
    /// the sign of the shear.
    #[test]
    fn pure_shear_comes_out_at_forty_five_degrees() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(0.0, 0.0, 200.0) }])).unwrap();

        assert!(result.succeeded);
        assert!(
            result.angles.iter().all(|a| a.abs() == 45.0),
            "{:?}",
            result.angles
        );
    }

    /// Twice the load needs more plies. Not exactly twice - the reserve factor
    /// is not linear in the ply count once the stack starts carrying the load
    /// in more than one direction - but more, and monotonically so.
    #[test]
    fn a_bigger_load_needs_a_thicker_stack() {
        let mut previous = 0;
        for load in [200.0, 400.0, 800.0, 1600.0] {
            let result = run(&base(vec![Constraint::Clt { loads: loads(load, 0.0, 0.0) }])).unwrap();
            assert!(
                result.angles.len() > previous,
                "{load} N/mm: {} Lagen nach {previous}",
                result.angles.len()
            );
            assert_eq!(result.thickness, 0.125 * result.layer_count as f64);
            assert_eq!(result.layer_count, result.angles.len(), "unsymmetrisch: kein Spiegeln");
            previous = result.angles.len();
        }
    }

    /// Two load cases at once: the stack has to carry both, so it comes out
    /// thicker than either alone and mixes the angles they each want.
    #[test]
    fn two_load_cases_produce_a_stack_that_carries_both() {
        let along = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();
        let across = run(&base(vec![Constraint::Clt { loads: loads(0.0, 400.0, 0.0) }])).unwrap();
        let both = run(&base(vec![
            Constraint::Clt { loads: loads(400.0, 0.0, 0.0) },
            Constraint::Clt { loads: loads(0.0, 400.0, 0.0) },
        ]))
        .unwrap();

        assert!(both.angles.len() > along.angles.len());
        assert!(both.angles.len() > across.angles.len());
        // What it picks is NOT 0 and 90, which is what one expects before
        // looking: equal tension in both directions is carried best by plies
        // at 45 degrees, which take a share of each. That the greedy search
        // finds that rather than the obvious answer is the point of having it.
        assert!(both.angles.iter().all(|a| a.abs() == 45.0), "{:?}", both.angles);
        assert!(both.min_reserve_factor >= 1.0);
        // Both constraints were asked at every step, which is what the count
        // is for.
        assert!(both.constraint_evaluations >= 2 * both.checked_laminates);
    }

    /// A buckling constraint forces the stack symmetric whatever the input
    /// says - it solves on the D matrix and wants no B matrix under it.
    #[test]
    fn a_buckling_constraint_forces_a_symmetric_stack() {
        let buckling = Constraint::Buckling {
            input: BucklingInput {
                length: 300.0,
                width: 300.0,
                n_x: -1.0,
                bc_x: BoundaryCondition::SimplySimply,
                bc_y: BoundaryCondition::SimplySimply,
                m: 6,
                n: 6,
                ..Default::default()
            },
        };
        assert!(buckling.needs_symmetric_laminate());

        let result = run(&OptimizationInput {
            max_layers: 40,
            ..base(vec![buckling])
        })
        .unwrap();
        assert!(result.succeeded);
        assert!(result.symmetric, "eine Beulbedingung erzwingt Symmetrie");
        // The stored sequence is HALF the stack - a symmetric search adds two
        // plies per step, which is what the layer count has to show.
        assert_eq!(result.layer_count, 2 * result.angles.len());
        assert_eq!(result.thickness, 0.125 * result.layer_count as f64);
    }

    /// A deflection limit is a constraint like any other, and no limit is no
    /// constraint - not a limit of zero, which would be unsatisfiable.
    #[test]
    fn an_unset_deflection_limit_constrains_nothing() {
        let unset = Constraint::Deformation { input: DeformationInput::default() };
        let materials = carbon();
        let criteria = default_criterion_registry();
        let laminate = build(
            &[0.0, 90.0, 90.0, 0.0],
            &base(vec![unset.clone()]),
            &materials,
            true,
        )
        .unwrap();
        assert_eq!(unset.reserve_factor(&laminate, &materials, &criteria), Some(f64::INFINITY));

        let limited = Constraint::Deformation {
            input: DeformationInput { max_displacement_z: 1.0, ..Default::default() },
        };
        let factor = limited.reserve_factor(&laminate, &materials, &criteria).unwrap();
        assert!(factor.is_finite() && factor > 0.0, "{factor}");
    }

    /// A limit that is only just met needs fewer plies than a strict one.
    #[test]
    fn a_stricter_deflection_limit_needs_more_plies() {
        let stack_for = |allowable: f64| {
            run(&OptimizationInput {
                max_layers: 60,
                ..base(vec![Constraint::Deformation {
                    input: DeformationInput {
                        max_displacement_z: allowable,
                        ..Default::default()
                    },
                }])
            })
            .unwrap()
            .angles
            .len()
        };
        assert!(stack_for(1.0) > stack_for(5.0));
    }

    /// The greedy search is what it says: a ply chosen early is never
    /// revisited, so the count it lands on is an upper bound and not
    /// necessarily the minimum. Worth stating in a test rather than only in a
    /// comment, because it is the property that distinguishes this optimiser
    /// from the three eLamX offers beside it.
    #[test]
    fn the_search_costs_angles_times_layers_and_no_more() {
        let result = run(&base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])).unwrap();
        let angles = 4;
        assert_eq!(result.checked_laminates, result.angles.len());
        assert_eq!(result.constraint_evaluations, angles * result.angles.len());
    }

    #[test]
    fn the_guards_refuse_what_cannot_be_searched() {
        let materials = carbon();
        let criteria = default_criterion_registry();
        let ok = base(vec![Constraint::Clt { loads: loads(100.0, 0.0, 0.0) }]);

        assert_eq!(
            sequential_decision(
                &OptimizationInput { angles: vec![], ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NoAngles)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { constraints: vec![], ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NoConstraints)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { thickness: 0.0, ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::NonPositiveThickness)
        );
        assert_eq!(
            sequential_decision(
                &OptimizationInput { material_id: "nope".to_string(), ..ok.clone() },
                &materials,
                &criteria
            ),
            Err(OptimizationError::UnknownMaterial { id: "nope".to_string() })
        );

        // And a load no stack of these angles can ever carry stops rather than
        // running forever, which is what the original does.
        assert_eq!(
            sequential_decision(
                &OptimizationInput {
                    max_layers: 12,
                    constraints: vec![Constraint::Clt { loads: loads(1.0e7, 0.0, 0.0) }],
                    ..ok
                },
                &materials,
                &criteria
            ),
            Err(OptimizationError::Exhausted { layers: 12 })
        );
    }
}
