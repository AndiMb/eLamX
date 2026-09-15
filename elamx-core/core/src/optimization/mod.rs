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

use crate::clt::{
    calculate_pressure_vessel, determine_values, get_layer_results, CltLaminate, Loads,
    PressureVesselInput, Strains,
};
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
    /// The laminate has to hold as the wall of a pressure vessel: the reserve
    /// factor is the worst ply's under the boiler formula's load.
    PressureVessel { input: PressureVesselInput },
}

impl Constraint {
    /// Whether this constraint can only be evaluated on a symmetric stack.
    ///
    /// Buckling and deformation solve on the D matrix and want no B matrix
    /// under them, so eLamX forces the whole search symmetric as soon as one
    /// of them is present - not as an option but as a consequence.
    pub fn needs_symmetric_laminate(&self) -> bool {
        match self {
            Constraint::Clt { .. } | Constraint::PressureVessel { .. } => false,
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
            Constraint::PressureVessel { input } => {
                let result = calculate_pressure_vessel(laminate, materials, criteria, input).ok()?;
                let worst = result.layer_results.iter().fold(f64::INFINITY, |acc, r| {
                    acc.min(r.rr_lower.minimal_reserve_factor)
                        .min(r.rr_upper.minimal_reserve_factor)
                });
                Some(worst)
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
    /// For the genetic search: the generation its answer last improved in.
    ///
    /// The number that says whether the run was long enough. If it is close to
    /// the generation count, the search was still finding things when it was
    /// stopped; if it is far below, it had settled. `None` for the searches
    /// that have no generations.
    #[serde(default)]
    pub last_improvement: Option<usize>,
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
    /// A genetic search with no parents or no children.
    EmptyPopulation,
    /// The exhaustive search spent its evaluation budget.
    ///
    /// It has to have one: the original keeps every candidate at every level
    /// and expands all of them, so the work grows as `angles^layers` and there
    /// is no point at which it decides to stop.
    BudgetSpent { checked: usize },
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
            OptimizationError::EmptyPopulation => {
                write!(f, "a genetic search needs at least one parent and one child")
            }
            OptimizationError::BudgetSpent { checked } => write!(
                f,
                "the exhaustive search looked at {checked} stacking sequences without finding one that carries the load - it enumerates every order, so the work grows as angles^layers"
            ),
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
    check(input, materials)?;

    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);

    let mut angles: Vec<f64> = Vec::new();
    let mut checked = 0usize;
    let mut evaluations = 0usize;

    while angles.len() < input.max_layers {
        // Where the new ply goes is `getNumberofLayers() / 2` in the Java, and
        // that count is the WHOLE stack - doubled for a symmetric one. So the
        // index works out differently in the two cases, and both are right:
        // a symmetric stack appends to its stored half, which puts the ply at
        // the mid-plane and leaves the outer ones outer; an unsymmetric one
        // inserts in the middle of the real sequence.
        let at = if symmetric { angles.len() } else { angles.len() / 2 };
        angles.insert(at, input.angles[0]);

        let mut best = f64::NEG_INFINITY;
        let mut best_angle = input.angles[0];
        for candidate in &input.angles {
            angles[at] = *candidate;
            let worst = worst_case(&angles, input, materials, criteria, symmetric, &mut evaluations);
            if worst > best {
                best = worst;
                best_angle = *candidate;
            }
        }
        angles[at] = best_angle;
        checked += 1;

        if best >= 1.0 {
            return Ok(finish(
                angles.clone(),
                best,
                input,
                materials,
                symmetric,
                checked,
                evaluations,
            ));
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

/// Exhaustive breadth-first search over stacking sequences.
/// Reference: eLamX2/.../additionaloptimizers/branchandbound/BranchAndBoundOptimizer.java
///
/// **eLamX calls this "branch and bound" and it is not.** A branch-and-bound
/// prunes a branch once its best possible outcome cannot beat what is already
/// in hand; this keeps every candidate at every level and expands all of them,
/// so it visits `angles^n` stacks to reach depth `n`. With the default four
/// angles that is a million laminates at ten plies, each one a full CLT solve.
/// The name is kept because it is the one the file format and the user
/// interface use; the behaviour is described here so nobody expects pruning
/// that is not there. [`todoroki`] is the one that actually bounds.
///
/// What it does give is the true optimum for its depth: it looks at every
/// sequence, so nothing is missed by a greedy step. `budget` is what keeps
/// that from being a promise the machine cannot keep - the original has none
/// and simply runs until it finds something or the process is killed.
pub fn exhaustive(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    budget: usize,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;
    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);

    let mut level: Vec<Vec<f64>> = vec![Vec::new()];
    let mut checked = 0usize;
    let mut evaluations = 0usize;
    let mut best = f64::NEG_INFINITY;
    let mut best_angles: Vec<f64> = Vec::new();

    while level[0].len() < input.max_layers {
        // Every candidate at this level, extended by every angle. The ply goes
        // on the END here, not in the middle as the sequential search puts it
        // - which is the whole point of enumerating: the ORDER is what is
        // being searched over, and appending reaches every order.
        let mut next: Vec<Vec<f64>> = Vec::with_capacity(level.len() * input.angles.len());
        for candidate in &level {
            for angle in &input.angles {
                let mut extended = candidate.clone();
                extended.push(*angle);
                next.push(extended);
            }
        }

        for candidate in &next {
            let worst =
                worst_case(candidate, input, materials, criteria, symmetric, &mut evaluations);
            checked += 1;
            if worst > best {
                best = worst;
                best_angles = candidate.clone();
            }
            if checked >= budget {
                return Err(OptimizationError::BudgetSpent { checked });
            }
        }

        if best >= 1.0 {
            return Ok(finish(best_angles, best, input, materials, symmetric, checked, evaluations));
        }
        level = next;
    }

    Err(OptimizationError::Exhausted { layers: input.max_layers })
}

/// Todoroki's approach: bound the ply count first, then fill it in.
/// Reference: eLamX2/.../additionaloptimizers/todoroki/TodorokiOptimizer.java
///
/// The one optimiser here that earns the name the other one carries, and the
/// idea behind it is worth stating plainly.
///
/// A **super layer** is a ply that does not exist: isotropic, as stiff in
/// every direction as a real ply is along its fibres, and as strong in every
/// direction as the real ply is at its best. No real ply can beat it anywhere,
/// so a stack of `n` super layers that still fails proves that no real stack
/// of `n` plies can pass. Growing super layers until the stack passes
/// therefore gives a hard LOWER bound on the ply count - and running the
/// sequential search first gives an upper one.
///
/// Then the super layers are replaced by real plies one at a time, outside in,
/// keeping every partial stack that still passes. When the last super layer is
/// gone, what survives is a set of real stacks at the smallest count that can
/// work, and the best of them is the answer. If the survivors ever run out, the
/// count was too optimistic and another super layer is added.
///
/// eLamX marks this optimiser symmetric-only, and so is this.
pub fn todoroki(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    budget: usize,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;

    // The super material and the catalogue it lives in, beside the real one.
    let real = &materials[&input.material_id];
    let mut catalogue = materials.clone();
    let super_id = "__superlayer";
    catalogue.insert(super_id.to_string(), super_material(real));

    let mut checked = 0usize;
    let mut evaluations = 0usize;

    // 1. The lower bound: how many super layers it takes.
    let mut super_count = 0usize;
    loop {
        super_count += 1;
        if super_count > input.max_layers {
            return Err(OptimizationError::Exhausted { layers: input.max_layers });
        }
        let angles = vec![0.0; super_count];
        let kinds = vec![Ply::Super; super_count];
        let worst = worst_case_mixed(
            &angles,
            &kinds,
            input,
            &catalogue,
            super_id,
            criteria,
            &mut evaluations,
        );
        checked += 1;
        if checked >= budget {
            return Err(OptimizationError::BudgetSpent { checked });
        }
        if worst >= 1.0 {
            break;
        }
    }

    // 2. Replace the super layers, outermost first, keeping what still passes.
    let mut survivors: Vec<Vec<f64>> = vec![vec![0.0; super_count]];
    let mut replaced = 0usize;
    loop {
        if replaced == super_count {
            break;
        }
        let mut next: Vec<Vec<f64>> = Vec::new();
        for survivor in &survivors {
            for angle in &input.angles {
                let mut candidate = survivor.clone();
                candidate[replaced] = *angle;
                let kinds: Vec<Ply> = (0..super_count)
                    .map(|i| if i <= replaced { Ply::Real } else { Ply::Super })
                    .collect();
                let worst = worst_case_mixed(
                    &candidate,
                    &kinds,
                    input,
                    &catalogue,
                    super_id,
                    criteria,
                    &mut evaluations,
                );
                checked += 1;
                if checked >= budget {
                    return Err(OptimizationError::BudgetSpent { checked });
                }
                if worst >= 1.0 {
                    next.push(candidate);
                }
            }
        }

        if next.is_empty() {
            // The bound was too optimistic: one more super layer, start over.
            super_count += 1;
            if super_count > input.max_layers {
                return Err(OptimizationError::Exhausted { layers: input.max_layers });
            }
            survivors = vec![vec![0.0; super_count]];
            replaced = 0;
            continue;
        }

        survivors = next;
        replaced += 1;
    }

    // 3. The best of the survivors - all real plies by now.
    let mut best = f64::NEG_INFINITY;
    let mut best_angles = survivors[0].clone();
    for survivor in &survivors {
        let worst = worst_case(survivor, input, materials, criteria, true, &mut evaluations);
        if worst > best {
            best = worst;
            best_angles = survivor.clone();
        }
    }

    Ok(finish(best_angles, best, input, materials, true, checked, evaluations))
}

/// Whether a ply in a mixed stack is a real one or a super layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ply {
    Real,
    Super,
}

/// The ply no real ply can beat.
///
/// Isotropic at the real ply's fibre-direction stiffness, with Poisson's ratio
/// zero, and as strong in every direction as the real ply is at its strongest.
/// The shear strength is `2R/3` - and that one is eLamX's own note: "ACHTUNG:
/// Der Schubwert ist durch reine Versuche bestimmt", determined by trial. It
/// is the one number in the bound that is not an argument, so a super layer is
/// a near-bound rather than a proven one where shear governs.
fn super_material(real: &Material) -> Material {
    let e = real.e_par;
    let mut m = Material::new("__superlayer", "Superlayer", e, e, 0.0, e / 2.0, 0.0);
    let r = real.r_par_ten.max(real.r_par_com);
    m.r_par_ten = r;
    m.set_r_par_com(r);
    m.r_nor_ten = r;
    m.set_r_nor_com(r);
    m.set_r_shear(2.0 * r / 3.0);
    m
}

/// The worst reserve factor of a stack whose plies are a mix of real and
/// super ones.
#[allow(clippy::too_many_arguments)]
fn worst_case_mixed(
    angles: &[f64],
    kinds: &[Ply],
    input: &OptimizationInput,
    catalogue: &HashMap<String, Material>,
    super_id: &str,
    criteria: &CriterionRegistry,
    evaluations: &mut usize,
) -> f64 {
    let mut laminate = Laminate::new("opt", "opt");
    laminate.symmetric = true;
    for (i, angle) in angles.iter().enumerate() {
        let is_super = kinds[i] == Ply::Super;
        let mut layer = Layer::new(
            format!("l{i}"),
            format!("{}", i + 1),
            if is_super { super_id } else { &input.material_id },
            *angle,
            input.thickness,
        );
        // A super layer is judged by max stress, as eLamX judges it - the
        // criterion has to be one that reads the isotropic strengths it was
        // given rather than a composite one.
        layer.criterion_id =
            Some(if is_super { "max_stress".to_string() } else { input.criterion_id.clone() });
        laminate.layers.push(layer);
    }
    let Ok(clt) = CltLaminate::new(&laminate, catalogue) else {
        return f64::NEG_INFINITY;
    };

    let mut worst = f64::INFINITY;
    for constraint in &input.constraints {
        *evaluations += 1;
        match constraint.reserve_factor(&clt, catalogue, criteria) {
            Some(value) => worst = worst.min(value),
            None => return f64::NEG_INFINITY,
        }
    }
    worst
}

/// The guards every optimiser shares.
fn check(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
) -> Result<(), OptimizationError> {
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
    Ok(())
}

/// The result, with the layer count and thickness taken from the stack that
/// was actually built rather than from the stored sequence.
fn finish(
    angles: Vec<f64>,
    min_reserve_factor: f64,
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    symmetric: bool,
    checked: usize,
    evaluations: usize,
) -> OptimizationResult {
    let layer_count =
        build(&angles, input, materials, symmetric).map_or(angles.len(), |l| l.layers().len());
    OptimizationResult {
        angles,
        symmetric,
        layer_count,
        min_reserve_factor,
        thickness: input.thickness * layer_count as f64,
        checked_laminates: checked,
        constraint_evaluations: evaluations,
        succeeded: min_reserve_factor >= 1.0,
        last_improvement: None,
    }
}

/// The knobs of the genetic search.
/// Reference: eLamX2/.../optimization/hauffe/OptimizationParameter.java
///
/// The defaults are the original's, including the ones that look odd:
/// `stop_after_unchanged` equals `max_generations`, so it never ends the run
/// early on its own - what does end it is the restart rule below, and running
/// out of generations.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "../../../web/src/lib/generated/"))]
pub struct GeneticParameters {
    pub parents: usize,
    pub children: usize,
    /// Chance that a gene mutates, and that the ply count does.
    pub mutation_probability: f64,
    /// Chance that an angle shifts to its neighbour in the allowed list -
    /// a gentler mutation, which is what makes a sorted angle list matter.
    pub shift_probability: f64,
    pub max_generations: usize,
    /// Generations without an improvement before the population is rebuilt
    /// around the best individual.
    pub restart_after_unchanged: usize,
    /// How many plies of headroom the genome carries above the best found.
    pub delta_max_layers: usize,
    /// The seed.
    ///
    /// Not in the original, which calls `Math.random()` and therefore answers
    /// a different laminate every time it is asked the same question. A search
    /// may be stochastic; a program should still be able to repeat itself.
    ///
    /// 32 bits rather than 64 because it crosses a JSON boundary, where a
    /// 64-bit integer is a `bigint` and every caller would have to care.
    pub seed: u32,
}

impl Default for GeneticParameters {
    fn default() -> Self {
        GeneticParameters {
            parents: 60,
            children: 60,
            mutation_probability: 0.3,
            shift_probability: 0.2,
            max_generations: 6000,
            restart_after_unchanged: 400,
            delta_max_layers: 0,
            seed: 0x5eed_1a11,
        }
    }
}

/// One candidate in the population.
///
/// The genome is longer than the laminate: `angles` holds `max_layers` genes
/// and `layers` says how many of them are built. Mutating the count is
/// therefore free - the genes are already there - which is the trick that lets
/// one population search over thicknesses as well as over sequences.
#[derive(Debug, Clone, PartialEq)]
struct Individual {
    layers: usize,
    angles: Vec<f64>,
    min_reserve_factor: f64,
}

/// xorshift64*, so a run can be repeated.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // A zero state would stay zero forever.
        Rng(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// In `[0, 1)`.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// In `[0, bound)`, or zero when the bound is.
    fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            0
        } else {
            (self.unit() * bound as f64) as usize % bound
        }
    }

    fn between(&mut self, low: usize, high: usize) -> usize {
        if high <= low {
            low
        } else {
            low + self.below(high - low)
        }
    }
}

/// The genetic search.
/// Reference: eLamX2/.../optimization/hauffe/HauffeOptimizer.java and GEP.java
///
/// It starts where the other two leave off: the sequential search gives it a
/// first parent and an upper bound on the ply count, and a stack of super
/// layers gives it a lower one (the same super layer [`todoroki`] uses). The
/// population then works between those, and every time it finds something
/// thinner it rebuilds itself around it.
///
/// Five operators make the children, in the proportions the original uses: a
/// third mutated, and a sixth each of one-point crossover, two-point
/// crossover, permutation and angle shift. Replacement is by crowding - each
/// child challenges the parent it most resembles, so the population keeps its
/// spread instead of collapsing onto one sequence.
///
/// It is the only one of the four that can return a different answer to the
/// same question, which is why the seed is an input here and is not in the
/// original.
pub fn genetic(
    input: &OptimizationInput,
    materials: &HashMap<String, Material>,
    criteria: &CriterionRegistry,
    params: &GeneticParameters,
    budget: usize,
) -> Result<OptimizationResult, OptimizationError> {
    check(input, materials)?;
    if params.parents == 0 || params.children == 0 {
        return Err(OptimizationError::EmptyPopulation);
    }

    let symmetric =
        input.symmetric || input.constraints.iter().any(Constraint::needs_symmetric_laminate);
    let mut rng = Rng::new(params.seed as u64);
    let mut checked = 0usize;
    let mut evaluations = 0usize;

    // The upper bound, and the individual to start from.
    let seed_result = sequential_decision(input, materials, criteria)?;
    checked += seed_result.checked_laminates;
    evaluations += seed_result.constraint_evaluations;

    // The lower bound, from super layers - the same argument todoroki makes.
    let mut catalogue = materials.clone();
    let super_id = "__superlayer";
    catalogue.insert(super_id.to_string(), super_material(&materials[&input.material_id]));
    let mut min_layers = 1usize;
    loop {
        let kinds = vec![Ply::Super; min_layers];
        let worst = worst_case_mixed(
            &vec![0.0; min_layers],
            &kinds,
            input,
            &catalogue,
            super_id,
            criteria,
            &mut evaluations,
        );
        checked += 1;
        if worst >= 1.0 || min_layers >= seed_result.angles.len() {
            break;
        }
        min_layers += 1;
    }
    min_layers = min_layers.saturating_sub(1).max(1);

    let mut max_layers = seed_result.angles.len() + params.delta_max_layers;
    let evaluate = |individual: &mut Individual,
                        evaluations: &mut usize,
                        checked: &mut usize| {
        individual.min_reserve_factor = worst_case(
            &individual.angles[..individual.layers],
            input,
            materials,
            criteria,
            symmetric,
            evaluations,
        );
        *checked += 1;
    };

    // The first parent is the sequential answer, its genome padded out with
    // random angles so it has room to grow.
    let mut parents: Vec<Individual> = Vec::with_capacity(params.parents);
    let mut genome = seed_result.angles.clone();
    while genome.len() < max_layers {
        genome.push(input.angles[rng.below(input.angles.len())]);
    }
    let mut first = Individual {
        layers: seed_result.angles.len(),
        angles: genome,
        min_reserve_factor: f64::NEG_INFINITY,
    };
    evaluate(&mut first, &mut evaluations, &mut checked);
    parents.push(first);
    for _ in 1..params.parents {
        let mut fresh = random_individual(&mut rng, input, min_layers, max_layers);
        evaluate(&mut fresh, &mut evaluations, &mut checked);
        parents.push(fresh);
    }

    let mut best = pick_best(&parents);
    let mut unchanged = 0usize;
    let mut generation_of_last_change = 0usize;

    for generation in 0..params.max_generations {
        let mut children = breed(&mut rng, &parents, input, params, min_layers, max_layers);
        for child in &mut children {
            evaluate(child, &mut evaluations, &mut checked);
            if checked >= budget {
                return Err(OptimizationError::BudgetSpent { checked });
            }
        }

        crowding_replacement(&mut parents, children);
        let candidate = pick_best(&parents);
        if candidate == best {
            unchanged += 1;
        } else {
            best = candidate.clone();
            generation_of_last_change = generation + 1;
            unchanged = 0;
        }

        // Rebuild around the best whenever it got thinner, or when nothing has
        // moved for long enough. The genome shrinks with it, which is what
        // narrows the search as it converges.
        if max_layers > best.layers + params.delta_max_layers
            || unchanged > params.restart_after_unchanged
        {
            unchanged = 0;
            max_layers = best.layers + params.delta_max_layers;
            min_layers = best.layers.saturating_sub(1).max(1);
            let mut carried = best.clone();
            carried.angles.truncate(max_layers.max(carried.layers));
            parents[0] = carried;
            for slot in parents.iter_mut().skip(1) {
                let mut fresh = random_individual(&mut rng, input, min_layers, max_layers);
                evaluate(&mut fresh, &mut evaluations, &mut checked);
                *slot = fresh;
            }
        }
    }

    let angles = best.angles[..best.layers].to_vec();
    let mut result = finish(
        angles,
        best.min_reserve_factor,
        input,
        materials,
        symmetric,
        checked,
        evaluations,
    );
    result.last_improvement = Some(generation_of_last_change);
    Ok(result)
}

fn random_individual(
    rng: &mut Rng,
    input: &OptimizationInput,
    min_layers: usize,
    max_layers: usize,
) -> Individual {
    let layers = rng.between(min_layers, max_layers).max(1);
    let angles = (0..max_layers.max(layers))
        .map(|_| input.angles[rng.below(input.angles.len())])
        .collect();
    Individual { layers, angles, min_reserve_factor: f64::NEG_INFINITY }
}

/// The five operators, in the original's proportions: a third mutated and a
/// sixth each of the other four. At the default sixty children that is exactly
/// the original's 20/10/10/10/10.
fn breed(
    rng: &mut Rng,
    parents: &[Individual],
    input: &OptimizationInput,
    params: &GeneticParameters,
    min_layers: usize,
    max_layers: usize,
) -> Vec<Individual> {
    let n = params.children;
    let mutated = n / 3;
    let rest = (n - mutated) / 4;
    let mut children = Vec::with_capacity(n);

    let pick = |rng: &mut Rng| parents[rng.below(parents.len())].clone();

    for _ in 0..mutated {
        let mut child = pick(rng);
        if rng.unit() <= params.mutation_probability {
            child.layers = rng.between(min_layers, max_layers).max(1);
        }
        for gene in child.angles.iter_mut() {
            if rng.unit() <= params.mutation_probability {
                *gene = input.angles[rng.below(input.angles.len())];
            }
        }
        children.push(child);
    }

    // One-point and two-point crossover both produce children in pairs.
    for _ in 0..rest / 2 {
        let (mut a, mut b) = (pick(rng), pick(rng));
        let cut = rng.below(a.angles.len().min(b.angles.len()).max(1));
        swap_tail(&mut a, &mut b, cut, usize::MAX);
        children.push(a);
        children.push(b);
    }
    for _ in 0..rest / 2 {
        let (mut a, mut b) = (pick(rng), pick(rng));
        let span = a.angles.len().min(b.angles.len()).max(1);
        let first = rng.below(span);
        let second = first + rng.below(span - first);
        swap_tail(&mut a, &mut b, first, second);
        children.push(a);
        children.push(b);
    }

    // Permutation: the same genes in a new order, which keeps the mix and
    // changes only where each angle sits - the one operator that cannot make a
    // laminate out of angles it did not already have.
    for _ in 0..rest {
        let mut child = pick(rng);
        let mut pool = child.angles.clone();
        for slot in child.angles.iter_mut() {
            *slot = pool.remove(rng.below(pool.len()));
        }
        children.push(child);
    }

    // Angle shift: a gene steps to its neighbour in the allowed list rather
    // than jumping anywhere, and wraps round at the ends.
    for _ in 0..(n - children.len()) {
        let mut child = pick(rng);
        if rng.unit() <= params.mutation_probability {
            child.layers = rng.between(min_layers, max_layers).max(1);
        }
        for gene in child.angles.iter_mut() {
            if rng.unit() <= params.shift_probability {
                if let Some(at) = input.angles.iter().position(|a| a == gene) {
                    let step = if rng.unit() < 0.5 { 1 } else { input.angles.len() - 1 };
                    *gene = input.angles[(at + step) % input.angles.len()];
                }
            }
        }
        children.push(child);
    }

    children
}

fn swap_tail(a: &mut Individual, b: &mut Individual, from: usize, to: usize) {
    let end = to.min(a.angles.len()).min(b.angles.len());
    for i in from..end {
        std::mem::swap(&mut a.angles[i], &mut b.angles[i]);
    }
}

/// How unlike two individuals are: genes that differ, plus the difference in
/// ply count.
fn distance(a: &Individual, b: &Individual) -> usize {
    let shared = a.layers.min(b.layers);
    let differing = (0..shared)
        .filter(|i| a.angles.get(*i) != b.angles.get(*i))
        .count();
    differing + a.layers.abs_diff(b.layers)
}

/// Crowding: each child challenges the parent it most resembles.
///
/// Which keeps the population spread out - a child that is better than the
/// best parent but unlike it replaces its own neighbour instead, so a single
/// good sequence cannot take over.
fn crowding_replacement(parents: &mut [Individual], children: Vec<Individual>) {
    for child in children {
        let Some(nearest) = (0..parents.len()).min_by_key(|i| distance(&child, &parents[*i])) else {
            continue;
        };
        let parent = &parents[nearest];
        let better = (parent.min_reserve_factor < 1.0
            && child.min_reserve_factor > parent.min_reserve_factor)
            || (child.layers < parent.layers
                && (child.min_reserve_factor > 1.0
                    || child.min_reserve_factor > parent.min_reserve_factor))
            || (child.layers == parent.layers
                && child.min_reserve_factor > parent.min_reserve_factor);
        if better {
            parents[nearest] = child;
        }
    }
}

/// The best of a population: the thinnest that carries the load, and among
/// equals the one with the most margin.
fn pick_best(parents: &[Individual]) -> Individual {
    let mut best = parents[0].clone();
    if best.min_reserve_factor < 1.0 {
        if let Some(feasible) = parents.iter().find(|p| p.min_reserve_factor >= 1.0) {
            best = feasible.clone();
        }
    }
    for candidate in parents {
        // Thinner and feasible wins; equally thick with more margin wins too.
        // The two arms do the same thing on purpose - they are two different
        // reasons, and collapsing them into one condition would hide that the
        // first requires feasibility and the second does not.
        let thinner_and_carries =
            candidate.layers < best.layers && candidate.min_reserve_factor >= 1.0;
        let same_thickness_more_margin = candidate.layers == best.layers
            && candidate.min_reserve_factor > best.min_reserve_factor;
        if thinner_and_carries || same_thickness_more_margin {
            best = candidate.clone();
        }
    }
    best
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

    /// The exhaustive search looks at every order, so on a problem small
    /// enough for it to finish it cannot do worse than the greedy one.
    #[test]
    fn the_exhaustive_search_is_never_beaten_by_the_greedy_one() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let greedy = run(&input).unwrap();
        let every =
            exhaustive(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        assert!(every.succeeded);
        assert!(every.layer_count <= greedy.layer_count, "{} vs {}", every.layer_count, greedy.layer_count);
        assert!(every.min_reserve_factor >= 1.0);
    }

    /// And it costs what it says it costs: `angles^n` at depth n, which is why
    /// it needs a budget and the greedy one does not.
    #[test]
    fn the_exhaustive_search_pays_angles_to_the_power_of_layers() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let every =
            exhaustive(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        // Every level is fully enumerated, so the count is the sum of a
        // geometric series in the number of angles.
        let angles = input.angles.len();
        let expected: usize = (1..=every.angles.len()).map(|n| angles.pow(n as u32)).sum();
        assert_eq!(every.checked_laminates, expected);

        // A budget below that stops rather than running on.
        assert!(matches!(
            exhaustive(&input, &carbon(), &default_criterion_registry(), 10),
            Err(OptimizationError::BudgetSpent { .. })
        ));
    }

    /// Todoroki bounds the ply count from below with super layers and from
    /// above with the greedy search, so what it returns sits between the two -
    /// and it is a real stack, not a fictitious one.
    #[test]
    fn todoroki_lands_between_its_two_bounds() {
        let input = OptimizationInput {
            symmetric: true,
            ..base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }])
        };
        let greedy = run(&input).unwrap();
        let bounded = todoroki(&input, &carbon(), &default_criterion_registry(), 100_000).unwrap();

        assert!(bounded.succeeded);
        assert!(bounded.min_reserve_factor >= 1.0);
        assert!(
            bounded.layer_count <= greedy.layer_count,
            "{} vs {}",
            bounded.layer_count,
            greedy.layer_count
        );
        assert!(bounded.symmetric, "Todoroki ist nur symmetrisch definiert");
        // Every angle in the answer is one that was offered - no super layer
        // survived into the result.
        for angle in &bounded.angles {
            assert!(input.angles.contains(angle), "{angle} war nicht zur Wahl");
        }
    }

    /// The super layer is the bound, so it has to be at least as good as any
    /// real ply in every direction - otherwise the count it proves is not a
    /// bound at all.
    #[test]
    fn a_super_layer_beats_the_real_ply_it_stands_for() {
        let materials = carbon();
        let real = &materials["cfk"];
        let fake = super_material(real);

        // As stiff across as the real one is along, and isotropic.
        assert_eq!(fake.e_par, real.e_par);
        assert_eq!(fake.e_nor, real.e_par);
        assert!(fake.e_nor > real.e_nor);
        assert_eq!(fake.nue12, 0.0);

        // And as strong in every direction as the real one is at its best.
        let best = real.r_par_ten.max(real.r_par_com);
        for strength in [fake.r_par_ten, fake.r_par_com, fake.r_nor_ten, fake.r_nor_com] {
            assert_eq!(strength, best);
        }
        assert!(fake.r_nor_ten > real.r_nor_ten);
        // The shear value is the one eLamX arrived at by trial rather than by
        // argument - see `super_material`.
        assert_eq!(fake.r_shear, 2.0 * best / 3.0);
        assert!(fake.r_shear > real.r_shear);
    }

    /// All three searches agree that the same load needs about the same stack.
    /// They disagree about how hard they work for it, which is the whole
    /// reason there is more than one.
    #[test]
    fn the_three_searches_agree_on_the_answer_and_not_on_the_price() {
        let input = OptimizationInput {
            symmetric: true,
            ..base(vec![Constraint::Clt { loads: loads(600.0, 100.0, 0.0) }])
        };
        let materials = carbon();
        let criteria = default_criterion_registry();

        let greedy = sequential_decision(&input, &materials, &criteria).unwrap();
        let every = exhaustive(&input, &materials, &criteria, 200_000).unwrap();
        let bounded = todoroki(&input, &materials, &criteria, 200_000).unwrap();

        for result in [&greedy, &every, &bounded] {
            assert!(result.succeeded);
            assert!(result.min_reserve_factor >= 1.0);
        }
        // The exhaustive one is optimal by construction; neither of the others
        // can beat it, and neither should be far off.
        assert!(every.layer_count <= greedy.layer_count);
        assert!(every.layer_count <= bounded.layer_count);
        assert!(greedy.layer_count <= every.layer_count + 4);

        // The prices, in constraint evaluations, are orders apart.
        assert!(every.constraint_evaluations > 10 * greedy.constraint_evaluations);
    }

    fn quick() -> GeneticParameters {
        // The original's population with a handful of generations: enough to
        // exercise every operator and the restart, fast enough for a test.
        GeneticParameters { max_generations: 25, ..Default::default() }
    }

    /// The genetic search finds a stack that carries the load, and does not do
    /// worse than the greedy one it starts from - it begins with that answer
    /// as its first parent and only replaces it with something better.
    #[test]
    fn the_genetic_search_never_does_worse_than_the_start_it_was_given() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let materials = carbon();
        let criteria = default_criterion_registry();

        let greedy = sequential_decision(&input, &materials, &criteria).unwrap();
        let bred = genetic(&input, &materials, &criteria, &quick(), 200_000).unwrap();

        assert!(bred.succeeded);
        assert!(bred.min_reserve_factor >= 1.0);
        assert!(bred.layer_count <= greedy.layer_count, "{} vs {}", bred.layer_count, greedy.layer_count);
        for angle in &bred.angles {
            assert!(input.angles.contains(angle), "{angle} war nicht zur Wahl");
        }
    }

    /// **The same seed gives the same laminate.** The original calls
    /// `Math.random()` and therefore answers a different stack every time it
    /// is asked the same question; a search may be stochastic, a program
    /// should still be able to repeat itself.
    #[test]
    fn the_same_seed_gives_the_same_answer_and_a_different_one_does_not() {
        let input = base(vec![Constraint::Clt { loads: loads(500.0, 80.0, 0.0) }]);
        let materials = carbon();
        let criteria = default_criterion_registry();

        let once = genetic(&input, &materials, &criteria, &quick(), 200_000).unwrap();
        let again = genetic(&input, &materials, &criteria, &quick(), 200_000).unwrap();
        assert_eq!(once, again, "derselbe Startwert muss dasselbe Laminat liefern");

        let elsewhere = genetic(
            &input,
            &materials,
            &criteria,
            &GeneticParameters { seed: 12345, ..quick() },
            200_000,
        )
        .unwrap();
        // A different seed is allowed to find the same stack - and on an easy
        // problem it will - but it must have walked a different path to it.
        assert!(
            elsewhere.checked_laminates != once.checked_laminates
                || elsewhere.angles != once.angles,
            "ein anderer Startwert muss einen anderen Lauf ergeben"
        );
    }

    /// It reports which generation it last improved in, which is what says
    /// whether the run was long enough.
    #[test]
    fn it_says_when_it_stopped_improving() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let bred =
            genetic(&input, &carbon(), &default_criterion_registry(), &quick(), 200_000).unwrap();
        let at = bred.last_improvement.expect("die genetische Suche zaehlt Generationen");
        assert!(at <= quick().max_generations);

        // And the other three have no generations to report.
        assert_eq!(run(&input).unwrap().last_improvement, None);
    }

    /// Every operator runs and none of them produces a genome the rest cannot
    /// use: the sizes stay consistent, the angles stay in the allowed set, and
    /// the ply count stays within the bounds.
    #[test]
    fn the_operators_leave_a_usable_population() {
        let input = OptimizationInput {
            angles: vec![0.0, 30.0, -30.0, 60.0, -60.0, 90.0],
            ..base(vec![Constraint::Clt { loads: loads(300.0, 0.0, 100.0) }])
        };
        let bred = genetic(
            &input,
            &carbon(),
            &default_criterion_registry(),
            &GeneticParameters { max_generations: 15, ..Default::default() },
            200_000,
        )
        .unwrap();

        assert!(bred.succeeded);
        assert_eq!(bred.angles.len(), bred.layer_count, "unsymmetrisch: kein Spiegeln");
        for angle in &bred.angles {
            assert!(input.angles.contains(angle), "{angle} stammt nicht aus der Auswahl");
        }
    }

    /// A budget stops it, and an empty population is refused rather than
    /// indexed into.
    #[test]
    fn the_genetic_guards_hold() {
        let input = base(vec![Constraint::Clt { loads: loads(400.0, 0.0, 0.0) }]);
        let materials = carbon();
        let criteria = default_criterion_registry();

        assert!(matches!(
            genetic(&input, &materials, &criteria, &quick(), 20),
            Err(OptimizationError::BudgetSpent { .. })
        ));
        assert_eq!(
            genetic(
                &input,
                &materials,
                &criteria,
                &GeneticParameters { parents: 0, ..quick() },
                200_000
            ),
            Err(OptimizationError::EmptyPopulation)
        );
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
